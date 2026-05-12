# 네이버 프리미엄 콘텐츠 크롤러 — 작업 진행 상황 (2026-05-12)

본 문서는 `docs/06-naver-premium-plan.md` 계획의 실제 구현 진척 상황과
디버깅 과정을 코덱스(또는 다른 협업자)가 컨텍스트를 잡을 수 있도록 정리한 것이다.

---

## 1. 현재 상태 요약

| 단계 | 상태 | 비고 |
|---|---|---|
| Python 워커 환경(`scrapers/.venv`) | ✅ | Scrapling 0.4.8, Playwright 1.59 Chromium 1217 설치 완료 |
| `scrapers/naver_login.py` | ✅ | DynamicSession 헤드풀 + 로그인 후 NID 쿠키 검증 + storage_state 저장 |
| `scrapers/naver_premium.py` | ✅ | DynamicSession 헤드리스 + storage_state 쿠키 주입 + `--debug` / `--headful` 플래그 |
| `.gitignore`, `.env.example` | ✅ | 세션 디렉터리 제외 + `NAVER_PROFILE_DIR`, `NAVER_STORAGE_STATE` env 추가 |
| `src/web-fetcher.js` `fetchNaverPremium` | ✅ | venv python 호출 + `NaverSessionExpiredError` (code=`SESSION_EXPIRED`) |
| `src/web-crawler.js` `naver-premium` 분기 | ✅ | `type:"naver-premium"` 소스 처리 |
| `config/web-sources.json` 항목 | ✅ | `naver-premium-mesegong` (`enabled:false`) |
| `package.json` 헬퍼 스크립트 | ✅ | `npm run naver:login`, `npm run naver:test` |
| **단건 fetch 본문 추출 검증** | 🟡 BLOCKED | 사용자 로그인 단계에서 NID_AUT/NID_SES 미발급 |

---

## 2. 디렉터리 구조 (신규 항목만)

```
scrapers/
├── .venv/                          # Python 가상환경 (git 제외)
├── .state/
│   ├── .gitkeep
│   ├── naver-profile/              # Chromium 영속 프로필 (git 제외)
│   ├── naver-storage-state.json     # Playwright storage_state (git 제외)
│   └── naver-profile.patchright-bak-20260512-200809/   # 백업
├── requirements.txt
├── naver_login.py
└── naver_premium.py
docs/
├── 06-naver-premium-plan.md        # 초기 전략
└── 07-naver-premium-progress.md    # 이 문서
```

---

## 3. 시도와 결과 — 디버깅 타임라인

### 3-1. 초기 구현: StealthySession (patchright Chromium)

처음에는 `scrapling.fetchers.StealthySession` (patchright 기반)을 사용.
1차 로그인 후 fetch 시도 시:

```
[2026-05-12 20:03:07] INFO: Fetched (200) <GET .../260511171452911bx>
SESSION_EXPIRED: 페이월 노출 + 미인증 응답.
```

`data-content-auth="false"` + `viewer_paywall` 노출.

### 3-2. `humanize=True` 의심 → 해제

`humanize=True`가 매 세션마다 다른 fingerprint를 생성해 디바이스 식별이
어긋난다는 가설로 `humanize=False`로 변경 — 동일 증상.

### 3-3. 헤드리스↔헤드풀 차이 의심 → 헤드풀로 재시도

`--headful --debug` 플래그를 추가해 헤드풀로 동일 URL fetch:

```
[debug] accessLevel=preview isPaywalled=True bodyLen=0 totalLen=11731 headful=True
```

여전히 페이월 — 헤드리스/헤드풀 차이가 아님이 확인됨.

### 3-4. 사용자가 헤드풀 브라우저에서 직접 확인

사용자 보고: "로그인 상태가 아닌데" → 헤드풀 창에서 봐도 비로그인 상태.
**patchright Chromium의 `user_data_dir` 영속화가 표준대로 동작하지 않는다는
정황**.

### 3-5. DynamicSession (표준 Playwright Chromium)으로 전환

```diff
- from scrapling.fetchers import StealthySession
+ from scrapling.fetchers import DynamicSession

- with StealthySession(headless=True, humanize=False, user_data_dir=..., ...) as session:
+ with DynamicSession(headless=True, user_data_dir=..., ...) as session:
```

`scrapers/.state/naver-profile/` → `naver-profile.patchright-bak-…/` 로 백업
후 새 프로필 디렉터리로 시작.

### 3-6. `SingletonLock` 충돌

`DynamicSession` 전환 후 fetch 시도 시:

```
Failed to create a ProcessSingleton for your profile directory.
SingletonLock -> huiseong-ui-MacBookPro.local-13728  (PID 13728 살아있음)
```

원인: 직전 `naver_login.py` 헤드풀 세션의 Chromium 부모 프로세스가
백그라운드에 잔존. 디버깅 중 Singleton* 파일을 한 차례 잘못 삭제했으나,
이후 PID 13728을 `kill -TERM`으로 정상 종료해 쿠키 DB가 commit됨
(`Cookies` 파일 mtime 20:10:27).

### 3-7. 쿠키 진단 — 결정적 단서

`naver_premium.py`의 `page_action`에 쿠키 카운트 프로브 추가
(값은 노출하지 않고 이름과 개수만):

```python
def _cookie_probe(p):
    all_c = p.context.cookies()
    naver = [c for c in all_c if "naver" in c.get("domain", "")]
    nid = sorted({c["name"] for c in naver if c["name"].startswith("NID")})
    print(f"[debug] cookies: total={len(all_c)} naver={len(naver)} NID_names={nid}",
          file=sys.stderr)
    return p
```

헤드리스 fetch 결과:

```
[debug] cookies: total=15 naver=15 NID_names=['NID_JST']
```

**결론**: 쿠키는 헤드리스 세션에 정상 적재됨(naver 15개).
그러나 NID 쿠키 중 `NID_JST` 하나뿐 — 이건 단순 페이지 방문만으로도
발급되는 JavaScript 토큰. **실제 로그인 인증 쿠키 `NID_AUT`, `NID_SES`가
존재하지 않음** → 사용자가 헤드풀 로그인 헬퍼에서 ID/PW 입력 단계까지
완료하지 못한 상태.

---

## 4. 현재 블록 지점

**사용자가 `npm run naver:login` 실행 시 헤드풀 브라우저에서 실제 로그인
플로우(ID/PW 입력 + 캡차/2FA)를 끝까지 통과하지 못함.**

증거:
- `naver_premium.py --debug` 출력 `NID_names=['NID_JST']`
- `NID_AUT`, `NID_SES` 부재 → 정상 로그인 시 발급되어야 할 인증 쿠키 없음

원인 추정 (확인 미완):
1. 헤드풀 창에서 `nid.naver.com` 로그인 페이지까지 도달하지 못함 (메인에서 멈춤)
2. ID/PW 입력 후 캡차/OTP 화면에서 처리 못 함
3. 로그인 시도 후 네이버가 "비정상 접근" 으로 차단

---

## 5. 적용한 안전장치 (최신 코드 기준)

### `scrapers/naver_login.py`
로그인 완료 후 verify 단계에서 NID_AUT/NID_SES 존재 검사:

```python
has_aut = "NID_AUT" in nid_names
has_ses = "NID_SES" in nid_names
if has_aut and has_ses:
    print("[naver-login] ✅ NID_AUT, NID_SES 확인 — 로그인 완료", file=sys.stderr)
else:
    missing = [n for n, ok in [("NID_AUT", has_aut), ("NID_SES", has_ses)] if not ok]
    print(f"[naver-login] ❌ 로그인 실패: 필수 쿠키 {missing} 미발급.", file=sys.stderr)
```

성공 시 `NAVER_STORAGE_STATE` 또는 기본
`scrapers/.state/naver-storage-state.json` 경로에 Playwright
`storage_state`를 저장한다. 이후 fetch 단계는 프로필 영속화에 더해 이 파일의
쿠키를 명시적으로 주입한다.

### `scrapers/naver_premium.py`
- 인증 실패(`accessLevel == "preview"`) 시 `exit 2` + stderr `SESSION_EXPIRED`
- `--debug` 옵션으로 fetch 시점 쿠키 진단 출력
- `--headful` 옵션으로 시각적 디버깅 가능
- `storage_state` 파일이 있으면 `NID_AUT`, `NID_SES` 존재를 선검증하고 쿠키를
  `DynamicSession(cookies=...)` 로 주입

### `src/web-fetcher.js`
- exit 2 → `NaverSessionExpiredError` (code=`SESSION_EXPIRED`)
- 기본 python 인터프리터 우선순위: 인자 `python` > env `NAVER_PYTHON` > `scrapers/.venv/bin/python`

---

## 6. 다음 단계

### 즉시 해야 할 일 (사용자 수동)
1. `npm run naver:login` 재실행
2. 헤드풀 창에서 **반드시** `nid.naver.com/nidlogin.login` 페이지로 가서
   - ID/PW 입력
   - "로그인 상태 유지" 체크
   - 캡차/2FA 완전 통과
3. 로그인 완료 후 본인 닉네임이 보이는지 눈으로 확인
4. 터미널 Enter → stderr에서 `✅ NID_AUT, NID_SES 확인` 확인
5. stderr에서 `storage_state 저장 완료` 확인
6. `npm run naver:test -- --debug "https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx"` 재실행

### 통과 시 검증 포인트
- `accessLevel: "full"`
- `bodyLength` ≈ 11,731 (= `totalTextLength`)
- `images` 길이 ≥ 1 (페이지에는 24장 명시됨)

### 그래도 실패하면 다음 진단 옵션
1. **헤드풀 fetch에선 OK / 헤드리스에선 페이월**일 경우
   - `useragent` 명시 지정 (헤드리스 모드 UA가 다를 가능성)
   - `disable_resources=False` 명시
2. **헤드풀에서도 페이월**일 경우
   - 사용자가 헤드풀 창에서 직접 contents.premium.naver.com 진입해
     로그인 표시(닉네임)가 있는지 확인
   - 없다면 네이버가 자동화 디바이스로 의심해 로그인 무효화 가능성 →
     `real_chrome=True` 시도 (시스템 Chrome 사용)
3. **stealth 우회 필요한 경우**
   - `StealthySession` 으로 되돌아가되 `user_data_dir` 영속화 대신
     로그인 헬퍼 안에서 직접 `context.storage_state(path=...)` 저장 후
     fetch 시 `context.add_cookies()` 로 명시 주입하는 방식 검토

---

## 7. 핵심 파일 경로 (코덱스 빠른 참고용)

```
/Users/huiseong/telegram-stock-crawler/
├── scrapers/
│   ├── requirements.txt
│   ├── naver_login.py            # 헤드풀 로그인 + verify
│   └── naver_premium.py          # 헤드리스 fetch + --debug/--headful
├── src/
│   ├── web-fetcher.js            # fetchNaverPremium(), NaverSessionExpiredError
│   └── web-crawler.js            # crawlNaverPremium() 분기
├── config/
│   └── web-sources.json          # naver-premium-mesegong (enabled:false)
├── package.json                  # naver:login, naver:test
├── .env.example                  # NAVER_PROFILE_DIR
└── docs/
    ├── 06-naver-premium-plan.md
    └── 07-naver-premium-progress.md
```

샘플 테스트 URL:
```
https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx
```

페이지 메타(이전 분석 결과):
- 채널: `mesegong` (메르를 통해 엿보는 세상 공부)
- 본문 컨테이너: `#_SE_VIEWER_CONTENT` (SmartEditor3)
- 페이월: `<div class="viewer_paywall">` + `data-content-auth="false|true"`
- 전체 본문 길이: 11,731자 (paywall ratio 2.93 = 미리보기 약 34%)
- 첨부 이미지: 24장
