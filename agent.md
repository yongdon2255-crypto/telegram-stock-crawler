# Agent Notes — Naver Premium Crawler

Last updated: 2026-05-12

## Current State

The Naver Premium content crawler is implemented and verified.

- Manual Naver login works through `npm run naver:login`.
- Login state is saved in both Chromium profile storage and Playwright `storage_state`.
- Authenticated single-article fetch works through `npm run naver:test`.
- Obsidian export works through `npm run naver:save`.
- Obsidian notes now embed images inline in the original SmartEditor component order, instead of appending all images at the bottom.

Verified sample URL:

```text
https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx
```

Latest successful fetch characteristics:

```text
NID_names=['NID_AUT', 'NID_JST', 'NID_SES']
storage_state=True
accessLevel=full
isPaywalled=True
bodyLen=12516
images=24
```

Latest Obsidian vault path:

```text
/Users/huiseong/Documents/Obsidian Vault
```

## Commands

Login:

```bash
npm run naver:login
```

Debug a single article:

```bash
npm run naver:test -- --debug "https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx"
```

Save a single article to Obsidian:

```bash
npm run naver:save -- "https://contents.premium.naver.com/mesegong/contents/contents/260511171452911bx"
```

Syntax checks used:

```bash
python3 -m py_compile scrapers/naver_login.py scrapers/naver_premium.py
node --check src/naver-to-obsidian.js
```

## Important Files

```text
scrapers/naver_login.py
scrapers/naver_premium.py
src/web-fetcher.js
src/web-crawler.js
src/naver-to-obsidian.js
config/web-sources.json
docs/06-naver-premium-plan.md
docs/07-naver-premium-progress.md
.env.example
.gitignore
```

Local-only files that must not be committed:

```text
.env
scrapers/.state/naver-profile/
scrapers/.state/naver-storage-state.json
scrapers/.venv/
```

## Implementation Notes

`scrapers/naver_login.py`

- Uses `DynamicSession(headless=False)`.
- Opens `https://nid.naver.com/nidlogin.login`.
- Verifies login by checking `NID_AUT` and `NID_SES`.
- Saves Playwright `storage_state` to `scrapers/.state/naver-storage-state.json` unless `NAVER_STORAGE_STATE` is set.
- Handles non-interactive execution by polling for auth cookies instead of relying only on terminal `input()`.

`scrapers/naver_premium.py`

- Uses `DynamicSession` with the persistent profile plus explicit cookies from `storage_state`.
- Treats missing or invalid auth cookies as `SESSION_EXPIRED` with exit code `2`.
- Extracts text from SmartEditor paragraphs using `get_all_text()`, because text is usually inside child spans.
- Produces both:
  - `body`: plain text
  - `bodyMarkdown`: text and images interleaved in original `.se-component` order
- Preserves image URL list in `images`.

`src/naver-to-obsidian.js`

- Fetches one article with `fetchNaverPremium`.
- Writes a Markdown note under:

```text
<OBSIDIAN_VAULT_PATH>/Stock News/YYYY-MM-DD/주식분석/
```

- Uses `bodyMarkdown` so images render inline at the correct location in Obsidian.

## Recent Commit

Base implementation was committed as:

```text
ab9c645 Add Naver Premium crawler
```

Uncommitted follow-up changes after that commit:

- `scrapers/naver_premium.py`: added `bodyMarkdown` and inline SmartEditor image ordering.
- `src/naver-to-obsidian.js`: switched Obsidian export from separate image section to `bodyMarkdown`.

## Known Caveats

- `npm run naver:test` only prints JSON. It does not write an Obsidian note.
- `npm run naver:save -- <URL>` writes the note directly to Obsidian.
- Remote images render in Obsidian only if Obsidian can load external URLs.
- If Naver session expires, rerun `npm run naver:login`.
