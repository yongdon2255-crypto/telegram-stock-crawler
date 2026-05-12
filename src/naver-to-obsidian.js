import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchNaverPremium } from './web-fetcher.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SETTINGS_FILE = path.join(ROOT, 'config', 'settings.json')

function vaultRoot() {
  const p = process.env.OBSIDIAN_VAULT_PATH
  if (!p) throw new Error('OBSIDIAN_VAULT_PATH가 .env에 없습니다.')
  return p
}

function kstParts(date = new Date()) {
  const d = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const pad = n => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}`,
    timestamp: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00+09:00`,
  }
}

function safeFilename(value) {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function yamlString(value) {
  return String(value || '').replace(/"/g, '\\"')
}

async function main() {
  const url = process.argv[2]
  if (!url) {
    console.error('usage: node src/naver-to-obsidian.js <NAVER_PREMIUM_URL>')
    process.exit(4)
  }

  const { stockNewsFolder } = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))
  const data = await fetchNaverPremium(url)
  const category = '주식분석'
  const { date, time, timestamp } = kstParts()
  const dir = path.join(vaultRoot(), stockNewsFolder, date, category)
  await mkdir(dir, { recursive: true })

  const title = data.title || data.id || 'naver-premium'
  const filename = `naver-premium-mesegong_${time}_${safeFilename(title)}.md`
  const filepath = path.join(dir, filename)
  const images = (data.images || []).map((src, i) => `${i + 1}. ${src}`).join('\n')

  const content = `---
source: "naver-premium-mesegong"
category: "${category}"
importance: "중"
date: "${timestamp}"
sourceUrl: "${yamlString(data.sourceUrl || url)}"
accessLevel: "${yamlString(data.accessLevel)}"
isPaywalled: ${Boolean(data.isPaywalled)}
tags: [stock, ${category}, naver-premium]
---

# ${title}

## 요약

${data.summary || ''}

## 원문

${data.body || ''}

## 이미지

${images || '없음'}

---
*수집: naver-premium-mesegong · ${date} ${time.slice(0, 2)}:${time.slice(2)} KST*
`

  await writeFile(filepath, content, 'utf8')
  console.log(filepath)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
