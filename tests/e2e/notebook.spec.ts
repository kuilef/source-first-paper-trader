import cases from "../../fixtures/cases.json" with { type: "json" };
import { validateBundle } from "../../src/domain/schema";
import { emptyJournal, runScan } from "../../src/agent/engine";
import { exportJournal } from "../../src/storage/journal";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("frozen replay shows automatic entry, exit, evidence and reproducible import", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Evidence before action." }),
  ).toBeVisible();
  await expect(
    page.getByText("Illustrative replay · synthetic prices", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  await expect(page.getByTestId("record-count")).toHaveText("2");
  await expect(page.getByTestId("realized")).toContainText("2.23");
  await page.getByRole("button", { name: /Inspect paper-buy/ }).click();
  await expect(
    page.getByText("2026-10-08 · day precision", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Frankencoin · ZCHF", { exact: true }).first(),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export journal" }).click();
  const file = await download;
  await file.saveAs("test-results/replay.json");
  await page
    .getByLabel("Import journal")
    .setInputFiles("test-results/replay.json");
  await expect(
    page.getByText("Imported journal · read only", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Import journal").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"__proto__":{}}'),
  });
  await expect(page.getByRole("alert")).toContainText("Import rejected");
  await expect(page.getByTestId("record-count")).toHaveText("2");
});
test("old event abstains and repeated replay does not accumulate records", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Replay scenario").selectOption("recycled");
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  await expect(page.getByTestId("record-count")).toHaveText("1");
  await expect(
    page.getByRole("article").getByText("EVENT_TOO_OLD", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  await expect(page.getByTestId("record-count")).toHaveText("1");
});
test("reset cancellation keeps the journal and focus; navigation and reload stay stopped", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Reset workspace" }).click();
  await expect(page.getByTestId("record-count")).toHaveText("2");
  await expect(
    page.getByRole("button", { name: "Reset workspace" }),
  ).toBeFocused();
  await page.getByRole("link", { name: "Live desk", exact: true }).click();
  await page.reload();
  await expect(page.getByTestId("agent-status")).toContainText("Stopped");
  await page.getByRole("link", { name: "Method", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "The live evidence desk." }),
  ).toBeVisible();
});
test("four routes remain accessible and do not overflow at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const route of ["replay", "live", "journal", "method"]) {
    await page.goto("/#" + route);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }
});

async function mockLive(page: import("@playwright/test").Page) {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00.000Z") });
  const receipt = async (url: string) => ({
    "x-source-url": url,
    "x-source-observed-at": await page.evaluate(() => new Date().toISOString()),
    "x-source-age": "0",
  });
  await page.route("**/api/listings", async (r) =>
    r.fulfill({
      headers: await receipt(
        "https://blog.kraken.com/category/product/asset-listings/feed",
      ),
      body: '<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>ZCHF is available for trading!</title><link>https://blog.kraken.com/product/asset-listings/zchf-is-available-for-trading</link><pubDate>Thu, 08 Oct 2026 15:53:48 +0000</pubDate><content:encoded><![CDATA[<p>ZCHF trading is live as of October 8, 2026.</p><h3>Frankencoin (ZCHF)</h3>]]></content:encoded></item></channel></rss>',
    }),
  );
  await page.route("**/api/pairs?*", async (r) =>
    r.fulfill({
      headers: await receipt(
        "https://api.kraken.com/0/public/AssetPairs?assetVersion=1&pair=ZCHFUSD",
      ),
      json: {
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
      },
    }),
  );
  await page.route("**/api/ticker?*", async (r) =>
    r.fulfill({
      headers: await receipt(
        "https://api.kraken.com/0/public/Ticker?pair=ZCHFUSD",
      ),
      json: { error: [], result: { ZCHFUSD: { a: ["10"], b: ["9.99"] } } },
    }),
  );
}
test("live scan opens one virtual position and reload/restart cannot duplicate entry", async ({
  page,
}) => {
  await mockLive(page);
  await page.goto("/#live");
  await page.getByRole("button", { name: "Start live agent" }).click();
  await expect(page.getByTestId("record-count")).toHaveText("1", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Stop agent" }).click();
  await page.reload();
  await expect(page.getByTestId("agent-status")).toContainText("Stopped");
  await expect(page.getByTestId("record-count")).toHaveText("1");
  await page.getByRole("button", { name: "Start live agent" }).click();
  await expect(page.getByTestId("agent-status")).toContainText("Watching", {
    timeout: 10000,
  });
  await expect(
    page.getByRole("button", { name: /Inspect paper-buy/ }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Stop agent" }).click();
});
test("live source failure is explicit and never silently switches to replay", async ({
  page,
}) => {
  await page.route("**/api/listings", (r) =>
    r.fulfill({ status: 503, body: "offline" }),
  );
  await page.goto("/#live");
  await page.getByRole("button", { name: "Start live agent" }).click();
  await expect(page.getByTestId("agent-status")).toContainText(
    "Source or storage error",
    { timeout: 10000 },
  );
  await expect(page.getByTestId("record-count")).toHaveText("0");
  await expect(
    page.getByText("Live observations · virtual positions", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop agent" }).click();
});
test("stop discards a late source response", async ({ page }) => {
  let release: () => void = () => {};
  let pending = false;
  await page.route("**/api/listings", async (r) => {
    pending = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await r.fulfill({ status: 503, body: "late" });
    } catch {
      /* Request was aborted by Stop. */
    }
  });
  await page.goto("/#live");
  await page.getByRole("button", { name: "Start live agent" }).click();
  await expect.poll(() => pending).toBe(true);
  await page.getByRole("button", { name: "Stop agent" }).click();
  release();
  await expect(page.getByTestId("agent-status")).toContainText("Stopped");
  await expect(page.getByTestId("record-count")).toHaveText("0");
});
test("keyboard navigation and populated evidence have no serious accessibility findings", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  await expect(page.getByTestId("record-count")).toHaveText("2");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
test("capture verified desktop and mobile release views", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Evidence before action." }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/desktop-intro.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  await expect(page.getByTestId("record-count")).toHaveText("2");
  await page.screenshot({
    path: "artifacts/screenshots/desktop-replay.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/screenshots/mobile-replay.png",
    fullPage: true,
  });
});

test("stale replay never creates a virtual position", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Replay scenario").selectOption("stale-quote");
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  await expect(
    page.getByRole("article").getByText("QUOTE_STALE", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Inspect paper-buy/ }),
  ).toHaveCount(0);
  await expect(page.getByTestId("realized")).toHaveText("$0.00");
});
test("verified hostile text stays inert and unsafe URLs cannot replace an import", async ({
  page,
}) => {
  const b = validateBundle(cases.confirmed);
  b.announcement.title = '<img src=x onerror="window.attack=1">';
  b.announcement.excerpt = "<script>window.attack=1</script>";
  const state = (
    await runScan(
      emptyJournal("illustrative-replay"),
      {
        mode: "illustrative-replay",
        candidates: [
          { announcement: b.announcement, pair: b.pair, quote: b.quote },
        ],
      },
      b.evaluatedAt,
    )
  ).state;
  await page.goto("/");
  await page.getByLabel("Import journal").setInputFiles({
    name: "inert.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportJournal(state)),
  });
  await expect(
    page.getByText("Imported journal · read only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(b.announcement.title, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { attack?: number }).attack),
  ).toBeUndefined();
  await expect(
    page.locator('img[src="x"],svg[onload],script:not([src])'),
  ).toHaveCount(0);
  const unsafe = structuredClone(state);
  unsafe.records[0].bundle.announcement.url = "javascript:alert(1)";
  await page.getByLabel("Import journal").setInputFiles({
    name: "bad-url.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(unsafe)),
  });
  await expect(page.getByRole("alert")).toContainText("Import rejected");
  await expect(page.getByTestId("record-count")).toHaveText("1");
});

test("Method downloads the same PNG logo through the application server", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Method", exact: true }).click();
  const logo = page.getByRole("link", { name: /Download.*logo/i });
  await expect(logo).toHaveAttribute("href", "/logo.png");
  const request = await page.request.get("/logo.png");
  expect(request.headers()["content-type"]).toBe("image/png");
  expect(request.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await request.body()).length).toBe(13136);
  const downloadPromise = page.waitForEvent("download");
  await logo.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
});
