# Bubble Surge

A portrait bubble-shooter puzzle game for the browser and Telegram WebApp.

## Play

- Aim and release to fire. Match three or more bubbles of one color.
- Tap the swap control to exchange the loaded and next bubbles.
- Consecutive matches and falling clusters charge Surge. When full, tap **Surge** to arm a six-neighbor blast shot.
- Gold diamond bubbles are **Signal Cores**. Match or drop one to release a two-ring pulse through nearby bubbles. On core stages, free every core to win; on clear stages, empty the board.
- A miss advances the drop counter. Detached bubbles fall, bounce, and pop into flying score coins. Stars reward efficient shots, while cascades add points and Surge charge. Campaign progress is saved in browser storage.

Thirty campaign boards across three chapters use hand-tuned deterministic recipes and seeded remixes: support bridges, side gates, twin peaks, hanging pods, and deeper core vaults. Daily Signal adds a date-seeded 32-shot challenge. Endless mode remains procedural. Wall-bank matches grant bonus points and Surge energy.

Completed runs earn coins and pilot XP. Daily missions reward wins, dropped bubbles and bank matches. Coins unlock themes and shot trails. Cloudflare Workers/D1 (or the alternative Node/SQLite server) supports server-verified Telegram Stars purchases of cosmetic Prisms. No energy timers or paid gameplay advantage.

## Run locally

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5188/>. To verify: `npm test` and `npm run build`.

## Design influences

The core matching rule comes from [Taito's Puzzle Bobble](https://www.taito.co.jp/en/mob/topics/15072). Varied goals and paths are informed by [King's Bubble Witch 3 guide](https://community.king.com/en/bubble-witch-saga/discussion/246620/bubble-witch-3-saga-beginners-guide); chain-reaction emphasis is informed by [Rovio's Dream Blast description](https://www.angrybirds.com/games/angry-birds-dream-blast/). Bubble Surge's own twist is the interaction between falling Signal Cores, local pulses, and the earned Surge shot.

## Release note

For your Cloudflare account, start with [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md). It includes the exact upload, database, Telegram secret, payment test, refund and backup steps. Nothing is automatically published or charged. `npm run cf:dev` previews the full Cloudflare build locally at port 5190.

This is version 1.0.0-rc.1, not a published or revenue-validated launch. Earned progress is local; premium wallets are account-linked when the service is configured. `npm start` serves the production build and API at http://127.0.0.1:5189 (Node 22.13+). Payments are disabled by default.

See [RELEASE.md](RELEASE.md) for deployment, Telegram setup, economy rules, refunds, analytics, and the remaining launch gates. See [README-RELEASE.md](README-RELEASE.md) for module boundaries.
