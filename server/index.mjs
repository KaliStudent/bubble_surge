import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Store } from './store.mjs'
import { createApp } from './app.mjs'

const dbPath = resolve(process.env.SURGE_DB_PATH || 'data/surge.sqlite')
mkdirSync(dirname(dbPath), { recursive: true })
const store = new Store(dbPath)
const enabled = process.env.SURGE_PAYMENTS_ENABLED === 'true'
const config = { store, token: process.env.TELEGRAM_BOT_TOKEN, webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  support: process.env.SURGE_SUPPORT_CONTACT, publicOrigin: process.env.SURGE_PUBLIC_ORIGIN, paymentsEnabled: enabled }
if (enabled && (!config.token || (config.webhookSecret?.length ?? 0) < 32 || !config.support || !config.publicOrigin?.startsWith('https://'))) {
  console.error('Payments require the bot token, a webhook secret of at least 32 characters, a support contact, and an HTTPS public origin.')
  store.close(); process.exit(1)
}
const app = createApp(config)
const port = Number(process.env.PORT || 5189)
const host = process.env.HOST || '127.0.0.1'
app.listen(port, host, () => console.log(`Bubble Surge release server on ${host}:${port}; payments ${enabled ? 'enabled' : 'disabled'}.`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close(() => { store.close(); process.exit(0) }))
