import { describe, it, expect, vi } from "vitest";
import cases from "../../fixtures/cases.json";
import type { EvidenceBundle, ScanInputs } from "../../src/domain/types";
import { emptyJournal, runScan, createScheduler } from "../../src/agent/engine";
import {
  parseImport,
  exportJournal,
  loadJournal,
  saveJournal,
  journalKey,
} from "../../src/storage/journal";
const b = () => structuredClone(cases.confirmed) as EvidenceBundle;
const inputs = (): ScanInputs => ({
  mode: "illustrative-replay",
  candidates: [
    { announcement: b().announcement, pair: b().pair, quote: b().quote },
  ],
});
class MemoryStorage {
  data = new Map<string, string>();
  fail = false;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.fail) throw new Error("Quota");
    this.data.set(k, v);
  }
}
describe("autonomous journal", () => {
  it("records one entry per event even after a repeated scan and reload", async () => {
    const s = await runScan(
      emptyJournal("illustrative-replay"),
      inputs(),
      b().evaluatedAt,
    );
    expect(s.state.portfolio.position?.quantity).toBe("2.487552");
    const repeated = await runScan(
      s.state,
      inputs(),
      "2026-10-09T12:00:30.000Z",
    );
    expect(repeated.state.records).toHaveLength(1);
    expect(repeated.state.portfolio).toEqual(s.state.portfolio);
  });
  it("marks and closes only at a new observation, preserving exact net pnl", async () => {
    let s = (
      await runScan(
        emptyJournal("illustrative-replay"),
        inputs(),
        b().evaluatedAt,
      )
    ).state;
    const q = {
      ...b().quote!,
      bid: "11",
      ask: "11.01",
      observedAt: "2026-10-09T12:01:00.000Z",
      receipt: {
        ...b().quote!.receipt,
        observedAt: "2026-10-09T12:01:00.000Z",
      },
    };
    s = (
      await runScan(
        s,
        { mode: "illustrative-replay", candidates: [], markQuote: q },
        q.observedAt,
      )
    ).state;
    expect(s.portfolio.position).toBeNull();
    expect(s.portfolio.cash).toBe("1002.226368978");
    expect(s.records[1].decision.action).toBe("paper-close");
  });
  it("does not invent a close when the source is unavailable", async () => {
    const s = (
      await runScan(
        emptyJournal("illustrative-replay"),
        inputs(),
        b().evaluatedAt,
      )
    ).state;
    const after = (
      await runScan(
        s,
        { mode: "illustrative-replay", candidates: [], markQuote: null },
        "2026-10-09T14:00:00.000Z",
      )
    ).state;
    expect(after.portfolio).toEqual(s.portfolio);
    expect(after.records.at(-1)?.decision.reasons).toContain(
      "QUOTE_UNAVAILABLE",
    );
  });
  it("keeps replay and live histories separate", async () => {
    await expect(
      runScan(emptyJournal("live"), inputs(), b().evaluatedAt),
    ).rejects.toThrow(/mode/i);
  });
  it("never mutates its input state", async () => {
    const state = emptyJournal("illustrative-replay"),
      saved = structuredClone(state);
    await runScan(state, inputs(), b().evaluatedAt);
    expect(state).toEqual(saved);
  });
});
describe("strict transfer and non-destructive storage", () => {
  it("roundtrips a journal and recalculates its accounting and hashes", async () => {
    const state = (
      await runScan(
        emptyJournal("illustrative-replay"),
        inputs(),
        b().evaluatedAt,
      )
    ).state;
    const imported = await parseImport(exportJournal(state));
    expect(imported.state).toEqual(state);
    expect(imported.readOnly).toBe(true);
    const forged = structuredClone(state);
    forged.portfolio.cash = "2000";
    await expect(parseImport(JSON.stringify(forged))).rejects.toThrow();
    const changed = structuredClone(state);
    changed.records[0].inputHash = "0".repeat(64);
    await expect(parseImport(JSON.stringify(changed))).rejects.toThrow();
    const duplicates = structuredClone(state);
    duplicates.records.push(duplicates.records[0]);
    await expect(parseImport(JSON.stringify(duplicates))).rejects.toThrow();
  });
  it("rejects oversized, deep, dangerous and foreign-version imports", async () => {
    for (const text of [
      "x".repeat(1048577),
      '{"__proto__":{}}',
      '{"schemaVersion":2}',
      '{"constructor":{}}',
    ])
      await expect(parseImport(text)).rejects.toThrow();
  });
  it("backs up prior state and leaves it intact after a quota failure", async () => {
    const store = new MemoryStorage(),
      s = emptyJournal("live");
    expect(saveJournal(store, s).ok).toBe(true);
    const old = store.getItem(journalKey("live"));
    store.fail = true;
    expect(saveJournal(store, s).ok).toBe(false);
    expect(store.getItem(journalKey("live"))).toBe(old);
  });
  it("preserves corrupted bytes and starts stopped with a recovery notice", () => {
    const store = new MemoryStorage();
    store.setItem(journalKey("live"), "broken");
    const loaded = loadJournal(store, "live");
    expect(loaded.notice).toMatch(/recover|corrupt/i);
    expect(loaded.state.records).toHaveLength(0);
    expect(store.getItem(journalKey("live") + ".corrupt")).toBe("broken");
  });
});
describe("single-generation scheduler", () => {
  it("starts once, ignores a stopped late result, and can restart", async () => {
    vi.useFakeTimers();
    let resolve!: (x: ScanInputs) => void;
    let state = emptyJournal("live"),
      calls = 0;
    const statuses: string[] = [];
    const scheduler = createScheduler({
      now: () => new Date(b().evaluatedAt),
      readState: () => state,
      writeState: (s) => {
        state = s;
      },
      scan: async () => {
        calls++;
        return new Promise((r) => {
          resolve = r;
        });
      },
      mark: async () => null,
      status: (s) => statuses.push(s.phase),
    });
    scheduler.start();
    scheduler.start();
    expect(calls).toBe(1);
    scheduler.stop();
    resolve({ ...inputs(), mode: "live" });
    await vi.runAllTicks();
    await Promise.resolve();
    expect(state.records).toHaveLength(0);
    expect(scheduler.isRunning()).toBe(false);
    expect(statuses.at(-1)).toBe("stopped");
    scheduler.start();
    expect(calls).toBe(2);
    scheduler.stop();
    vi.useRealTimers();
  });
  it("reports failures without losing persisted history or starting a parallel loop", async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const scheduler = createScheduler({
      now: () => new Date(b().evaluatedAt),
      readState: () => emptyJournal("live"),
      writeState: () => {},
      scan: async () => {
        throw new Error("offline");
      },
      mark: async () => null,
      status: (s) => statuses.push(s.phase),
    });
    scheduler.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(statuses).toContain("error");
    expect(vi.getTimerCount()).toBe(1);
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
describe("review regressions: independent marks and scheduler generations", () => {
  it("persists a valid exit even when the listing feed is unavailable", async () => {
    vi.useFakeTimers();
    let state = (
      await runScan(
        emptyJournal("illustrative-replay"),
        inputs(),
        b().evaluatedAt,
      )
    ).state;
    const now = "2026-10-09T13:00:00.000Z";
    const quote = {
      ...b().quote!,
      bid: "11",
      ask: "11.01",
      observedAt: now,
      receipt: { ...b().quote!.receipt, observedAt: now },
    };
    const statuses: string[] = [];
    const scheduler = createScheduler({
      now: () => new Date(now),
      readState: () => state,
      writeState: (s) => {
        state = s;
      },
      mark: async () => quote,
      scan: async () => {
        throw new Error("RSS offline");
      },
      status: (s) => statuses.push(s.phase),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.portfolio.position).toBeNull();
    expect(state.records.at(-1)?.decision.action).toBe("paper-close");
    expect(statuses).toContain("error");
    scheduler.stop();
    vi.useRealTimers();
  });
  it("does not let a stale generation move the active scan deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
    let state = emptyJournal("live"),
      calls = 0;
    const resolve: Array<(i: ScanInputs) => void> = [];
    const scheduler = createScheduler({
      now: () => new Date(),
      readState: () => state,
      writeState: (s) => {
        state = s;
      },
      mark: async () => null,
      scan: async () => {
        calls++;
        return new Promise((r) => resolve.push(r));
      },
      status: () => {},
    });
    scheduler.start();
    scheduler.stop();
    scheduler.start();
    resolve[1]({ mode: "live", candidates: [] });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60000);
    resolve[0]({ mode: "live", candidates: [] });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(240000);
    expect(calls).toBe(3);
    scheduler.stop();
    vi.useRealTimers();
  });
});
it("exports the exact versioned risk and fill assumptions", () => {
  const exported = JSON.parse(exportJournal(emptyJournal("live")));
  expect(exported.policy).toMatchObject({
    version: "policy-v1",
    initialCash: "1000",
    budget: "25",
    feeRate: "0.004",
    slippageRate: "0.001",
    maxSpread: "0.01",
    quoteMaxAgeSeconds: 90,
    stopLoss: "-0.02",
    takeProfit: "0.03",
    maxHoldMs: 3600000,
  });
});
