# AGENTS.md — working on Bubble Surge in the Base44 sandbox

Non-obvious facts about running this repo. Manifests and README already cover the
product; this file covers the environment.

## Run it

```sh
docker compose -f docker-compose.base44.yml up -d --build
```

- Single service `web` (image `node:22`), repo bind-mounted at `/app`, listening on
  host port **3000** (the preview port). Health: `GET /healthz`.
- One origin: the Node release server (`server/index.mjs` -> `server/app.mjs`) serves
  both the static client from `./dist` and the `/api/*` service. The client uses
  relative `/api/...` URLs, so no API URL or CORS wiring is needed.
- The ledger is SQLite at `data/surge.sqlite` (`node:sqlite`, built into Node >= 22.5;
  it prints an ExperimentalWarning, which is expected). No database service is needed.
- Startup runs `npm ci` into a named `node_modules` volume, then `node server/index.mjs`.
  The server needs no npm packages at runtime (only Node builtins); deps exist for
  the test suite and tooling.

## No client source in this repository (important)

`src/` is **absent** from the repository and from its entire git history. The client
is shipped as a prebuilt bundle in the tracked `dist/` directory.

- Root `index.html` is the Vite entry and loads `/src/main.ts`, which does not exist,
  so `npm run dev` (Vite, port 5188) cannot serve the UI — it renders a blank page.
  Do not try to fix that by pointing the preview at Vite.
- Consequence for edits: there is no hot reload for the client. Front-end changes
  require the missing sources plus `npm run build`; today the only client artifact
  that can be served is the existing `./dist` bundle.
- Consequence for tests: `npm test` fails immediately — every test in `tests/*.test.cjs`
  requires `../src/**.ts`. They pass only in a checkout that has `src/`.
- Server edits (`server/*.mjs`) are plain source, but there is no watcher:
  `docker compose -f docker-compose.base44.yml restart web` (or `up -d`) and re-check
  `docker compose -f docker-compose.base44.yml logs -f web`.

## Credentials

None are required to boot. Telegram Stars payments are off by default
(`SURGE_PAYMENTS_ENABLED` unset -> disabled, the project's intended default), so the
game and its public `/api/store` render without any token.

To enable payments, the server requires all of: `SURGE_PAYMENTS_ENABLED=true`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (>= 32 chars), `SURGE_SUPPORT_CONTACT`,
and an HTTPS `SURGE_PUBLIC_ORIGIN`. The server exits on startup if the set is
incomplete. In the sandbox, set `SURGE_PUBLIC_ORIGIN` to the preview origin
(`https://3000-$BASE44_PUBLIC_HOST_SUFFIX`) — leave it unset otherwise, which disables
the server's Origin allowlist so the preview works from its proxied host. Do not put
user-supplied credentials under Compose `environment:`; the platform delivers them to
`/run/base44/app.env`, wired as the last `env_file:` entry.

`wrangler.jsonc` and `cloudflare/` are the alternative Cloudflare Workers/D1
deployment (`npm run cf:dev`, port 5190) and are not used by the sandbox runbook.
