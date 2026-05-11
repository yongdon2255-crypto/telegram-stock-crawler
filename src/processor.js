import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runClaude, parseJSON } from './claude-runner.js'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

const SUMMARIZE_PROMPT = (channel, text) => `\
다음 한국 증권 채널 메시지를 분석해줘.

채널: ${channel}
내용:
${text}

아래 JSON만 출력 (다른 텍스트 없이):
{"summary":"1~2문장 요약","category":"반도체|미국주식|IT/Tech|기타","importance":"상|중|하"}`

const OCR_PROMPT = '이 이미지의 모든 텍스트를 추출해줘. 표, 숫자, 기호 포함. 추출된 텍스트만 출력.'

export async function processMessage(item) {
  let text = item.text || ''

  if (item.mediaType === 'document' && item.mediaPath) {
    const buf = await readFile(item.mediaPath)
    const pdf = await pdfParse(buf)
    text = [text, pdf.text.trim()].filter(Boolean).join('\n')
  } else if (item.mediaType === 'photo' && item.mediaPath) {
    const ocrText = await runClaude(OCR_PROMPT, item.mediaPath)
    text = [text, ocrText].filter(Boolean).join('\n')
  }

  if (!text.trim()) return null

  const raw = await runClaude(SUMMARIZE_PROMPT(item.channel, text.slice(0, 4000)))
  return parseJSON(raw)
}
