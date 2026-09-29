# Bubble Surge · release candidate 1

This is a playable release candidate, not a published or revenue-validated launch. No live charges have been made. Public distribution and live Telegram credentials are deliberately separate from building the game.

## Run and deploy

**Cloudflare is now the prepared deployment path:** follow [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md) for Workers Static Assets + D1, secure Telegram configuration, test/production separation, refunds and backups. `npm run deploy` uploads the full Worker and game; `npm run cf:check` is a no-upload dry run. The Node instructions below are an alternative, not the Cloudflare setup.

Requires Node 22.13 or newer (tested locally on Node 26.7).

```sh
npm ci
npm test
npm run build
npm start
```

Development stays at http://127.0.0.1:5188 (`npm run dev`). The Node release server serves `dist` and its API together at http://127.0.0.1:5189. Cloudflare local preview runs on port 5190 (`npm run cf:dev`). A static-only host can serve the free game, but cannot fulfill purchases.

Use one persistent Node instance behind an HTTPS reverse proxy. Keep `data/surge.sqlite` on durable storage. Do not deploy this SQLite implementation to an ephemeral/serverless filesystem or multiple independent instances. Use a process supervisor, TLS, HTTP request limits, and regular SQLite-consistent backups. Test restoring a backup before enabling payments. `/healthz` reports service availability and whether payments are enabled. No automatic publishing or webhook registration occurs on startup.

## Turn on the Telegram store

These commands are for the Node alternative only. For Cloudflare use the setup guide above; local `store:manage` refund/report commands do not operate on D1.

1. Copy `.env.example` to private `.env`, or set equivalent server environment variables. Never use `VITE_` for secrets. Configure your bot token, a random webhook secret of at least 32 characters, the exact HTTPS origin (no trailing slash), and a real support contact. Do not paste secrets into chat.
2. Deploy the build and Node service on that origin. Set your bot's Main Mini App URL through BotFather.
3. Register the webhook with `npm run store:manage -- webhook`. This writes an external Telegram setting, so run it only against the intended bot. The handler is `/api/telegram/webhook`.
4. Test in Telegram's test environment first. Verify invoice creation, cancel, failure, success, delayed/duplicate webhook delivery, wallet restoration on another device, cosmetic spending and refund. Automated tests mock Telegram; they do not replace this integration test.
5. Confirm the support process, published terms/privacy details, and commercial rights to all supplied audio before public distribution. Then set `SURGE_PAYMENTS_ENABLED=true` and restart. The service refuses to enable sales with missing required configuration.

Digital goods in Telegram must use Telegram Stars: https://core.telegram.org/bots/payments-stars. Mini App authentication follows https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app. Authentication is checked on the server; only a verified payment webhook credits the ledger. Client invoice callbacks are never proof of payment.

The wallet restores automatically after Telegram authentication. The player can also refresh it in Collection. Authentication expires after 24 hours; reopening the Mini App refreshes it. `/paysupport`, `/support`, and `/terms` return the configured support contact and purchase information. Human support still needs to monitor and resolve requests. Retain payment receipts according to your operational/legal requirements; there is no scheduled receipt deletion.

## Currency design

| Source/sink | Amount |
| --- | --- |
| Campaign win | 20 + 5 per earned star |
| First first-star clear per stage | +60 |
| First second/third star per stage | +25 each |
| First daily clear (UTC) | +100 |
| Daily missions | 60 / 60 / 80 |
| Failed puzzle | 1 coin per 500 points, max 10 |
| Endless finished/banked run | 1 coin per 250 points, max 100 |
| Coin cosmetics | 250–650 |
| Initial Prism packs | 150 for 75 Stars; 400 for 175 Stars |
| Premium styles | 150 / 150 / 250 Prisms |

Coin rewards, campaign progress, XP and daily missions are local to the browser. They are not secure enough to sell or use for cash prizes. Prisms and premium ownership are separate, server-authoritative, and cannot be granted through a local save. Both currencies buy cosmetics only. There are no paid lives, pay-to-win boosters, random paid rewards, or streak penalties. Prices are initial experiment hypotheses, not an established profitable economy.

First-time stage bonuses are keyed per star; replaying a level cannot reissue them. Daily first-clear and mission rewards reset at 00:00 UTC. A run crossing midnight belongs to the day it started. Replays use the same board and starting ammunition seed; ammunition changes with remaining board colors. Daily play allows 32 shots and has no row descent. It is a personal-best challenge, not a cheat-resistant public leaderboard.

To refund an identified purchase:

```sh
npm run store:manage -- refund <telegram_payment_charge_id>
```

This sends a real refund request, then reconciles the ledger. The refund webhook also reconciles it, including duplicate delivery. Refunds reverse premium style spending back into Prisms, unequip those styles, then remove the refunded pack's credit. Other paid value is preserved so the player can choose their styles again. Do not edit wallet balances manually. Back up receipts before administrative work.

## Measure enjoyment and profitability

Players opt in through Settings; analytics are off by default. Only event names and allow-listed play fields are accepted. A random install ID is hashed server-side; no name, messages or contacts are included in events. The API authenticates the request but does not persist the Telegram ID with the event. Server events are retained for 30 days; local history is capped at 200 events. Disabling analytics clears the local log and install identifier. Payment receipts remain separate.

`npm run store:manage -- report` reports the event funnel, mature D1/D7 cohorts, gross Stars and paying accounts. Cohorts are limited to opt-in events within the retention window and are biased; they are not a complete count of all players. Client-reported play events must not be treated as trusted competitive scores. A browser reinstall gets a new anonymous install ID.

For the first external test, recruit a small group of real players and observe tutorial completion, first-stage completion, session length, retries, D1 and D7 return rates, mission participation, and coin spending. Ask which moments made them want another round. Review level-specific completion and abandonment before changing prices. Test one meaningful change at a time.

Profit is measured from actual net receipts after refunds, fees, hosting, support, asset costs and acquisition costs. Gross Stars are not profit and cannot be assumed to have a fixed cash conversion. Keep acquisition spending small until measured cohort value exceeds acquisition cost. Do not use purchases as evidence that difficulty or retention is healthy.

## Remaining launch gates

- Live Telegram test-environment purchase/refund verification with the real bot configuration.
- Real iOS/Android Telegram playtests, including interrupted audio, touch and low-memory devices.
- Human difficulty playthrough across all three chapters and a sample of daily seeds. Automated checks establish geometry, attachment and reachable opening shots, not enjoyable full solutions.
- Confirm audio redistribution/commercial licenses and operator-specific support/privacy/terms information.
- Configure production HTTPS, persistence, backups and uptime/error monitoring; then conduct a limited public test before paid acquisition.
- Optional future work: account-synced earned progress and authoritative competitive runs. Neither is claimed in this release.
