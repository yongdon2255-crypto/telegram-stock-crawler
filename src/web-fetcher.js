import * as cheerio from 'cheerio'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

export function parseList(html, selectors) {
  const $ = cheerio.load(html)
  const items = []

  $(selectors.list).each((_, el) => {
    const titleEl = $(el).find(selectors.title).first()
    const linkEl  = $(el).find(selectors.link).first()
    const dateEl  = $(el).find(selectors.date).first()

    const title = cleanText(titleEl.text())
    let   href  = linkEl.attr('href') || ''
    const date  = dateEl.text().trim()

    if (!title || !href) return
    items.push({ title, url: href, date })
  })

  return items
}

function cleanText(raw) {
  return raw
    .replace(/^\s*\d+\s*\n/, '')   // "1\n제목" 형태의 번호 prefix 제거
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseArticle(html, selectors) {
  const $ = cheerio.load(html)
  return $(selectors.body).first().text().replace(/\s+/g, ' ').trim()
}

export function resolveUrl(base, href) {
  if (!href) return ''
  if (href.startsWith('http')) return href
  try {
    return new URL(href, base).href
  } catch {
    return ''
  }
}
