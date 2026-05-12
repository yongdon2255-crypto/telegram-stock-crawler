import puppeteer from 'puppeteer'
import * as cheerio from 'cheerio'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchHtml, parseList, parseArticle, resolveUrl, fetchNaverPremium, NaverSessionExpiredError } from './web-fetcher.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCES_PATH   = join(__dirname, '../config/web-sources.json')
const WEB_STATE_PATH = join(__dirname, '../config/web-state.json')
const INBOX_DIR      = join(__dirname, '../inbox')
const MAX_SEEN = 200
const ARTICLE_DELAY_MS = 1500
const SOURCE_DELAY_MS  = 5_000

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── state helpers ──────────────────────────────────────────────────────────────

async function loadState() {
  if (!existsSync(WEB_STATE_PATH)) return {}
  return JSON.parse(await readFile(WEB_STATE_PATH, 'utf8'))
}

async function saveState(state) {
  await writeFile(WEB_STATE_PATH, JSON.stringify(state, null, 2))
}

function isNew(state, sourceId, url) {
  return !(state[sourceId]?.seenUrls ?? []).includes(url)
}

function markSeen(state, sourceId, url) {
  if (!state[sourceId]) state[sourceId] = { seenUrls: [] }
  const seen = state[sourceId].seenUrls
  if (!seen.includes(url)) seen.push(url)
  if (seen.length > MAX_SEEN) state[sourceId].seenUrls = seen.slice(-MAX_SEEN)
}

// ── Puppeteer dynamic crawl ────────────────────────────────────────────────────

async function crawlDynamic(source, state) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const results = []
  try {
    const page = await browser.newPage()
    await page.setUserAgent(UA)
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9' })

    await page.goto(source.listUrl, { waitUntil: 'networkidle2', timeout: 30_000 })
    const html = await page.content()

    const items = parseList(html, source.selectors)
      .map(it => ({ ...it, url: resolveUrl(source.baseUrl || source.listUrl, it.url) }))
      .filter(it => it.url && isNew(state, source.id, it.url))
      .slice(0, 10)

    for (const item of items) {
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        const articleHtml = await page.content()
        item.body = parseArticle(articleHtml, source.articleSelectors)
        results.push(item)
        markSeen(state, source.id, item.url)
      } catch (err) {
        console.error(`[web] dynamic article error ${item.url}: ${err.message}`)
      }
      await sleep(ARTICLE_DELAY_MS)
    }
  } finally {
    await browser.close()
  }
  return results
}

// ── fetch+cheerio static crawl ─────────────────────────────────────────────────

async function crawlStatic(source, state) {
  const html  = await fetchHtml(source.listUrl)
  const items = parseList(html, source.selectors)
    .map(it => ({ ...it, url: resolveUrl(source.baseUrl || source.listUrl, it.url) }))
    .filter(it => it.url && isNew(state, source.id, it.url))
    .slice(0, 10)

  const results = []
  for (const item of items) {
    try {
      const articleHtml = await fetchHtml(item.url)
      item.body = parseArticle(articleHtml, source.articleSelectors)
      results.push(item)
      markSeen(state, source.id, item.url)
    } catch (err) {
      console.error(`[web] static article error ${item.url}: ${err.message}`)
    }
    await sleep(ARTICLE_DELAY_MS)
  }
  return results
}

// ── naver premium (Scrapling 워커 호출) ───────────────────────────────────────

async function crawlNaverPremium(source, state) {
  // 목록 페이지에서 콘텐츠 URL 후보를 수집
  let listHtml
  try {
    listHtml = await fetchHtml(source.listUrl)
  } catch (err) {
    console.error(`[web] naver list fetch failed ${source.listUrl}: ${err.message}`)
    return []
  }
  const $ = cheerio.load(listHtml)
  const pattern = source.articleUrlPattern || '/contents/contents/'
  const urls = []
  $('a').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (!href.includes(pattern)) return
    const abs = resolveUrl(source.listUrl, href)
    if (!abs || urls.includes(abs)) return
    urls.push(abs)
  })

  const fresh = urls.filter(u => isNew(state, source.id, u)).slice(0, 5)
  const results = []
  for (const url of fresh) {
    try {
      const data = await fetchNaverPremium(url)
      results.push({
        title: data.title,
        url:   data.sourceUrl || url,
        date:  data.publishedAt || '',
        body:  data.body || '',
        meta:  {
          channel:        data.channel,
          author:         data.author,
          isPaywalled:    data.isPaywalled,
          accessLevel:    data.accessLevel,
          bodyLength:     data.bodyLength,
          totalLength:    data.totalTextLength,
          images:         data.images,
          thumbnail:      data.thumbnail,
        },
      })
      markSeen(state, source.id, url)
    } catch (err) {
      if (err instanceof NaverSessionExpiredError) {
        console.error(`[web] naver SESSION_EXPIRED: ${err.message}`)
        const e = new Error(`NAVER_LOGIN_REQUIRED: ${source.id}`)
        e.code = 'NAVER_LOGIN_REQUIRED'
        throw e
      }
      console.error(`[web] naver article error ${url}: ${err.message}`)
    }
    await sleep(180_000)  // 채널당 180s 권장 (요청 빈도 가드)
  }
  return results
}

// ── main export ────────────────────────────────────────────────────────────────

export async function runWebCrawl() {
  const { sources } = JSON.parse(await readFile(SOURCES_PATH, 'utf8'))
  const enabled = sources.filter(s => s.enabled)
  const state   = await loadState()

  let totalNew = 0

  for (const source of enabled) {
    const sourceType = source.type
      || (source.dynamic ? 'dynamic' : 'static')
    console.log(`[web] crawling ${source.name} (${sourceType})…`)
    try {
      let articles
      if (sourceType === 'naver-premium') {
        articles = await crawlNaverPremium(source, state)
      } else if (sourceType === 'dynamic') {
        articles = await crawlDynamic(source, state)
      } else {
        articles = await crawlStatic(source, state)
      }

      for (const art of articles) {
        const text = [art.title, art.body].filter(Boolean).join('\n\n')
        if (!text.trim()) continue

        const now      = new Date().toISOString()
        const dateStr  = now.slice(0, 10)
        const uid      = Date.now()
        const filename = `${dateStr}_${source.id}_${uid}.json`
        const item = {
          channel:   source.id,
          category:  source.category,
          messageId: uid,
          date:      now,
          text:      text.slice(0, 6000),
          mediaType: null,
          mediaPath: null,
          mimeType:  null,
          sourceUrl: art.url,
        }
        await writeFile(join(INBOX_DIR, filename), JSON.stringify(item, null, 2))
        totalNew++
        console.log(`[web]   + ${art.title?.slice(0, 60)}`)
      }

      console.log(`[web] ${source.name}: ${articles.length}건 신규`)
    } catch (err) {
      console.error(`[web] source ${source.id} failed: ${err.message}`)
    }

    await saveState(state)
    await sleep(SOURCE_DELAY_MS)
  }

  return { totalNew }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}
