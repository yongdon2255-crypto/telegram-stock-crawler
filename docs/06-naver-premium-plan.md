# 네이버 프리미엄 콘텐츠 크롤링 계획 (Scrapling + 로그인 세션)

## 목적

[네이버 프리미엄 콘텐츠](https://contents.premium.naver.com/) 채널(예: `mesegong` 메르를 통해 엿보는 세상 공부)을
**본인의 유료 구독 계정으로 로그인**한 뒤 본문 전체를 가져와 기존 파이프라인(`inbox → processor → obsidian → reporter`)에 합류시킨다.

기존 `web-crawler.js`(Puppeteer/fetch)로는 페이월(`<div class="viewer_paywall">`)에 막혀 미리보기(약 34%)만 추출되므로,
[Scrapling](https://github.com/D4Vinci/Scrapling)의 `StealthySession`을 사용해 Playwright 기반 stealth 브라우저 + 저장된 세션으로 전체 본문에 접근한다.

---

## 실측 결과 (대상 URL 기준)

샘플 URL: `https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx`

| 항목 | 값 |
|---|---|
| 채널 | `mesegong` (메르를 통해 엿보는 세상 공부) |
| 본문 컨테이너 | `<div id="_SE_VIEWER_CONTENT" class="se_viewer_content">` (SmartEditor3) |
| 페이월 여부 | **유료** — `<div class="viewer_paywall">` 노출, `data-ba-params`에 `paywall_exposed:"y"` |
| 노출 비율 | `data-paywall-ratio="2.93"` ≈ 34%만 미리보기 (전체 11,731자 중 약 8천자) |
| 인증 토큰 | `data-content-auth="false"` (비로그인 상태) |
| 렌더링 | SSR — `__NEXT_DATA__` 없음, 정적 HTML에 본문 그대로 포함 |
| robots.txt | `/contents/` 경로 **허용** (`/my`, `/subscriptions/.../order`만 차단) |
| 이미지 CDN | `scs-phinf.pstatic.net` |

---

## 핵심 결정

| 항목 | 선택 | 이유 |
|---|---|---|
| 크롤러 | **Scrapling `StealthySession`** | Playwright Chromium + fingerprint 스푸핑 → 네이버 봇감지 우회 |
| 세션 보존 | **`storage_state` JSON 파일** | 쿠키+localStorage 통째 저장/재사용. `NID_AUT` 만료(약 1년) 전까지 무로그인 동작 |
| 첫 로그인 | **반수동 (headful 1회)** | 네이버는 캡차/디바이스 검증이 강함. 1회만 사람이 직접 입력 후 신뢰 디바이스 등록 |
| Node 통합 | **Python 워커 서브프로세스** | `claude` CLI를 `execFile`로 부르는 패턴과 동일. stdout JSON 통신 |

---

## 아키텍처

```
config/web-sources.json (type: "naver-premium")
        │
        ▼
[src/web-crawler.js]  ─ 새 분기 추가
  ├─ 정적 HTML (기존)            fetch + cheerio
  ├─ 동적 SPA (기존)             Puppeteer headless
  └─ Naver Premium (신규)        Python 워커 호출
                                       │
                          [scrapers/naver_premium.py]
                          - Scrapling StealthySession
                          - storage_state 로드 (저장된 세션)
                          - SE_VIEWER_CONTENT 추출
                          - stdout JSON 반환
                                       │
                          inbox/{date}_{source}_{id}.json
                                       │
                  기존 파이프라인 (handoff → processor → obsidian → reporter)
```

---

## 새 파일/디렉터리

| 경로 | 역할 |
|------|------|
| `scrapers/requirements.txt` | Python 의존성 (`scrapling[fetchers]`) |
| `scrapers/naver_login.py` | 1회 수동 로그인 → `storage_state` 저장 |
| `scrapers/naver_premium.py` | 콘텐츠 단건 크롤러 (CLI: URL → JSON) |
| `scrapers/naver_premium_list.py` | (후속) 채널 목록 페이지에서 새 글 ID 추출 |
| `scrapers/.state/naver.json` | 저장된 쿠키+localStorage (git 제외) |

---

## 환경 변수 추가 (`.env`)

| Key | Purpose |
|-----|---------|
| `NAVER_STORAGE_STATE` | 저장된 세션 JSON 경로 (기본 `scrapers/.state/naver.json`) |
| `NAVER_LOGIN_URL` | (선택) 로그인 시작 URL, 기본값 사용 |

`NAVER_ID`/`NAVER_PW`는 저장하지 않는다 — 자동 로그인을 시도하면 봇 감지로 계정 잠금 위험.

---

## 단계별 실행 계획

### 1단계: Python 워커 격리 환경
- `scrapers/` 디렉터리 신설 (Node 코드와 분리)
- `scrapers/requirements.txt`: `scrapling[fetchers]`
- 설치:
  ```bash
  pip3 install -r scrapers/requirements.txt
  scrapling install   # Playwright 브라우저 다운로드 (~300MB)
  ```
- `.gitignore`에 `scrapers/.state/` 추가 (쿠키 = 자격증명)

### 2단계: 1회성 로그인 스크립트 (`scrapers/naver_login.py`)
- `StealthySession(headless=False, ...)` 으로 헤드풀 브라우저 띄움
- `https://nid.naver.com/nidlogin.login` 진입
- **사용자가 직접** ID/PW 입력 + 캡차/2FA 처리 + "이 디바이스 신뢰" 체크
- 로그인 성공 감지(URL 변경, 또는 `naver.com` 메인 진입) 후 `context.storage_state(path=NAVER_STORAGE_STATE)`로 저장
- 종료

→ 이 스크립트는 사람이 1회 직접 실행 (`npm run naver:login`). 이후 자동 크롤링은 저장된 상태만 사용.

### 3단계: 콘텐츠 크롤러 (`scrapers/naver_premium.py`)

**입력**: URL (CLI 인자)

**처리**:
1. `StealthySession(headless=True, storage_state=NAVER_STORAGE_STATE, humanize=True, network_idle=True)` 로 페이지 fetch
2. `#_SE_VIEWER_CONTENT` 추출
3. `.viewer_paywall` 존재 여부 체크 (있으면 세션 만료 의심)
4. 메타: `og:title`, `og:description`, `og:image`, `data-content-id`, `data-category`, `data-paywall-ratio`
5. 이미지: `.se-image img` 의 `src` (또는 `data-lazy-src`) 수집

**출력**: stdout JSON
```json
{
  "id": "260511171452911bx",
  "title": "[시장 단상] ...",
  "author": "수퍼노바",
  "publishedAt": "2026-05-11T18:00:00+09:00",
  "category": "001000",
  "body": "...",
  "images": ["https://scs-phinf.pstatic.net/..."],
  "isPaywalled": true,
  "accessLevel": "full",
  "sourceUrl": "https://contents.premium.naver.com/..."
}
```

**종료 코드**:
- `0` 정상
- `2` 세션 만료 (페이월 노출 + auth=false) → stderr `SESSION_EXPIRED`
- `3` 페이지 오류 (HTTP 4xx/5xx, 본문 없음)

### 4단계: Node 어댑터 (`src/web-fetcher.js` / `src/web-crawler.js`)
- `fetchNaverPremium(url)` 함수: `execFile('python3', ['scrapers/naver_premium.py', url])` → stdout JSON 파싱
- `web-crawler.js`의 소스 분기에 `if (source.type === 'naver-premium')` 추가
- exit code 2 → reporter.js 로 "네이버 재로그인 필요" 알림 전달

### 5단계: 소스 등록 (`config/web-sources.json`)
```json
{
  "id": "naver-premium-mesegong",
  "name": "메르 프리미엄",
  "type": "naver-premium",
  "listUrl": "https://contents.premium.naver.com/mesegong/contents",
  "articleUrlPattern": "/mesegong/contents/contents/",
  "category": "주식분석",
  "requiresAuth": true,
  "pollingIntervalSec": 3600,
  "enabled": false
}
```

처음에는 `enabled:false`로 두고 단건 테스트가 끝난 뒤 활성화.

### 6단계: 운영 헬퍼 (`package.json` scripts)
- `npm run naver:login` → `python3 scrapers/naver_login.py` (헤드풀)
- `npm run naver:test <URL>` → `python3 scrapers/naver_premium.py <URL>` (단건 확인)

---

## 네이버 로그인 시 주의

- **자동 로그인 비추천**: `page.fill()`+`page.click()`은 keyup 이벤트 패턴(사람=불규칙, 봇=일정)으로 봇 감지 → "비정상 접근" 차단 + 재로그인 루프
- **세션 영속화가 정답**: 신뢰 디바이스 등록 + `storage_state` 저장 시 `NID_AUT` 쿠키 유효기간(약 1년) 동안 무인 동작
- **IP 고정 권장**: 평소 사용 IP와 다른 곳에서 같은 NID 쿠키 접근 시 추가 검증 트리거. launchd로 같은 Mac에서 돌리면 안전
- **요청 빈도**: `humanize=True` + 채널당 180초 간격. 동시 다채널 fetch 금지

---

## 법적/약관

- robots.txt: 콘텐츠 경로 허용 (실측 완료)
- 네이버 이용약관: 자동화된 수집은 원칙적 금지지만, **본인이 결제한 콘텐츠를 본인 디바이스에서 본인 사용 목적**으로 캐시하는 것은 일반적으로 묵인 범위. **외부 공유·재배포는 명백한 위반**
- 가드레일:
  - Obsidian 저장 시 출처 URL과 "개인 학습용" 표기 자동 삽입
  - claude-runner 프롬프트에 "원문 인용은 1단락 이하, 요약 위주" 지시
  - 다른 사람 계정 쿠키 사용 금지

---

## 리스크 및 대응

| 리스크 | 대응 |
|---|---|
| 세션 만료 | exit code 2 → reporter가 텔레그램으로 "재로그인 필요" 알림 → `npm run naver:login` |
| 봇 감지(캡차) | `StealthySession` + `humanize=True` + 1Mac 1IP 고정 |
| 셀렉터 변경 | Scrapling의 `adaptive=True`로 자동 재배치 시도 |
| Playwright 디스크 사용량 | `scrapling install` 1회. 브라우저 캐시는 `~/Library/Caches/ms-playwright/` |
| Python 환경 오염 | venv 사용 권장 (`scrapers/.venv/`), `pyproject.toml` 분리 가능 |
