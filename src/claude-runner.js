import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const OCR_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocr.swift')

export async function runClaude(prompt) {
  const { stdout } = await execFileAsync('claude', ['-p', prompt], {
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout.trim()
}

export async function extractImageText(imagePath) {
  const { stdout } = await execFileAsync('swift', [OCR_SCRIPT, imagePath], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

export function parseJSON(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]+\}/)
    if (match) return JSON.parse(match[0])
    return null
  }
}
