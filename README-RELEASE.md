# Bubble Surge

A portrait browser puzzle game about cutting supports, freeing Signal Cores and triggering chains. Built with TypeScript and Canvas, with a lightweight HTML interface and Cloudflare Workers/D1 Telegram Stars service. The Node/SQLite server remains an alternative.

## Play loop

Aim and match three colors, drop disconnected branches, chain gold-core pulses, and build Surge for a color-independent blast. Wall-banked matches grant extra points and Surge charge. Failed matches advance the board; successful shots maintain breathing room.

Thirty deterministic stages span three chapters. Daily Signal offers a date-seeded 32-shot challenge, while Endless provides an open-ended score chase. Completed runs grant coins and pilot XP. Daily missions reward skillful play. Coins unlock themes and shot trails; optional server-managed Prisms purchase premium arena treatments. No energy timers or paid gameplay advantage.

## Local commands

```sh
npm install
npm run dev       # http://127.0.0.1:5188
npm test
npm run build
npm start         # production build + service at http://127.0.0.1:5189
```

Node 22.13+ is required for tooling and the optional Node server. Follow [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md) for the prepared cloud deployment. Release/economy notes are in [RELEASE.md](RELEASE.md). Payments are disabled by default.

## Project structure

- `src/core`: grid topology, collision geometry and particles.
- `src/game`: round lifecycle, level recipes, deterministic randomness, progression, economy and commerce client.
- `src/ui/ReleaseUI.ts`: accessible menus, missions, collection, results and settings.
- `src/renderer`: canvas rendering and effects; logical coordinates remain independent of display resolution.
- `src/audio`: gesture-unlocked music and bounded effects from the supplied audio folder.
- `server`: Telegram authentication, SQLite ledger, invoice/webhook handling, support and reporting.
- `cloudflare`: Worker, atomic D1 ledger/migrations and private administration script.
- `tests`: geometry, puzzles, reward motion, economy and payment integration tests.

Existing `bubble-surge-progress-v1` saves are retained. Earned coins/settings live in a separate versioned local profile. Premium currency is never trusted from local storage. No private bot credentials are included in the client bundle.
