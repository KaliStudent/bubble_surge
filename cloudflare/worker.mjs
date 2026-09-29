import { createHash } from 'node:crypto'
import { authenticate, equalSecret } from '../server/auth.mjs'
import { PACKS, STYLES } from '../server/catalog.mjs'
import { D1Store } from './store.mjs'

const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}
const json = (status, data) => new Response(JSON.stringify(data), { status, headers })
class BadRequest extends Error {}
async function readBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new BadRequest('JSON required')
  const reader = request.body?.getReader()
  if (!reader) throw new BadRequest('Body required')
  let size = 0, chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 32768) { await reader.cancel(); throw new BadRequest('Request too large') }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const data = JSON.parse(new TextDecoder().decode(bytes))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    return data
  } catch (error) {
    if (error instanceof BadRequest) throw error
    throw new BadRequest('Invalid JSON')
  } finally { reader.releaseLock() }
}

function salesEnabled(env) {
  return env.SURGE_PAYMENTS_ENABLED === 'true' && !!env.TELEGRAM_BOT_TOKEN &&
    /^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET ?? '') &&
    !!env.SURGE_SUPPORT_CONTACT && /^https:\/\/[^/]+$/.test(env.SURGE_PUBLIC_ORIGIN ?? '')
}
async function telegram(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${env.TELEGRAM_TEST_MODE === 'true' ? 'test/' : ''}${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error('Telegram service request failed')
  return data.result
}

/** botCall is injectable for tests only; clients cannot override Telegram's host. */
export async function handleRequest(request, env, botCall = (method, body) => telegram(env, method, body)) {
  const url = new URL(request.url), store = new D1Store(env.DB)
  const enabled = salesEnabled(env), support = env.SURGE_SUPPORT_CONTACT || ''
  try {
    if (url.pathname === '/healthz') {
      await store.sql('SELECT COUNT(*) AS count FROM wallets WHERE user_id=?', '__health__').first()
      return json(200, { status: 'ok', payments: enabled, testMode: env.TELEGRAM_TEST_MODE === 'true' })
    }
    if (url.pathname === '/api/telegram/webhook') {
      if (request.method !== 'POST' || !equalSecret(request.headers.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) return json(403, { error: 'Forbidden' })
      const update = await readBody(request)
      if (update.pre_checkout_query) {
        const query = update.pre_checkout_query
        let error
        try {
          if (!enabled) throw new Error('Sales paused')
          await store.validatePayment(String(query.from.id), query, true)
        } catch { error = 'This purchase is unavailable or expired. Please open a new invoice.' }
        await botCall('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: !error, ...(error ? { error_message: error } : {}) })
      }
      // Fulfillment/refunds keep working while new sales are disabled.
      const message = update.message
      if (message?.successful_payment) await store.credit(String(message.from.id), message.successful_payment)
      if (message?.refunded_payment) {
        const payment = message.refunded_payment
        const order = await store.validatePayment(String(message.chat.id), payment)
        await store.credit(order.user_id, payment)
        await store.refund(payment.telegram_payment_charge_id)
      }
      if (message?.text?.match(/^\/(paysupport|support|terms)(?:@\w+)?(?:\s|$)/)) {
        await botCall('sendMessage', { chat_id: message.chat.id,
          text: `Bubble Surge support: ${support || 'Purchases are currently disabled.'}\nFor payment help, refunds, or account-data requests, include your Telegram receipt. Prisms buy cosmetics only and have no cash value. Refunds restore premium style spending, remove the refunded pack's Prisms, and reset premium styles. Other paid value is preserved.` })
      }
      return json(200, { ok: true })
    }
    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.get('origin')
      if (origin && origin !== (env.SURGE_PUBLIC_ORIGIN || url.origin)) return json(403, { error: 'Origin not allowed' })
      if (url.pathname === '/api/admin') {
        if (request.method !== 'POST' || (env.SURGE_ADMIN_SECRET?.length ?? 0) < 32 || !equalSecret(request.headers.get('authorization'), `Bearer ${env.SURGE_ADMIN_SECRET}`)) return json(403, { error: 'Forbidden' })
        if (await store.limited('admin', 10)) return json(429, { error: 'Please wait a minute.' })
        const body = await readBody(request)
        if (body.action === 'webhook') {
          if (!/^https:\/\/[^/]+$/.test(env.SURGE_PUBLIC_ORIGIN ?? '') || !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET ?? '') || !env.TELEGRAM_BOT_TOKEN) return json(400, { error: 'Configure origin, bot token and webhook secret first.' })
          await botCall('setWebhook', { url: `${env.SURGE_PUBLIC_ORIGIN}/api/telegram/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'pre_checkout_query'], drop_pending_updates: false })
          return json(200, { ok: true, message: 'Telegram webhook registered.' })
        }
        if (body.action === 'status') {
          const info = await botCall('getWebhookInfo', {})
          // Whitelist diagnostic fields; never return bot credentials or webhook secret.
          return json(200, { url: info.url, pendingUpdates: info.pending_update_count, lastError: info.last_error_message || null, payments: enabled })
        }
        if (body.action === 'report') return json(200, await store.report())
        if (body.action === 'refund' && typeof body.charge === 'string') {
          const payment = await store.sql('SELECT * FROM payments WHERE charge=?', body.charge).first()
          if (!payment) return json(404, { error: 'Receipt not found in this database.' })
          if (!payment.refunded) {
            await botCall('refundStarPayment', { user_id: Number(payment.user_id), telegram_payment_charge_id: payment.charge })
            await store.refund(payment.charge)
          }
          return json(200, { ok: true, message: 'Refund recorded.' })
        }
        return json(400, { error: 'Unknown administration action.' })
      }
      if (request.method === 'GET' && url.pathname === '/api/store') return json(200, { enabled, packs: PACKS, styles: STYLES, support })
      let user
      try { user = authenticate((request.headers.get('authorization') ?? '').replace(/^tma /, ''), env.TELEGRAM_BOT_TOKEN) }
      catch { return json(401, { error: 'Reopen the game in Telegram to access your account.' }) }
      if (await store.limited(`user:${user}`, 120)) return json(429, { error: 'Please wait a moment before trying again.' })
      if (request.method === 'GET' && url.pathname === '/api/wallet') return json(200, await store.wallet(user))
      if (request.method !== 'POST') return json(404, { error: 'Not found' })
      const body = await readBody(request)
      if (url.pathname === '/api/invoice') {
        if (!enabled) return json(503, { error: 'Purchases are not available yet.' })
        if (await store.limited(`invoice:${user}`, 5, 300000)) return json(429, { error: 'Please wait before creating another purchase.' })
        if (!PACKS.some(pack => pack.id === body.id)) return json(400, { error: 'Unknown pack' })
        const invoice = await store.invoice(user, body.id)
        const link = await botCall('createInvoiceLink', { title: `${invoice.prisms} Bubble Surge Prisms`, description: 'Optional cosmetic currency for premium arena styles. No gameplay advantage.', payload: invoice.id, provider_token: '', currency: 'XTR', prices: [{ label: 'Prisms', amount: invoice.stars }] })
        return json(200, { url: link })
      }
      if (url.pathname === '/api/cosmetics') {
        try { return json(200, await store.unlock(user, body.id)) }
        catch { return json(400, { error: 'Style unavailable or not enough Prisms.' }) }
      }
      if (url.pathname === '/api/events') {
        if (!['run_started','run_completed','run_abandoned','tutorial_complete','coin_spend','purchase_intent'].includes(body.event) || typeof body.session !== 'string' || body.session.length > 64) return json(400, { error: 'Invalid event' })
        if (await store.limited(`event:${user}`, 30)) return json(429, { error: 'Too many events' })
        const properties = {}
        for (const [key, value] of Object.entries(body.properties ?? {}).slice(0, 20)) {
          if (!['mode','level','date','won','stars','score','shots','drops','banks','cores','seconds','coins','item','amount','pack'].includes(key)) continue
          if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length < 80)) properties[key] = value
        }
        const player = createHash('sha256').update(typeof body.player === 'string' ? body.player.slice(0, 64) : body.session).digest('hex').slice(0, 24)
        await store.sql('INSERT INTO events(player,session,event,data,created) VALUES (?,?,?,?,?)', player, body.session, body.event, JSON.stringify(properties), Date.now()).run()
        return json(200, { ok: true })
      }
      return json(404, { error: 'Not found' })
    }
    return await env.ASSETS.fetch(request)
  } catch (error) {
    // Never log request headers, Telegram URLs, receipts, or secret values.
    if (error instanceof BadRequest) return json(400, { error: error.message })
    return json(503, { error: 'Service temporarily unavailable. Please try again.' })
  }
}

export default {
  fetch(request, env) { return handleRequest(request, env) },
  async scheduled(_controller, env) { await new D1Store(env.DB).cleanup() },
}
