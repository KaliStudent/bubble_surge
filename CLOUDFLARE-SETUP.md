# Bubble Surge: Cloudflare setup

The game is prepared for **Cloudflare Workers Static Assets + D1**. Your computer builds and uploads the game; Cloudflare hosts the files and API. You do not need a VPS, an always-running home computer, Vercel, Pages, or R2 for this build. Your Workers subscription is usable, but usage-based charges can still apply; configure billing alerts.

**Do not drag only `dist` into a static hosting upload screen.** That omits the wallet/payment backend. The commands below upload both parts together. Nothing has been published yet. No live Telegram transaction has been tested by the developer agent.

## 1. Sign in and create the database

Open PowerShell and run these commands individually. Node 22.13+ is required.

Before `npm ci`, stop this project's running development previews with Ctrl+C in their terminals (ports 5188 and 5190). Windows can otherwise lock dependency files and report `EBUSY`. Wait for each command to finish before entering the next one. If installation fails, stop there; do not continue to `npx wrangler` until `npm ci` succeeds. After a successful install Wrangler is available locally and should not ask to download a different version.

```powershell
Set-Location 'C:\Users\brian\MainProjects\bubble-shooter-v2'
npm ci
npm test
npx wrangler login
npx wrangler d1 create bubble-surge-db
```

Approve Cloudflare sign-in in your own browser. If you have several accounts, choose the account with your paid Workers subscription. Creating D1 is a real cloud resource, but does not publish the game.

The last command prints a `database_id` (a long ID with dashes). Open `wrangler.jsonc` and replace **only** the all-zero `database_id` with that ID. Keep the binding `DB`, database name `bubble-surge-db`, and migrations directory unchanged. If Wrangler offers to add the binding automatically, decline and edit the existing binding to avoid duplicates. If the database already exists, use its existing ID from your Cloudflare D1 dashboard; do not create another or import over an existing production database.

Keep `SURGE_PAYMENTS_ENABLED` and `TELEGRAM_TEST_MODE` as the strings `"false"`.

## 2. Upload the game, with purchases disabled

```powershell
npm run cf:migrate
npm run deploy
```

Accept the migration prompt for the intended database. This creates the wallet and receipt tables. The deploy command builds and uploads the game, sound files, Worker API and hourly cleanup schedule. It prints an HTTPS address similar to `https://bubble-surge.YOUR-SUBDOMAIN.workers.dev`.

Open that exact address: the free game should work. Also open its `/healthz` address: expect `status: "ok"`, `payments: false`, `testMode: false`. A 503 usually means the database ID/binding is wrong or migrations were not applied. The premium store intentionally remains unavailable in an ordinary browser, even after payments are enabled; it needs Telegram authentication.

If Cloudflare says the Worker name already exists, inspect the existing Worker before deploying: do not overwrite an unrelated service. Choose a new `name` in `wrangler.jsonc` if necessary.

## 3. Set the public address and support contact

In `wrangler.jsonc`, change these two entries under `vars`:

```json
"SURGE_PUBLIC_ORIGIN": "https://bubble-surge.YOUR-SUBDOMAIN.workers.dev",
"SURGE_SUPPORT_CONTACT": "@YourActualSupportUsername"
```

Use your actual deploy address, **without a trailing slash**. The support contact must be monitored; you can use a support email or HTTPS support page instead. Leave payments disabled. Save the file, then run:

```powershell
npm run deploy
```

Use `wrangler.jsonc` as the source of truth for these non-secret settings. Dashboard-only changes to the same variables can be overwritten by later deployments.

## 4. Add three private secrets

In your password manager, generate **two different random secrets**, each at least 32 characters. For the webhook secret, use only letters, digits, underscores or hyphens (64 hexadecimal characters is a good choice). Save each with its name.

Run each command, then paste its value into Wrangler's private prompt:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put SURGE_ADMIN_SECRET
```

- `TELEGRAM_BOT_TOKEN`: the token from your intended bot in BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: your first generated secret, used to verify Telegram callbacks.
- `SURGE_ADMIN_SECRET`: your second, different secret, used by you for support/administration.

**Never paste these into chat, source code, `wrangler.jsonc`, screenshots, or any `VITE_` variable.** Never put the bot token into a browser address. Production secrets stay in Cloudflare; the frontend does not receive them. Secret commands update the named Worker, so check its name before proceeding.

## 5. Connect Telegram

Register this game's webhook from PowerShell:

```powershell
.\cloudflare\manage.ps1 -Origin 'https://bubble-surge.YOUR-SUBDOMAIN.workers.dev' -Action webhook
.\cloudflare\manage.ps1 -Origin 'https://bubble-surge.YOUR-SUBDOMAIN.workers.dev' -Action status
```

Replace the example address in both commands. Each prompts for `SURGE_ADMIN_SECRET` without showing it. Expect `Telegram webhook registered`, then the webhook URL ending in `/api/telegram/webhook`. Pending updates should drain; `lastError` should be null on a new healthy integration (Telegram may retain an old last-error message).

**This replaces any existing webhook for that bot.** Use a dedicated game bot or deliberately retire its old integration. Do not run another polling bot against the same token.

In BotFather, select the bot, configure its **Main Mini App** with the exact HTTPS game address, and configure the menu button if desired. Add the name, description and artwork. This hosts and connects the Mini App; it does not automatically earn placement in Telegram's app listings.

Launch from Telegram, not just a regular browser. Play a stage, reopen the game, open Collection, and send `/paysupport` to the bot to confirm the support response. The new public origin starts a separate browser save from localhost: earned coins/progress are still local, while paid wallets are tied to the authenticated Telegram account.

If PowerShell blocks this local script, use an allowed PowerShell environment or have your administrator review it. Do not disable organizational security policies.

## 6. Test payments safely before enabling public sales

The automated suite uses synthetic Telegram messages and Cloudflare's local D1 engine. It does **not** prove real Telegram payment integration. Telegram supports free Stars testing in a separate [test environment](https://core.telegram.org/bots/webapps#using-bots-in-the-test-environment).

For that test, make a separate copy of `wrangler.jsonc` named `wrangler.test.jsonc` in this folder. Set `name` to `bubble-surge-test`, create a separate `bubble-surge-test-db` database, set its ID/name, and set `TELEGRAM_TEST_MODE` to `"true"`. Keep binding `DB`. The Worker then uses Telegram's `/test/` Bot API. Never share a database or bot token between test and production, and never toggle the production database into test mode.

```powershell
npx wrangler d1 create bubble-surge-test-db
# Edit wrangler.test.jsonc with the test database ID before continuing.
npx wrangler d1 migrations apply bubble-surge-test-db --remote --config wrangler.test.jsonc
npm run build
npx wrangler deploy --config wrangler.test.jsonc
```

Set the test config's public origin to the printed **test** address and its support contact. Add all three secrets with `--config wrangler.test.jsonc` on each `wrangler secret put` command, using a bot created in Telegram's **test** environment and different test secrets. Set `SURGE_PAYMENTS_ENABLED` to `"true"` **only in the test config**, redeploy it with the same `--config` flag, run the management script against the test address, and configure the test bot's Mini App there.

Verify: invoice creation, cancellation without currency credit, successful purchase credited once, reopening on another device, buying/equipping a cosmetic, and refund with the management command below. Reopen Collection to refresh the wallet. Repeated refund handling must not remove value twice. Test interrupted connections and relaunching as well. `/healthz` must say `testMode: true` for this deployment, never the production one.

Before real sales: finish iOS/Android playtests, confirm commercial redistribution rights to all audio/artwork, publish your operator-specific terms/privacy/refund information, monitor the support contact, and test database backup recovery. The game's built-in help is not a substitute for operator-specific policies.

Once those gates are satisfied, change `SURGE_PAYMENTS_ENABLED` to `"true"` in the **production** `wrangler.jsonc` (leave `TELEGRAM_TEST_MODE` as `"false"`), then:

```powershell
npm run deploy
```

Reopen the production Mini App. Its `/healthz` should report `payments: true` and `testMode: false`. A production purchase uses **real Stars**. Perform a small end-to-end production check you authorize yourself before announcing the store. Telegram requires Stars for digital goods sold within Telegram; see [Stars payment documentation](https://core.telegram.org/bots/payments-stars).

## Operating the game

**Updates:** run `npm test`, `npm run cf:migrate` if a new migration was added, then `npm run deploy`. Existing D1 data survives deployments. Do not delete the D1 database or reset its tables. Never deploy a different bot against an existing paid ledger without a deliberate migration.

**Pause new sales:** set `SURGE_PAYMENTS_ENABLED` to `"false"` and redeploy. Keep the token, webhook and database intact: already-paid orders and refunds still need processing.

**Reports and refunds:** use the same management script, not `npm run store:manage` (that older command operates only on the local Node/SQLite version).

```powershell
.\cloudflare\manage.ps1 -Origin 'https://YOUR-GAME-ADDRESS' -Action report
.\cloudflare\manage.ps1 -Origin 'https://YOUR-GAME-ADDRESS' -Action refund -Charge 'TELEGRAM_PAYMENT_CHARGE_ID'
```

Reports are opt-in gameplay counts/retention and net-of-recorded-refunds gross Stars, **not profit**. Refunds require typing `REFUND` and entering the admin secret. They use the stored receipt to identify the payer, send a real Telegram refund, and reconcile D1. Refunds reset all premium styles, restore their purchase value, and remove only the refunded pack's credit; other paid value is retained. Repeated recorded refunds do not call Telegram again. If a request times out, inspect webhook status and D1's payment row before retrying; Telegram may have completed the refund even if the response was lost. Its refund notification also reconciles the ledger. Do not manually add or subtract balances.

**Backups:** enable/inspect [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and rehearse recovery on a separate database. You can also export a private snapshot:

```powershell
New-Item -ItemType Directory -Force backups
npx wrangler d1 export bubble-surge-db --remote --output backups/surge-before-update.sql
```

Use a new filename for each backup. Exports contain account IDs and receipts: keep them private and never upload them as game assets. Restoring an older paid ledger can lose recent credits or refund records, so reconcile with Telegram before reopening sales. Local `backups`, `.wrangler`, `.env` and `.dev.vars` files are git-ignored; do not put secrets in `public` or `dist`.

**Monitoring:** watch Workers errors, D1 health/storage and billing, Telegram webhook pending updates/errors, and support requests. API responses intentionally do not expose sensitive exception details. Hourly cleanup deletes analytics older than 30 days and expired rate-limit buckets; receipts and wallets are retained. Analytics are opt-in and off by default. Rate limits persist in D1 rather than being reset with each Worker instance. Add Cloudflare edge traffic controls appropriate to your launch volume; app limits do not cap total hosting costs.

**Custom domain:** optional. Add a domain to this Worker, then update `SURGE_PUBLIC_ORIGIN`, redeploy, rerun the webhook command against that domain, and update BotFather. Keep one canonical origin. Changing domains moves local earned progress into a different browser storage origin; paid account wallets remain in D1.

## Local verification and architecture

```powershell
npm test
npm run cf:check
npm run cf:dev
```

Cloudflare preview: `http://127.0.0.1:5190/`. It uses a separate local D1 database and does not connect to production. Existing development remains at port 5188 and the optional Node server at 5189. `cf:check` builds and performs a **dry run**, with no upload.

- `cloudflare/worker.mjs`: API, Telegram callbacks, private administration, scheduled cleanup.
- `cloudflare/store.mjs`: D1 wallet, receipt, cosmetic, rate-limit and report operations.
- `cloudflare/migrations/0001_initial.sql`: tables, constraints and accounting triggers.
- `cloudflare/manage.ps1`: private management requests, with hidden secret prompt.
- `server/auth.mjs`, `server/catalog.mjs`: shared verification and catalog.
- `public/_headers`: static-asset security/cache headers.
- `wrangler.jsonc`: deployment configuration; no secrets.

Database triggers make credits, spending and refunds atomic. D1 batches roll back all statements on failure; see [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Tests exercise concurrent duplicate receipts, overspending, ownership idempotency, conflicting charges, reordered refunds, admin authorization, expiry cleanup and request validation. The original Node server remains an alternative, not a second writer to the cloud wallet. No old SQLite data is automatically imported; stop and arrange a ledger migration if that version has real purchases.
