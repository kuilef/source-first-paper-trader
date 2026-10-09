# Implementation plan

Design: [DESIGN.md](DESIGN.md).

**Goal:** Deliver a public, autonomous, paper-only Kraken listing-evidence demo with a reproducible journal and a DoraHacks draft stopped before final submission.

**Architecture:** A browser application owns deterministic parsing, decisions, scheduling, exact paper accounting, and local storage. A minimal Cloudflare Pages Worker proxies only fixed public Kraken GET endpoints and serves assets. Replay and live workspaces never silently mix.

**Tech Stack:** TypeScript, Vite, Decimal.js, Vitest/jsdom, Playwright, Miniflare 4.x, accessibility checks, Cloudflare Pages advanced-mode Worker, GitHub Actions; current supported Node LTS and a committed npm lockfile.

## Global Constraints

- Initial virtual cash: 1,000 USD. Maximum all-in entry cost: 25 USD. Maximum open positions: 1. No leverage or shorting.
- Assumed fee: 0.40% of notional on each side. Assumed adverse slippage: 0.10% on each side.
- Fresh listing window: the latest two UTC calendar dates, meaning today or yesterday at evaluation time. This is a calendar-date policy, NOT 48 elapsed hours.
- Maximum spread: 1.00% using `(ask-bid)/ask`. Maximum effective observation age: 90 seconds, computed as elapsed time since upstream observation plus any supplied upstream Age; reject future or pre-event/pre-entry observations.
- Close at first observed net-liquidation return <= -2%, >= +3%, or elapsed holding time >= 60 minutes; unavailable quotes cannot fill.
- Public UI/docs are English; supply a Russian operating manual. No model, exchange account, wallet, order, paid API, database, analytics, or scheduled server is required.
- Never conflate publication time, trading date, HTTP observation time, or an exchange execution timestamp. Never strip asset ID prefixes.
- Final DoraHacks submission is excluded. Public GitHub and Cloudflare publication are within the release scope; follow actual platform permission/security requirements.

## Review Focus

- Repeated scan/Start clicks or interrupted persistence must not duplicate a paper fill; task 3 tests idempotent event IDs and one scheduler generation.
- Republishing a listing or reusing a ticker must not invent a fresh event/identity; tasks 1–2 test published October 8 / traded October 5 and Pheasant Network versus pNetwork.
- Cache hits, tab suspension, or a source timeout must not produce stale/fabricated fills; tasks 2–3 test original observation timestamps, missing marks, and next-observation exits.
- Corrupt, hostile, oversized, or foreign-version imports/storage must preserve the current journal and render no executable markup; tasks 3 and 5 test rejection/recovery.
- Quantity rounding, minimum order constraints, and fee rounding must never overspend or imply a guaranteed stop-loss price; tasks 1 and 3 test exact values and price gaps.

## File map and stable contracts

- `src/domain/types.ts`, `schema.ts`, `canonical.ts`: validated v1 types, bounds, and deterministic stable encoding/hash.
- `src/domain/policy.ts`, `accounting.ts`: pure interpretation/policy reason codes and exact paper fills/marks.
- `src/sources/kraken.ts`, `rss.ts`, `client.ts`: strict source parsing and receipt-preserving public adapters.
- `worker/index.ts`, `worker/proxy.ts`: advanced-mode asset/proxy routing; `public/_headers` or Worker-equivalent headers.
- `src/agent/engine.ts`, `scheduler.ts`: idempotent state transitions and injected-clock loop.
- `src/storage/journal.ts`, `transfer.ts`: bounded local persistence/import/export and recovery.
- `src/ui/App.ts`, `EvidenceSheet.ts`, `LiveDesk.ts`, `ReplayLab.ts`, `Journal.ts`, `Method.ts`, `styles.css`: accessible notebook UI.
- `fixtures/illustrative/*.json`, `fixtures/source-regressions/*.json`: small explicitly labelled frozen examples and parser captures.
- `scripts/replay.ts`, `scripts/live-smoke.ts`: reproducible offline replay and explicit read-only live verification.
- `tests/unit/`, `tests/integration/`, `tests/e2e/`: colocated categories named in tasks below.
- `docs/manual.ru.md`, `docs/method.md`, `docs/demo.md`, `docs/submission.md`, `docs/deployment.md`, `README.md`, `.github/workflows/ci.yml`.

Use the domain type names in the spec. Exact public functions:

- `validateBundle(input: unknown): EvidenceBundle` and `validateJournal(input: unknown): JournalState` throw typed `ValidationError` without mutating input.
- `canonicalJson(value: ValidatedJson): string`; `hashBundle(bundle: EvidenceBundle): Promise<string>` returns SHA-256 hex of stable normalized input.
- `evaluate(bundle: EvidenceBundle, policy: Policy): Decision` is pure; it returns action, ordered checks/reasons, stable eventKey, and optional proposed quantity/fill/cost.
- `enterPosition(bundle: EvidenceBundle, decision: Decision, state: PortfolioState): EntryResult`; `markOrClose(position: Position, quote: QuoteSnapshot, now: string, policy: Policy): MarkResult` are pure.
- `parseListingFeed(xml: string, receipt: SourceReceipt): Announcement[]`; `parsePairs(json: unknown, receipt: SourceReceipt): PairSnapshot[]`; `parseTicker(json: unknown, pair: PairSnapshot, receipt: SourceReceipt): QuoteSnapshot` fail closed with typed source errors.
- `loadLiveEvidence(client: PublicSourceClient, now: string): Promise<ScanInputs>` uses only fixed sources; `PublicSourceClient` exposes `listings()`, `pairs(pairId)`, `ticker(pairId)`.
- `runScan(state: JournalState, inputs: ScanInputs, now: string): Promise<ScanResult>` returns new validated state and newly appended records without mutating state.
- `createScheduler(deps: SchedulerDeps): { start(): void; stop(): void; isRunning(): boolean }`, where dependencies explicitly inject `now`, timeouts, source client, readState/writeState, and status reporter.
- `loadJournal(storage: StorageLike): LoadResult`; `saveJournal(storage: StorageLike, state: JournalState): SaveResult`; `parseImport(text: string): Promise<ImportedReplay>`; `exportJournal(state: JournalState): string`.

Types used above (`Policy`, `Decision`, `PortfolioState`, `Position`, `EntryResult`, `MarkResult`, `SourceReceipt`, `ScanInputs`, `ScanResult`, `JournalState`, `SchedulerDeps`, `StorageLike`, `LoadResult`, `SaveResult`, `ImportedReplay`) are defined in `types.ts` or their owning module before a dependent task begins. Use discriminated unions for successful/unavailable results, no successful-looking defaults.

---

### Task 1: Freeze evidence, policy, and exact paper accounting

**Files:** package/config/lockfile; domain files; illustrative fixtures; `tests/unit/{schema,canonical,policy,accounting}.test.ts`; offline replay script; design and plan docs.

**Interfaces:** Produces domain types and all pure domain functions above. It needs only explicit input/clock values; no network or UI.

- [ ] Scaffold the minimum supported TypeScript/Vite/Vitest toolchain, choose/package-pin current supported versions, and define `typecheck`, `test`, `test:unit`, `build`, and `replay` scripts. Add the design/plan and a short architectural README, not product boilerplate.
- [ ] Write failing schema/canonical tests: the same normalized bundle has identical canonical bytes despite insertion order; unknown version, NaN/exponent bomb, invalid date, dangerous prototype key, depth 17, duplicate record ID, and array count >200 throw `ValidationError`.
- [ ] Run `npm run test:unit -- schema canonical`. Confirm failures are missing behavior, not tool/config errors.
- [ ] Implement validated v1 types, bounds, safe object reconstruction, canonical serialization, and deterministic eventKey/hash contracts. Freeze policy-v1 values from the spec.
- [ ] Write failing policy tests: fresh confirmed event buys; pub Oct 8/trading Oct 5 abstains on Oct 9; date Oct 8 qualifies on Oct 9 while never becoming an invented timestamp; future/unknown date abstains; supplied pNetwork name conflicts with official Pheasant Network; duplicate event, not-online pair, unsupported margin listing, old quote, wide spread, and insufficient/minimum cash abstain.
- [ ] Write failing accounting tests asserting quantity `2.487552`, fee `0.09960159`, entry cost `24.999997110`, exit net `27.226366088`, and PnL `2.226368978` from the spec. Assert all-in cost never exceeds 25/cash, rounded amount respects lotDecimals/orderMin/costMin, no negative/nonfinite price passes, and display rounding does not change ledger values.
- [ ] Run `npm run test:unit -- policy accounting`; confirm meaningful failures. Implement the pure policy and Decimal.js math with stable reason ordering and explicit assumptions.
- [ ] Create at least five validated illustrative bundles with provenance/mode labels and deterministic clocks; implement `scripts/replay.ts` to print decision reasons/hash/accounting from a chosen fixture without network.
- [ ] Run `npm run typecheck && npm run test:unit && npm run replay -- --case confirmed`. Require all tests green and a stable expected replay output recorded by a snapshot test.

### Task 2: Add fixed public-source adapters and lightweight Worker

**Files:** source adapter/parser files; Worker files/config; source-regression fixtures; `tests/unit/{rss,kraken}.test.ts`; `tests/integration/proxy.test.ts`; live smoke script.

**Interfaces:** Consumes domain types/validators. Produces parser functions, `PublicSourceClient`, and `loadLiveEvidence`; Worker API routes exactly match the design.

- [ ] Capture compact derived source-regression metadata and very short evidence excerpts from the verified official RSS/pair/ticker responses, with exact source and retrieval provenance. Use synthetic XML/HTML for parser fixtures; never persist or export full copyrighted article/feed bodies. Include ZCHF, the publication/trading-date mismatch, and PNT/OUSD identity bindings. Minimize retained excerpts; do not commit full giant API responses unnecessarily.
- [ ] Write failing RSS tests: extract official full name/symbol and explicit date phrase; preserve pubDate separately; reject DOCTYPE/entities/parse errors/oversize; ignore margin, futures, deposit-only, roadmap, and no-date articles; hostile HTML stays text; missing or ambiguous explicit source year abstains rather than guessing.
- [ ] Write failing Kraken tests: use assetVersion=1 keys exactly; resolve only unique USD spot pair; read bid/ask from `b[0]`/`a[0]`; preserve orderMin/costMin/lotDecimals; exchangeTimestamp remains null; invalid API error list, inverted book, or missing pair becomes unavailable; effective age adds cache age and elapsed receipt age, and future/pre-entry observations cannot fill.
- [ ] Run `npm run test:unit -- rss kraken` and verify red. Implement parsers using bounded XML/text parsing, not executable HTML or uncontrolled regex matching. Document the narrow grammar and explicit-source-year requirement in Method.
- [ ] Write failing proxy tests for only GET and three exact routes; one required bounded pair token on pairs/ticker routes and no extra query keys; blocked arbitrary URLs/path traversal/redirects; 10-second timeout; body limits including chunked overflows; upstream failures; cached original observation time; static fallback; correct content/security headers.
- [ ] Run `npm test -- proxy` and confirm red. Implement raw bounded proxying with 300s RSS/pairs and 15s ticker cache, original receipt headers, fixed source destinations, streamed byte limits, and no remote-content parsing at the edge. Use `redirect: 'manual'` and reject 3xx explicitly; do not rely on unsupported `redirect: 'error'`. Keep static asset handling compatible with Cloudflare Pages advanced mode. Run the Worker integration tests through stable Miniflare 4.x in the actual Worker runtime, not only a Node fetch mock.
- [ ] Implement the browser adapter with sequential calls, one bounded retry/backoff, strict source-error unions, and no replay fallback. Add explicit live smoke that prints source status/receipt metadata and exits nonzero on required-source failure.
- [ ] Run `npm run typecheck && npm test && npm run build`; then `npm run live-smoke`. Record which real sources succeeded and exact observation time. If the live source fails, report unavailable and retain functioning labelled replay; do not declare live verification passed.

### Task 3: Build autonomous loop, journal, and safe recovery

**Files:** engine/scheduler/storage files; `tests/unit/{engine,scheduler,storage,transfer}.test.ts`; `tests/integration/autonomy.test.ts`.

**Interfaces:** Consumes validated domain functions and PublicSourceClient. Produces `runScan`, `createScheduler`, persistence and import/export functions for the UI.

- [ ] Write failing engine tests: scan fresh then repeat produces one fill and no duplicate record; deterministic candidate ordering; replay/live isolation; open position blocks second entry; one new quote marks/automatically exits; a gap exits at observed bid, not the threshold; unavailable quote leaves last mark labelled stale and produces no invented close; restart never treats missed elapsed intervals as observed fills.
- [ ] Write failing fake-clock scheduler tests: repeated Start has one timer/inflight request; Stop aborts/invalidates late results; stale response from previous generation cannot write; listing-scan cadence 5m with at most three sequential candidate pair lookups and open-position marks 60s; request spacing >=1s; suspension/resume does not fan out missed work; on reload runtime is stopped.
- [ ] Run `npm run test:unit -- engine scheduler` and verify red. Implement immutable, idempotent state transitions and one active scheduler generation, with atomic validated write-before-publish journal updates. Keep per-decision actions autonomous.
- [ ] Write failing storage/import tests: roundtrip preserves hash/accounting/mode; malformed JSON, malicious keys, oversize/depth/count, foreign version, forged totals/hash, duplicated IDs, and imported live/running flags cannot activate trading or corrupt current state. Simulate quota failure and interrupted writes; previous valid journal remains recoverable.
- [ ] Run `npm run test:unit -- storage transfer` and verify red. Implement staged validation, last-valid backup, non-destructive corruption recovery, explicit reset confirmation contract, and separate read-only imported replay. Recalculate verification hashes/accounting rather than trusting imported derived totals.
- [ ] Add integration test starting with an empty stopped journal, running one confirmed scan and one exit quote, exporting/importing, and proving exact final cash/decision hash. Add source failure followed by recovery with no duplicate fill.
- [ ] Run `npm run typecheck && npm test && npm run replay -- --case confirmed`. All tests must pass with no real network required.

### Task 4: Deliver the responsive evidence notebook

**Files:** UI files, entrypoint/style/assets; `tests/e2e/notebook.spec.ts`; UI component tests where valuable.

**Interfaces:** Consumes engine/storage contracts only; does not reimplement policy in components. UI renders `DecisionRecord` checks/reasons, source receipts, decimal display helpers, and scheduler status.

- [ ] Write failing browser tests for: first visit clearly labels illustrative mode; Run replay shows source/date/identity, a paper fill, exact assumptions, and later outcome; Live desk Start/Stop uses autonomous actions; journal selection shows original record; export/import roundtrip; failed import keeps the visible existing journal.
- [ ] Write failing tests for keyboard navigation, labelled inputs/status live region, narrow 360px viewport, preserved focus after reset cancellation/import modal close, and Back/Forward/hash navigation without stale selected detail. Buttons must remain usable during loading and repeated clicks.
- [ ] Run `npm run test:e2e -- notebook` and verify meaningful UI failures. Build the editorial layout from the spec with real content and distinct mode/status labels, avoiding fake live statistics. Use text rendering for all source/import text.
- [ ] Add Method/about content explaining the explicit calendar-date heuristic, online-pair and source identity limits, 90s observation policy, synthetic replay provenance, modeled fees/slippage, next-observation exit behavior, local-only storage, and tab-open runtime limits.
- [ ] Inspect actual desktop/mobile screenshots and browser behavior, correct overflow, contrast, spacing, focus order, truncation, source links, and empty/error states. Test no external font/image requests are needed.
- [ ] Run `npm run typecheck && npm test && npm run test:e2e && npm run build`. Record tested viewport sizes and screenshot paths for later demo materials.

### Task 5: Harden the full app and verify CI

**Files:** adversarial/regression tests; `.github/workflows/ci.yml`; headers/config as needed; focused fixes only.

**Interfaces:** No new product surface. Pin the full build/test/security evidence before public release.

- [ ] Add browser adversarial tests for `<script>`, event-handler markup, javascript/data URLs, malicious imported object keys, source-content instruction text, huge text, quote/source timeout, late Stop responses, reload with a position, and reset cancellation/repetition. Assert zero execution and unchanged unrelated state.
- [ ] Run the tests red where defects exist, fix the smallest causes, rerun focused tests and full suite. Add an accessibility check for all four routes and verify reduced-motion behavior.
- [ ] Configure GitHub Actions on the selected Node LTS: `npm ci`, typecheck, unit/integration, build, browser tests; install Playwright browser dependencies through the official package path. Keep live smoke separate/non-flaky, with explicit manual invocation rather than silently substituting mocks.
- [ ] Run dependency audit and inspect lockfile/licenses; record current findings accurately. Review Worker bundle and proxy CPU strategy against Free-plan constraints without claiming measured production CPU if unmeasured. Verify no secrets/private profile artifacts are tracked.
- [ ] Obtain independent correctness/security review of policy chronology, identity, accounting, duplicate fills, import/storage, SSRF/XSS, and deployment config. Fix material findings with targeted failing regression tests before rerunning the full suite.
      Continue this final coherent checkpoint with the release documentation below before committing.

## Release documentation

English README/method/deployment/demo/submission notes; Russian manual; verified public deployment and explicit live-source smoke, with no fabricated availability or performance claims.

## Local verification record — 9 October 2026

- TypeScript, ESLint and production build passed.
- 138 unit/integration tests passed, including 72 proxy tests and 7 actual workerd runtime checks.
- 11 Chromium browser tests passed against the production Worker preview, including desktop/320px layout, axe checks, restart/cancellation, import/export, stale data and hostile text.
- Independent review covered chronology, exact accounting, scheduler generations, receipt consistency, fixed proxy routes and inert imported text. Material findings have regression tests.
- Dependency audit reported zero vulnerabilities after pinned transitive development-tool updates.
- Live upstream evidence and an end-to-end paper-journal scan were checked separately from the synthetic fixtures.
- Native workerd outbound DNS was unavailable in the restricted build sandbox; live direct-Node source/ledger checks succeeded and the limitation is separate from mocked runtime/browser coverage.
- Remote CI and the deployed public URL require their own verification; these local results do not claim publication.
