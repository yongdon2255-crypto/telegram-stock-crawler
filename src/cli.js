import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const ROOT          = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHANNELS_FILE = path.join(ROOT, 'config', 'channels.json')

async function load() {
  return JSON.parse(await readFile(CHANNELS_FILE, 'utf8'))
}

async function save(data) {
  await writeFile(CHANNELS_FILE, JSON.stringify(data, null, 2) + '\n')
}

function find(channels, handle) {
  return channels.find(c => c.handle === handle)
}

// --- commands ---

function listChannels(channels) {
  if (!channels.length) { console.log('등록된 채널 없음'); return }
  const pad = s => String(s).padEnd(22)
  console.log(pad('핸들') + pad('카테고리') + '상태    large')
  console.log('-'.repeat(56))
  for (const c of channels) {
    console.log(
      pad(c.handle) +
      pad(c.category) +
      (c.enabled ? '활성  ' : '비활성') + '  ' +
      (c.large ? 'Y' : 'N')
    )
  }
  console.log(`\n총 ${channels.length}개 채널 (활성: ${channels.filter(c=>c.enabled).length}개)`)
}

async function addChannel(channels, handle, category, large) {
  if (!handle.startsWith('@')) handle = '@' + handle
  if (find(channels, handle)) {
    console.log(`이미 등록된 채널: ${handle}`)
    return channels
  }
  channels.push({ handle, category, large, pollingIntervalSec: 3600, enabled: true })
  console.log(`추가: ${handle} [${category}] large=${large}`)
  return channels
}

function removeChannel(channels, handle) {
  if (!handle.startsWith('@')) handle = '@' + handle
  const before = channels.length
  const next = channels.filter(c => c.handle !== handle)
  if (next.length === before) console.log(`채널 없음: ${handle}`)
  else console.log(`삭제: ${handle}`)
  return next
}

function setEnabled(channels, handle, enabled) {
  if (!handle.startsWith('@')) handle = '@' + handle
  const ch = find(channels, handle)
  if (!ch) { console.log(`채널 없음: ${handle}`); return channels }
  ch.enabled = enabled
  console.log(`${handle} → ${enabled ? '활성' : '비활성'}`)
  return channels
}

function setLarge(channels, handle, large) {
  if (!handle.startsWith('@')) handle = '@' + handle
  const ch = find(channels, handle)
  if (!ch) { console.log(`채널 없음: ${handle}`); return channels }
  ch.large = large
  console.log(`${handle} large=${large}`)
  return channels
}

// --- entrypoint ---

const [cmd, ...rest] = process.argv.slice(2)

if (!cmd || cmd === 'help') {
  console.log(`
사용법:
  node src/cli.js list
  node src/cli.js add @handle --category 반도체 [--large]
  node src/cli.js remove @handle
  node src/cli.js enable @handle
  node src/cli.js disable @handle
  node src/cli.js large @handle [true|false]
`)
  process.exit(0)
}

const data     = await load()
const channels = data.channels

switch (cmd) {
  case 'list': {
    listChannels(channels)
    break
  }

  case 'add': {
    const handle   = rest[0]
    const catIdx   = rest.indexOf('--category')
    const category = catIdx !== -1 ? rest[catIdx + 1] : '기타'
    const large    = rest.includes('--large')
    if (!handle) { console.error('handle 필요. 예: add @kwusa --category 미국주식'); process.exit(1) }
    data.channels = await addChannel(channels, handle, category, large)
    await save(data)

    // backfill 자동 실행
    const h = handle.startsWith('@') ? handle : '@' + handle
    console.log(`\nBackfill 시작 (기본 39시간)...`)
    execFile('node', ['src/monitor.js', '--backfill', '--channel', h], { cwd: ROOT },
      (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout)
        if (err) console.error(stderr || err.message)
      }
    )
    break
  }

  case 'remove': {
    const handle = rest[0]
    if (!handle) { console.error('handle 필요. 예: remove @kwusa'); process.exit(1) }
    data.channels = removeChannel(channels, handle)
    await save(data)
    break
  }

  case 'enable': {
    const handle = rest[0]
    if (!handle) { console.error('handle 필요'); process.exit(1) }
    data.channels = setEnabled(channels, handle, true)
    await save(data)
    break
  }

  case 'disable': {
    const handle = rest[0]
    if (!handle) { console.error('handle 필요'); process.exit(1) }
    data.channels = setEnabled(channels, handle, false)
    await save(data)
    break
  }

  case 'large': {
    const handle = rest[0]
    const val    = rest[1] !== 'false'
    if (!handle) { console.error('handle 필요'); process.exit(1) }
    data.channels = setLarge(channels, handle, val)
    await save(data)
    break
  }

  default:
    console.error(`알 수 없는 명령: ${cmd}. 'node src/cli.js help' 참고`)
    process.exit(1)
}
