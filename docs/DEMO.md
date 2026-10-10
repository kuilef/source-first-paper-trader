# Demo and submission notes

## A 90-second demonstration

- 0–15s: Show the paper-only banner and Replay lab. Explain that this is a deterministic research agent, with synthetic illustrative prices and no real trading endpoint.
- 15–35s: Run the fresh-listing case. Inspect the original full name/symbol, separate article and trading dates, current pair status, and the policy checks. The agent opens a virtual position without a manual trade-entry command.
- 35–50s: Select the later close in the decision trail. Show modeled bid-side fill, fee and exact net proceeds. Explain next-observation exits and gaps.
- 50–65s: Run the recycled-announcement case. Highlight EVENT_TOO_OLD: a new publication does not reset the stated trading date.
- 65–80s: Export and re-import the journal. The imported view is read only and recalculates hashes, decisions and balances. A fingerprint is not proof of authenticity.
- 80–90s: Open Live desk. Start or show a current real scan only when sources are reachable; otherwise show the honest source error. Explain tab-open operation and Stop.

Recording assets: desktop/mobile screenshots are emitted by the browser test suite under `artifacts/screenshots/`. The workstation visual suite captures all 11 required application states at 320, 390, 768, 1024 and 1440px under `artifacts/screenshots/redesign/`, with an inventory and per-capture receipts. The suite uses actual UI flows and explicit test-only source mocks; those mocks are not part of the production interface. The deployed Method page links `/logo.png`. Do not narrate illustrative quotes as historical prices or claim a source was live without checking its current receipt.

## Suggested project description

Source-First Paper Trader is a rule-based research agent that turns original market evidence into auditable practice decisions. It checks Kraken's official listing announcements against public pair and ticker data, separates publication time from the actual stated trading date, and resolves a full asset name and symbol within one venue. When transparent eligibility, freshness and risk checks pass, it opens a small virtual position; otherwise it records a reasoned abstention. Subsequent observed quotes mark or close the paper position.

Every action retains normalized evidence, original-source links, short excerpts, observation receipts, policy checks and exact decimal accounting. A bounded JSON export/import flow recomputes the full decision and portfolio chain. The UI includes clearly labelled synthetic replays and a live observer that runs while the page is open.

## Technical summary

- TypeScript/Vite browser application; no external font, model service or analytics.
- Deterministic parser and versioned policy; Decimal.js accounting and SHA-256 fingerprints.
- Small Cloudflare Pages Worker with fixed, read-only Kraken routes, byte/time bounds and honest cache receipts.
- Separate live, illustrative and read-only imported workspaces; local-only journal storage.
- Unit, parser, security, real workerd, interrupted lifecycle, browser and accessibility checks.

## Scope disclosures

This project makes practice decisions only. It uses no wallet, exchange authentication, real order endpoint, RYO SDK, LLM, blockchain contract or paid data API. It demonstrates the evidence-to-practice-decision pattern. It does not claim eligibility for every similarly named event, sponsor endorsement, decentralization, model training, historical profitability, commercial traction or a guaranteed prize.

Repository and deployment URLs must be copied from their verified published locations. Do not claim CI passed until the exact remote commit finishes successfully. Filling a project draft is separate from final submission; no final submission or legal acceptance is performed by this source code.
