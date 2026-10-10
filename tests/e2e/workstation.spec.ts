import {
  test,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Keep the original notebook.spec.ts regression assertions unchanged. These
// captures exercise the public UI; mocked live receipts exist only in this test.
const SCREENSHOT_DIR = "artifacts/screenshots/redesign";
const WIDTHS = [320, 390, 768, 1024, 1440] as const;
const LIVE_TIME = new Date("2026-10-09T12:00:00.000Z");
const VIEW_HEIGHT = 900;
const STATES = [
  {
    id: "01-replay-before-run",
    label: "Replay lab before any replay",
    route: "replay",
    origin: "Empty local replay workspace",
  },
  {
    id: "02-replay-confirmed-entry-exit",
    label: "Confirmed replay with entry and exit",
    route: "replay",
    origin: "Existing confirmed illustrative scenario run through the UI",
  },
  {
    id: "03-replay-recycled-abstention",
    label: "Recycled announcement abstention",
    route: "replay",
    origin: "Existing recycled illustrative scenario run through the UI",
  },
  {
    id: "04-live-stopped-empty",
    label: "Live desk stopped with an empty journal",
    route: "live",
    origin: "Empty local live workspace; agent never started",
  },
  {
    id: "05-live-scanning",
    label: "Live desk reading sources",
    route: "live",
    origin: "Start agent with an intercepted listing request held pending",
  },
  {
    id: "06-live-watching",
    label: "Live desk watching after successful scan",
    route: "live",
    origin: "Existing mock-live XML and Kraken JSON response patterns",
  },
  {
    id: "07-live-source-error",
    label: "Live desk source error",
    route: "live",
    origin: "Intercepted listing request returns HTTP 503",
  },
  {
    id: "08-live-stopped-open-position",
    label: "Stopped live desk with a persisted open virtual position",
    route: "live",
    origin: "Mocked live scan, Stop, then genuine local journal reload",
  },
  {
    id: "09-journal-multiple-records",
    label: "Journal with two selectable records",
    route: "journal",
    origin: "Existing confirmed illustrative replay, then Journal navigation",
  },
  {
    id: "10-journal-imported-verified",
    label: "Verified imported read-only journal",
    route: "journal",
    origin: "UI-exported confirmed replay reimported through verification",
  },
  {
    id: "11-method",
    label: "Method documentation and original sources",
    route: "method",
    origin: "Unmodified real application route",
  },
] as const;
type VisualState = (typeof STATES)[number];

function captureName(state: string, width: number) {
  return `${state}-${width}x${VIEW_HEIGHT}`;
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await writeFile(
    join(SCREENSHOT_DIR, "manifest.json"),
    JSON.stringify(
      {
        description:
          "Required redesign visual coverage: 11 UI states at five widths.",
        note: "This is the expected capture inventory, not a test-pass claim. A successful capture writes an adjacent .capture.json receipt and attaches the PNG to its Playwright result. Additional regression captures use the same receipt format.",
        widths: WIDTHS,
        viewportHeight: VIEW_HEIGHT,
        expectedRequiredCaptures: STATES.length * WIDTHS.length,
        captures: STATES.flatMap((state) =>
          WIDTHS.map((width) => ({
            state: state.id,
            label: state.label,
            route: state.route,
            dataOrigin: state.origin,
            viewport: { width, height: VIEW_HEIGHT },
            screenshot: `${captureName(state.id, width)}.png`,
            receipt: `${captureName(state.id, width)}.capture.json`,
          })),
        ),
      },
      null,
      2,
    ) + "\n",
  );
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // A missing mock must fail honestly rather than accidentally query live data.
  // Specific mockLive routes registered later take precedence.
  await page.route("**/api/**", (route) => route.abort("blockedbyclient"));
});

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.viewport,
  );
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.viewport,
  );
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  state: string,
  width: number,
  label: string,
  origin: string,
  fullPage = true,
) {
  const name = captureName(state, width);
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage, animations: "disabled" });
  await writeFile(
    join(SCREENSHOT_DIR, `${name}.capture.json`),
    JSON.stringify(
      {
        state,
        label,
        screenshot: `${name}.png`,
        capturedAt: new Date().toISOString(),
        viewport: page.viewportSize(),
        fullPage,
        route: new URL(page.url()).hash || "#replay (default)",
        dataOrigin: origin,
        test: testInfo.title,
        project: testInfo.project.name,
      },
      null,
      2,
    ) + "\n",
  );
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Reuses the synthetic source responses from notebook.spec.ts, including the
// original-source receipt headers and actual parser/client/scheduler pipeline.
async function mockLive(
  page: Page,
  options: { holdListings?: boolean; failListings?: boolean } = {},
) {
  await page.clock.install({ time: LIVE_TIME });
  const gate = deferred();
  let listingRequests = 0;
  let tickerRequests = 0;
  if (!options.holdListings) gate.release();
  const receipt = async (url: string) => ({
    "x-source-url": url,
    "x-source-observed-at": await page.evaluate(() => new Date().toISOString()),
    "x-source-age": "0",
  });
  await page.route("**/api/listings", async (route) => {
    listingRequests++;
    await gate.promise;
    try {
      if (options.failListings) {
        await route.fulfill({ status: 503, body: "offline" });
        return;
      }
      await route.fulfill({
        headers: await receipt(
          "https://blog.kraken.com/category/product/asset-listings/feed",
        ),
        body: '<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>ZCHF is available for trading!</title><link>https://blog.kraken.com/product/asset-listings/zchf-is-available-for-trading</link><pubDate>Thu, 08 Oct 2026 15:53:48 +0000</pubDate><content:encoded><![CDATA[<p>ZCHF trading is live as of October 8, 2026.</p><h3>Frankencoin (ZCHF)</h3>]]></content:encoded></item></channel></rss>',
      });
    } catch (error) {
      // Stop aborts a deliberately gated request. Do not hide genuine failures
      // in normal, non-gated fixture setup.
      if (!options.holdListings) throw error;
    }
  });
  await page.route("**/api/pairs?*", async (route) =>
    route.fulfill({
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
  await page.route("**/api/ticker?*", async (route) => {
    tickerRequests++;
    await route.fulfill({
      headers: await receipt(
        "https://api.kraken.com/0/public/Ticker?pair=ZCHFUSD",
      ),
      json: { error: [], result: { ZCHFUSD: { a: ["10"], b: ["9.99"] } } },
    });
  });
  return {
    releaseListings: gate.release,
    listingRequests: () => listingRequests,
    tickerRequests: () => tickerRequests,
  };
}

async function runConfirmedReplay(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Evidence before action." }),
  ).toBeVisible();
  await page.getByLabel("Replay scenario").selectOption("confirmed");
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  await expect(page.getByTestId("record-count")).toHaveText("2");
  await expect(
    page.getByRole("button", { name: /Inspect paper-buy/ }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /Inspect paper-close/ }),
  ).toHaveCount(1);
  await expect(page.getByTestId("realized")).toHaveText("$2.23");
}

async function exportedJournal(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export journal" }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

async function startWatching(page: Page) {
  await page.goto("/#live");
  await page.getByRole("button", { name: "Start live agent" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Watching", {
    timeout: 10000,
  });
  await expect(page.getByTestId("record-count")).toHaveText("1");
  await expect(
    page.getByRole("complementary", { name: "Paper portfolio" }),
  ).toContainText("Frankencoin · ZCHF");
}

async function enterState(
  page: Page,
  state: VisualState,
): Promise<(() => Promise<void>) | undefined> {
  switch (state.id) {
    case "01-replay-before-run":
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Evidence before action." }),
      ).toBeVisible();
      await expect(page.getByTestId("record-count")).toHaveText("0");
      await expect(
        page.getByText("Illustrative replay · synthetic prices", {
          exact: true,
        }),
      ).toBeVisible();
      return;
    case "02-replay-confirmed-entry-exit":
      await runConfirmedReplay(page);
      await page.getByRole("button", { name: /Inspect paper-close/ }).click();
      await expect(page.getByRole("article")).toContainText("paper-close");
      await expect(page.getByRole("article")).toContainText("Modeled exit");
      return;
    case "03-replay-recycled-abstention":
      await page.goto("/");
      await page.getByLabel("Replay scenario").selectOption("recycled");
      await page
        .getByRole("button", { name: "Run illustrative replay" })
        .click();
      await expect(page.getByTestId("record-count")).toHaveText("1");
      await expect(
        page.getByRole("article").getByText("EVENT_TOO_OLD", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("article")).toContainText("abstain");
      return;
    case "04-live-stopped-empty":
      await page.goto("/#live");
      await expect(page.getByTestId("agent-status")).toHaveText("Stopped");
      await expect(page.getByTestId("record-count")).toHaveText("0");
      await expect(
        page.getByRole("button", { name: "Start live agent" }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Stop agent" }),
      ).toBeDisabled();
      await expect(
        page.getByText("Not observed", { exact: false }).first(),
      ).toBeVisible();
      return;
    case "05-live-scanning": {
      const live = await mockLive(page, { holdListings: true });
      await page.goto("/#live");
      await page.getByRole("button", { name: "Start live agent" }).click();
      await expect.poll(live.listingRequests).toBe(1);
      await expect(page.getByTestId("agent-status")).toContainText(
        "Reading sources",
      );
      await expect(
        page.getByRole("button", { name: "Agent running" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Stop agent" }),
      ).toBeEnabled();
      await expect(page.getByTestId("record-count")).toHaveText("0");
      return async () => {
        await page.getByRole("button", { name: "Stop agent" }).click();
        live.releaseListings();
        await expect(page.getByTestId("agent-status")).toHaveText("Stopped");
        await expect(page.getByTestId("record-count")).toHaveText("0");
      };
    }
    case "06-live-watching":
      await mockLive(page);
      await startWatching(page);
      await expect(
        page.getByRole("button", { name: "Agent running" }),
      ).toBeDisabled();
      return async () => {
        await page.getByRole("button", { name: "Stop agent" }).click();
      };
    case "07-live-source-error":
      await mockLive(page, { failListings: true });
      await page.goto("/#live");
      await page.getByRole("button", { name: "Start live agent" }).click();
      await expect(page.getByTestId("agent-status")).toHaveText(
        "Source or storage error",
        { timeout: 10000 },
      );
      await expect(page.getByTestId("record-count")).toHaveText("0");
      await expect(
        page.getByText("Live observations · virtual positions", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Live agent controls and runtime" }),
      ).toContainText("503");
      return async () => {
        await page.getByRole("button", { name: "Stop agent" }).click();
      };
    case "08-live-stopped-open-position":
      await mockLive(page);
      await startWatching(page);
      await page.getByRole("button", { name: "Stop agent" }).click();
      await page.reload();
      await expect(page.getByTestId("agent-status")).toHaveText("Stopped");
      await expect(page.getByTestId("record-count")).toHaveText("1");
      await expect(
        page.getByText(/An open virtual position is paused/),
      ).toBeVisible();
      await expect(
        page.getByRole("complementary", { name: "Paper portfolio" }),
      ).toContainText("Frankencoin · ZCHF");
      return;
    case "09-journal-multiple-records":
      await runConfirmedReplay(page);
      await page.getByRole("link", { name: "Journal", exact: true }).click();
      await expect(page.getByLabel("Journal workspace")).toHaveValue(
        "illustrative-replay",
      );
      await page.getByRole("button", { name: /Inspect paper-buy/ }).click();
      await expect(page.getByRole("article")).toContainText("Modeled entry");
      await expect(page.getByTestId("record-count")).toHaveText("2");
      return;
    case "10-journal-imported-verified": {
      await runConfirmedReplay(page);
      const journal = await exportedJournal(page);
      await page.getByRole("link", { name: "Journal", exact: true }).click();
      await page.getByLabel("Import journal").setInputFiles({
        name: "verified-replay.json",
        mimeType: "application/json",
        buffer: journal,
      });
      await expect(
        page.getByText("Imported journal · read only", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          /Import verified by recomputing every decision, hash and ledger total/,
        ),
      ).toBeVisible();
      await expect(page.getByLabel("Journal workspace")).toHaveValue(
        "imported",
      );
      await expect(page.getByTestId("record-count")).toHaveText("2");
      await expect(
        page.getByRole("button", { name: "Start live agent" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Run illustrative replay" }),
      ).toHaveCount(0);
      return;
    }
    case "11-method":
      await page.goto("/#method");
      await expect(
        page.getByRole("heading", { name: "A clear method. Honest limits." }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Download.*logo/i }),
      ).toHaveAttribute("href", "/logo.png");
      return;
  }
}

for (const width of WIDTHS) {
  test.describe(`redesign state matrix at ${width}px`, () => {
    test.use({ viewport: { width, height: VIEW_HEIGHT } });
    for (const state of STATES) {
      test(state.label, async ({ page }, testInfo) => {
        const cleanup = await enterState(page, state);
        try {
          await expect(
            page.getByRole("region", { name: "Paper-trading notice" }),
          ).toBeVisible();
          await expect(
            page.locator(`nav a[href="#${state.route}"]`),
          ).toHaveAttribute("aria-current", "page");
          await expectNoPageOverflow(page);
          await expectAccessible(page);
          await page.evaluate(() => window.scrollTo(0, 0));
          await capture(
            page,
            testInfo,
            state.id,
            width,
            state.label,
            state.origin,
          );
        } finally {
          await cleanup?.();
        }
      });
    }
  });
}

async function expectWithinFirstViewport(locator: Locator, label: string) {
  await expect(locator, label).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds, label).not.toBeNull();
  expect(bounds!.x, `${label} starts inside viewport`).toBeGreaterThanOrEqual(
    0,
  );
  expect(bounds!.y, `${label} starts inside viewport`).toBeGreaterThanOrEqual(
    0,
  );
  expect(bounds!.x + bounds!.width, `${label} right edge`).toBeLessThanOrEqual(
    1440,
  );
  expect(
    bounds!.y + bounds!.height,
    `${label} fully visible without scrolling`,
  ).toBeLessThanOrEqual(900);
}

test("Live operational controls, portfolio and beginning of evidence fit in the first 1440×900 screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockLive(page);
  for (const populated of [false, true]) {
    if (populated) await startWatching(page);
    else await page.goto("/#live");
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const [locator, label] of [
      [page.getByRole("link", { name: "Source-First home" }), "Brand"],
      [
        page.getByRole("navigation", { name: "Primary navigation" }),
        "Navigation",
      ],
      [
        page.getByRole("region", { name: "Paper-trading notice" }),
        "Paper-only disclosure",
      ],
      [
        page.getByRole("heading", { name: "The live evidence desk." }),
        "Live desk heading",
      ],
      [page.getByTestId("agent-status"), "Agent status"],
      [page.locator("#start-agent"), "Start agent control"],
      [page.getByRole("button", { name: "Stop agent" }), "Stop agent control"],
      [
        page.getByRole("complementary", { name: "Paper portfolio" }),
        "Paper portfolio",
      ],
      [
        page.getByRole("article").getByRole("heading").first(),
        "Beginning of evidence workspace",
      ],
    ] as const)
      await expectWithinFirstViewport(locator, label);
    await expectNoPageOverflow(page);
    await capture(
      page,
      testInfo,
      populated ? "live-first-screen-watching" : "live-first-screen-stopped",
      1440,
      "First-viewport operational composition",
      "Public UI with existing mock-live fixtures where populated",
      false,
    );
  }
  await page.getByRole("button", { name: "Stop agent" }).click();
});

for (const width of WIDTHS) {
  test(`all six replay scenarios retain their actions and reasons at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: VIEW_HEIGHT });
    await page.goto("/");
    const scenarios = [
      ["confirmed", "VERIFIED_FRESH_LISTING"],
      ["recycled", "EVENT_TOO_OLD"],
      ["identity-conflict", "IDENTITY_CONFLICT"],
      ["future", "EVENT_FUTURE"],
      ["stale-quote", "QUOTE_STALE"],
      ["wide-spread", "SPREAD_TOO_WIDE"],
    ] as const;
    await expect(
      page.getByLabel("Replay scenario").locator("option"),
    ).toHaveCount(scenarios.length);
    for (const [scenario, reason] of scenarios) {
      await page.getByLabel("Replay scenario").selectOption(scenario);
      await page
        .getByRole("button", { name: "Run illustrative replay" })
        .click();
      const confirmed = scenario === "confirmed";
      await expect(page.getByTestId("record-count")).toHaveText(
        confirmed ? "2" : "1",
      );
      await expect(
        page.getByRole("article").getByText(reason, { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("article")).toContainText(
        confirmed ? "paper-buy" : "abstain",
      );
      await expect(page.getByTestId("realized")).toHaveText(
        confirmed ? "$2.23" : "$0.00",
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(
        page.getByText(/Illustrative evidence and synthetic prices/),
      ).toBeVisible();
      await expectNoPageOverflow(page);
    }
  });
}

test("keyboard activation transfers focus away from newly disabled runtime controls and survives scans", async ({
  page,
}) => {
  const live = await mockLive(page, { holdListings: true });
  await page.goto("/#live");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Start live agent" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Agent running" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop agent" })).toBeFocused();
  live.releaseListings();
  await expect(page.getByTestId("agent-status")).toHaveText("Watching", {
    timeout: 10000,
  });
  await expect(page.getByRole("button", { name: "Stop agent" })).toBeFocused();

  const policy = page.locator("summary").filter({ hasText: /^Policy checks/ });
  await policy.focus();
  await page.keyboard.press("Enter");
  await expect(policy.locator("..")).toHaveAttribute("open", "");
  await page.clock.fastForward(61000);
  await expect(page.getByTestId("record-count")).toHaveText("2", {
    timeout: 10000,
  });
  await expect(page.getByTestId("agent-status")).toHaveText("Watching");
  await expect(policy).toBeFocused();
  await expect(policy.locator("..")).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: /Inspect mark/ })).toHaveCount(
    1,
  );

  await page.getByRole("button", { name: "Stop agent" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Stop agent" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start live agent" }),
  ).toBeFocused();
  await expect(page.getByTestId("agent-status")).toHaveText("Stopped");
});

test("expanded evidence survives reselecting its current record and long provenance stays bounded", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: VIEW_HEIGHT });
  await runConfirmedReplay(page);
  const currentRecord = page.getByRole("button", { name: /Inspect paper-buy/ });
  const policy = page.locator("summary").filter({ hasText: /^Policy checks/ });
  const provenance = page
    .locator("summary")
    .filter({ hasText: "Snapshot & provenance" });
  await policy.click();
  await provenance.click();
  await currentRecord.focus();
  await page.keyboard.press("Enter");
  await expect(currentRecord).toBeFocused();
  await expect(policy.locator("..")).toHaveAttribute("open", "");
  await expect(provenance.locator("..")).toHaveAttribute("open", "");
  await expect(page.locator(".hash")).toHaveText(/^[a-f0-9]{64}$/);
  await expect(
    page.getByText(
      /Quote timestamps describe successful response observation, not exchange trades/,
    ),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await expectAccessible(page);
  await capture(
    page,
    testInfo,
    "evidence-expanded-provenance",
    320,
    "Populated evidence with expanded policy checks and full SHA-256 provenance",
    "Existing confirmed illustrative replay",
  );
});

test("a storage write failure preserves the live error state and never implies a saved position", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: VIEW_HEIGHT });
  await mockLive(page);
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("source-first-v1:"))
        throw new DOMException(
          "Test storage quota exhausted",
          "QuotaExceededError",
        );
      return setItem.call(this, key, value);
    };
  });
  await page.goto("/#live");
  await page.getByRole("button", { name: "Start live agent" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText(
    "Source or storage error",
    { timeout: 10000 },
  );
  await expect(
    page.getByRole("region", { name: "Live agent controls and runtime" }),
  ).toContainText("Journal not saved");
  await expect(page.getByTestId("record-count")).toHaveText("0");
  await expect(
    page.getByRole("complementary", { name: "Paper portfolio" }),
  ).toContainText("No open position");
  await expectNoPageOverflow(page);
  await expectAccessible(page);
  await capture(
    page,
    testInfo,
    "live-storage-error",
    390,
    "Live storage failure with unsaved journal clearly reported",
    "Existing mock-live responses with browser-local test quota failure",
  );
  await page.getByRole("button", { name: "Stop agent" }).click();
});

test("Journal selector preserves live, illustrative and verified read-only workspaces", async ({
  page,
}) => {
  await mockLive(page);
  await startWatching(page);
  await page.getByRole("button", { name: "Stop agent" }).click();
  await runConfirmedReplay(page);
  const replay = await exportedJournal(page);
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await page.getByLabel("Journal workspace").selectOption("live");
  await expect(page.getByTestId("record-count")).toHaveText("1");
  await expect(
    page.getByText("Live observations · virtual positions", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Journal workspace")
    .selectOption("illustrative-replay");
  await expect(page.getByTestId("record-count")).toHaveText("2");
  await page.getByLabel("Import journal").setInputFiles({
    name: "verified.json",
    mimeType: "application/json",
    buffer: replay,
  });
  await expect(page.getByLabel("Journal workspace")).toHaveValue("imported");
  await expect(
    page.getByLabel("Journal workspace").locator("option"),
  ).toHaveCount(3);
  await expect(
    page.getByText("Imported journal · read only", { exact: true }),
  ).toBeVisible();
  expect(JSON.parse((await exportedJournal(page)).toString())).toEqual(
    JSON.parse(replay.toString()),
  );
  await page.getByLabel("Journal workspace").selectOption("live");
  await expect(page.getByTestId("record-count")).toHaveText("1");
  const verifiedNotice = page.getByText(
    /Import verified by recomputing every decision, hash and ledger total/,
  );
  await expect(verifiedNotice).toHaveCount(0);
  await page.getByLabel("Journal workspace").selectOption("imported");
  await expect(page.getByTestId("record-count")).toHaveText("2");
  await expect(verifiedNotice).toBeVisible();
  await page.getByLabel("Import journal").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"__proto__":{}}'),
  });
  await expect(page.getByRole("alert")).toContainText("Import rejected");
  await expect(
    page.getByText("Imported journal · read only", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("record-count")).toHaveText("2");
});

test("keyboard replay activation restores focus after the disabled running state", async ({
  page,
}) => {
  await page.goto("/");
  const run = page.getByRole("button", { name: "Run illustrative replay" });
  await run.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("record-count")).toHaveText("2");
  await expect(run).toBeEnabled();
  await expect(run).toBeFocused();
  await page.getByLabel("Replay scenario").selectOption("recycled");
  await run.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("record-count")).toHaveText("1");
  await expect(run).toBeFocused();
});

test("decision accessible names include visible asset identity and reason codes", async ({
  page,
}) => {
  await runConfirmedReplay(page);
  await expect(
    page.getByRole("button", { name: /^Inspect paper-buy ZCHF 1/ }),
  ).toHaveAccessibleName(/Frankencoin.*VERIFIED_FRESH_LISTING/);
  await expect(
    page.getByRole("button", { name: /^Inspect paper-close ZCHF 2/ }),
  ).toHaveAccessibleName(/Frankencoin.*TAKE_PROFIT/);
  await page.getByLabel("Replay scenario").selectOption("recycled");
  await page.getByRole("button", { name: "Run illustrative replay" }).click();
  await expect(
    page.getByRole("button", { name: /^Inspect abstain ZCHF 1/ }),
  ).toHaveAccessibleName(/Frankencoin.*EVENT_TOO_OLD/);
});

for (const [route, heading] of [
  ["replay", "Evidence before action."],
  ["live", "The live evidence desk."],
  ["journal", "All decisions leave a trace."],
  ["method", "A clear method. Honest limits."],
] as const) {
  test(`Skip to content keeps the ${route} route and focuses main`, async ({
    page,
  }) => {
    await page.goto("/#" + route);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp("#" + route + "$"));
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("main")).toBeFocused();
    await expect(page.locator(`nav a[href="#${route}"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
}

test("closing an imported read-only view uses accurate confirmation and preserves local journals", async ({
  page,
}) => {
  await runConfirmedReplay(page);
  const replay = await exportedJournal(page);
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await page
    .getByLabel("Import journal")
    .setInputFiles({
      name: "verified.json",
      mimeType: "application/json",
      buffer: replay,
    });
  const close = page.getByRole("button", { name: "Close imported view" });
  await expect(close).toBeVisible();
  let prompt = "";
  page.once("dialog", async (dialog) => {
    prompt = dialog.message();
    await dialog.dismiss();
  });
  await close.click();
  expect(prompt).toMatch(/clos.*import.*read.only/i);
  expect(prompt).not.toContain("Reset this local workspace");
  await expect(page.getByLabel("Journal workspace")).toHaveValue("imported");
  await expect(page.getByTestId("record-count")).toHaveText("2");
  await expect(close).toBeFocused();
  page.once("dialog", (dialog) => dialog.accept());
  await close.click();
  await expect(page.getByLabel("Journal workspace")).toHaveValue(
    "illustrative-replay",
  );
  await expect(
    page.getByLabel("Journal workspace").locator('option[value="imported"]'),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      /Import verified by recomputing every decision, hash and ledger total/,
    ),
  ).toHaveCount(0);
  await expect(page.getByTestId("record-count")).toHaveText("2");
  expect(JSON.parse((await exportedJournal(page)).toString())).toEqual(
    JSON.parse(replay.toString()),
  );
});
