import 'dotenv/config'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cron from 'node-cron'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHANNELS_FILE = path.join(ROOT, 'config', 'channels.json')
const SETTINGS_FILE = path.join(ROOT, 'config', 'settings.json')
const STATE_FILE    = path.join(ROOT, 'config', 'state.json')
const INBOX_DIR     = path.join(ROOT, 'inbox')
const MEDIA_DIR     = path.join(ROOT, 'inbox', 'media')

const SLOW_DELAY = { large: 180_000, small: 60_000 }

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')) } catch { return {} }
}
async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}

async function fetchChannel(client, channel, state, backfillSince = null) {
  const handle = channel.handle
  const entity = await client.getEntity(handle)
  let messages = []

  if (backfillSince) {
    const sinceTs = Math.floor(backfillSince.getTime() / 1000)
    let offsetId = 0
    while (true) {
      const opts = { limit: 100, reverse: true, offsetDate: sinceTs }
      if (offsetId) opts.offsetId = offsetId
      const batch = await client.getMessages(entity, opts)
      if (!batch.length) break
      const fresh = batch.filter(m => m.date >= sinceTs)
      messages.push(...fresh)
      if (batch.length < 100) break
      offsetId = batch[batch.length - 1].id
      await sleep(2000)
    }
  } else {
    const minId = state[handle]?.lastMessageId ?? 0
    messages = await client.getMessages(entity, { limit: 50, minId })
  }

  if (!messages.length) return { channel: handle, count: 0 }

  await mkdir(MEDIA_DIR, { recursive: true })

  let savedCount = 0
  let maxId = state[handle]?.lastMessageId ?? 0

  for (const msg of messages) {
    if (!msg.message && !msg.media) continue

    const item = {
      channel:   handle,
      category:  channel.category,
      messageId: msg.id,
      date:      new Date(msg.date * 1000).toISOString(),
      text:      msg.message || '',
      mediaType: null,
      mediaPath: null,
      mimeType:  null,
    }

    if (msg.media) {
      const cls = msg.media.className
      if (cls === 'MessageMediaPhoto') {
        item.mediaType = 'photo'
        item.mediaPath = path.join(MEDIA_DIR, `${handle.slice(1)}_${msg.id}.jpg`)
        await client.downloadMedia(msg, { outputFile: item.mediaPath })
      } else if (cls === 'MessageMediaDocument') {
        const mime = msg.media.document?.mimeType || ''
        if (mime === 'application/pdf') {
          item.mediaType = 'document'
          item.mimeType  = mime
          item.mediaPath = path.join(MEDIA_DIR, `${handle.slice(1)}_${msg.id}.pdf`)
          await client.downloadMedia(msg, { outputFile: item.mediaPath })
        }
      }
    }

    const dateStr = item.date.slice(0, 10)
    const filename = `${dateStr}_${handle.slice(1)}_${msg.id}.json`
    await writeFile(path.join(INBOX_DIR, filename), JSON.stringify(item, null, 2))
    savedCount++
    if (msg.id > maxId) maxId = msg.id
  }

  state[handle] = { lastMessageId: maxId, lastPolledAt: new Date().toISOString() }
  return { channel: handle, count: savedCount }
}

async function runCycle(client, opts = {}) {
  const { backfill = false, channelFilter = null, hours = null } = opts
  const { channels } = JSON.parse(await readFile(CHANNELS_FILE, 'utf8'))
  const { backfillDefaultHours } = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))
  const state = await loadState()

  const targets = channels.filter(
    ch => ch.enabled && (!channelFilter || ch.handle === channelFilter)
  )

  const backfillSince = backfill
    ? new Date(Date.now() - (hours ?? backfillDefaultHours) * 3600 * 1000)
    : null

  const results = []
  for (const ch of targets) {
    try {
      const r = await fetchChannel(client, ch, state, backfillSince)
      results.push(r)
      console.log(`[${ch.handle}] ${r.count}건 수집`)
    } catch (err) {
      console.error(`[${ch.handle}] 오류:`, err.message)
      results.push({ channel: ch.handle, count: 0, error: err.message })
    }
    await sleep(ch.large ? SLOW_DELAY.large : SLOW_DELAY.small)
  }

  await saveState(state)
  return results
}

async function createClient() {
  if (!process.env.TG_SESSION) {
    console.error('오류: TG_SESSION이 .env에 없습니다. npm run auth 를 먼저 실행하세요.')
    process.exit(1)
  }
  const client = new TelegramClient(
    new StringSession(process.env.TG_SESSION),
    Number(process.env.TG_API_ID),
    process.env.TG_API_HASH,
    { connectionRetries: 5 },
  )
  await client.connect()
  return client
}

// --- entrypoint ---
const args = process.argv.slice(2)
const isBackfill    = args.includes('--backfill')
const channelFilter = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : null
const hours         = args.includes('--hours')   ? Number(args[args.indexOf('--hours') + 1]) : null

const client = await createClient()

if (isBackfill || channelFilter) {
  console.log('Backfill 시작...')
  const results = await runCycle(client, { backfill: true, channelFilter, hours })
  console.log('Backfill 완료:', results)
  await client.disconnect()
} else {
  console.log(`Monitor 시작 (1h cycle) — ${new Date().toLocaleString('ko-KR')}`)
  await runCycle(client)

  cron.schedule('0 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Cycle 시작`)
    const results = await runCycle(client)
    console.log('Cycle 완료:', results)
    // Phase 5에서 reporter.js 호출 추가
  })
}

export { runCycle, createClient }
