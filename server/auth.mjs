import { createHmac, timingSafeEqual } from 'node:crypto'

export function authenticate(initData, token, now = Date.now()) {
  if (typeof initData !== 'string' || !token || initData.length > 8192) throw new Error('Invalid Telegram session')
  const params = new URLSearchParams(initData)
  const seen = new Set()
  for (const [key] of params) {
    if (seen.has(key)) throw new Error('Invalid Telegram session')
    seen.add(key)
  }
  const hash = params.get('hash')
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid Telegram session')
  params.delete('hash')
  const check = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const key = createHmac('sha256', 'WebAppData').update(token).digest()
  const expected = createHmac('sha256', key).update(check).digest()
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new Error('Invalid Telegram session')
  const age = now / 1000 - Number(params.get('auth_date'))
  if (!Number.isFinite(age) || age < -30 || age > 86400) throw new Error('Session expired. Reopen the game in Telegram.')
  const user = JSON.parse(params.get('user') ?? 'null')
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error('Invalid Telegram session')
  return String(user.id)
}

export function equalSecret(actual, expected) {
  if (!actual || !expected || typeof actual !== 'string') return false
  const a = Buffer.from(actual), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
