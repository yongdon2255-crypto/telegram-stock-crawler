# Claude OAuth 연동 (API 키 없이 현재 구독 사용)

## 개념

이 프로젝트는 `ANTHROPIC_API_KEY` 없이 **로컬에 설치된 `claude` CLI** 를 subprocess로 호출해 요약·분류를 수행한다. Claude Code를 구독 중이면 추가 비용 없이 사용 가능.

```
processor.js
    │
    └─ execFile('claude', ['-p', prompt])
           │
           └─ 로컬 claude CLI (OAuth 세션) → Claude API
```

---

## 1. Claude CLI 설치 확인

```bash
which claude        # 경로 출력되면 OK
claude --version    # 버전 확인
```

설치되어 있지 않으면:

```bash
npm install -g @anthropic-ai/claude-code
# 또는 공식 설치 스크립트
curl -fsSL https://claude.ai/install.sh | sh
```

설치 후 로그인 (최초 1회):

```bash
claude
# 브라우저가 열리며 Claude.ai 계정으로 OAuth 인증
```

---

## 2. CLI 동작 확인

```bash
echo "다음을 한 줄로 요약해줘: 삼성전자 HBM 공급 계약 체결" | claude -p -
# 또는
claude -p "삼성전자 HBM 공급 계약 체결을 한 줄로 요약해줘"
```

---

## 3. 코드에서 호출하는 방법

```js
// src/claude-runner.js
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * @param {string} prompt
 * @returns {Promise<string>} Claude 응답 텍스트
 */
export async function runClaude(prompt) {
  const { stdout } = await execFileAsync('claude', ['-p', prompt], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}
```

사용 예:

```js
import { runClaude } from './claude-runner.js'

const rawText = '삼성전자, TSMC와 HBM4 공동 개발 계약 체결...'

const response = await runClaude(`
다음 증권 뉴스를 분석해줘.

내용:
${rawText}

JSON 형식으로만 응답해 (다른 텍스트 없이):
{
  "summary": "1~2문장 요약",
  "category": "반도체 | 미국주식 | IT/Tech | 기타",
  "importance": "상 | 중 | 하"
}
`)

const parsed = JSON.parse(response)
```

---

## 4. 이미지 OCR (Claude Vision)

```js
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'

export async function extractTextFromImage(imagePath) {
  // claude CLI는 현재 stdin 이미지를 직접 지원하지 않으므로
  // 이미지를 base64로 인코딩해 프롬프트에 포함하는 방식 사용
  const imageData = await readFile(imagePath, { encoding: 'base64' })
  const ext = imagePath.split('.').pop().toLowerCase()
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg'

  const prompt = `이 이미지에서 모든 텍스트를 추출해줘. 표, 숫자, 기호 포함. 추출된 텍스트만 출력.`

  // claude CLI v1.x는 --image 플래그 또는 stdin multipart 지원
  // 버전에 따라 아래 중 하나 사용
  return new Promise((resolve, reject) => {
    const proc = execFile('claude', ['-p', prompt, '--image', imagePath], {
      timeout: 60_000,
    }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}
```

> claude CLI의 이미지 입력 방식은 버전마다 다를 수 있음. `claude --help` 에서 `--image` 또는 파일 첨부 옵션 확인.

---

## 5. 요금 / 한도

| 항목 | 내용 |
|------|------|
| 비용 | Claude Pro/Max 구독 포함 (API 크레딧 별도 없음) |
| 속도 제한 | 구독 플랜의 일반 사용량 한도 적용 |
| 병렬 호출 | 한 번에 여러 subprocess 실행 가능하나 rate limit 주의 |

채널 수가 많아져 요청이 빈번해지면 호출 사이에 `await sleep(2000)` 추가.

---

## 알려진 제한 — 이미지 OCR

`claude -p "prompt" imagepath` 형태로 이미지 경로를 인자로 전달해도 claude CLI가 이미지를 처리하지 않음 (텍스트 프롬프트만 응답). 이미지 전용 메시지는 현재 건너뜀.

```js
// processor.js — 현재 동작
} else if (item.mediaType === 'photo' && item.mediaPath) {
  // claude CLI가 이미지를 인식하지 못해 OCR 실패 → 텍스트만 처리
  const ocrText = await runClaude(OCR_PROMPT, item.mediaPath) // 실질적으로 무시됨
}
```

개선 방향: `--file` 플래그 지원 여부 확인 또는 Tesseract(로컬 OCR) 연동.

---

## 주의 사항

- `@anthropic-ai/sdk` 패키지를 `require`/`import` 하지 않음 — 이 프로젝트는 CLI subprocess 방식만 사용.
- `ANTHROPIC_API_KEY` 환경변수 불필요 (`.env.example`에 포함하지 말 것).
- claude CLI 세션이 만료되면 `claude` 명령을 다시 실행해 재인증.
