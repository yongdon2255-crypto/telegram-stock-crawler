# 시스템 개요

## 목적

한국 증권사 텔레그램 채널을 자동으로 수집·분류·요약해 Obsidian에 저장하는 로컬 인텔리전스 파이프라인.

## 전체 흐름

```
텔레그램 채널 (공개/비공개)
        │
        ▼
[monitor.js] — 1시간 polling cycle
  └─ slow rule: 채널당 60s(소형) ~ 180s(대형) 딜레이
        │  raw JSON (메시지 + 첨부파일)
        ▼
[inbox/]  ←────────── 7일 보관 후 자동 삭제
        │
        ▼
[handoff.js] — inbox → processor 큐로 이동
        │
        ▼
[processor.js]
  ├─ 텍스트 메시지   → 그대로 사용
  ├─ PDF 첨부       → pdf-parse → 텍스트 추출
  └─ 이미지 첨부    → claude CLI (vision) → 텍스트 추출
        │
        ▼
[claude-runner.js] — claude CLI subprocess (OAuth)
  → 1줄 요약, 카테고리, 중요도(상/중/하) 반환
        │
        ▼
[obsidian.js] — .md 파일 생성 → Obsidian Vault
        │
        ▼
[reporter.js] — cycle 완료 후 사용자 텔레그램으로 상태 리포트 전송
```

## 카테고리 체계

| 카테고리 | 주요 채널 예시 |
|----------|---------------|
| 반도체   | @kiwoom_semibat, @KISemicon |
| 미국주식 | @kwusa |
| IT/Tech  | @merITz_tech, @skitteam |

## 파일 레이아웃

```
crawler/
├── CLAUDE.md
├── .env                    ← 시크릿 (git 제외)
├── .env.example            ← 템플릿 (git 포함)
├── config/
│   ├── channels.json       ← 채널 목록 + large 플래그
│   └── settings.json       ← vault 경로, 보존 기간, digest 스케줄
├── src/
│   ├── auth.js             ← 최초 1회 세션 생성
│   ├── monitor.js          ← polling 루프 + slow rule
│   ├── handoff.js          ← inbox → processor 큐 이동
│   ├── processor.js        ← OCR + 요약 조율
│   ├── claude-runner.js    ← claude CLI subprocess 래퍼
│   ├── obsidian.js         ← vault .md 저장
│   ├── reporter.js         ← 텔레그램 상태 리포트 전송
│   └── cli.js              ← 채널 관리 CLI
├── inbox/                  ← raw JSON (git 제외)
├── processed/              ← 처리 완료 아카이브 (git 제외)
├── logs/                   ← 로그 파일 (git 제외)
└── docs/
    ├── 00-overview.md      ← 이 파일
    ├── 01-telegram-setup.md
    ├── 02-claude-oauth.md
    ├── 03-obsidian-setup.md
    └── 04-implementation-plan.md
```

## 의존성 요약

| 패키지 | 역할 |
|--------|------|
| `telegram` (gramjs) | MTProto 클라이언트 (수집 + 리포트 전송 공용) |
| `pdf-parse` | PDF 텍스트 추출 |
| `node-cron` | 프로세스 내 스케줄링 |
| `dotenv` | 환경변수 로드 |
| `claude` CLI | 요약·분류·OCR (OAuth, 별도 설치) |

## 다음 단계

1. [텔레그램 설정](01-telegram-setup.md) — API 발급, 세션 생성, 리포트 채팅 ID 확인
2. [Claude OAuth 연동](02-claude-oauth.md) — CLI 경로 및 동작 확인
3. [Obsidian 연동](03-obsidian-setup.md) — vault 경로, launchd 스케줄링
4. [구현 계획](04-implementation-plan.md) — 단계별 코드 구현 순서
