# Obsidian 연동 및 macOS 스케줄링

## 1. Obsidian Vault 경로 설정

`.env`에 vault 절대경로 지정:

```dotenv
OBSIDIAN_VAULT_PATH=/Users/leo/Documents/Obsidian/Main
```

`config/settings.json`:

```json
{
  "vaultPath": "${OBSIDIAN_VAULT_PATH}",
  "stockNewsFolder": "Stock News",
  "dailyDigestFolder": "Daily Digest",
  "retentionDays": 7,
  "digestSchedule": "0 14 * * 1-5"
}
```

---

## 2. 저장 폴더 구조

```
Obsidian Vault/
└── Stock News/
    ├── 2026-05-11/
    │   ├── 반도체/
    │   │   └── kiwoom_semibat_20260511T1400.md
    │   └── 미국주식/
    │       └── kwusa_20260511T1200.md
    └── Daily Digest/
        └── 2026-05-11.md
```

---

## 3. Markdown 파일 형식

```markdown
---
source: "@kiwoom_semibat"
category: "반도체"
importance: "상"
date: "2026-05-11T14:00:00+09:00"
tags: [stock, 반도체]
---

## 요약

삼성전자, HBM4 공급 계약 TSMC와 체결. 3분기 양산 예정.

## 원문

삼성전자는 오늘 TSMC와 HBM4 관련 공급 계약을...

---
*수집: @kiwoom_semibat · 2026-05-11 14:00 KST*
```

---

## 4. macOS launchd 백그라운드 실행 {#launchd}

### 4-1. plist 파일 생성

```bash
cat > ~/Library/LaunchAgents/com.crawler.stock.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.crawler.stock</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/leo/Documents/development/crawler/src/monitor.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/leo/Documents/development/crawler</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>StartInterval</key>
  <integer>3600</integer>

  <key>StandardOutPath</key>
  <string>/Users/leo/Documents/development/crawler/logs/monitor.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/leo/Documents/development/crawler/logs/monitor-error.log</string>

  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF
```

### 4-2. 등록 및 시작

```bash
mkdir -p /Users/leo/Documents/development/crawler/logs

# 등록
launchctl load ~/Library/LaunchAgents/com.crawler.stock.plist

# 상태 확인
launchctl list | grep crawler

# 즉시 실행 테스트
launchctl start com.crawler.stock

# 로그 확인
tail -f /Users/leo/Documents/development/crawler/logs/monitor.log
```

### 4-3. 중지 / 제거

```bash
launchctl stop com.crawler.stock
launchctl unload ~/Library/LaunchAgents/com.crawler.stock.plist
```

> node 경로가 다를 수 있음: `which node` 로 확인 후 plist 수정.

---

## 5. 수동 실행 (launchd 없이)

```bash
# 포그라운드 (터미널 유지)
npm run monitor

# 백그라운드 (터미널 종료 후에도 유지)
nohup npm run monitor > logs/monitor.log 2>&1 &
echo $! > logs/monitor.pid

# 종료
kill $(cat logs/monitor.pid)
```

---

## 6. Daily Digest 자동 생성

`config/settings.json`의 `digestSchedule` (cron 표현식) 기준으로 평일 14:00 KST에 일간 요약 생성:

```
Stock News/Daily Digest/2026-05-11.md
```

형식:
```markdown
# 2026-05-11 주식 뉴스 요약

## 반도체 (3건)
- [상] 삼성전자 HBM4 공급 계약 체결 — @kiwoom_semibat
- [중] SK하이닉스 GDDR7 샘플 출하 — @KISemicon

## 미국주식 (2건)
- [상] NVDA 실적 발표 가이던스 상향 — @kwusa
```
