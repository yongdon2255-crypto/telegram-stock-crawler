import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function runClaude(prompt, imagePath = null) {
  const args = ['-p', prompt]
  if (imagePath) args.push(imagePath)

  const { stdout } = await execFileAsync('claude', args, {
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
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
