import { Store } from './store.mjs'
import { telegramCall } from './app.mjs'

const [command, receipt] = process.argv.slice(2)
if (command === 'webhook') {
  const origin = process.env.SURGE_PUBLIC_ORIGIN, secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!origin?.startsWith('https://') || !secret || secret.length < 32) throw new Error('Configure HTTPS origin and webhook secret first')
  await telegramCall(process.env.TELEGRAM_BOT_TOKEN, 'setWebhook', { url: `${origin}/api/telegram/webhook`, secret_token: secret,
    allowed_updates: ['message', 'pre_checkout_query'], drop_pending_updates: false })
  console.log('Webhook registered.')
} else if (command === 'refund' && receipt) {
  const store = new Store(process.env.SURGE_DB_PATH || 'data/surge.sqlite')
  try {
    const payment = store.db.prepare('SELECT * FROM payments WHERE charge=?').get(receipt)
    if (!payment) throw new Error('Receipt not found')
    if (!payment.refunded) {
      await telegramCall(process.env.TELEGRAM_BOT_TOKEN, 'refundStarPayment', { user_id: Number(payment.user_id), telegram_payment_charge_id: receipt })
      store.refund(receipt)
    }
    console.log('Refund recorded. Unspent paid value preserved.')
  } finally { store.close() }
} else if (command === 'report') {
  const store = new Store(process.env.SURGE_DB_PATH || 'data/surge.sqlite')
  try {
    const counts = store.db.prepare('SELECT event, COUNT(*) AS count, COUNT(DISTINCT player) AS players FROM events GROUP BY event').all()
    const revenue = store.db.prepare('SELECT COUNT(*) AS purchases, COALESCE(SUM(stars),0) AS gross_stars, COUNT(DISTINCT user_id) AS payers FROM payments WHERE refunded=0').get()
    const retention = store.db.prepare(`WITH visits AS (SELECT DISTINCT player, date(created/1000,'unixepoch') AS day FROM events),
      cohorts AS (SELECT player, MIN(day) AS first_day FROM visits GROUP BY player)
      SELECT COUNT(*) AS players, SUM(EXISTS(SELECT 1 FROM visits v WHERE v.player=c.player AND v.day=date(c.first_day,'+1 day'))) AS returned_d1,
      SUM(EXISTS(SELECT 1 FROM visits v WHERE v.player=c.player AND v.day=date(c.first_day,'+7 day'))) AS returned_d7
      FROM cohorts c WHERE first_day <= date('now','-7 day')`).get()
    console.log(JSON.stringify({ events: counts, revenue, matureCohortRetention: retention, caveat: 'Analytics are opt-in and client-reported; Stars are gross, not profit.' }, null, 2))
  } finally { store.close() }
} else {
  console.log('Commands: webhook | refund <Telegram charge ID> | report. Load private environment configuration before running.')
}
