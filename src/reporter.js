function formatKST(date = new Date()) {
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(/\. /g, '-').replace('.', '')
}

function nextCycleTime() {
  const next = new Date(Date.now() + 60 * 60 * 1000)
  return next.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function buildMessage(stats) {
  const { channelCount, results, savedCount } = stats

  const byCategory = {}
  for (const r of results) {
    if (!r.count) continue
    const cat = r.category || '기타'
    byCategory[cat] = (byCategory[cat] || 0) + r.count
  }

  const categoryLine = Object.entries(byCategory)
    .map(([k, v]) => `${k}: ${v}건`)
    .join(' | ')

  const totalNew = results.reduce((s, r) => s + (r.count || 0), 0)

  return [
    `크롤러 cycle 완료 (${formatKST()})`,
    '',
    `수집 채널: ${channelCount}개`,
    `신규 메시지: ${totalNew}건${categoryLine ? `\n  └ ${categoryLine}` : ''}`,
    `Obsidian 저장: ${savedCount}건`,
    '',
    `다음 cycle: ~60분 후 (${nextCycleTime()})`,
  ].join('\n')
}

export async function reportCycle(client, stats) {
  const chatId = process.env.REPORT_CHAT_ID || 'me'
  const message = buildMessage(stats)

  try {
    await client.sendMessage(chatId, { message })
    console.log('[reporter] 리포트 전송 완료')
  } catch (err) {
    console.error('[reporter] 전송 실패:', err.message)
  }
}
