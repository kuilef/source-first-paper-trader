// @vitest-environment jsdom
import { beforeEach, it, expect, vi } from "vitest";
async function boot() {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  location.hash = "replay";
  await import("../../src/ui/App");
}
const click = (id: string) =>
  (document.getElementById(id) as HTMLButtonElement).click();
beforeEach(async () => {
  await boot();
});
it("renders the replay notebook and runs a saved entry/exit without network", async () => {
  expect(document.querySelector("h1")?.textContent).toBe(
    "Evidence before action.",
  );
  click("run-replay");
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-testid="record-count"]')?.textContent,
    ).toBe("2"),
  );
  expect(
    document.querySelector('[data-testid="realized"]')?.textContent,
  ).toContain("2.23");
  expect(document.querySelector("main")?.textContent).toContain(
    "day precision",
  );
  expect(localStorage.length).toBe(1);
});
it("keeps a cancelled reset and repeated replay deterministic", async () => {
  click("run-replay");
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-testid="record-count"]')?.textContent,
    ).toBe("2"),
  );
  vi.spyOn(window, "confirm").mockReturnValue(false);
  click("reset");
  expect(
    document.querySelector('[data-testid="record-count"]')?.textContent,
  ).toBe("2");
  click("run-replay");
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-testid="record-count"]')?.textContent,
    ).toBe("2"),
  );
  vi.restoreAllMocks();
});
it("explains an old event rejection in the selected frozen case", async () => {
  const select = document.querySelector("#scenario") as HTMLSelectElement;
  select.value = "recycled";
  select.dispatchEvent(new Event("change"));
  click("run-replay");
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-testid="record-count"]')?.textContent,
    ).toBe("1"),
  );
  expect(document.querySelector("main")?.textContent).toContain(
    "EVENT_TOO_OLD",
  );
});

it("keeps the selected decision and expanded evidence stable during rerenders", async () => {
  click("run-replay");
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".record-button")).toHaveLength(2),
  );
  expect(
    document.querySelector("#record-0")?.getAttribute("aria-pressed"),
  ).toBe("true");
  const checks = document.querySelector("details") as HTMLDetailsElement;
  checks.open = true;
  const trail = document.querySelector(".record-list ol") as HTMLElement;
  trail.scrollTop = 48;
  const summary = checks.querySelector("summary")!;
  summary.focus();
  click("record-0");
  expect(document.querySelector("details")?.open).toBe(true);
  expect(document.querySelector(".record-list ol")?.scrollTop).toBe(48);
  expect(document.activeElement?.tagName).toBe("SUMMARY");
  expect(
    document.querySelector("#record-0")?.getAttribute("aria-pressed"),
  ).toBe("true");
});

it("preserves focus on the original source link while the selected evidence rerenders", async () => {
  click("run-replay");
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".record-button")).toHaveLength(2),
  );
  const link = document.querySelector("article a") as HTMLAnchorElement;
  link.focus();
  click("record-0");
  expect(document.activeElement?.getAttribute("href")).toBe(
    link.getAttribute("href"),
  );
});

it("shows the actual runtime phase, an unknown scan time and no schedule while stopped", () => {
  location.hash = "live";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(
    document.querySelector(".operational-strip #start-agent"),
  ).not.toBeNull();
  expect(document.querySelector(".runtime-facts")?.textContent).toContain(
    "Last successful scanNot observed",
  );
  expect(document.querySelector(".runtime-facts")?.textContent).not.toContain(
    "Next scheduled",
  );
  expect(
    document.querySelector('[data-testid="agent-status"]')?.textContent,
  ).toBe("Stopped");
});

it("separates source dates and quote observations in the evidence facts", async () => {
  click("run-replay");
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".record-button")).toHaveLength(2),
  );
  const sheet = document.querySelector("article")!;
  expect(sheet.textContent).toContain("Article published");
  expect(sheet.textContent).toContain("Stated trading date");
  expect(sheet.textContent).toContain("Agent first saw event");
  expect(sheet.textContent).toContain("Quote response observed");
  expect(sheet.textContent).toContain("Synthetic bid / ask");
  expect(sheet.querySelector(".quote-note")?.textContent).toContain(
    "not exchange trade time",
  );
});

it("moves keyboard focus to the available agent control when its partner becomes disabled", () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
  location.hash = "live";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  document.getElementById("start-agent")!.focus();
  click("start-agent");
  expect(
    document.querySelector('[data-testid="agent-status"]')?.textContent,
  ).toBe("Reading sources…");
  expect(document.activeElement?.id).toBe("stop-agent");
  click("stop-agent");
  expect(document.activeElement?.id).toBe("start-agent");
  vi.restoreAllMocks();
});

it("restores keyboard focus after the replay control finishes its temporary disabled state", async () => {
  document.getElementById("run-replay")!.focus();
  click("run-replay");
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".record-button")).toHaveLength(2),
  );
  expect(document.activeElement?.id).toBe("run-replay");
});

it("exposes each decision's full identity and reasons in its accessible name", async () => {
  click("run-replay");
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".record-button")).toHaveLength(2),
  );
  const label = document.querySelector("#record-0")?.getAttribute("aria-label");
  expect(label).toContain("Frankencoin");
  expect(label).toContain("VERIFIED_FRESH_LISTING");
});

it("activates Skip to content without replacing the current navigation route", async () => {
  location.hash = "method";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  const skip = document.querySelector(".skip-link") as HTMLAnchorElement;
  skip.click();
  await vi.waitFor(() => expect(document.activeElement?.id).toBe("main"));
  expect(location.hash).toBe("#method");
  expect(document.querySelector("h1")?.textContent).toBe(
    "A clear method. Honest limits.",
  );
});
