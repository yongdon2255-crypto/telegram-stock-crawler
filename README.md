# Korean Stock Intelligence Crawler

한국 증권사 텔레그램 채널과 경제 뉴스 포털을 자동 수집·요약해 Obsidian에 저장하는 로컬 파이프라인.

## 개요

- **텔레그램 MTProto** — 증권사 리서치 채널 (공개·비공개) 1시간 주기 polling
- **웹 크롤러** — 연합인포맥스·매일경제·한국경제 등 경제 뉴스 사이트 (Puppeteer/fetch)
- **Apple Vision OCR** — 이미지·차트에서 텍스트 추출 (macOS 내장, 추가 비용 없음)
- **Claude OAuth** — `claude` CLI subprocess로 요약·분류 (API 키 불필요, 구독 사용)
- **Obsidian** — 카테고리·중요도 frontmatter가 붙은 Markdown으로 저장

```
텔레그램 채널                     웹 뉴스 포털
     │                                 │
[monitor.js]                   [web-crawler.js]
 slow rule                      Puppeteer/fetch
     │                                 │
     └─────────────┬───────────────────┘
                   ▼
              inbox/ (raw JSON)
                   │
             [handoff.js]
                   │
            [processor.js]
   텍스트 → Claude 요약
   PDF    → pdf-parse → Claude 요약
   이미지  → Apple Vision OCR → Claude 요약 (또는 직접 저장)
                   │
            [obsidian.js] → Vault .md
            [reporter.js] → 텔레그램 상태 리포트
```

## 빠른 시작

### 1. 설치

```bash
git clone https://github.com/DWL21/telegram-stock-crawler.git
cd telegram-stock-crawler
npm install
```

### 2. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 편집:

```dotenv
TG_API_ID=1234567           # my.telegram.org 에서 발급
TG_API_HASH=abcdef...       # my.telegram.org 에서 발급
TG_SESSION=                 # 아래 auth.js 실행 후 채워짐
REPORT_CHAT_ID=me           # 리포트 수신 (me = 저장된 메시지)
OBSIDIAN_VAULT_PATH=/Users/yourname/Documents/Obsidian/Main
RETENTION_DAYS=7
```

> Telegram API 자격증명 발급: [docs/01-telegram-setup.md](docs/01-telegram-setup.md)

### 3. 텔레그램 인증 (최초 1회)

```bash
node src/auth.js
# 전화번호 → 인증코드 → (2FA 비밀번호) 입력
# 출력된 TG_SESSION= 값을 .env에 붙여넣기
```

### 4. 실행

```bash
# 1시간 주기 polling 시작 (텔레그램 + 웹 크롤)
npm run monitor

# 수동 실행: inbox → Obsidian 저장
npm run process

# 특정 채널 backfill
node src/monitor.js --backfill --channel @kiwoom_semibat --hours 24

# 웹 크롤만 단독 실행
node -e "import('./src/web-crawler.js').then(m => m.runWebCrawl())"
```

## 채널 관리

```bash
node src/cli.js list-channels
node src/cli.js add-channel @handle --category 반도체 [--large]
node src/cli.js remove-channel @handle
node src/cli.js enable @handle
node src/cli.js disable @handle
```

`--large` 플래그: 대형 채널(구독자 수 많음)에 180s 딜레이 적용 (기본 60s). Telegram `FLOOD_WAIT` 방지.

## 웹 소스 관리

`config/web-sources.json` 직접 편집:

```json
{
  "sources": [
    {
      "id": "my-source",
      "name": "소스 이름",
      "listUrl": "https://example.com/news/list",
      "baseUrl": "https://example.com",
      "category": "반도체",
      "dynamic": false,
      "selectors": {
        "list": "ul.news-list li",
        "title": "a.title",
        "link": "a.title",
        "date": "span.date"
      },
      "articleSelectors": { "body": "div.article-body" },
      "pollingIntervalSec": 3600,
      "enabled": true
    }
  ]
}
```

`"dynamic": true` → Puppeteer (JS 렌더링 필요 사이트), `false` → fetch + cheerio (정적 HTML)

## Obsidian 출력 형식

```
Vault/Stock News/2026-05-12/반도체/kiwoom_semibat_1400.md
```

```markdown
---
source: "@kiwoom_semibat"
category: "반도체"
importance: "상"
date: "2026-05-12T14:00:00+09:00"
tags: [stock, 반도체]
---

## 요약

삼성전자, HBM4 공급 계약 TSMC와 체결. 3분기 양산 예정.

## 원문

...
```

평일 14:00 KST에 Daily Digest (`Stock News/Daily Digest/YYYY-MM-DD.md`) 자동 생성.

## 의존성

| 패키지 | 용도 |
|--------|------|
| `telegram` (gramjs) | Telegram MTProto 클라이언트 |
| `puppeteer` | 동적 웹 페이지 크롤링 |
| `cheerio` | 정적 HTML 파싱 |
| `pdf-parse` v1 | PDF 텍스트 추출 (v2 API 비호환으로 v1 고정) |
| `node-cron` | 1시간 주기 스케줄링 |
| `dotenv` | 환경변수 로드 |
| `claude` CLI | Claude OAuth 요약 (별도 설치, API 키 불필요) |
| `swift` (macOS 내장) | Apple Vision OCR |

### Claude CLI 설치

```bash
npm install -g @anthropic-ai/claude-code
claude   # 최초 1회 브라우저 OAuth 로그인
```

## 문서

| 파일 | 내용 |
|------|------|
| [docs/00-overview.md](docs/00-overview.md) | 전체 아키텍처 |
| [docs/01-telegram-setup.md](docs/01-telegram-setup.md) | Telegram API 발급 및 세션 생성 |
| [docs/02-claude-oauth.md](docs/02-claude-oauth.md) | Claude OAuth 연동 |
| [docs/03-obsidian-setup.md](docs/03-obsidian-setup.md) | Obsidian 연동 및 launchd 스케줄링 |
| [docs/04-implementation-plan.md](docs/04-implementation-plan.md) | 구현 계획 및 테스트 결과 |
| [docs/05-web-crawler-plan.md](docs/05-web-crawler-plan.md) | 웹 크롤러 설계 |

## 주의 사항

- `.env`는 절대 커밋하지 않음 (`.gitignore` 포함)
- `inbox/`, `processed/`, `logs/`는 로컬 전용
- `pdf-parse`는 반드시 v1 사용 — v2는 API 변경으로 비호환
- 웹 크롤링 시 각 소스 서버에 1.5s(기사 간) / 5s(소스 간) 딜레이 적용
- Apple Vision OCR은 macOS 전용
