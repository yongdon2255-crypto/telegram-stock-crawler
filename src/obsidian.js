import 'dotenv/config'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cron from 'node-cron'

const ROOT         = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SETTINGS_FILE = path.join(ROOT, 'config', 'settings.json')

function vaultRoot() {
  const p = process.env.OBSIDIAN_VAULT_PATH
  if (!p) throw new Error('OBSIDIAN_VAULT_PATH가 .env에 없습니다.')
  return p
}

function toKST(isoString) {
  return new Date(new Date(isoString).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
}

function formatKST(isoString) {
  const d = toKST(isoString)
  const pad = n => String(n).padStart(2, '0')
  return {
    date:      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
    time:      `${pad(d.getHours())}${pad(d.getMinutes())}`,
    timestamp: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00+09:00`,
  }
}

export async function writeObsidianNote(item, result) {
  const { stockNewsFolder } = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))
  const { date, time, timestamp } = formatKST(item.date)
  const category = result.category || item.category
  const handle   = item.channel.replace('@', '')

  const dir = path.join(vaultRoot(), stockNewsFolder, date, category)
  await mkdir(dir, { recursive: true })

  const filename = `${handle}_${time}.md`
  const filepath = path.join(dir, filename)

  const content = `---
source: "${item.channel}"
category: "${category}"
importance: "${result.importance}"
date: "${timestamp}"
tags: [stock, ${category}]
---

## 요약

${result.summary}

## 원문

${item.text || ''}
${item.mediaPath ? `\n_첨부파일: ${path.basename(item.mediaPath)}_` : ''}

---
*수집: ${item.channel} · ${date} ${time.slice(0,2)}:${time.slice(2)} KST*
`

  await writeFile(filepath, content, 'utf8')
  console.log(`[obsidian] 저장: Stock News/${date}/${category}/${filename}`)
  return filepath
}

export async function writeDailyDigest() {
  const { stockNewsFolder, dailyDigestFolder } = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))
  const today     = formatKST(new Date().toISOString()).date
  const newsRoot  = path.join(vaultRoot(), stockNewsFolder, today)

  // 오늘 저장된 모든 .md 수집
  const entries = []
  try {
    const categories = await readdir(newsRoot)
    for (const cat of categories) {
      const catDir = path.join(newsRoot, cat)
      const files  = (await readdir(catDir)).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const raw  = await readFile(path.join(catDir, file), 'utf8')
        const imp  = (raw.match(/importance:\s*"(.+)"/) || [])[1] || '하'
        const sum  = (raw.match(/## 요약\n\n(.+)/) || [])[1] || ''
        const src  = (raw.match(/source:\s*"(.+)"/) || [])[1] || ''
        entries.push({ category: cat, importance: imp, summary: sum, source: src })
      }
    }
  } catch {
    console.log('[digest] 오늘 수집된 항목 없음')
    return
  }

  const order = { 상: 0, 중: 1, 하: 2 }
  entries.sort((a, b) => (order[a.importance] ?? 3) - (order[b.importance] ?? 3))

  const byCategory = {}
  for (const e of entries) {
    if (!byCategory[e.category]) byCategory[e.category] = []
    byCategory[e.category].push(e)
  }

  let body = `# ${today} 주식 뉴스 요약\n\n`
  for (const [cat, items] of Object.entries(byCategory)) {
    body += `## ${cat} (${items.length}건)\n`
    for (const e of items) {
      body += `- [${e.importance}] ${e.summary} — ${e.source}\n`
    }
    body += '\n'
  }

  const digestDir = path.join(vaultRoot(), stockNewsFolder, dailyDigestFolder)
  await mkdir(digestDir, { recursive: true })
  const digestPath = path.join(digestDir, `${today}.md`)
  await writeFile(digestPath, body, 'utf8')
  console.log(`[digest] 저장: ${stockNewsFolder}/${dailyDigestFolder}/${today}.md`)
}

// Daily Digest 스케줄 (평일 14:00 KST)
const { digestSchedule } = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))
cron.schedule(digestSchedule, writeDailyDigest, { timezone: 'Asia/Seoul' })
