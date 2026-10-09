# Source-First Paper Trader

A rule-based research agent that checks original Kraken listing evidence, then autonomously records a virtual trade or an explainable abstention.

**Paper-only. No funds, wallet, exchange login, API keys or language model.** A positive illustrative outcome is not evidence of investment returns.

[Live demo](https://source-first-paper-trader.kuilef42.workers.dev/) · [Grant application guide](GRANT_APPLICATION.md)

## Try it locally

Requirements: Node.js 24 LTS, npm, and `zip` for the optional upload bundle.

```sh
npm ci
npm run build
npm run preview
```

Open http://127.0.0.1:4173. This preview runs the actual Cloudflare Worker through Miniflare, including its same-origin public-source routes and security headers. `npm run dev` is a faster UI-only Vite server; its live-source routes are intentionally unavailable. Both servers serve the same `/logo.png` download from the embedded project artwork.

1. In **Replay lab**, run the fresh-listing case. Inspect the automatic entry and later exit, source identity, event date, policy checks and exact accounting.
2. Choose the recycled-announcement case. A recent publication cannot turn an older trading date into a fresh event.
3. In **Live desk**, press **Start live agent**. It checks real official sources while the page remains open. **Stop agent** cancels the loop. Reload always starts stopped.
4. Export the journal. Importing recalculates all decisions, hashes and balances in a separate read-only view; it never starts the agent.

[Русская инструкция](docs/manual.ru.md) · [Design](docs/DESIGN.md) · [Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Demo and submission notes](docs/DEMO.md)

## What the agent does

The autonomous loop discovers at most three recent official announcements per scan, extracts a narrowly supported live-spot-listing statement, binds the original full asset name and symbol to one USD pair, and checks its status and quote. The deterministic policy opens a small virtual position or records the reasons it abstained. Subsequent observations mark or close open positions automatically.

The UI separates four facts: article publication, stated trading date, agent discovery time, and public quote response observation. Kraken Ticker supplies no exchange quote timestamp. An online symbol is not a globally unique token identity, contract-address verification, or proof that the pair is available in every jurisdiction.

### Policy-v1

| Rule                  | Value                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Starting virtual cash | 1,000 USD                                                                                                 |
| All-in entry cap      | 25 USD, one open position                                                                                 |
| Accepted event age    | Today or yesterday in the UTC calendar; not rolling 48 hours                                              |
| Entry evidence        | Explicit complete trading date, live spot wording, full name/symbol binding, matching online USD pair     |
| Observation freshness | Elapsed response observation age + supplied upstream Age ≤ 90 seconds; no pre-discovery entry quote       |
| Spread                | `(ask − bid) / ask` ≤ 1%                                                                                  |
| Modeled fees/slippage | 0.40% fee and 0.10% adverse slippage each side                                                            |
| Quantity/fee rounding | Quantity down to source lot precision; fee up to 8 USD decimal places                                     |
| Exit                  | First fresh observed liquidation return ≤ −2% or ≥ +3%, or quote observed at least 60 minutes after entry |

Exit fills use the observed bid after slippage, never an imagined threshold-crossing price. A gap can exceed the loss threshold. Missing/stale quotes cannot create fills or P&L. Extreme numeric values or dust whose rounded fee exceeds gross proceeds abstain. Liquidity, partial fills, market depth and queue position are not simulated. Fees are illustrative, not a retrieved personal fee tier.

Every export includes the complete versioned policy, normalized evidence, short excerpts, source URLs and hashes, original observations, ordered checks, and exact decimal accounting. SHA-256 detects changes; it does not authenticate the source or make browser storage immutable.

## Sources and failure modes

- [Official listing RSS](https://blog.kraken.com/category/product/asset-listings/feed)
- [Kraken AssetPairs documentation](https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs)
- [Kraken Ticker documentation](https://docs.kraken.com/api-reference/market-data/get-ticker-information)

The parser requires `SYMBOL is [now] available for trading!`, a matching `Full name (SYMBOL)` heading, and `SYMBOL trading is live as of Month D, YYYY`. Missing years, ambiguous bindings, changed markup, unsupported products and unavailable market evidence fail closed. Full RSS/article bodies are transient parser inputs; they are not persisted, exported or included in fixtures.

A read-only live smoke on 9 October 2026 at 20:10 UTC resolved Frankencoin/ZCHF, Sui Dollar/USDSUI and Pheasant Network/PNT. ZCHF's stated 8 October date qualified. The other two stated 5 October and were rejected despite 8 October publication. This is a dated integration observation, not a promise of future availability or an executed exchange order.

```sh
npm run live-smoke
npm run live-smoke -- https://YOUR-VERIFIED-PAGES-HOST
```

The first command reads the upstream sources directly; the second checks the deployed same-origin adapter. Both report original event dates and quote observations, exit nonzero when required live evidence is unavailable, and never replace a failure with a fixture.

## Reproducible checks

```sh
npm run typecheck
npm run lint
npm test
npm run replay -- --case confirmed
npx playwright install --with-deps chromium
npm run build
PRODUCTION_PREVIEW=1 npm run test:e2e
npm audit --audit-level=high
```

Frozen case names: `confirmed`, `recycled`, `identity-conflict`, `future`, `stale-quote`, `wide-spread`. Quotes and modified evidence are illustrative teaching inputs, not historical strategy-performance data. The confirmed input fingerprint is `4fb68686d1647d4bc98ce8b6428c11e4d4b35311b416abcc68d3c78731ec13e1`.

Tests cover schema/parser boundaries, exact accounting, stale/future/recycled evidence, duplicate fills, interruption/restart, independent marking during feed outages, corrupt/quota-limited storage, hostile imports, fixed proxy destinations, redirects, timeouts and byte limits. Proxy integration tests run actual workerd through Miniflare. Browser checks cover 320px/mobile and desktop flows, keyboard access, axe accessibility, import/export and live error/cancellation behavior. Screenshots and traces are CI artifacts.

The development lockfile keeps stable Miniflare 4 and overrides its transitive `undici` to 7.29.1 and `sharp` to 0.35.5 to address reported advisories. Worker/runtime and production-preview checks are rerun against those exact versions. These development packages are not shipped in the browser or deployed Worker.

## Cloudflare Pages deployment

```sh
npm run package
```

Upload `artifacts/source-first-cloudflare.zip`, or choose the built `dist/` folder, using a Cloudflare Pages **Direct Upload** project. The ZIP is flat: `index.html`, `assets/`, `_worker.js`, `_routes.json`, `release.json`, the SVG icon and licence notices are at the expected root. Every built file is UTF-8 text. The Worker serves `/logo.png` from the same original 512px PNG bytes embedded in `worker/logo.ts`; there is no binary file to copy or upload. GET returns `image/png`, and HEAD returns the same metadata without a body. Keep `_worker.js`; plain static hosting cannot provide live data. No environment variables, tokens, KV, Durable Objects, database, paid API or server cron are required.

In a restricted execution sandbox, native workerd may be unable to resolve upstream DNS even when the direct Node smoke succeeds. This produces an honest HTTP 502. Local mocked-runtime success is not a substitute for checking the public Cloudflare API routes after deployment.

The GitHub workflow verifies the source and uploads a flat `cloudflare-pages-<commit>` artifact from `dist/`. Downloading that artifact provides the root layout needed for Pages. The independent browser-evidence artifact contains screenshots/traces. `release.json` identifies the source commit used for a build. CI success and public deployment availability must be checked for the actual published commit; local checks alone do not establish either.

The Worker permits only three fixed GET routes: `/api/listings`, `/api/pairs?pair=…`, and `/api/ticker?pair=…`. It rejects extra parameters, arbitrary destinations and every upstream redirect. It enforces a 10-second deadline and byte caps of 256 KiB / 2 MiB / 64 KiB. Original receipt time and upstream Age survive cache hits; TTLs are 300 / 300 / 15 seconds. Browser requests are sequential, at least one second apart, with one bounded retry. Listing scans run every five minutes; open positions are checked every minute.

This small architecture is designed for free-plan use, but account quotas still apply. [Pages Functions consume the Workers request quota](https://developers.cloudflare.com/pages/functions/pricing/). All paths invoke this project's Worker to receive security headers, so even asset requests count as Function invocations. Caching reduces upstream requests, not invocation count. No production CPU or high-traffic performance guarantee is claimed. See [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/) before changing deployment structure.

After deployment, verify `/release.json`, `/logo.png`, all three API routes, the replay, and one live scan. Report source failures honestly. The Method page has a downloadable 512×512 PNG project logo generated from the original SVG icon.

## Single-file Cloudflare Worker deployment

Pages remains the default build. A second packaging command embeds the same public text assets into the existing Worker, preserving the app, proxy, logo and security headers:

```sh
npm run package:worker
STANDALONE_PREVIEW=1 npm run preview
# In another terminal, verify the same browser flows:
PRODUCTION_PREVIEW=1 STANDALONE_PREVIEW=1 npm run test:e2e
```

`artifacts/source-first-worker.mjs` is one LF-terminated UTF-8 ES module. It requires no bindings, secrets, uploaded asset directory or external packages at runtime. The build rejects binary inputs and scripts reaching the project's 3 MiB raw size bound. `dist/` and the Pages ZIP remain available. CI tests both deployment modes and publishes a separate `cloudflare-worker-<commit>` artifact.

In the normal Cloudflare Worker dashboard, open the project's code editor, replace the default `worker.js` content with the complete generated module, and deploy it as an ES-module Worker. Use compatibility date `2026-07-01` or later. No Node compatibility flag or asset binding is needed. Keep the `export` at the end of the file. Do not paste TypeScript source or a ZIP into the editor.

Live demo: [source-first-paper-trader.kuilef42.workers.dev](https://source-first-paper-trader.kuilef42.workers.dev/). The deployed artifact was built from [f143cafd](https://github.com/kuilef/source-first-paper-trader/commit/f143cafdde1e68e7d0d6dec81589aae05013ae2b). Browser checks on 9 October 2026 verified the illustrative entry/exit, old-event abstention, and a real Kraken-source scan; the live agent was then stopped. This documentation-only update does not change that running app revision.

For future deployments, inspect `/release.json` and verify the logo, replay and live-source routes. To stamp a verified revision when building an exported source archive, set `BUILD_REVISION=<verified-commit>` before `npm run package:worker`. All requests, including embedded static assets, consume Worker invocations; account quotas still apply.

## Privacy, storage and licence

There is no app account, analytics, tracking pixel or remote journal database. Journal data stays in this browser's localStorage. The hosting provider receives normal HTTP requests; the Worker retrieves public Kraken data. Do not put personal information into imported files. Import bounds are 1 MiB, 200 records, depth 16 and short excerpts; executable markup and unknown fields are rejected or rendered as inert text. Imports never fetch embedded URLs. A failed write retains the prior valid journal, and corrupt data is preserved where storage permits.

**Live runtime stops when the page closes or is suspended.** Export before clearing storage. Open positions resume from the first new observation; missing intervals are not fabricated.

Code: MIT. Kraken's name, data and excerpts retain their respective rights; this independent project is not endorsed by Kraken. [Runtime dependency notices](THIRD_PARTY.md) are also included in the deployment. No profitability, eligibility, prize or sponsor-integration claim is implied.
