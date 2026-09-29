const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createHmac } = require('node:crypto')
let mf, db, D1Store, handleRequest
const token = 'cloudflare-test-token-not-real'
const secret = 'test-only-webhook-secret-32-characters-long'
const adminSecret = 'test-only-admin-secret-32-characters-long'
function initData(id) {
  const params = new URLSearchParams({ user: JSON.stringify({ id }), auth_date: String(Math.floor(Date.now()/1000)) })
  const key = createHmac('sha256', 'WebAppData').update(token).digest()
  params.set('hash', createHmac('sha256', key).update([...params].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n')).digest('hex'))
  return params.toString()
}
const paymentFor = (invoice, charge) => ({ invoice_payload: invoice.id, currency: 'XTR', total_amount: invoice.stars, telegram_payment_charge_id: charge })
before(async () => {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare')
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test") } }', compatibilityDate: '2026-09-01', d1Databases: { DB: 'surge-test' } }))
  db = await mf.getD1Database('DB')
  for (const sql of readFileSync('cloudflare/migrations/0001_initial.sql', 'utf8').split('-- statement-breakpoint')) await db.prepare(sql).run()
  ;({ D1Store } = await import('../cloudflare/store.mjs'))
  ;({ handleRequest } = await import('../cloudflare/worker.mjs'))
})
after(async () => { await mf?.dispose() })

test('migration keeps remote-compatible trigger boundaries and Wrangler splits all statements', async () => {
  const { unstable_splitSqlQuery } = await import('wrangler')
  const sql = readFileSync('cloudflare/migrations/0001_initial.sql', 'utf8')
  const statements = unstable_splitSqlQuery(sql)
  assert.equal(statements.length, 12)
  const triggers = statements.filter(statement => /CREATE TRIGGER/.test(statement))
  assert.equal(triggers.length, 4)
  for (const trigger of triggers) {
    const definition = trigger.slice(trigger.indexOf('CREATE TRIGGER')).trim()
    assert.doesNotMatch(definition, /[\r\n]|\bCASE\b/)
    assert.match(definition, /BEGIN .+; END;?$/)
  }
})

test('D1: invalid direct ledger inserts roll back before granting any value', async () => {
  const store = new D1Store(db), invoice = await store.invoice('99', 'prisms-150')
  await assert.rejects(store.sql('INSERT INTO payments(charge,invoice,user_id,prisms,stars,created) VALUES (?,?,?,?,?,?)', 'forged-99', invoice.id, '99', 999999, 75, Date.now()).run())
  assert.equal((await store.wallet('99')).prisms, 0)
  assert.equal((await store.sql('SELECT state FROM invoices WHERE id=?', invoice.id).first()).state, 'pending')
  assert.equal(await store.sql('SELECT charge FROM payments WHERE charge=?', 'forged-99').first(), null)
})

test('D1: concurrent duplicate receipts grant once, reject conflicts and bind payer/amount', async () => {
  const store = new D1Store(db), invoice = await store.invoice('101', 'prisms-400'), payment = paymentFor(invoice, 'receipt-101')
  await assert.rejects(store.credit('102', payment))
  await assert.rejects(store.credit('101', { ...payment, total_amount: 1 }))
  await assert.rejects(store.credit('101', { ...payment, currency: 'USD' }))
  await Promise.all(Array.from({ length: 12 }, () => new D1Store(db).credit('101', payment)))
  assert.equal((await store.wallet('101')).prisms, 400)
  await assert.rejects(store.credit('101', { ...payment, telegram_payment_charge_id: 'conflict' }))
  const other = await store.invoice('101', 'prisms-150')
  await assert.rejects(store.credit('101', paymentFor(other, 'receipt-101')))
  assert.equal((await store.wallet('101')).prisms, 400)
  assert.equal((await store.sql('SELECT state FROM invoices WHERE id=?', other.id).first()).state, 'pending')
})
test('D1: concurrent cosmetic buys cannot double spend or double charge ownership', async () => {
  const store = new D1Store(db), invoice = await store.invoice('201', 'prisms-150')
  await store.credit('201', paymentFor(invoice, 'receipt-201'))
  const results = await Promise.allSettled([store.unlock('201','aurora'), new D1Store(db).unlock('201','solar')])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const wallet = await store.wallet('201')
  assert.equal(wallet.prisms, 0); assert.equal(wallet.owned.length, 1)
  await Promise.all(Array.from({ length: 6 }, () => new D1Store(db).unlock('201', wallet.owned[0])))
  assert.equal((await store.wallet('201')).prisms, 0)
  assert.equal((await store.unlock('201','default')).equipped, null)
  await assert.rejects(store.unlock('201','unknown'))
})
test('D1: duplicate refunds restore spent value, preserve other packs and never recredit', async () => {
  const store = new D1Store(db), a = await store.invoice('301','prisms-400'), b = await store.invoice('301','prisms-150')
  const payment = paymentFor(a,'receipt-301')
  await store.credit('301', payment); await store.credit('301', paymentFor(b,'receipt-302'))
  await store.unlock('301','aurora'); await store.unlock('301','nova')
  await Promise.all(Array.from({ length: 8 }, () => new D1Store(db).refund('receipt-301')))
  assert.deepEqual(await store.wallet('301'), { prisms: 150, equipped: null, owned: [] })
  await store.credit('301', payment)
  assert.equal((await store.wallet('301')).prisms, 150)
  await store.refund('receipt-302')
  assert.equal((await store.wallet('301')).prisms, 0)
})
test('D1: rate limits persist across instances and expired events are removed', async () => {
  const now = Date.now(), first = new D1Store(db), second = new D1Store(db)
  assert.equal(await first.limited('test-limit', 2, 60000, now), false)
  assert.equal(await second.limited('test-limit', 2, 60000, now), false)
  assert.equal(await first.limited('test-limit', 2, 60000, now), true)
  assert.equal(await second.limited('test-limit', 2, 60000, now+60000), false)
  await first.sql('INSERT INTO events(player,session,event,data,created) VALUES (?,?,?,?,?)','old','old','run_started','{}',1).run()
  await first.cleanup()
  assert.equal(await first.sql('SELECT * FROM events WHERE player=?','old').first(), null)
})
test('Worker: complete authenticated flow, fail-closed sales, private admin and reordered refunds', async () => {
  const calls = [], store = new D1Store(db)
  const env = { DB: db, TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, SURGE_ADMIN_SECRET: adminSecret, SURGE_PAYMENTS_ENABLED: 'true', SURGE_PUBLIC_ORIGIN: 'https://surge.test', SURGE_SUPPORT_CONTACT: '@support_test' }
  const bot = async (method, body) => { calls.push({ method, body }); return 'https://t.me/$test-invoice' }
  const call = (path, body, headers = {}, overrides = {}) => handleRequest(new Request(`https://surge.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { ...env, ...overrides }, bot)
  const auth = { authorization: `tma ${initData(401)}` }, wh = { 'x-telegram-bot-api-secret-token': secret }, admin = { authorization: `Bearer ${adminSecret}` }
  assert.equal((await call('/healthz')).status, 200)
  assert.equal((await call('/api/wallet')).status, 401)
  assert.equal((await call('/api/invoice',{ id: 'prisms-150' },auth,{ SURGE_SUPPORT_CONTACT: '' })).status,503)
  assert.equal((await call('/api/invoice',{ id: 'prisms-150' },{ ...auth, origin: 'https://evil.test' })).status,403)
  assert.equal((await call('/api/invoice',{ id: 'prisms-150', prisms: 99999 },auth)).status,200)
  assert.equal((await store.wallet('401')).prisms,0)
  const order = calls.at(-1).body
  assert.equal(order.currency,'XTR'); assert.equal(order.prices[0].amount,75)
  const payment = { invoice_payload: order.payload, currency: 'XTR', total_amount:75, telegram_payment_charge_id:'receipt-401' }
  const success = { message: { from: { id:401 }, successful_payment: payment } }
  assert.equal((await call('/api/telegram/webhook',success,auth)).status,403)
  await call('/api/telegram/webhook',{ pre_checkout_query: { id:'q', from:{ id:401 }, ...payment } },wh)
  assert.equal(calls.at(-1).body.ok,true)
  // Refund first, then delayed successful_payment, including with sales disabled.
  const refund = { message:{ chat:{ id:401 }, refunded_payment:payment } }
  assert.equal((await call('/api/telegram/webhook',refund,wh,{ SURGE_PAYMENTS_ENABLED:'false' })).status,200)
  assert.equal((await call('/api/telegram/webhook',success,wh,{ SURGE_PAYMENTS_ENABLED:'false' })).status,200)
  assert.equal((await store.wallet('401')).prisms,0)
  assert.equal((await call('/api/admin',{ action:'webhook' })).status,403)
  assert.equal((await call('/api/admin',{ action:'webhook' },admin)).status,200)
  assert.equal(calls.at(-1).method,'setWebhook')
  assert.equal(calls.at(-1).body.drop_pending_updates,false)
  assert.equal((await call('/api/admin',{ action:'refund',charge:'missing' },admin)).status,404)
  const invoice = await store.invoice('402','prisms-150')
  await store.credit('402',paymentFor(invoice,'receipt-admin'))
  assert.equal((await call('/api/admin',{ action:'refund',charge:'receipt-admin' },admin)).status,200)
  assert.equal(calls.at(-1).method,'refundStarPayment')
  assert.equal((await store.wallet('402')).prisms,0)
  assert.equal((await call('/api/admin',{ action:'report' },admin)).status,200)
  assert.equal((await call('/api/events',{ event:'run_started',session:'s',player:'anonymous',properties:{ mode:'daily',private:'omit' } },auth)).status,200)
  const event = await store.sql('SELECT * FROM events WHERE session=?','s').first()
  assert.deepEqual(JSON.parse(event.data),{ mode:'daily' }); assert.notEqual(event.player,'anonymous')
  assert.equal((await call('/api/events',{ event:'run_started',session:'s',padding:'x'.repeat(32769) },auth)).status,400)
  const malformed = await handleRequest(new Request('https://surge.test/api/events',{ method:'POST',headers:{ ...auth,'Content-Type':'application/json' },body:'{' }),env,bot)
  assert.equal(malformed.status,400)
})
