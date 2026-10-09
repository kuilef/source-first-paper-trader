import { emptyJournal, runScan } from "../src/agent/engine";
import { JSDOM } from "jsdom";
import { createPublicClient, loadLiveEvidence } from "../src/sources/client";
import { evaluate } from "../src/domain/policy";
import type { EvidenceBundle } from "../src/domain/types";
Object.assign(globalThis, { DOMParser: new JSDOM("").window.DOMParser });
const origin = process.argv[2];
const nativeFetch = globalThis.fetch;
const direct = async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), "http://localhost");
  let url: string;
  if (path.pathname === "/api/listings")
    url = "https://blog.kraken.com/category/product/asset-listings/feed";
  else
    url = `https://api.kraken.com/0/public/${path.pathname === "/api/pairs" ? "AssetPairs" : "Ticker"}?${path.pathname === "/api/pairs" ? "assetVersion=1&" : ""}${path.searchParams}`;
  const response = await nativeFetch(
    origin ? new URL(String(input), origin) : url,
    init,
  );
  if (origin) return response;
  const headers = new Headers(response.headers);
  headers.set("x-source-url", url);
  headers.set("x-source-observed-at", new Date().toISOString());
  const age = response.headers.get("age");
  if (age) headers.set("x-source-age", age);
  return new Response(response.body, { status: response.status, headers });
};
const inputs = await loadLiveEvidence(
  createPublicClient({ fetch: direct }),
  new Date().toISOString(),
);
const now = new Date().toISOString();
for (const c of inputs.candidates) {
  const bundle: EvidenceBundle = {
    schemaVersion: 1,
    mode: "live",
    evaluatedAt: now,
    parserVersion: "kraken-rss-v1",
    policyVersion: "policy-v1",
    intent: "scan",
    claim: {
      text: c.announcement.title,
      assetName: null,
      symbol: c.announcement.symbol || null,
      venue: "kraken",
      eventType: "spot-listing",
      source: "official-feed",
    },
    announcement: c.announcement,
    pair: c.pair,
    quote: c.quote,
    sourceReceipts: [
      c.announcement.receipt,
      ...(c.pair ? [c.pair.receipt] : []),
      ...(c.quote ? [c.quote.receipt] : []),
    ],
    portfolioBefore: {
      cash: "1000",
      realizedPnl: "0",
      position: null,
      seenEvents: [],
    },
  };
  console.log(
    JSON.stringify({
      source: c.announcement.url,
      publishedAt: c.announcement.publishedAt,
      eventDate: c.announcement.explicitTradingDate,
      assetName: c.announcement.assetName,
      symbol: c.announcement.symbol,
      pair: c.pair?.key ?? null,
      quoteObservedAt: c.quote?.observedAt ?? null,
      checkedAt: now,
      action: evaluate(bundle).action,
      reasons: evaluate(bundle).reasons,
    }),
  );
}
if (!inputs.candidates.length || inputs.candidates.every((c) => !c.quote)) {
  process.exitCode = 1;
  console.error("Required live evidence unavailable; no fixture fallback.");
}

const journal = (await runScan(emptyJournal("live"), inputs, now)).state;
console.log(
  JSON.stringify({
    paperOnly: true,
    journalRecords: journal.records.length,
    openVirtualPositions: journal.portfolio.position ? 1 : 0,
    virtualCash: journal.portfolio.cash,
    recordIds: journal.records.map((r) => r.id),
  }),
);
