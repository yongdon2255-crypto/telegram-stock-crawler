# 웹 크롤러 계획 (Puppeteer 기반)

## 목적

텔레그램 채널 외 **증권사 리서치 사이트·경제 뉴스·공시 포털**을 Puppeteer로 수집해 기존 파이프라인(processor → obsidian → reporter)에 합류시킨다.

---

## 아키텍처

```
Web Sources (뉴스 · 공시 · 리서치 포털)
        │
        ▼
[web-crawler.js]  ─ Puppeteer 기반
  ├─ 정적 HTML       fetch + DOM 파싱 (빠름, Puppeteer 생략)
  └─ 동적 SPA/JS     Puppeteer headless (JS 실행 필요)
        │  raw JSON → inbox/{date}_{source}_{id}.json
        ▼
기존 파이프라인 재사용
[handoff.js] → [processor.js] → [obsidian.js] → [reporter.js]
```

기존 `inbox/` 스키마를 그대로 따르므로 `handoff.js` 이후 코드는 **수정 없이** 재사용된다.

---

## 수집 대상 (초안)

| 소스 | URL | 타입 | 카테고리 |
|------|-----|------|----------|
| 이데일리 IT/반도체 | edaily.co.kr | 동적(SPA) | IT/Tech |
| 한국경제 증권 | hankyung.com/finance | 동적 | 미국주식 |
| DART 주요공시 | dart.fss.or.kr | 정적 | 기타 |
| KRX 시장정보 | krx.co.kr | 정적 | 기타 |
| 뉴스핌 반도체 | newspim.com | 정적 | 반도체 |

`config/web-sources.json`으로 관리하며 CLI(`src/cli.js`)로 추가·비활성화 가능.

---

## 새 파일 목록

| # | 파일 | 역할 |
|---|------|------|
| 1 | `config/web-sources.json` | 소스 레지스트리 |
| 2 | `src/web-crawler.js` | Puppeteer 크롤러 코어 |
| 3 | `src/web-fetcher.js` | 정적 fetch 헬퍼 (cheerio) |

기존 `src/monitor.js`에 **웹 크롤 사이클을 추가**해 동일한 1h cron에서 실행한다.

---

## `config/web-sources.json` 스키마

```json
{
  "sources": [
    {
      "id": "edaily-it",
      "name": "이데일리 IT",
      "url": "https://www.edaily.co.kr/news/newsList?newsId=&mediaCodeNo=257",
      "category": "IT/Tech",
      "dynamic": true,
      "selectors": {
        "list": "ul.news_list li",
        "title": "a.news_tit",
        "link": "a.news_tit",
        "date": "span.news_date",
        "body": "div.news_body"
      },
      "pollingIntervalSec": 3600,
      "enabled": true
    }
  ]
}
```

| 필드 | 설명 |
|------|------|
| `dynamic` | `true` → Puppeteer, `false` → fetch+cheerio |
| `selectors` | CSS selector 맵 (소스마다 상이) |
| `pollingIntervalSec` | 기본 3600 (텔레그램과 동일 주기) |

---

## `src/web-crawler.js` 핵심 로직

```js
import puppeteer from 'puppeteer'
import * as cheerio from 'cheerio'
import { saveInbox } from './monitor.js'

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
]

export async function crawlSource(source) {
  const articles = source.dynamic
    ? await crawlDynamic(source)
    : await crawlStatic(source)

  for (const article of articles) {
    await saveInbox({
      channel: source.id,
      category: source.category,
      text: article.title + '\n\n' + article.body,
      date: article.date,
      mediaType: null,
      sourceUrl: article.url,
    })
  }
}

async function crawlDynamic(source) {
  const browser = await puppeteer.launch({ headless: 'new', args: BROWSER_ARGS })
  const page = await browser.newPage()

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  )
  await page.goto(source.url, { waitUntil: 'networkidle2', timeout: 30_000 })

  // 목록 페이지 파싱
  const links = await page.$$eval(source.selectors.list, (els, sel) =>
    els.slice(0, 10).map(el => ({
      title: el.querySelector(sel.title)?.textContent?.trim(),
      url: el.querySelector(sel.link)?.href,
      date: el.querySelector(sel.date)?.textContent?.trim(),
    })), source.selectors
  )

  // 각 기사 본문 fetch
  const articles = []
  for (const link of links.filter(l => l.url)) {
    await page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    const body = await page.$eval(source.selectors.body,
      el => el?.innerText?.trim() ?? ''
    ).catch(() => '')
    articles.push({ ...link, body })
    await sleep(1500)  // 소스 서버 부하 방지
  }

  await browser.close()
  return articles
}

async function crawlStatic(source) {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockCrawler/1.0)' }
  })
  const html = await res.text()
  const $ = cheerio.load(html)
  // ... selector 기반 파싱
}
```

---

## 중복 제거

같은 기사를 다음 cycle에 재수집하지 않도록 **URL 지문(fingerprint)** 방식 사용:

```js
// config/web-state.json (git 제외)
{
  "edaily-it": { "seenUrls": ["https://...", "..."] }
}
```

`seenUrls`는 최근 200개만 유지 (FIFO). `config/state.json` 과 동일 파일에 키로 통합 가능.

---

## monitor.js 통합

```js
// src/monitor.js (기존 텔레그램 사이클 뒤에 추가)
import { crawlSource } from './web-crawler.js'
import webSourcesJson from '../config/web-sources.json' assert { type: 'json' }

async function runWebCrawl() {
  const sources = webSourcesJson.sources.filter(s => s.enabled)
  for (const source of sources) {
    await crawlSource(source)
    await sleep(5_000)  // 소스 간 딜레이
  }
}

// cron 핸들러 내에서
await runTelegramCycle(client, channels)
await runWebCrawl()
await reportCycle(client, stats)
```

---

## anti-bot 대책

| 대책 | 구현 |
|------|------|
| User-Agent 설정 | Chrome 최신 UA 문자열 |
| `navigator.webdriver` 제거 | `--disable-blink-features=AutomationControlled` |
| 페이지 간 딜레이 | 1.5s (기사 간), 5s (소스 간) |
| robots.txt 준수 | crawl 전 `robots.txt` 확인 (선택적) |
| 헤드리스 회피 감지 우회 | `puppeteer-extra-plugin-stealth` 옵션 |

---

## 의존성 추가

```bash
npm install puppeteer cheerio
# stealth 플러그인 (선택)
npm install puppeteer-extra puppeteer-extra-plugin-stealth
```

`puppeteer` 첫 설치 시 Chromium 자동 다운로드(~200MB). 이미 Chrome이 있다면:
```bash
npm install puppeteer-core
# PUPPETEER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

---

## 구현 순서

```
Step 1  config/web-sources.json 작성 (소스 2~3개 선정)
Step 2  src/web-fetcher.js (정적 fetch + cheerio) — 간단한 소스부터
Step 3  src/web-crawler.js (Puppeteer 동적 크롤) — 복잡한 SPA
Step 4  monitor.js 통합 + 중복 제거 로직
Step 5  cli.js 확장: add-source / list-sources / disable-source
Step 6  obsidian.js — sourceUrl frontmatter 필드 추가
Step 7  reporter.js — 웹 소스 수집 건수 별도 집계
```

---

## inbox JSON 스키마 확장 (최소)

```json
{
  "channel": "edaily-it",
  "category": "IT/Tech",
  "text": "기사 제목\n\n본문...",
  "date": "2026-05-12T09:30:00+09:00",
  "mediaType": null,
  "sourceUrl": "https://www.edaily.co.kr/news/read?newsId=..."
}
```

`sourceUrl` 필드 추가만으로 기존 `processor.js` · `obsidian.js` 는 무수정 재사용 가능.
`obsidian.js`의 frontmatter에 `source_url` 키를 선택적으로 추가하면 Obsidian에서 원문 링크 확인 가능.

---

## 리스크 및 대응

| 리스크 | 대응 |
|--------|------|
| IP 차단 | 소스 간 딜레이 + robots.txt 준수 |
| 셀렉터 변경 | `web-sources.json` 수정만으로 재배포 없이 대응 |
| Puppeteer 버전 충돌 | `puppeteer-core` + 로컬 Chrome 사용 |
| 스캔 PDF 링크 포함 | 기존 pdf-parse → 텍스트 없음 → 건너뜀 (기존 동작 그대로) |
| 메모리 누수 | 매 소스마다 `browser.close()` 호출, 브라우저 재사용 안 함 |
