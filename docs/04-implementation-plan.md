# 최종 구현 계획

## 구현 범위 (확정)

| # | 컴포넌트 | 파일 | 상태 |
|---|----------|------|------|
| 1 | MTProto 인증 | `src/auth.js` | 구현 예정 |
| 2 | Polling + **slow rule** | `src/monitor.js` | 구현 예정 |
| 3 | inbox 이동 | `src/handoff.js` | 구현 예정 |
| 4 | OCR + 요약 | `src/processor.js` | 구현 예정 |
| 5 | Claude CLI 래퍼 | `src/claude-runner.js` | 구현 예정 |
| 6 | Obsidian 저장 | `src/obsidian.js` | 구현 예정 |
| 7 | **텔레그램 리포트** | `src/reporter.js` | 구현 예정 |
| 8 | 채널 관리 CLI | `src/cli.js` | 구현 예정 |

> REST API 서버는 이번 범위에서 제외. 채널 관리는 CLI(`src/cli.js`)로 처리.

---

## Phase 0 — 프로젝트 초기화

```bash
npm init -y
npm install telegram dotenv pdf-parse node-cron
```

`config/channels.json` 초기값:

```json
{
  "channels": [
    { "handle": "@kiwoom_semibat", "category": "반도체",  "large": true,  "pollingIntervalSec": 3600, "enabled": true },
    { "handle": "@kwusa",          "category": "미국주식", "large": false, "pollingIntervalSec": 3600, "enabled": true },
    { "handle": "@merITz_tech",    "category": "IT/Tech", "large": false, "pollingIntervalSec": 3600, "enabled": true },
    { "handle": "@skitteam",       "category": "IT/Tech", "large": false, "pollingIntervalSec": 3600, "enabled": true },
    { "handle": "@KISemicon",      "category": "반도체",  "large": false, "pollingIntervalSec": 3600, "enabled": true }
  ]
}
```

`config/settings.json`:

```json
{
  "stockNewsFolder": "Stock News",
  "dailyDigestFolder": "Daily Digest",
  "retentionDays": 7,
  "digestSchedule": "0 14 * * 1-5",
  "backfillDefaultHours": 39
}
```

---

## Phase 1 — 인증 (`src/auth.js`)

최초 1회 실행해 `TG_SESSION` 생성. 이후 재사용.

**핵심 로직:**
```js
const client = new TelegramClient(new StringSession(''), apiId, apiHash, {})
await client.start({ phoneNumber, password, phoneCode, onError })
console.log('TG_SESSION=' + client.session.save())
```

---

## Phase 2 — Polling + Slow Rule (`src/monitor.js`)

### 주요 동작

1. `node-cron`으로 1시간마다 실행
2. `channels.json`에서 `enabled: true` 채널 목록 로드
3. 각 채널 순서대로 처리:
   - 마지막 수집 시각 이후 메시지 fetch
   - raw JSON → `inbox/{date}_{channel}_{msgId}.json` 저장
   - **slow rule 딜레이 적용 후 다음 채널 이동**
4. 전체 완료 후 `reporter.js` 호출

### Slow Rule 구현

```js
const DELAY = { large: 180_000, default: 60_000 }

for (const ch of channels) {
  await fetchChannel(client, ch)
  await sleep(ch.large ? DELAY.large : DELAY.default)
}
```

### Backfill 모드

```bash
npm run backfill
# 또는 특정 채널
node src/monitor.js --backfill --channel @kiwoom_semibat --hours 24
```

`backfillSinceISO` 기준: 당일 09:00 KST 이전 추가 시 전일 09:00부터 backfill.

---

## Phase 3 — handoff + processor

### `src/handoff.js`

`inbox/` 파일을 순서대로 읽어 `processor.js`로 전달.
처리 완료 파일은 `processed/`로 이동.

### `src/processor.js`

```
메시지 타입 판별
├─ text only    → 바로 claude-runner로 전달
├─ PDF 첨부     → pdf-parse → 텍스트 → claude-runner
└─ 이미지 첨부  → claude-runner (--image 플래그, vision 모드)
```

반환 JSON:
```json
{ "summary": "...", "category": "반도체", "importance": "상" }
```

### `src/claude-runner.js`

```js
export async function runClaude(prompt, imagePath = null) {
  const args = ['-p', prompt]
  if (imagePath) args.push('--image', imagePath)
  const { stdout } = await execFileAsync('claude', args, { timeout: 60_000 })
  return stdout.trim()
}
```

---

## Phase 4 — Obsidian 저장 (`src/obsidian.js`)

저장 경로: `{OBSIDIAN_VAULT_PATH}/Stock News/{YYYY-MM-DD}/{category}/{source}_{HHmm}.md`

YAML frontmatter:
```yaml
---
source: "@kiwoom_semibat"
category: "반도체"
importance: "상"
date: "2026-05-11T14:00:00+09:00"
tags: [stock, 반도체]
---
```

**Daily Digest** (`node-cron` 평일 14:00 KST):
`Stock News/Daily Digest/{YYYY-MM-DD}.md` — 당일 수집 항목을 중요도순으로 정리.

---

## Phase 5 — 텔레그램 리포트 (`src/reporter.js`)

cycle 완료 후 `REPORT_CHAT_ID`로 상태 메시지 전송. **기존 gramjs 클라이언트 재사용** (추가 토큰 불필요).

### 전송 메시지 형식

```
📊 크롤러 cycle 완료 (2026-05-11 14:00 KST)

수집 채널: 5개
신규 메시지: 23건
  └ 반도체: 12건 | 미국주식: 7건 | IT/Tech: 4건
Obsidian 저장: 23건

다음 cycle: ~60분 후 (15:00 KST)
```

### 구현 패턴

```js
import { reportCycle } from './reporter.js'

// monitor.js 끝에서 호출
await reportCycle(client, {
  channelCount: 5,
  newMessages: 23,
  byCategory: { '반도체': 12, '미국주식': 7, 'IT/Tech': 4 },
  nextCycleAt: nextRunTime,
})
```

```js
// reporter.js
export async function reportCycle(client, stats) {
  const text = formatReport(stats)
  await client.sendMessage(process.env.REPORT_CHAT_ID, { message: text })
}
```

---

## Phase 6 — 채널 관리 CLI (`src/cli.js`)

```bash
node src/cli.js add-channel @handle --category 반도체 [--large]
node src/cli.js remove-channel @handle
node src/cli.js list-channels
node src/cli.js enable @handle
node src/cli.js disable @handle
```

channels.json을 직접 읽고 쓰는 단순 CLI. backfill은 add 직후 자동 실행.

---

## 구현 순서 요약

```
Phase 0 (초기화)    → package.json, config/*.json, .env
Phase 1 (인증)      → src/auth.js
Phase 2 (수집)      → src/monitor.js (slow rule 포함)
Phase 3 (처리)      → src/handoff.js → src/processor.js → src/claude-runner.js
Phase 4 (저장)      → src/obsidian.js
Phase 5 (리포트)    → src/reporter.js
Phase 6 (CLI)       → src/cli.js
스케줄링            → launchd plist (docs/03-obsidian-setup.md 참고)
```

각 Phase는 독립적으로 테스트 가능. Phase 2까지 완료하면 inbox에 raw JSON이 쌓이는 것을 확인할 수 있음.
