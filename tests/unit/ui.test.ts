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
