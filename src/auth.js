import 'dotenv/config'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const apiId = Number(process.env.TG_API_ID)
const apiHash = process.env.TG_API_HASH

if (!apiId || !apiHash) {
  console.error('오류: .env에 TG_API_ID와 TG_API_HASH를 먼저 설정하세요.')
  process.exit(1)
}

const rl = createInterface({ input, output })
const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 5,
})

await client.start({
  phoneNumber: () => rl.question('전화번호 (+82 10XXXXXXXX): '),
  phoneCode:   () => rl.question('인증코드 (텔레그램 앱 확인): '),
  password:    () => rl.question('2FA 비밀번호 (없으면 Enter): '),
  onError:     (err) => console.error('인증 오류:', err.message),
})

rl.close()

const session = client.session.save()
console.log('\n✅ 인증 완료. 아래 값을 .env의 TG_SESSION= 에 붙여넣으세요:\n')
console.log(`TG_SESSION=${session}\n`)

await client.disconnect()
