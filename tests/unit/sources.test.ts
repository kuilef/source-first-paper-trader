// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  parseListingFeed,
  parsePairs,
  parseTicker,
} from "../../src/sources/kraken";
import cases from "../../fixtures/cases.json";
const fixture = cases.confirmed;
import type { PairSnapshot, SourceReceipt } from "../../src/domain/types";
const receipt = fixture.announcement.receipt as SourceReceipt;
const xml = (
  body = "ZCHF trading is live as of October 8, 2026.",
  name = "Frankencoin (ZCHF)",
  title = "ZCHF is available for trading!",
) =>
  `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>${title}</title><link>https://blog.kraken.com/product/asset-listings/zchf-is-available-for-trading</link><pubDate>Thu, 08 Oct 2026 15:53:48 +0000</pubDate><content:encoded><![CDATA[<p>${body}</p><h3>${name}</h3>]]></content:encoded></item></channel></rss>`;
describe("bounded official RSS interpreter", () => {
  it("extracts official identity, separate publication and actual event day", () => {
    const a = parseListingFeed(xml(), receipt)[0];
    expect(a.assetName).toBe("Frankencoin");
    expect(a.symbol).toBe("ZCHF");
    expect(a.explicitTradingDate).toBe("2026-10-08");
    expect(a.publishedAt).toBe("2026-10-08T15:53:48.000Z");
    expect(a.datePrecision).toBe("day");
    expect(a.sourceTimezone).toBe("unknown");
  });
  it("does not recycle publication date or infer missing year", () => {
    expect(
      parseListingFeed(
        xml("ZCHF trading is live as of October 5, 2026."),
        receipt,
      )[0].explicitTradingDate,
    ).toBe("2026-10-05");
    expect(
      parseListingFeed(xml("ZCHF trading is live as of October 8."), receipt)[0]
        .explicitTradingDate,
    ).toBeNull();
  });
  it("requires a full name binding and rejects unsupported wording", () => {
    expect(
      parseListingFeed(xml(undefined, "Unrelated (PNT)"), receipt)[0].assetName,
    ).toBe("");
    expect(
      parseListingFeed(
        xml(undefined, undefined, "ZCHF futures are available!"),
        receipt,
      )[0].supported,
    ).toBe(false);
  });
  it("never executes or retains article markup", () => {
    const a = parseListingFeed(
      xml(
        '<img src=x onerror="alert(1)"><script>throw new Error()</script>ZCHF trading is live as of October 8, 2026.',
      ),
      receipt,
    )[0];
    expect(a.excerpt).not.toMatch(/<|onerror|script/);
    expect(a.excerpt.split(/\s+/).length).toBeLessThanOrEqual(25);
  });
  it.each([
    "<!DOCTYPE x><rss/>",
    '<!ENTITY evil SYSTEM "file:///etc/passwd"><rss/>',
    "<rss><item>",
    "x".repeat(262145),
  ])("rejects unsafe/invalid/oversize XML", (s) =>
    expect(() => parseListingFeed(s, receipt)).toThrow(),
  );
  it("rejects external source URLs", () =>
    expect(() =>
      parseListingFeed(
        xml().replace(
          "https://blog.kraken.com/product/",
          "https://evil.test/product/",
        ),
        receipt,
      ),
    ).toThrow());
});
const pairRaw = {
  error: [],
  result: {
    "ZCHF/USD": {
      altname: "ZCHFUSD",
      wsname: "ZCHF/USD",
      base: "ZCHF",
      quote: "USD",
      status: "online",
      lot_decimals: 6,
      ordermin: "0.01",
      costmin: "0.5",
    },
  },
};
describe("Kraken public market parsing", () => {
  it("preserves canonical key and validates minimum quantity metadata", () => {
    const p = parsePairs(pairRaw, receipt)[0];
    expect(p.key).toBe("ZCHF/USD");
    expect(p.lotDecimals).toBe(6);
    expect(p.costMin).toBe("0.5");
  });
  it("uses b/a not last trade and records observation time only", () => {
    const p = parsePairs(pairRaw, receipt)[0];
    const q = parseTicker(
      {
        error: [],
        result: { ZCHFUSD: { a: ["10"], b: ["9.99"], c: ["500"] } },
      },
      p,
      receipt,
    );
    expect(q.ask).toBe("10");
    expect(q.bid).toBe("9.99");
    expect(q.exchangeTimestamp).toBeNull();
    expect(q.observedAt).toBe(receipt.observedAt);
  });
  it.each([
    { error: ["EAPI:Rate limit exceeded"], result: {} },
    { error: [], result: null },
    { result: {} },
  ])("rejects missing or failed responses", (j) =>
    expect(() => parsePairs(j, receipt)).toThrow(),
  );
  it("rejects crossed books, wrong pairs, ambiguous quote keys and nonfinite values", () => {
    const p = fixture.pair as PairSnapshot;
    for (const j of [
      { ZCHFUSD: { a: ["10"], b: ["11"] } },
      { OTHER: { a: ["10"], b: ["9"] } },
      { ZCHFUSD: { a: ["NaN"], b: ["9"] } },
      { ZCHFUSD: { a: ["10"], b: ["9"] }, "ZCHF/USD": { a: ["10"], b: ["9"] } },
    ])
      expect(() => parseTicker({ error: [], result: j }, p, receipt)).toThrow();
  });
});
