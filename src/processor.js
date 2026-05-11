import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runClaude, parseJSON, extractImageText } from './claude-runner.js'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

const SUMMARIZE_PROMPT = (channel, text) => `\
다음 한국 증권 채널 메시지를 분석해줘.

채널: ${channel}
내용:
${text}

아래 JSON만 출력 (다른 텍스트 없이):
{"summary":"1~2문장 요약","category":"반도체|미국주식|IT/Tech|기타","importance":"상|중|하"}`

export async function processMessage(item) {
  let text = item.text || ''

  if (item.mediaType === 'document' && item.mediaPath) {
    // PDF: 텍스트 추출 후 Claude 요약
    const buf = await readFile(item.mediaPath)
    const pdf = await pdfParse(buf)
    text = [text, pdf.text.trim()].filter(Boolean).join('\n')
  } else if (item.mediaType === 'photo' && item.mediaPath) {
    // 이미지: Apple Vision OCR만 사용 (Claude 토큰 소모 없음)
    // 텍스트가 없는 이미지 전용 메시지는 OCR 결과를 직접 반환
    const ocrText = await extractImageText(item.mediaPath)
    if (!text.trim() && ocrText) {
      return {
        summary: ocrText.slice(0, 200).replace(/\n/g, ' '),
        category: item.category,
        importance: '중',
        _ocrOnly: true,
      }
    }
    text = [text, ocrText].filter(Boolean).join('\n')
  }

  if (!text.trim()) return null

  // 텍스트 메시지 & PDF: Claude 요약
  const raw = await runClaude(SUMMARIZE_PROMPT(item.channel, text.slice(0, 4000)))
  return parseJSON(raw)
}
