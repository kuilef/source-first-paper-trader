# Source-First Paper Trader: design

## Brief and scope

Build one complete public demo for the BLI / RYO-CHAN Autonomous Agents bounty: an autonomous, rule-based agent that checks a narrowly defined Kraken spot-listing claim against original evidence, then opens a small virtual position or records an explainable abstention. The result must be useful and reproducible without exchange accounts, wallets, deposits, paid APIs, or a model subscription. It does not predict returns.

## Choice and alternatives

Recommended: a browser-first TypeScript application with a minimal, fixed-endpoint Cloudflare Pages Worker. It needs no database, credentials, CRE account, contract deployment, or scheduled infrastructure. A deterministic interpreter and policy are enough for the published News Checker example; call it a rule-based agent, never machine learning.

Alternative 1, Token Rights Watch with CRE, gives more blockchain integration but adds CRE account/simulation and EVM integration risk. Alternative 2, an LLM-based multi-source trader, adds cost, credentials, nondeterminism, and a larger misleading-evidence surface. Neither helps this narrow complete demo. Fresh direct bounty verification found no mandatory LLM, RYO SDK/API/MCP, wallet, or real-trading integration. Do not claim an unused integration.

## Evidence and current feasibility

The researched bounty requires autonomous market-evidence interpretation, practice positions, and a reproducible rationale; News Checker is an allowed example. Published award text is "$6,000 USD VALUE", not a verified cash allocation. Eligibility, payout details, and extra submission fields remain subject to the actual form. Do not market the project as accepted, eligible, novel in all respects, or likely to win.

Verified on 2026-10-09:

- Official listing RSS: https://blog.kraken.com/category/product/asset-listings/feed ; approximately 92 KB, includes pubDate and full content:encoded, lacks browser CORS.
- Public pair catalog: https://api.kraken.com/0/public/AssetPairs?assetVersion=1 ; approximately 677 KB and 1,460 pairs in the observed response. `assetVersion=1` supplies readable base/quote identifiers and canonical keys such as `PNT/USD`; altname/wsname also exist. Preserve exact supplied IDs. Never strip X/Z prefixes heuristically.
- Public ticker: https://api.kraken.com/0/public/Ticker?pair=XBTUSD ; `a[0]` is ask and `b[0]` is bid. There is no exchange quote timestamp. A response observation timestamp is not an execution timestamp.
- Date/identity regression cases: ZCHF / Frankencoin was published October 8 with explicit trading date October 8; USDsui / Sui Dollar and PNT / Pheasant Network were published October 8 with explicit trading date October 5. Do not infer PNT is pNetwork. OUSD in the inspected article means Open USD, not Origin Dollar.
- Source URLs: https://blog.kraken.com/product/asset-listings/zchf-is-available-for-trading , https://blog.kraken.com/product/asset-listings/pnt-is-available-for-trading , https://blog.kraken.com/product/asset-listings/usdsui-is-available-for-trading , https://blog.kraken.com/product/asset-listings/ousd-is-available-for-trading .

Useful references: https://dorahacks.io/hackathon/bounty/1380 ; https://dorahacks.io/hackathon/legal-hack-2026/bounties ; https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs ; https://docs.kraken.com/api-reference/market-data/get-ticker-information .

## Product and visual direction

English public UI, English README/about and submission copy, Russian operating manual. An editorial research notebook: warm paper background, ink text, muted teal highlights, restrained amber warnings, a serif headline with system sans/monospace for controls/evidence. No neon trading terminal, empty decorative charts, unsupported score, or token-logo identity assumptions.

Four accessible navigation destinations: Live desk, Replay lab, Journal, Method. The main evidence sheet has a source excerpt, a date/identity comparison, a policy checklist, and a final paper action. Selected journal entries show the same sheet, including market snapshots and accounting. A compact runtime strip states running/stopped, last successful scan, last error, and next scheduled scan. Mobile stacks these sections without page-level horizontal scrolling. Buttons, forms, tabs, dialogs, and status messages are keyboard/screen-reader accessible; preserve focus and honor reduced motion.

The first visit presents a clearly labelled illustrative replay with a direct "Run replay" action and offers a separate live desk. It never presents a fixture as a live position. Start/Stop controls the autonomous loop; no per-decision confirmation or manual trade-entry button. An optional pasted headline is evaluated as a bounded claim, never as permission to fetch its URL. The public Method page explains source limitations, date precision, risk parameters, simulation mechanics, storage, and operating hours.

## Architecture and interfaces

Use vanilla TypeScript + Vite for the client; Vitest for pure/integration tests; Playwright plus an accessibility test for browser flows; Decimal.js for exact decimal arithmetic; a small Worker module for Cloudflare Pages advanced mode. Resolve supported current package versions when scaffolding, pin the lockfile, and use the same supported Node LTS locally and in CI. No analytics, external fonts, database, account system, or secrets.

1. `domain/` owns strict schemas, immutable evidence/decision records, decimal accounting, and the pure policy. It depends on no UI or network API.
2. `sources/` parses bounded official RSS/XML and Kraken JSON into normalized evidence, preserving excerpt/source/identity/date provenance. Browser XML parsing must reject DOCTYPE/entities and parse errors. HTML is reduced to text, never mounted as HTML.
3. `worker/` only serves assets and fixed, bounded public GET proxies. No arbitrary URL fetch, user credentials, account endpoints, private Kraken APIs, or third-party news crawling.
4. `agent/` schedules source scans and position marks, evaluates eligible events, handles idempotence, and updates the paper ledger. Time and network dependencies are injected for deterministic tests.
5. `storage/` loads validated versioned local state and transactionally persists it; import/export uses the same bounded schema. A failed import never replaces the current journal.
6. `ui/` renders facts from those interfaces. `scripts/replay.ts` reproduces a frozen fixture without network access. `scripts/live-smoke.ts` performs explicitly live read-only checks and reports unavailable sources honestly.

Never persist, export, or commit full copyrighted RSS/article bodies. Store a source body hash, normalized input snapshot, source URLs, excerpts, observation times, parser version, policy version, fee/slippage assumptions, and decision reasons. Hash a canonical stable representation; hashes detect accidental changes, not cryptographic authenticity or immutable audit storage. Run IDs and paper event IDs are deterministic. Live observations and replay workspaces are separate.

## Normalized evidence contract

All numeric market values and amounts are validated decimal strings; never accept NaN, Infinity, exponent bombs, negative/zero prices, or an inverted book. All timestamps are strict ISO UTC instants except explicitly date-only source event dates.

- `EvidenceBundle`: schemaVersion=1, mode (`live` or `illustrative-replay`), evaluatedAt, parserVersion, policyVersion, claim, announcement, pair snapshot, quote snapshot or null, source receipts, and portfolio-before snapshot.
- `Claim`: bounded original text, claimed asset name/symbol if present, venue=`kraken`, eventType=`spot-listing`, source of claim (`official-feed` or `user-text`). A supplied full name must match the original announcement; ticker alone cannot override a conflicting name.
- `Announcement`: exact official URL/title/excerpt, publishedAt, firstSeenAt, retrievedAt, explicitTradingDate (`YYYY-MM-DD` or null), datePrecision (`day`, `instant`, or `unknown`), optional exact trading instant, original trading-date phrase, sourceTimezone (`explicit` or `unknown`), and full official asset name/symbol. Require an explicit source year for v1; missing or ambiguous year means abstain. The verified current source phrases include their year.
- `PairSnapshot`: exact key/altname/wsname/base/quote/status, lotDecimals, orderMin, costMin, observedAt, source receipt. USD spot only. Preserve source fields as supplied; no symbol-prefix heuristics.
- `QuoteSnapshot`: pair key, bid, ask, requestedAt, observedAt, exchangeTimestamp=null, upstreamAgeSeconds or null, source receipt, and availability. Cached responses keep their original observedAt. The UI says "Observed at".
- `DecisionRecord`: immutable bundle plus ordered reason codes, action (`paper-buy`, `abstain`, `paper-close`, or `mark`), accounting result, and canonical input hash. Do not attach a confidence/profitability probability.

Resolve an asset only when the original announcement binds a full name to a symbol and exactly one matching online USD spot pair exists. Compare full names when evaluating a claim. The binding is venue-specific evidence, not a globally unique token identity, contract-address verification, or proof of user regional eligibility. Missing or conflicting information remains unknown.

## Policy v1: explicit illustrative limits

Freeze these values in `policy-v1` and print them in Method and every export:

- Initial virtual cash: 1,000 USD. Maximum all-in entry cost: 25 USD. Maximum open positions: 1. No leverage or shorting.
- Assumed fee: 0.40% of notional on each side. Assumed adverse slippage: 0.10% on each side. These are illustrative assumptions, not a retrieved personal fee tier.
- Fresh listing window: the latest two UTC calendar dates, meaning today or yesterday at evaluation time. This is a calendar-date policy, NOT 48 elapsed hours. Preserve the source's date-only precision and unknown timezone. Require explicit original-source wording that trading is live and a currently online pair; publication time alone never qualifies an event. Future, absent, ambiguous, or older trading dates abstain.
- Maximum spread: 1.00% using `(ask-bid)/ask`. Maximum effective observation age: 90 seconds, computed as elapsed time since our successful upstream observation plus any supplied upstream Age. Reject future observation times and quotes observed before event discovery or position entry; never use a pre-entry quote for an exit. No assertion about the age of the exchange's underlying quote.
- Entry quantity is rounded down to the pair's lotDecimals. Require orderMin and costMin after rounding. Subtract actual modeled notional plus modeled fee, and never exceed cash or 25 USD. A newly scanned event cannot spend twice, including across repeated clicks, reruns, reload, or import.
- Close when the first newly observed quote shows net-liquidation return at or below -2%, at or above +3%, or when at least 60 minutes have elapsed since entry. Execute only at that actual observation, not an imagined threshold-crossing time. A price gap can exceed the loss threshold. Unavailable quotes do not create fills or PnL.
- Pausing stops new scans and marks. On reload always start stopped, explain any open virtual position, and use the first new observation on resumption. There is no claim of continuous background operation while the tab is closed/suspended.

Evaluation order: invalid/unavailable data; unsupported or non-spot announcement; missing/date-ambiguous evidence; identity/pair mismatch; old/future event; pair not online; duplicate event; open-position/cash limit; invalid/stale quote; spread/minimum-size limit; then paper-buy. Return all relevant checks with a stable primary reason; do not substitute a bullish narrative for a rejection.

Ticker existence alone does not confirm a listing date. Margin, futures, roadmap, deposit-only, and planned listing announcements are excluded. Re-publication does not reset event age. An old article scanned for the first time remains old.

## Accounting and replay

Decimal precision 40. Store amounts as decimal strings with full calculated precision within schema bounds; round a fee upward to 8 USD decimals and quantity down to lotDecimals (maximum 18). Display money rounded to cents, but calculate and export from stored values. Entry fill is ask × 1.001. Exit/mark liquidation fill is bid × 0.999. Marked equity includes the hypothetical exit fee. Realized PnL changes only after a close; unrealized PnL is a separately labelled current modeled liquidation value minus entry cost.

Pinned arithmetic fixture: ask=10, bid=9.99, lotDecimals=6, budget=25 gives quantity 2.487552, entry fill 10.010, entry fee 0.09960159, all-in cost 24.999997110. An exit bid of 11 gives fill 10.989, exit fee 0.10934284, net proceeds 27.226366088, and realized PnL 2.226368978. Display 2.23 USD while retaining exact strings.

Ship at least five small frozen illustrative cases: confirmed/fresh with entry and later exit; recycled publication with older trading date; ambiguous/colliding identity; future/unsupported announcement; unavailable/stale or wide-spread market. Synthetic quotes and portfolio values are labelled synthetic at case selection, in the journal, and in exports. Real-source excerpts may inform a case but do not make synthetic quotes historical prices. A test/CLI replay must reproduce the canonical decision and accounting with a supplied clock, without today's catalog, network, or future-price leakage.

A compact historical metadata fixture with a very short excerpt is permissible for parser regression and must retain its capture date and source; use synthetic XML/HTML for parser tests instead of copied article bodies. It is not historical strategy-performance evidence. Never claim positive returns from illustrative examples demonstrate alpha.

## Network, storage, and security limits

Worker routes: `GET /api/listings` -> the exact official RSS above; `GET /api/pairs?pair=<identifier>` -> the fixed AssetPairs endpoint with assetVersion=1 and one bounded pair identifier; `GET /api/ticker?pair=<identifier>` -> the fixed Ticker endpoint. Both pairs and ticker routes require exactly one pair identifier of at most 40 ASCII alphanumeric/slash characters; construct it with URLSearchParams. Reject extra parameters, all other methods/paths, redirects outside the fixed source, and URL-like pair inputs. No client-controlled destination URL. Serve static assets through the Pages binding; apply defensive headers.

Proxy raw bounded XML/JSON; parse in the browser to avoid excessive free-tier edge CPU. Maximum upstream bodies: RSS 256 KiB; pairs 2 MiB; ticker 64 KiB. Use `redirect: 'manual'` and reject 3xx explicitly; the deployed Worker runtime does not support relying on `redirect: 'error'`. Maximum fetch duration 10 seconds, one bounded retry in the browser with backoff; no retry loop. Small cache: RSS 300 seconds, pairs 300 seconds, ticker 15 seconds. Set an original observation header before cache insertion, preserve it on cache hits, and expose/cache an honest age. Do not cache error bodies as success or replace failures with fixture data. Rate budget: at most one upstream request per second per active agent; a scan is sequential, not a fan-out. Scan listings every 5 minutes; inspect at most three newest supported candidate pairs per scan, sequentially, and quote/mark an open position every 60 seconds. Derive the narrow pair query only from a parsed official asset symbol, then verify returned exact wsname/base/quote. Do not request the full pair catalog in normal operation. The Worker has no cron, Durable Object, or database requirement.

Imports: maximum 1 MiB, 200 decision records, 20 source excerpts per bundle, excerpts at most 240 characters and no more than 25 quoted words from one source, input text at most 600 characters, URLs at most 2,048 characters, maximum JSON nesting 16. Reject `__proto__`, `prototype`, `constructor`, unknown top-level fields, unsupported versions, duplicate IDs, invalid decimal/date strings, and inconsistent record hashes/accounting. Construct typed objects from selected own fields, never deep-merge imported objects. Imported histories stay in a separate read-only replay workspace until explicit local replacement; never auto-start or fetch imported URLs. Export only local project data; no accounts or personal data are collected.

Storage cap matches imports. Versioned localStorage keeps the journal and a backup of the last valid save. On corrupt/unsupported state, keep the raw original in a recoverable local key when feasible, show a non-destructive recovery notice, and open a clean stopped workspace. A failed write leaves the last valid state and reports unsaved changes. Reset requires a local UI confirmation and offers export; cancellation leaves state untouched. No secrets in localStorage, the Worker, repository, or logs.

Render all source/user text as text. Links allow https and known source hosts for evidence; unsafe URLs render as inert text. Use noopener/noreferrer. Set CSP without unsafe-eval, nosniff, frame restrictions, Referrer-Policy, and a Permissions-Policy denying unnecessary sensors. External snippets cannot execute instructions. Bound regex/parsing work and reject oversized/chunked bodies while reading rather than after unlimited buffering.

## Release acceptance criteria

The repository provides deterministic tests, reproducible installation, English documentation and a Russian operating manual. Release checks cover Cloudflare Pages assets/proxy behavior, desktop/mobile accessibility, independent correctness/security review, and a fresh read-only live-source smoke. A working demo and a prepared application draft do not imply sponsor acceptance or eligibility.
