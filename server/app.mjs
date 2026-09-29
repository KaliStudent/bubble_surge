import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { authenticate, equalSecret } from './auth.mjs'
import { PACKS, STYLES } from './catalog.mjs'

export async function telegramCall(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  const data = await response.json()
  // Do not expose Telegram URLs (which contain the token) or upstream request details.
  if (!response.ok || !data.ok) throw new Error('Telegram service request failed')
  return data.result
}

export function createApp({ store, token = '', webhookSecret = '', support = '', publicOrigin = '',
  paymentsEnabled = false, dist = resolve('dist'), botCall = (method, body) => telegramCall(token, method, body) }) {
  const enabled = paymentsEnabled && !!token && webhookSecret.length >= 32 && !!support && publicOrigin.startsWith('https://')
  const limits = new Map()
  const limited = (key, max, window = 60000) => {
    const now = Date.now()
    if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now) limits.delete(k)
    let entry = limits.get(key)
    if (!entry || entry.until < now) { entry = { count: 0, until: now + window }; limits.set(key, entry) }
    return ++entry.count > max
  }
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data))
  }
  const readBody = async req => {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON required')
    let size = 0, chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > 32768) throw new Error('Request too large')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/healthz') return json(res, 200, { status: 'ok', payments: enabled })
      if (url.pathname === '/api/telegram/webhook') {
        if (req.method !== 'POST' || !equalSecret(req.headers['x-telegram-bot-api-secret-token'], webhookSecret)) return json(res, 403, { error: 'Forbidden' })
        const update = await readBody(req)
        if (update.pre_checkout_query) {
          const query = update.pre_checkout_query
          let error
          try {
            if (!enabled) throw new Error('Purchases are temporarily unavailable.')
            store.validatePayment(String(query.from.id), query, true)
          } catch { error = 'This purchase is unavailable or expired. Please open a new invoice.' }
          await botCall('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: !error, ...(error ? { error_message: error } : {}) })
        }
        if (update.message?.successful_payment) store.credit(String(update.message.from.id), update.message.successful_payment)
        if (update.message?.refunded_payment) {
          const payment = update.message.refunded_payment
          const order = store.validatePayment(String(update.message.chat.id), payment)
          // Telegram can deliver refund notifications before a retried payment update.
          store.credit(order.user_id, payment)
          store.refund(payment.telegram_payment_charge_id)
        }
        const message = update.message
        if (message?.text?.match(/^\/(paysupport|support|terms)(?:@\w+)?(?:\s|$)/)) {
          await botCall('sendMessage', { chat_id: message.chat.id,
            text: `Bubble Surge support: ${support || 'Purchases are currently disabled.'}\nFor payment help, refunds, or account-data requests, include your Telegram payment receipt. Prisms buy cosmetics only and have no cash value. A refund removes its Prisms and resets equipped premium styles; remaining paid value is preserved.` })
        }
        return json(res, 200, { ok: true })
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && publicOrigin && req.headers.origin !== publicOrigin) return json(res, 403, { error: 'Origin not allowed' })
        if (req.method === 'GET' && url.pathname === '/api/store') return json(res, 200, { enabled, packs: PACKS, styles: STYLES, support })
        let user
        try { user = authenticate((req.headers.authorization ?? '').replace(/^tma /, ''), token) }
        catch { return json(res, 401, { error: 'Reopen the game in Telegram to access your account.' }) }
        if (limited(`user:${user}`, 120)) return json(res, 429, { error: 'Please wait a moment before trying again.' })
        if (req.method === 'GET' && url.pathname === '/api/wallet') return json(res, 200, store.wallet(user))
        if (req.method !== 'POST') return json(res, 404, { error: 'Not found' })
        const body = await readBody(req)
        if (url.pathname === '/api/invoice') {
          if (!enabled) return json(res, 503, { error: 'Purchases are not available yet.' })
          if (limited(`invoice:${user}`, 5, 300000)) return json(res, 429, { error: 'Please wait before creating another purchase.' })
          if (!PACKS.some(p => p.id === body.id)) return json(res, 400, { error: 'Unknown pack' })
          const invoice = store.invoice(user, body.id)
          const link = await botCall('createInvoiceLink', { title: `${invoice.prisms} Bubble Surge Prisms`,
            description: 'Optional cosmetic currency for premium arena styles. No gameplay advantage.',
            payload: invoice.id, provider_token: '', currency: 'XTR', prices: [{ label: 'Prisms', amount: invoice.stars }] })
          return json(res, 200, { url: link })
        }
        if (url.pathname === '/api/cosmetics') {
          try { return json(res, 200, store.unlock(user, body.id)) }
          catch { return json(res, 400, { error: 'Style unavailable or not enough Prisms.' }) }
        }
        if (url.pathname === '/api/events') {
          const allowed = ['run_started', 'run_completed', 'run_abandoned', 'tutorial_complete', 'coin_spend', 'purchase_intent']
          if (!allowed.includes(body.event) || limited(`event:${user}`, 30) || typeof body.session !== 'string' || body.session.length > 64) return json(res, 400, { error: 'Invalid event' })
          const properties = {}
          for (const [key, value] of Object.entries(body.properties ?? {}).slice(0, 20)) {
            if (!['mode','level','date','won','stars','score','shots','drops','banks','cores','seconds','coins','item','amount','pack'].includes(key)) continue
            if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length < 80)) properties[key] = value
          }
          // Opt-in anonymous install ID, not derived from Telegram's identity.
          const player = createHash('sha256').update(typeof body.player === 'string' ? body.player.slice(0, 64) : body.session).digest('hex').slice(0, 24)
          store.db.prepare('INSERT INTO events(player,session,event,data,created) VALUES (?,?,?,?,?)').run(player, body.session, body.event, JSON.stringify(properties), Date.now())
          store.db.prepare('DELETE FROM events WHERE created < ?').run(Date.now() - 30 * 86400000)
          return json(res, 200, { ok: true })
        }
        return json(res, 404, { error: 'Not found' })
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' })
      const path = resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
      if (!path.startsWith(resolve(dist) + sep) || !existsSync(path) || !(await stat(path)).isFile()) return json(res, 404, { error: 'Not found' })
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' }
      res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream')
      res.setHeader('Cache-Control', url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'self'; object-src 'none'")
      if (req.method === 'HEAD') return res.end()
      createReadStream(path).on('error', () => res.destroy()).pipe(res)
    } catch {
      // No request headers, tokens, user details, or receipts in public logs.
      if (!res.headersSent) json(res, 500, { error: 'Service temporarily unavailable. Please try again.' })
      else res.end()
    }
  })
}
