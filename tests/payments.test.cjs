const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const token = 'test-only-token-not-a-credential'
function initData(user = 42, time = Math.floor(Date.now()/1000)) {
  const params = new URLSearchParams({ user: JSON.stringify({ id: user }), auth_date: String(time), query_id: 'test' })
  const check = [...params].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n')
  const key = createHmac('sha256', 'WebAppData').update(token).digest()
  params.set('hash', createHmac('sha256', key).update(check).digest('hex'))
  return params.toString()
}
test('Telegram authentication rejects forged, old, duplicate and future init data', async () => {
  const { authenticate } = await import('../server/auth.mjs')
  assert.equal(authenticate(initData(), token), '42')
  assert.throws(() => authenticate(initData().replace('42', '43'), token))
  assert.throws(() => authenticate(initData(42, 1), token))
  assert.throws(() => authenticate(initData(42, Math.floor(Date.now()/1000) + 600), token))
  assert.throws(() => authenticate(initData() + '&auth_date=1', token))
})
test('payment receipts are idempotent, user-bound and amount-bound; spending and refund preserve value', async () => {
  const { Store } = await import('../server/store.mjs')
  const store = new Store(':memory:')
  try {
    const invoice = store.invoice('42', 'prisms-400')
    const payment = { invoice_payload: invoice.id, currency: 'XTR', total_amount: invoice.stars, telegram_payment_charge_id: 'receipt-one' }
    assert.throws(() => store.credit('43', payment))
    assert.throws(() => store.credit('42', { ...payment, total_amount: 1 }))
    assert.throws(() => store.credit('42', { ...payment, currency: 'USD' }))
    assert.equal(store.wallet('42').prisms, 0)
    assert.equal(store.credit('42', payment).prisms, 400)
    assert.equal(store.credit('42', payment).prisms, 400)
    assert.throws(() => store.credit('42', { ...payment, telegram_payment_charge_id: 'different' }))
    assert.equal(store.unlock('42', 'aurora').prisms, 250)
    assert.equal(store.unlock('42', 'aurora').prisms, 250)
    assert.equal(store.unlock('42', 'nova').prisms, 0)
    assert.throws(() => store.unlock('42', 'solar'))
    const extra = store.invoice('42', 'prisms-150')
    store.credit('42', { ...payment, invoice_payload: extra.id, total_amount: extra.stars, telegram_payment_charge_id: 'receipt-two' })
    const refunded = store.refund('receipt-one')
    assert.equal(refunded.prisms, 150); assert.deepEqual(refunded.owned, []); assert.equal(refunded.equipped, null)
    assert.equal(store.refund('receipt-one').prisms, 150)
    assert.equal(store.credit('42', payment).prisms, 150)
  } finally { store.close() }
})
test('HTTP purchase flow rejects unauthenticated callers and only webhook confirmation adds Prisms', async () => {
  const { Store } = await import('../server/store.mjs')
  const { createApp } = await import('../server/app.mjs')
  const store = new Store(':memory:'), calls = []
  const secret = 'test-webhook-secret-with-at-least-32-characters'
  const app = createApp({ store, token, webhookSecret: secret, support: 'test support', publicOrigin: 'https://example.test', paymentsEnabled: true,
    botCall: async (method, body) => { calls.push({ method, body }); return 'https://t.me/$test-invoice' } })
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.address().port}`
  const headers = { 'Content-Type': 'application/json', Authorization: `tma ${initData()}` }
  try {
    assert.equal((await fetch(`${base}/api/wallet`)).status, 401)
    const response = await fetch(`${base}/api/invoice`, { method: 'POST', headers, body: JSON.stringify({ id: 'prisms-150', prisms: 999999 }) })
    assert.equal(response.status, 200)
    assert.equal(store.wallet('42').prisms, 0)
    const invoice = calls.find(c => c.method === 'createInvoiceLink').body
    assert.equal(invoice.currency, 'XTR'); assert.equal(invoice.prices[0].amount, 75)
    const payment = { invoice_payload: invoice.payload, currency: 'XTR', total_amount: 75, telegram_payment_charge_id: 'http-receipt' }
    const update = { message: { from: { id: 42 }, successful_payment: payment } }
    assert.equal((await fetch(`${base}/api/telegram/webhook`, { method: 'POST', headers, body: JSON.stringify(update) })).status, 403)
    const wh = { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }
    await fetch(`${base}/api/telegram/webhook`, { method: 'POST', headers: wh, body: JSON.stringify({ pre_checkout_query: { id: 'q1', from: { id: 42 }, ...payment } }) })
    assert.equal(calls.at(-1).body.ok, true)
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/api/telegram/webhook`, { method: 'POST', headers: wh, body: JSON.stringify(update) })).status, 200)
    assert.equal((await (await fetch(`${base}/api/wallet`, { headers })).json()).prisms, 150)
    const spent = await fetch(`${base}/api/cosmetics`, { method: 'POST', headers, body: JSON.stringify({ id: 'solar' }) })
    assert.equal((await spent.json()).prisms, 0)
    const blocked = await fetch(`${base}/api/invoice`, { method: 'POST', headers: { ...headers, Origin: 'https://wrong.test' }, body: JSON.stringify({ id: 'prisms-150' }) })
    assert.equal(blocked.status, 403)
  } finally { await new Promise(resolve => app.close(resolve)); store.close() }
})
