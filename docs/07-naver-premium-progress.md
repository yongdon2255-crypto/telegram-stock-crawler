# 네이버 프리미엄 콘텐츠 크롤러 — 작업 진행 상황 (2026-05-12)

본 문서는 `docs/06-naver-premium-plan.md` 계획의 실제 구현 결과와 디버깅
과정을 이후 작업자가 빠르게 이어받을 수 있도록 정리한 것이다.

---

## 1. 현재 상태 요약

| 단계 | 상태 | 비고 |
|---|---|---|
| Python 워커 환경(`scrapers/.venv`) | ✅ | Scrapling 0.4.8, Playwright 1.59 Chromium 1217 |
| `scrapers/naver_login.py` | ✅ | DynamicSession 헤드풀 로그인 + NID 쿠키 검증 + storage_state 저장 |
| `scrapers/naver_premium.py` | ✅ | 인증 쿠키 주입, 본문/이미지 추출, `--debug` / `--headful` |
| `src/web-fetcher.js` | ✅ | `fetchNaverPremium()`, `NaverSessionExpiredError` |
| `src/web-crawler.js` | ✅ | `type:"naver-premium"` 소스 분기 |
| `src/naver-to-obsidian.js` | ✅ | 단건 URL을 Obsidian Markdown 노트로 저장 |
| `config/web-sources.json` | ✅ | `naver-premium-mesegong` 추가 (`enabled:false`) |
| `.gitignore`, `.env.example` | ✅ | 세션/venv 제외, `NAVER_PROFILE_DIR`, `NAVER_STORAGE_STATE` |
| Obsidian vault 설정 | ✅ | `/Users/huiseong/Documents/Obsidian Vault` |
| 단건 fetch 검증 | ✅ | `accessLevel=full`, 본문 추출 성공, 이미지 24개 |
| Obsidian 미리보기 검증 | ✅ | 이미지가 원문 문단 순서대로 `![](...)` 인라인 저장 |

---

## 2. 사용 명령

### 로그인

```bash
npm run naver:login
```

브라우저가 열리면 네이버 로그인, 캡차/2FA, 로그인 상태 유지까지 완료한다.
성공 시 `NID_AUT`, `NID_SES`가 확인되고 `storage_state`가 저장된다.

### 단건 fetch 테스트

```bash
npm run naver:test -- --debug "https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx"
```

성공 예:

```text
[debug] cookies: total=33 naver=20 NID_names=['NID_AUT', 'NID_JST', 'NID_SES'] storage_state=True
[debug] accessLevel=full isPaywalled=True bodyLen=12516 totalLen=11731 headful=False
```

### Obsidian 단건 저장

```bash
npm run naver:save -- "https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx"
```

저장 경로 형식:

```text
<OBSIDIAN_VAULT_PATH>/Stock News/YYYY-MM-DD/주식분석/naver-premium-mesegong_HHMM_<title>.md
```

현재 vault:

```text
/Users/huiseong/Documents/Obsidian Vault
```

---

## 3. 구현 구조

```text
scrapers/
├── .venv/                          # Python 가상환경 (git 제외)
├── .state/
│   ├── .gitkeep
│   ├── naver-profile/              # Chromium 영속 프로필 (git 제외)
│   └── naver-storage-state.json     # Playwright storage_state (git 제외)
├── requirements.txt
├── naver_login.py
└── naver_premium.py
src/
├── web-fetcher.js
├── web-crawler.js
└── naver-to-obsidian.js
docs/
├── 06-naver-premium-plan.md
└── 07-naver-premium-progress.md
```

---

## 4. 디버깅 타임라인

### 4-1. StealthySession 시도

처음에는 `scrapling.fetchers.StealthySession`을 사용했다. 로그인 후 fetch 시
아래처럼 페이월 미리보기만 반환됐다.

```text
SESSION_EXPIRED: 페이월 노출 + 미인증 응답.
data-content-auth="false"
```

`humanize=True`가 fingerprint를 흔들 수 있다고 보고 해제했지만 결과는 같았다.

### 4-2. 헤드리스/헤드풀 차이 확인

`--headful --debug`로 같은 URL을 열었지만 여전히:

```text
accessLevel=preview isPaywalled=True bodyLen=0
```

즉 헤드리스 자체 문제가 아니라 로그인 세션이 유지되지 않는 문제였다.

### 4-3. DynamicSession 전환

`StealthySession`에서 `DynamicSession`으로 전환했다.

```diff
- from scrapling.fetchers import StealthySession
+ from scrapling.fetchers import DynamicSession
```

이후 표준 Playwright Chromium 프로필을 사용했다.

### 4-4. 쿠키 진단

초기에는 아래처럼 `NID_JST`만 확인됐다.

```text
NID_names=['NID_JST']
```

정상 로그인에는 `NID_AUT`, `NID_SES`가 필요하므로 로그인 미완료 상태로 판단했다.

### 4-5. storage_state 보강

Chromium profile 영속화에만 의존하지 않고, 로그인 성공 시 Playwright
`storage_state`를 별도로 저장하도록 보강했다.

fetch 시에는 `storage_state`의 쿠키를 `DynamicSession(cookies=...)`에 명시적으로
주입한다.

### 4-6. 비대화형 로그인 대기 보강

Codex 실행 환경에서는 `input()`이 EOF로 바로 끝날 수 있었다. 그래서
`sys.stdin.isatty()`가 false인 경우 `NID_AUT`/`NID_SES`가 생길 때까지 최대
`NAVER_LOGIN_WAIT_SEC` 동안 폴링하도록 바꿨다.

### 4-7. 본문 추출 수정

SmartEditor DOM에서 실제 텍스트는 `p.se-text-paragraph`의 직접 텍스트가 아니라
내부 `span`에 있었다. `.text` 대신 `get_all_text()`를 사용하도록 수정했다.

### 4-8. Obsidian 이미지 순서 수정

초기 Obsidian 저장은 텍스트 본문과 이미지 목록을 분리해 이미지가 아래에 몰렸다.
원문은 `.se-component` 순서대로 텍스트와 이미지가 섞여 있으므로,
`scrapers/naver_premium.py`에서 `bodyMarkdown`을 생성하도록 수정했다.

현재 저장 결과는 `## 원문` 아래에서 문단과 이미지가 원문 순서대로 섞인다.

```md
2026-05-11 코스피 4.3% 상승...

![이미지](https://...)

코스피
전체 종목수: 948개
```

---

## 5. 핵심 동작

### `scrapers/naver_login.py`

- `DynamicSession(headless=False)`로 로그인 브라우저 실행
- `https://nid.naver.com/nidlogin.login` 진입
- `NID_AUT`, `NID_SES` 확인
- 성공 시 `scrapers/.state/naver-storage-state.json` 저장
- 비대화형 환경에서는 auth cookie를 자동 폴링

### `scrapers/naver_premium.py`

- `NAVER_PROFILE_DIR` 또는 기본 profile 사용
- `NAVER_STORAGE_STATE` 또는 기본 storage_state 사용
- 빈 env 값은 기본값으로 처리
- 인증 쿠키 없으면 exit code `2`, `SESSION_EXPIRED`
- `body`: 평문 본문
- `bodyMarkdown`: SmartEditor 컴포넌트 순서의 Markdown 본문
- `images`: 이미지 URL 배열
- `accessLevel`: `full`, `free`, `preview`

### `src/naver-to-obsidian.js`

- 단건 URL fetch
- `bodyMarkdown`을 Obsidian 원문으로 저장
- 이미지 별도 섹션 없음
- 저장 위치는 `.env`의 `OBSIDIAN_VAULT_PATH` 사용

---

## 6. 검증 결과

문법 검증:

```bash
python3 -m py_compile scrapers/naver_login.py scrapers/naver_premium.py
node --check src/naver-to-obsidian.js
```

단건 fetch:

```text
NID_names=['NID_AUT', 'NID_JST', 'NID_SES']
storage_state=True
accessLevel=full
isPaywalled=True
bodyLen=12516
images=24
```

Obsidian 저장 예:

```text
/Users/huiseong/Documents/Obsidian Vault/Stock News/2026-05-12/주식분석/naver-premium-mesegong_2049_[시장 단상] 시장 쏠림, NAND 광풍, 로보틱스, 유리기판, 외국인 통합계좌.md
```

---

## 7. 커밋 상태

기본 구현 커밋:

```text
ab9c645 Add Naver Premium crawler
```

이후 추가 변경:

- `scrapers/naver_premium.py`: `bodyMarkdown` 추가, 이미지 원문 순서 보존
- `src/naver-to-obsidian.js`: `bodyMarkdown` 사용, 이미지 하단 몰림 제거
- `agent.md`: 현재 구현 상태와 운영 메모 정리
- `docs/07-naver-premium-progress.md`: 최신 성공 상태로 갱신

---

## 8. 남은 주의사항

- `.env`와 `scrapers/.state/*`는 로컬 자격증명이므로 커밋하지 않는다.
- 세션이 만료되면 `npm run naver:login`을 다시 실행한다.
- `npm run naver:test`는 JSON 출력만 한다.
- Obsidian 노트 저장은 `npm run naver:save -- <URL>`로 한다.
- 원격 이미지가 Obsidian에서 안 보이면 Obsidian의 외부 이미지 로딩/네트워크 상태를 확인한다.
