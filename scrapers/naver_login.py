#!/usr/bin/env python3
"""
naver_login.py — 1회성 수동 로그인 헬퍼

Scrapling StealthySession을 헤드풀(headful=False)로 띄워 사용자가 직접
네이버에 로그인하게 한 뒤, user_data_dir(=Chromium 영속 프로필)에
쿠키/localStorage를 저장한다. 동시에 Playwright storage_state JSON도
저장해 이후 naver_premium.py 가 인증 쿠키를 명시적으로 주입할 수 있게 한다.

사용:
    python3 scrapers/naver_login.py

권장 절차:
    1. 브라우저가 뜨면 ID/PW 입력 후 로그인 (캡차/2FA 모두 처리)
    2. "이 디바이스 신뢰" 옵션 체크 (NID_AUT 장기 쿠키)
    3. https://contents.premium.naver.com/ 진입 가능 확인
    4. 터미널로 돌아와 Enter 입력 → 프로필 저장 후 종료
"""
import os
import sys
import time
from pathlib import Path

from scrapling.fetchers import DynamicSession

ROOT = Path(__file__).resolve().parent
DEFAULT_PROFILE = ROOT / ".state" / "naver-profile"
DEFAULT_STORAGE_STATE = ROOT / ".state" / "naver-storage-state.json"
LOGIN_URL = "https://nid.naver.com/nidlogin.login"
SUCCESS_HINT_URL = "https://contents.premium.naver.com/"
DEFAULT_LOGIN_WAIT_SEC = 600


def naver_nid_names(page) -> tuple[list[dict], list[str]]:
    cookies = page.context.cookies()
    naver_cookies = [c for c in cookies if "naver.com" in c.get("domain", "")]
    nid_names = sorted({c["name"] for c in naver_cookies if c["name"].startswith("NID")})
    return naver_cookies, nid_names


def wait_for_auth_cookies(page, timeout_sec: int) -> tuple[list[dict], list[str]]:
    deadline = time.monotonic() + timeout_sec
    last_naver_cookies: list[dict] = []
    last_nid_names: list[str] = []
    while time.monotonic() < deadline:
        try:
            last_naver_cookies, last_nid_names = naver_nid_names(page)
            if {"NID_AUT", "NID_SES"}.issubset(last_nid_names):
                return last_naver_cookies, last_nid_names
        except Exception:
            pass
        time.sleep(2)
    return last_naver_cookies, last_nid_names


def main() -> int:
    profile_dir = Path(os.environ.get("NAVER_PROFILE_DIR") or str(DEFAULT_PROFILE))
    storage_state_path = Path(os.environ.get("NAVER_STORAGE_STATE") or str(DEFAULT_STORAGE_STATE))
    login_wait_sec = int(os.environ.get("NAVER_LOGIN_WAIT_SEC", str(DEFAULT_LOGIN_WAIT_SEC)))
    profile_dir.mkdir(parents=True, exist_ok=True)
    storage_state_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[naver-login] 프로필 디렉터리: {profile_dir}", file=sys.stderr)
    print(f"[naver-login] storage_state: {storage_state_path}", file=sys.stderr)
    print("[naver-login] 헤드풀 브라우저 기동…", file=sys.stderr)

    def manual_login(page):
        # 사용자에게 nid.naver.com 로그인 화면 노출 — page_action 호출 시점에 이미 로드됨
        print("", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        print(" 브라우저에서 직접 네이버에 로그인하세요.", file=sys.stderr)
        print(" 1) ID/PW 입력 + 캡차/2FA 처리", file=sys.stderr)
        print(" 2) '로그인 상태 유지' 체크박스 반드시 체크", file=sys.stderr)
        print(" 3) 로그인 완료 후 https://contents.premium.naver.com/ 진입,", file=sys.stderr)
        print("    우측 상단에 본인 닉네임/아이디가 보이는지 확인", file=sys.stderr)
        print(" 4) 이 터미널로 돌아와 Enter 입력", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        if sys.stdin.isatty():
            try:
                input()
            except EOFError:
                pass
        else:
            print(
                f"[naver-login] 비대화형 실행 감지: 최대 {login_wait_sec}초 동안 "
                "NID_AUT/NID_SES 쿠키를 자동 대기합니다.",
                file=sys.stderr,
            )
            wait_for_auth_cookies(page, login_wait_sec)

        # 종료 직전 검증: 실제 로그인 인증 쿠키(NID_AUT, NID_SES) 존재 확인
        try:
            naver_cookies, nid_names = naver_nid_names(page)
            has_aut = "NID_AUT" in nid_names
            has_ses = "NID_SES" in nid_names
            print(
                f"[naver-login] verify: naver 쿠키 {len(naver_cookies)}개, "
                f"NID 이름들={nid_names}",
                file=sys.stderr,
            )
            if has_aut and has_ses:
                print("[naver-login] ✅ NID_AUT, NID_SES 확인 — 로그인 완료", file=sys.stderr)
                try:
                    page.context.storage_state(path=str(storage_state_path))
                    print("[naver-login] storage_state 저장 완료", file=sys.stderr)
                except Exception as e:
                    print(f"[naver-login] storage_state 저장 실패: {e}", file=sys.stderr)
                try:
                    page.goto(SUCCESS_HINT_URL, wait_until="domcontentloaded", timeout=30_000)
                except Exception:
                    pass
            else:
                missing = [n for n, ok in [("NID_AUT", has_aut), ("NID_SES", has_ses)] if not ok]
                print(
                    f"[naver-login] ❌ 로그인 실패: 필수 쿠키 {missing} 미발급.",
                    file=sys.stderr,
                )
                print(
                    "[naver-login]    브라우저에서 nid.naver.com 로그인 페이지로 가서 "
                    "ID/PW + 캡차/2FA 까지 완전히 통과한 뒤 다시 시도하세요.",
                    file=sys.stderr,
                )
        except Exception as e:
            print(f"[naver-login] verify error: {e}", file=sys.stderr)
        return page

    with DynamicSession(
        headless=False,
        user_data_dir=str(profile_dir),
        google_search=False,
        network_idle=False,
        load_dom=True,
        timeout=120_000,
        locale="ko-KR",
        timezone_id="Asia/Seoul",
    ) as session:
        try:
            session.fetch(LOGIN_URL, page_action=manual_login, timeout=600_000)
        except Exception as e:
            print(f"[naver-login] fetch 종료: {e}", file=sys.stderr)

    print(f"[naver-login] 프로필 저장 완료: {profile_dir}", file=sys.stderr)
    print("[naver-login] 이제 'npm run naver:test <URL>' 로 단건 확인 가능", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
