import 'dotenv/config'
import { readdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { processMessage } from './processor.js'
import { writeObsidianNote } from './obsidian.js'

const ROOT         = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INBOX_DIR    = path.join(ROOT, 'inbox')
const PROCESSED_DIR = path.join(ROOT, 'processed')

export async function processInbox() {
  const files = (await readdir(INBOX_DIR))
    .filter(f => f.endsWith('.json'))
    .sort()

  if (!files.length) {
    console.log('inbox: 처리할 파일 없음')
    return { ok: 0, skipped: 0, error: 0 }
  }

  console.log(`inbox: ${files.length}건 처리 시작`)
  const stats = { ok: 0, skipped: 0, error: 0 }

  for (const filename of files) {
    const src  = path.join(INBOX_DIR, filename)
    const dest = path.join(PROCESSED_DIR, filename)

    try {
      const item   = JSON.parse(await readFile(src, 'utf8'))
      const result = await processMessage(item)

      if (result) {
        await writeObsidianNote(item, result)
        stats.ok++
      } else {
        stats.skipped++
      }
      await rename(src, dest)
    } catch (err) {
      console.error(`[${filename}] 처리 오류:`, err.message)
      stats.error++
    }
  }

  console.log(`완료 — 저장: ${stats.ok}, 건너뜀: ${stats.skipped}, 오류: ${stats.error}`)
  return stats
}

// npm run process (--once flag)
if (process.argv.includes('--once')) {
  await processInbox()
  process.exit(0)
}
