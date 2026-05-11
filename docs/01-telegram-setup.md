# Phase 1: 텔레그램 수집 설정

## 1. Bot API vs MTProto — 선택 기준

| 방식 | Bot API | MTProto (gramjs) |
|------|---------|-----------------|
| 발급처 | @BotFather | my.telegram.org |
| 공개채널 읽기 | 가능 | 가능 |
| 비공개채널 읽기 | 봇이 멤버여야 함 | 계정이 멤버면 됨 |
| 이미지/PDF 다운로드 | 제한적 (20MB) | 제한 없음 |
| 권장 | X | **O** |

> **권장: MTProto (gramjs)**. 증권사 채널 중 초대 전용 비공개 채널이 있으며 파일 다운로드 한도도 없음.

---

## 2. Telegram API 자격증명 발급 (MTProto)

### 2-1. my.telegram.org 접속

1. 브라우저에서 [https://my.telegram.org](https://my.telegram.org) 접속
2. 본인 전화번호 입력 (국제 형식: +82 10XXXXXXXX)
3. 텔레그램 앱으로 받은 인증코드 입력

### 2-2. App 생성

1. **API development tools** 클릭
2. 다음 정보 입력:
   - **App title**: `stock-crawler` (임의)
   - **Short name**: `stockcrawler`
   - **Platform**: Other
   - **Description**: 개인용 채널 아카이빙
3. **Create application** 클릭

### 2-3. 자격증명 복사

생성 후 표시되는 두 값을 `.env`에 저장:

```
App api_id: 1234567        → TG_API_ID
App api_hash: abc123...    → TG_API_HASH
```

> **주의**: api_hash는 다시 볼 수 없으므로 즉시 복사.

---

## 3. 프로젝트 초기 설정

### 3-1. 의존성 설치

```bash
cd /Users/leo/Documents/development/crawler
npm init -y
npm install telegram dotenv pdf-parse node-cron
```

### 3-2. .env 파일 작성

```bash
cp .env.example .env
```

`.env` 편집:

```dotenv
TG_API_ID=1234567
TG_API_HASH=abcdef1234567890abcdef1234567890
TG_SESSION=                        # 첫 실행 후 자동으로 채워짐
REPORT_CHAT_ID=me                  # 리포트 수신 채팅 ID (me = 내 저장 메시지)
OBSIDIAN_VAULT_PATH=/Users/leo/Documents/Obsidian/Main
RETENTION_DAYS=7
```

### 3-3. 첫 실행 — 세션 생성

```bash
node src/auth.js
```

실행하면:
1. 전화번호 입력 프롬프트 (예: `+821012345678`)
2. 텔레그램 앱에서 받은 인증코드 입력
3. 2FA 비밀번호 (설정된 경우) 입력
4. 성공 시 `TG_SESSION=` 값이 터미널에 출력됨

출력된 세션 문자열을 `.env`의 `TG_SESSION=` 뒤에 붙여넣기.

> 세션은 재사용되므로 이후 실행 시 인증 불필요.

---

## 4. 채널 등록

```bash
# 채널 추가
node src/cli.js add-channel @kiwoom_semibat --category 반도체
node src/cli.js add-channel @kwusa --category 미국주식
node src/cli.js add-channel @merITz_tech --category IT/Tech
node src/cli.js add-channel @skitteam --category IT/Tech
node src/cli.js add-channel @KISemicon --category 반도체

# 목록 확인
node src/cli.js list-channels
```

`config/channels.json` 직접 편집도 가능:

```json
{
  "channels": [
    {
      "handle": "@kiwoom_semibat",
      "category": "반도체",
      "pollingIntervalSec": 3600,
      "enabled": true
    }
  ]
}
```

---

## 5. 첫 수집 (Backfill)

```bash
# 특정 채널 최근 24시간 backfill
node src/monitor.js --backfill --channel @kiwoom_semibat --hours 24

# 모든 채널 backfill (기본 39시간)
npm run backfill
```

backfill 완료 후 `inbox/` 폴더에 JSON 파일이 생성되었는지 확인:

```bash
ls inbox/
# 예: 2026-05-11_kiwoom_semibat_msg12345.json
```

---

## 6. 리포트 수신 채팅 ID 확인

cycle 완료 후 `reporter.js`가 텔레그램으로 상태 메시지를 전송한다. 수신 대상을 설정해야 한다.

### 옵션 A — 내 저장 메시지 (Saved Messages, 가장 간단)

```dotenv
REPORT_CHAT_ID=me
```

텔레그램 앱 → "Saved Messages" 채팅으로 리포트가 전송됨.

### 옵션 B — 특정 채팅 ID 지정

본인 계정의 숫자 ID가 필요한 경우:

```bash
# 세션 생성 후 아래 실행
node -e "
const { TelegramClient, StringSession } = require('telegram');
require('dotenv').config();
(async () => {
  const client = new TelegramClient(
    new StringSession(process.env.TG_SESSION),
    +process.env.TG_API_ID,
    process.env.TG_API_HASH,
    {}
  );
  await client.connect();
  const me = await client.getMe();
  console.log('My ID:', me.id.toString());
  await client.disconnect();
})();
"
```

출력된 숫자를 `.env`에 저장:

```dotenv
REPORT_CHAT_ID=123456789
```

---

## 7. 상시 모니터링 시작

```bash
npm run monitor
```

1시간마다 등록된 모든 채널을 polling. 백그라운드 실행은 [macOS launchd 설정](03-obsidian-setup.md#launchd) 참고.

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| `AUTH_KEY_DUPLICATED` | 세션 충돌 | `.env`의 `TG_SESSION` 초기화 후 재인증 |
| `FLOOD_WAIT_X` | API 요청 과다 | X초 대기, pollingIntervalSec 증가 |
| `CHANNEL_PRIVATE` | 미가입 채널 | 텔레그램 앱에서 해당 채널 가입 후 재시도 |
| 세션 파일 노출 | .env 미추가 | `.gitignore`에 `.env` 포함 여부 확인 |
