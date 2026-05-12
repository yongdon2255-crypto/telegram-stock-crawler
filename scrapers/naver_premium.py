#!/usr/bin/env python3
"""
naver_premium.py — 네이버 프리미엄 콘텐츠 단건 크롤러

사용:
    python3 scrapers/naver_premium.py <URL>

입력  : 콘텐츠 URL (예: https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx)
출력  : stdout — JSON 객체 1개 (성공 시)
오류  : stderr 메시지 + 종료 코드
        0 = 정상
        2 = 세션 만료 (페이월 노출 + 인증 false) → 재로그인 필요
        3 = 페이지 오류 (HTTP / 본문 추출 실패)
        4 = 잘못된 인자
"""
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from scrapling.fetchers import DynamicSession

ROOT = Path(__file__).resolve().parent
DEFAULT_PROFILE = ROOT / ".state" / "naver-profile"
DEFAULT_STORAGE_STATE = ROOT / ".state" / "naver-storage-state.json"


def fail(code: int, message: str) -> int:
    print(message, file=sys.stderr)
    return code


def absolute_url(src: str) -> str:
    if not src:
        return ""
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("http"):
        return src
    return ""


def first(node, selector):
    """node.css(selector).first 의 None-safe 헬퍼."""
    if node is None:
        return None
    return node.css(selector).first


def attr(node, name, default=""):
    if node is None:
        return default
    try:
        return node.attrib.get(name, default) or default
    except AttributeError:
        return default


def text_of(node, default=""):
    if node is None:
        return default
    try:
        return (node.get_all_text(separator="", strip=True) or "").strip()
    except AttributeError:
        try:
            return (node.text or "").strip()
        except AttributeError:
            return default


def meta_content(page, prop):
    return attr(first(page, f'meta[property="{prop}"]'), "content", "")


def auth_cookie_names(cookies: list[dict]) -> set[str]:
    return {
        c.get("name", "")
        for c in cookies
        if "naver" in c.get("domain", "") and c.get("name", "").startswith("NID")
    }


def load_storage_cookies(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    cookies = raw.get("cookies", [])
    return cookies if isinstance(cookies, list) else []


def extract(page) -> dict:
    """Selector(=page) 객체에서 필요한 필드를 뽑아낸다."""
    viewer = first(page, "#_SE_VIEWER_CONTENT")
    if viewer is None:
        raise RuntimeError("BODY_NOT_FOUND: #_SE_VIEWER_CONTENT 미존재")

    content_id = attr(viewer, "data-content-id")
    cp_name = attr(viewer, "data-cp-name")
    category_code = attr(viewer, "data-category")
    paywall_ratio = attr(viewer, "data-paywall-ratio")
    content_auth = attr(viewer, "data-content-auth").lower() == "true"

    # data-ba-params는 JSON 문자열
    ba_params_raw = attr(viewer, "data-ba-params")
    ba_params = {}
    if ba_params_raw:
        try:
            ba_params = json.loads(ba_params_raw)
        except Exception:
            pass
    total_text_length = int(ba_params.get("total_text_length", 0) or 0)
    paywall_exposed = (ba_params.get("paywall_exposed", "") or "").lower() == "y"

    # 페이월 배너 존재 여부
    has_paywall_banner = first(page, "div.viewer_paywall") is not None

    # 본문 텍스트: SmartEditor 컴포넌트만 모아서 정리 (UI 텍스트 제거)
    text_parts: list[str] = []
    for node in viewer.css(".se-component .se-text-paragraph"):
        t = text_of(node)
        if t:
            text_parts.append(t)
    body_text = "\n".join(text_parts).strip()

    # 본문 fallback: se-text-paragraph가 비면 viewer 전체 텍스트
    if not body_text:
        try:
            body_text = viewer.get_all_text(separator="\n", strip=True)
        except AttributeError:
            body_text = viewer.text or ""
        body_text = re.sub(r"\s+\n", "\n", body_text).strip()

    # 이미지: SmartEditor 이미지 컴포넌트
    images: list[str] = []
    for img in viewer.css(".se-image img"):
        src = attr(img, "data-lazy-src") or attr(img, "src")
        u = absolute_url(src)
        if u and u not in images:
            images.append(u)

    # 페이지 레벨 메타
    og_title = meta_content(page, "og:title")
    og_desc = meta_content(page, "og:description")
    og_image = meta_content(page, "og:image")
    og_url = meta_content(page, "og:url")
    published = meta_content(page, "article:published_time")

    # 제목 / 작성자
    title = og_title or text_of(first(page, ".end_tit"))
    author = text_of(first(page, ".end_user .name")) or text_of(first(page, ".name"))

    # 노출 비율(미리보기 / 전체) 계산
    try:
        ratio = float(paywall_ratio) if paywall_ratio else None
    except ValueError:
        ratio = None
    preview_fraction = (1.0 / ratio) if ratio and ratio > 0 else None

    # 접근 레벨 판정:
    #  - 페이월 배너 없음 → 전체 무료(free)
    #  - 페이월 배너 있음 + content_auth=False → 미리보기(preview) = 세션 만료 의심
    #  - 페이월 배너 있음 + content_auth=True  → 전체 접근(full, 구독자)
    if content_auth:
        access_level = "full"
    elif not has_paywall_banner:
        access_level = "free"
    else:
        access_level = "preview"

    return {
        "id": content_id,
        "channel": cp_name,
        "title": title,
        "author": author,
        "publishedAt": published,
        "categoryCode": category_code,
        "summary": og_desc,
        "body": body_text,
        "bodyLength": len(body_text),
        "totalTextLength": total_text_length,
        "images": images,
        "thumbnail": absolute_url(og_image),
        "isPaywalled": has_paywall_banner or paywall_exposed or bool(paywall_ratio),
        "accessLevel": access_level,
        "previewFraction": preview_fraction,
        "sourceUrl": og_url,
    }


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if a]
    headful = False
    debug = False
    remaining = []
    for a in args:
        if a == "--headful":
            headful = True
        elif a == "--debug":
            debug = True
        else:
            remaining.append(a)

    if not remaining:
        return fail(4, "usage: naver_premium.py [--headful] [--debug] <URL>")

    url = remaining[0].strip()
    if not url.startswith("http"):
        return fail(4, f"invalid URL: {url}")

    host = urlparse(url).netloc
    if not host.endswith("naver.com"):
        return fail(4, f"non-naver host not supported: {host}")

    profile_dir = Path(os.environ.get("NAVER_PROFILE_DIR") or str(DEFAULT_PROFILE))
    storage_state_path = Path(os.environ.get("NAVER_STORAGE_STATE") or str(DEFAULT_STORAGE_STATE))
    profile_has_data = profile_dir.exists() and any(profile_dir.iterdir())
    storage_has_data = storage_state_path.exists()
    if not profile_has_data and not storage_has_data:
        return fail(
            2,
            f"SESSION_EXPIRED: 프로필/storage_state 비어있음 ({profile_dir}, {storage_state_path}). "
            "먼저 'npm run naver:login' 으로 로그인하세요.",
        )

    storage_cookies = load_storage_cookies(storage_state_path)
    storage_nid_names = auth_cookie_names(storage_cookies)
    if storage_state_path.exists() and not {"NID_AUT", "NID_SES"}.issubset(storage_nid_names):
        return fail(
            2,
            f"SESSION_EXPIRED: storage_state에 필수 인증 쿠키 없음 "
            f"NID_names={sorted(storage_nid_names)}. 'npm run naver:login' 재실행 필요.",
        )

    try:
        with DynamicSession(
            headless=not headful,
            user_data_dir=str(profile_dir),
            cookies=storage_cookies or None,
            google_search=False,
            network_idle=True,
            load_dom=True,
            timeout=60_000,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        ) as session:
            if debug:
                def _cookie_probe(p):
                    try:
                        all_c = p.context.cookies()
                        naver = [c for c in all_c if "naver" in c.get("domain", "")]
                        nid = sorted({c["name"] for c in naver if c["name"].startswith("NID")})
                        print(
                            f"[debug] cookies: total={len(all_c)} naver={len(naver)} "
                            f"NID_names={nid} storage_state={storage_state_path.exists()}",
                            file=sys.stderr,
                        )
                    except Exception as ex:
                        print(f"[debug] cookie probe error: {ex}", file=sys.stderr)
                    return p
                page = session.fetch(
                    url,
                    network_idle=True,
                    wait_selector="#_SE_VIEWER_CONTENT",
                    wait_selector_state="attached",
                    timeout=60_000,
                    page_action=_cookie_probe,
                )
            else:
                page = session.fetch(
                    url,
                    network_idle=True,
                    wait_selector="#_SE_VIEWER_CONTENT",
                    wait_selector_state="attached",
                    timeout=60_000,
                )
            status = getattr(page, "status", 200) or 200
            if status >= 400:
                return fail(3, f"HTTP_{status}: {url}")

            try:
                data = extract(page)
            except RuntimeError as e:
                return fail(3, str(e))

            if debug:
                print(
                    f"[debug] accessLevel={data['accessLevel']} "
                    f"isPaywalled={data['isPaywalled']} "
                    f"bodyLen={data['bodyLength']} "
                    f"totalLen={data['totalTextLength']} "
                    f"headful={headful}",
                    file=sys.stderr,
                )

            if data["accessLevel"] == "preview":
                return fail(
                    2,
                    f"SESSION_EXPIRED: 페이월 노출 + 미인증 응답. id={data['id']}. "
                    "'npm run naver:login' 재실행 필요.",
                )

            print(json.dumps(data, ensure_ascii=False))
            return 0
    except Exception as e:
        return fail(3, f"FETCH_ERROR: {type(e).__name__}: {e}")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
