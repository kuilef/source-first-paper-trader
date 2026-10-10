import "./styles.css";
import cases from "../../fixtures/cases.json";
import type { DecisionRecord, JournalState, Mode } from "../domain/types";
import { validateBundle, safeSourceUrl } from "../domain/schema";
import { money } from "../domain/accounting";
import {
  emptyJournal,
  runScan,
  createScheduler,
  type RuntimeStatus,
} from "../agent/engine";
import {
  createPublicClient,
  loadLiveEvidence,
  loadQuote,
  type PublicSourceClient,
} from "../sources/client";
import {
  loadJournal,
  saveJournal,
  exportJournal,
  parseImport,
  MAX_BYTES,
} from "../storage/journal";

type Child = Node | string | null | undefined;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) if (c != null) n.append(c);
  return n;
}
const p = (text: string, cls = "") => el("p", { class: cls }, text);
function button(
  label: string,
  handler: () => void,
  id: string,
  cls = "button",
) {
  const b = el("button", { type: "button", id, class: cls }, label);
  b.addEventListener("click", handler);
  return b;
}
function sourceLink(label: string, url: string) {
  return safeSourceUrl(url)
    ? el(
        "a",
        {
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
          class: "source-link",
        },
        label,
        " ↗",
      )
    : el("span", {}, label);
}
const store = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, v: string) => localStorage.setItem(key, v),
};
const initialLive = loadJournal(store, "live"),
  initialReplay = loadJournal(store, "illustrative-replay");
const verifiedImportNotice =
  "Import verified by recomputing every decision, hash and ledger total. This workspace is read only.";
let live = initialLive.state,
  replay = initialReplay.state,
  imported: JournalState | null = null;
let notice = initialLive.notice ?? initialReplay.notice ?? "",
  error = "",
  selectedId = "",
  scenario: keyof typeof cases = "confirmed",
  busy = false;
let journalView: "live" | "illustrative-replay" | "imported" =
  "illustrative-replay";
let status: RuntimeStatus = {
  phase: "stopped",
  running: false,
  nextAt: null,
  lastSuccessAt: null,
  error: null,
};
const clientCache = new WeakMap<AbortSignal, PublicSourceClient>();
function clientFor(signal: AbortSignal) {
  let c = clientCache.get(signal);
  if (!c) {
    c = createPublicClient({ signal });
    clientCache.set(signal, c);
  }
  return c;
}
const scheduler = createScheduler({
  now: () => new Date(),
  readState: () => live,
  writeState: (state) => {
    const saved = saveJournal(store, state);
    if (!saved.ok) throw new Error(saved.error);
    live = state;
    if (!selectedId) selectedId = state.records.at(-1)?.id ?? "";
    render();
  },
  scan: (signal) =>
    loadLiveEvidence(clientFor(signal), new Date().toISOString()),
  mark: async (signal) => {
    if (!live.portfolio.position) return null;
    try {
      return await loadQuote(clientFor(signal), live.portfolio.position.pair);
    } catch {
      return null;
    }
  },
  status: (s) => {
    status = s;
    render();
  },
});
function route() {
  const value = location.hash.slice(1);
  return ["replay", "live", "journal", "method"].includes(value)
    ? value
    : "replay";
}
function currentJournal() {
  if (imported && journalView === "imported") return imported;
  return route() === "live"
    ? live
    : route() === "replay"
      ? replay
      : journalView === "live"
        ? live
        : replay;
}
function viewLabel(s: JournalState) {
  return s === imported
    ? "Imported journal · read only"
    : s.mode === "live"
      ? "Live observations · virtual positions"
      : "Illustrative replay · synthetic prices";
}
function stamp(iso: string | null) {
  if (!iso) return "Not observed";
  return (
    new Date(iso).toLocaleString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + " UTC"
  );
}
function activateView() {
  imported = null;
  error = "";
  selectedId = "";
  journalView = route() === "live" ? "live" : "illustrative-replay";
}
window.addEventListener("hashchange", () => {
  activateView();
  render();
});
window.addEventListener("pagehide", () => scheduler.stop());
async function runReplay() {
  if (busy) return;
  busy = true;
  error = "";
  imported = null;
  journalView = "illustrative-replay";
  render();
  try {
    const bundle = validateBundle(cases[scenario]),
      inputs = {
        mode: "illustrative-replay" as Mode,
        candidates: [
          {
            announcement: bundle.announcement,
            pair: bundle.pair,
            quote: bundle.quote,
            claim: bundle.claim,
          },
        ],
      };
    let state = (
      await runScan(
        emptyJournal("illustrative-replay"),
        inputs,
        bundle.evaluatedAt,
      )
    ).state;
    if (state.portfolio.position && bundle.quote) {
      const now = "2026-10-09T12:05:00.000Z",
        quote = {
          ...bundle.quote,
          bid: "11",
          ask: "11.01",
          observedAt: now,
          requestedAt: now,
          receipt: { ...bundle.quote.receipt, observedAt: now },
        };
      state = (
        await runScan(
          state,
          { mode: "illustrative-replay", candidates: [], markQuote: quote },
          now,
        )
      ).state;
    }
    const saved = saveJournal(store, state);
    if (!saved.ok) throw new Error(saved.error);
    replay = state;
    selectedId = state.records[0]?.id ?? "";
  } catch (e) {
    error = e instanceof Error ? e.message : "Replay could not run";
  } finally {
    busy = false;
    render();
  }
}
function exportCurrent() {
  try {
    const text = exportJournal(currentJournal()),
      url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = el("a", {
      href: url,
      download: `source-first-${currentJournal().mode}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error = e instanceof Error ? e.message : "Export failed";
    render();
  }
}
async function importFile(file: File | undefined) {
  if (!file) return;
  error = "";
  try {
    if (file.size > MAX_BYTES) throw new Error("File exceeds 1 MiB");
    const result = await parseImport(await file.text());
    scheduler.stop();
    imported = result.state;
    journalView = "imported";
    selectedId = imported.records[0]?.id ?? "";
    notice = verifiedImportNotice;
  } catch (e) {
    error = `Import rejected: ${e instanceof Error ? e.message : "invalid file"}. Existing journal kept.`;
  }
  render();
}
function resetCurrent() {
  if (
    !window.confirm(
      imported
        ? "Close this imported read-only view? Original local journals are unchanged."
        : "Reset this local workspace? Export the journal first if you want to keep it. Other workspaces are unchanged.",
    )
  )
    return;
  error = "";
  if (imported) {
    imported = null;
    journalView = "illustrative-replay";
    selectedId = "";
    render();
    return;
  }
  const state = currentJournal();
  if (state.mode === "live") scheduler.stop();
  const clean = emptyJournal(state.mode),
    saved = saveJournal(store, clean);
  if (saved.ok) {
    if (state.mode === "live") live = clean;
    else replay = clean;
    selectedId = "";
  } else error = saved.error ?? "Reset could not be saved";
  render();
}
function toolbar() {
  const input = el("input", {
    type: "file",
    id: "import-journal",
    accept: ".json,application/json",
    class: "file-input",
    "aria-label": "Import journal",
  });
  input.addEventListener("change", () => {
    void importFile(input.files?.[0]);
    input.value = "";
  });
  return el(
    "div",
    { class: "journal-tools" },
    button("Export journal", exportCurrent, "export", "button quiet"),
    el(
      "label",
      { class: "button quiet file-label", for: "import-journal" },
      "Import journal",
      input,
    ),
    button(
      imported ? "Close imported view" : "Reset workspace",
      resetCurrent,
      "reset",
      "button text-button",
    ),
  );
}
function stats(state: JournalState) {
  const portfolio = state.portfolio,
    position = portfolio.position;
  return el(
    "aside",
    { class: "ledger-panel", "aria-label": "Paper portfolio" },
    p("PAPER PORTFOLIO", "eyebrow"),
    el(
      "div",
      { class: "stat" },
      el("span", {}, "Virtual cash"),
      el("strong", {}, "$" + money(portfolio.cash)),
    ),
    el(
      "div",
      { class: "stat" },
      el("span", {}, "Realized P&L"),
      el(
        "strong",
        { "data-testid": "realized" },
        "$" + money(portfolio.realizedPnl),
      ),
    ),
    el(
      "div",
      { class: "stat" },
      el("span", {}, "Decisions recorded"),
      el(
        "strong",
        { "data-testid": "record-count" },
        String(state.records.length),
      ),
    ),
    el(
      "div",
      { class: "position-note" },
      p(
        position
          ? `${position.assetName} · ${position.symbol}`
          : "No open position",
        "position-title",
      ),
      p(
        position
          ? `${position.quantity} units · modeled cost $${money(position.cost)}`
          : "See the decision trail for the last action.",
      ),
      position
        ? p(
            position.lastNetValue
              ? `Last modeled liquidation: $${money(position.lastNetValue)}. Observed ${stamp(position.lastObservedAt)}.`
              : "Awaiting a subsequent valid quote. No current mark is implied.",
          )
        : null,
    ),
    p(
      "Starts with $1,000 virtual cash. At most $25 per entry, one position at a time.",
      "fine-print",
    ),
  );
}
function evidence(record: DecisionRecord) {
  const { bundle: b, decision: d } = record,
    a = b.announcement;
  const summary =
    d.action === "paper-buy"
      ? "Evidence accepted. Paper position opened."
      : d.action === "paper-close"
        ? "Exit rule reached at an observed price."
        : d.action === "mark"
          ? "Position marked with a new observation."
          : "Evidence is insufficient. Keep virtual cash.";
  const fields = [
    [
      "Source identity",
      `${a.assetName || "Unresolved name"} · ${a.symbol || "Unknown symbol"}`,
    ],
    [
      "Stated trading date",
      a.explicitTradingDate
        ? `${a.explicitTradingDate} · day precision`
        : "Unknown; no publication-date substitution",
    ],
    ["Article published", stamp(a.publishedAt)],
    ["Agent first saw event", stamp(a.firstSeenAt)],
    [
      "USD pair",
      b.pair ? `${b.pair.key} · ${b.pair.status}` : "No uniquely verified pair",
    ],
    [
      "Quote response observed",
      b.quote ? stamp(b.quote.observedAt) : "Unavailable; no fill",
    ],
    [
      b.mode === "illustrative-replay"
        ? "Synthetic bid / ask"
        : "Observed bid / ask",
      b.quote ? `$${b.quote.bid} / $${b.quote.ask}` : "Unavailable",
    ],
    ["Evaluation time", stamp(b.evaluatedAt)],
  ];
  const sheet = el(
    "article",
    { class: "evidence-sheet", "aria-label": "Selected decision evidence" },
    el(
      "div",
      { class: "sheet-top" },
      p("EVIDENCE SHEET", "eyebrow"),
      el("span", { class: "action-tag " + d.action }, d.action),
    ),
    el("h2", {}, summary),
    p(
      d.checks.find((check) => !check.passed)?.detail ??
        (d.action === "paper-buy"
          ? "All entry checks passed. The recorded cost and fees are modeled below."
          : "The recorded observation and modeled accounting are shown below."),
      "decision-summary",
    ),
    p(a.title, "article-title"),
    sourceLink("Read the original announcement", a.url),
    a.excerpt
      ? el(
          "div",
          { class: "excerpt" },
          p(a.excerpt),
          p(
            "Short source excerpt · date timezone not specified by source",
            "caption",
          ),
        )
      : p("No qualifying trading-date sentence was found.", "empty-copy"),
    el(
      "dl",
      { class: "fact-grid" },
      ...fields.flatMap(([label, value]) => [
        el("div", {}, el("dt", {}, label), el("dd", {}, value)),
      ]),
    ),
    p(
      "Quote response observation is not exchange trade time. No exchange quote timestamp is supplied.",
      "caption quote-note",
    ),
    el("h3", { class: "subsection-label" }, "Ordered decision reasons"),
    el(
      "ol",
      { class: "reason-list" },
      ...d.reasons.map((reason) =>
        el("li", {}, el("code", { class: "reason-code" }, reason)),
      ),
    ),
  );
  sheet.append(
    el(
      "details",
      { class: "checks", "data-detail-key": record.id + ":policy" },
      el(
        "summary",
        { id: "policy-summary" },
        `Policy checks · ${d.checks.filter((c) => c.passed).length}/${d.checks.length} passed`,
      ),
      el(
        "ol",
        {},
        ...d.checks.map((c) =>
          el(
            "li",
            {},
            el(
              "span",
              { class: c.passed ? "passed" : "failed" },
              c.passed ? "Pass" : "Hold",
            ),
            c.detail,
          ),
        ),
      ),
    ),
  );
  if (d.entry)
    sheet.append(
      el(
        "div",
        { class: "accounting-note" },
        el("h3", {}, "Modeled entry"),
        p(`${d.entry.quantity} units × $${d.entry.fill} + $${d.entry.fee} fee`),
        p(`All-in cost: $${d.entry.cost}`),
      ),
    );
  if (d.mark?.net)
    sheet.append(
      el(
        "div",
        { class: "accounting-note" },
        el(
          "h3",
          {},
          d.action === "paper-close" ? "Modeled exit" : "Modeled liquidation",
        ),
        p(`Net value $${d.mark.net} · P&L $${d.mark.pnl}`),
        p(`Observed fill $${d.mark.fill}; modeled fee $${d.mark.fee}.`),
      ),
    );
  sheet.append(
    el(
      "details",
      { class: "checks", "data-detail-key": record.id + ":provenance" },
      el("summary", { id: "provenance-summary" }, "Snapshot & provenance"),
      p(`Evaluation: ${b.evaluatedAt}`),
      p("Policy: policy-v1 · Parser: kraken-rss-v1"),
      p(
        "Quote timestamps describe successful response observation, not exchange trades.",
      ),
      ...b.sourceReceipts.map((r) =>
        el(
          "div",
          { class: "receipt" },
          sourceLink(new URL(r.url).hostname, r.url),
          p(
            `Observed ${r.observedAt} · upstream Age ${r.upstreamAgeSeconds ?? "unknown"}s`,
          ),
        ),
      ),
      p("SHA-256 input fingerprint", "caption"),
      el("code", { class: "hash" }, record.inputHash),
      p(
        "This fingerprint detects changes. It does not authenticate a source or make local data immutable.",
        "caption",
      ),
    ),
  );
  return sheet;
}
function records(state: JournalState, selected: DecisionRecord | undefined) {
  return el(
    "section",
    { class: "record-list", "aria-label": "Decision journal" },
    el(
      "div",
      { class: "section-title" },
      el("h2", {}, "The decision trail"),
      el("span", { class: "count" }, String(state.records.length)),
    ),
    state.records.length
      ? el(
          "ol",
          {},
          ...state.records.map((r, i) => {
            const inspect = button(
              "",
              () => {
                selectedId = r.id;
                render();
              },
              "record-" + i,
              "record-button" + (selected?.id === r.id ? " selected" : ""),
            );
            inspect.setAttribute("aria-pressed", String(selected?.id === r.id));
            inspect.setAttribute(
              "aria-label",
              `Inspect ${r.decision.action} ${r.bundle.announcement.symbol || "Unresolved"} ${i + 1}: ${r.bundle.announcement.assetName || "Unresolved identity"}. ${r.decision.reasons.join("; ")}`,
            );
            inspect.append(
              el(
                "span",
                { class: "record-sequence" },
                String(i + 1).padStart(2, "0"),
              ),
              el(
                "span",
                { class: "action-tag " + r.decision.action },
                r.decision.action,
              ),
              el(
                "span",
                { class: "record-identity" },
                r.bundle.announcement.assetName
                  ? `${r.bundle.announcement.assetName} · ${r.bundle.announcement.symbol}`
                  : "Unresolved identity",
              ),
              el(
                "span",
                { class: "record-caption" },
                r.decision.reasons.join(" · "),
              ),
            );
            return el("li", {}, inspect);
          }),
        )
      : p(
          "No decisions yet. Start a live observation or run an illustrative case.",
          "empty-copy",
        ),
  );
}
function workspace() {
  const s = currentJournal(),
    selected = s.records.find((r) => r.id === selectedId) ?? s.records.at(-1);
  return el(
    "section",
    { class: "workspace" },
    el(
      "div",
      { class: "workspace-top" },
      p(viewLabel(s), "mode-label"),
      toolbar(),
    ),
    el(
      "div",
      { class: "workspace-grid" },
      el(
        "div",
        { class: "workspace-primary" },
        selected ? records(s, selected) : null,
        selected
          ? evidence(selected)
          : el(
              "article",
              { class: "evidence-sheet empty-sheet" },
              p("AN AUDITABLE CHAIN", "eyebrow"),
              el("h2", {}, "A small claim. A visible chain."),
              p(
                "The agent reads the original announcement, checks the market, then records a practice action with its reasons.",
              ),
              el(
                "ol",
                { class: "steps" },
                el(
                  "li",
                  {},
                  el("span", {}, "01"),
                  "Find the source and its actual trading date",
                ),
                el(
                  "li",
                  {},
                  el("span", {}, "02"),
                  "Resolve the asset and check a current USD pair",
                ),
                el(
                  "li",
                  {},
                  el("span", {}, "03"),
                  "Open a virtual position or explain why it abstained",
                ),
              ),
            ),
        selected ? null : records(s, selected),
      ),
      stats(s),
    ),
  );
}
const scenarioLabels: Record<keyof typeof cases, string> = {
  confirmed: "Fresh listing → paper entry & exit",
  recycled: "Recycled announcement → abstain",
  "identity-conflict": "Conflicting identity → abstain",
  future: "Future trading date → abstain",
  "stale-quote": "Stale observation → abstain",
  "wide-spread": "Wide spread → abstain",
};
function replayPage() {
  const select = el(
    "select",
    { id: "scenario", "aria-label": "Replay scenario" },
    ...Object.entries(scenarioLabels).map(([value, label]) =>
      el("option", { value }, label),
    ),
  );
  select.value = scenario;
  select.addEventListener("change", () => {
    scenario = select.value as keyof typeof cases;
  });
  const run = button(
    busy ? "Running…" : "Run illustrative replay",
    () => {
      void runReplay();
    },
    "run-replay",
  );
  run.disabled = busy;
  return el(
    "main",
    { id: "main", tabindex: "-1", class: "replay-page" },
    el(
      "section",
      { class: "page-header" },
      p("THE REPLAY LAB", "eyebrow"),
      el("h1", {}, "Evidence before action."),
      p(
        "Inspect the original evidence, the policy decision and its virtual portfolio effect.",
        "lede",
      ),
    ),
    el(
      "section",
      {
        class: "replay-controls",
        "aria-label": "Illustrative replay controls",
      },
      el(
        "div",
        { class: "run-box" },
        el(
          "div",
          {},
          el("label", { for: "scenario" }, "Choose a frozen case"),
          select,
        ),
        run,
      ),
      p(
        "Illustrative evidence and synthetic prices; original links provide context, not historical performance. Frozen clock: 9 Oct 2026. Running a case replaces only this replay workspace.",
        "caption",
      ),
    ),
    workspace(),
  );
}
function livePage() {
  const start = button(
    status.running ? "Agent running" : "Start live agent",
    () => {
      error = "";
      scheduler.start();
    },
    "start-agent",
  );
  start.disabled = status.running;
  const stop = button(
    "Stop agent",
    () => scheduler.stop(),
    "stop-agent",
    "button quiet",
  );
  stop.disabled = !status.running;
  return el(
    "main",
    { id: "main", tabindex: "-1", class: "live-page" },
    el(
      "section",
      { class: "page-header" },
      p("OFFICIAL SOURCES, LIVE OBSERVATIONS", "eyebrow"),
      el("h1", {}, "The live evidence desk."),
      p(
        "Checks Kraken’s official listing feed and public USD markets. Actions are deterministic, autonomous and entirely virtual.",
        "lede",
      ),
    ),
    el(
      "section",
      {
        class: "operational-strip",
        "aria-label": "Live agent controls and runtime",
      },
      el(
        "div",
        { class: "runtime-state phase-" + status.phase, "aria-live": "polite" },
        p("AGENT STATUS", "eyebrow"),
        el(
          "strong",
          { "data-testid": "agent-status" },
          status.phase === "stopped"
            ? "Stopped"
            : status.phase === "scanning"
              ? "Reading sources…"
              : status.phase === "error"
                ? "Source or storage error"
                : "Watching",
        ),
      ),
      el("div", { class: "actions" }, start, stop),
      el(
        "dl",
        { class: "runtime-facts" },
        el(
          "div",
          {},
          el("dt", {}, "Last successful scan"),
          el("dd", {}, stamp(status.lastSuccessAt)),
        ),
        status.running && status.nextAt
          ? el(
              "div",
              {},
              el("dt", {}, "Next scheduled observation"),
              el("dd", {}, stamp(status.nextAt)),
            )
          : null,
        el(
          "div",
          {},
          el("dt", {}, "Polling cadence"),
          el("dd", {}, "Listings 5 min · Open position 60 sec"),
        ),
        el(
          "div",
          {},
          el("dt", {}, "Operating window"),
          el("dd", {}, "Page open only · Reload starts stopped"),
        ),
      ),
      status.error ? p(status.error, "runtime-error") : null,
    ),
    live.portfolio.position && !status.running
      ? p(
          "An open virtual position is paused. Resume to check the first new quote; missed time is never replayed as observed fills.",
          "warning",
        )
      : null,
    workspace(),
  );
}
function journalPage() {
  const select = el(
    "select",
    { "aria-label": "Journal workspace", id: "journal-workspace" },
    el("option", { value: "illustrative-replay" }, "Illustrative replay"),
    el("option", { value: "live" }, "Live observations"),
    ...(imported
      ? [el("option", { value: "imported" }, "Imported · read only")]
      : []),
  );
  select.value = journalView;
  select.addEventListener("change", () => {
    journalView = select.value as typeof journalView;
    selectedId = "";
    render();
  });
  return el(
    "main",
    { id: "main", tabindex: "-1", class: "journal-page" },
    el(
      "section",
      { class: "page-header" },
      p("THE JOURNAL", "eyebrow"),
      el("h1", {}, "All decisions leave a trace."),
      p(
        "Inspect source receipts, rules and exact paper accounting. Importing a journal verifies it and opens a separate read-only view.",
        "lede",
      ),
      el("label", { for: "journal-workspace" }, "Workspace"),
      select,
    ),
    workspace(),
  );
}
function methodPage() {
  const sections = [
    [
      "00 · A rule-based research agent",
      "This project uses a narrow deterministic parser and a versioned policy, not a language model. It autonomously discovers up to three recent Kraken announcements per scan, verifies evidence, evaluates risk limits and records virtual actions. There is no RYO SDK, blockchain contract or real trading integration.",
    ],
    [
      "01 · The source comes first",
      "The official listing feed must explicitly bind a full asset name to a symbol and say trading is live as of a complete month/day/year. The agent checks exactly one matching USD spot pair. Margin, futures, roadmap and deposit-only announcements are unsupported. A ticker alone cannot prove identity or a listing date. Venue-specific names do not prove contract identity or regional eligibility.",
    ],
    [
      "02 · Dates are different facts",
      "Publication is not the trading date. Only events dated today or yesterday in the UTC calendar qualify. This is not a rolling 48-hour window. Source event dates have day precision and an unknown source timezone; no exact midnight launch is invented. Missing or conflicting dates mean abstention.",
    ],
    [
      "03 · A small, explicit policy",
      "Initial virtual cash: $1,000. One open position. Maximum all-in entry cost: $25. Illustrative fee: 0.40% each side; adverse slippage: 0.10% each side. Ask-relative spread must be at most 1%. Quote response observation age plus supplied upstream Age must be at most 90 seconds. A price cannot predate agent discovery.",
    ],
    [
      "04 · What a fill means",
      "Entry is ask × 1.001; quantity rounds down to the pair lot precision and fees round up to 8 USD decimals. Pair minimum quantity/notional are checked. Exit is bid × 0.999 less modeled fee. There is no liquidity, partial-fill, order-book depth or queue simulation. Unrepresentable values and dust smaller than modeled fees abstain.",
    ],
    [
      "05 · Exits happen at observations",
      "The first newly observed quote whose net liquidation return reaches −2% or +3%, or is observed at least 60 minutes after entry, closes the virtual position. Gaps can exceed those thresholds. Stale or unavailable quotes cannot invent fills. Marked liquidation value and realized P&L are different. Kraken Ticker does not supply an exchange quote timestamp.",
    ],
    [
      "06 · Replay is illustrative",
      "All replay prices are synthetic and the clock is frozen. Real-source metadata does not turn those prices into historical observations. Replay demonstrates mechanics and failure modes; it provides no performance or profitability evidence.",
    ],
    [
      "07 · Your journal stays here",
      "There is no account, analytics or database. Versioned local storage keeps this browser’s journal and a last-valid backup. Imported files are limited to 1 MiB and 200 records, validated and recomputed, and never auto-start the agent or fetch their URLs. Source excerpts are short; complete articles are not stored or exported. SHA-256 fingerprints detect changes but are not proof of authenticity.",
    ],
    [
      "08 · Practical limits",
      "This is a paper-only research demonstration, not investment advice. The live desk requires the same-origin Cloudflare Worker; ordinary static hosting shows an honest source error. Free service quotas, changed source markup, rate limits and outages can stop observations. The agent runs only while the page is open and starts stopped after reload. Export before clearing browser storage.",
    ],
  ];
  return el(
    "main",
    { id: "main", tabindex: "-1", class: "method" },
    el(
      "section",
      { class: "page-header" },
      p("METHOD / POLICY-V1", "eyebrow"),
      el("h1", {}, "A clear method. Honest limits."),
      p(
        "Every decision should be inspectable without trusting a story about the market.",
        "lede",
      ),
    ),
    el(
      "div",
      { class: "method-grid" },
      ...sections.map(([title, text]) =>
        el("section", {}, el("h2", {}, title), p(text)),
      ),
    ),
    el(
      "section",
      { class: "sources-note" },
      el("h2", {}, "Original sources"),
      sourceLink(
        "Kraken listing feed",
        "https://blog.kraken.com/category/product/asset-listings/feed",
      ),
      sourceLink(
        "Public AssetPairs API",
        "https://api.kraken.com/0/public/AssetPairs?assetVersion=1",
      ),
      sourceLink("Public Ticker API", "https://api.kraken.com/0/public/Ticker"),
      el(
        "a",
        { href: "/logo.png", download: "source-first-logo.png" },
        "Download project logo (PNG)",
      ),
    ),
  );
}
// Rendered nodes are replaced when the scheduler reports a new observation.
// Retain inspection state without changing any persisted journal data.
const expandedEvidence = new Map<string, boolean>();
let suspendedFocusId = "";
function render() {
  const active = document.activeElement as HTMLElement | null;
  const activeId =
    active?.id || (active === document.body ? suspendedFocusId : "");
  suspendedFocusId = "";
  const trailScroll = document.querySelector(".record-list ol")?.scrollTop ?? 0;
  const activeHref = active?.closest("a")?.getAttribute("href");
  const matchingLinks = activeHref
    ? Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[href]"),
      ).filter((link) => link.getAttribute("href") === activeHref)
    : [];
  const activeLinkIndex = matchingLinks.indexOf(active as HTMLAnchorElement);
  document
    .querySelectorAll<HTMLDetailsElement>("details[data-detail-key]")
    .forEach((detail) => {
      expandedEvidence.set(detail.dataset.detailKey!, detail.open);
    });
  const current = route();
  const header = el(
    "header",
    { class: "site-header" },
    el(
      "a",
      { href: "#replay", class: "brand", "aria-label": "Source-First home" },
      el("img", { src: "/favicon.svg", alt: "", width: "36", height: "36" }),
      el(
        "span",
        {},
        el("strong", {}, "Source-First"),
        el("small", {}, "PAPER TRADER"),
      ),
    ),
    el(
      "nav",
      { "aria-label": "Primary navigation" },
      ...(
        [
          ["live", "Live desk"],
          ["replay", "Replay lab"],
          ["journal", "Journal"],
          ["method", "Method"],
        ] as const
      ).map(([hash, label]) =>
        el(
          "a",
          {
            href: "#" + hash,
            ...(current === hash ? { "aria-current": "page" } : {}),
          },
          label,
        ),
      ),
    ),
  );
  const content =
    current === "live"
      ? livePage()
      : current === "journal"
        ? journalPage()
        : current === "method"
          ? methodPage()
          : replayPage();
  const skip = el(
    "a",
    { href: "#main", class: "skip-link" },
    "Skip to content",
  );
  skip.addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("main")?.focus();
  });
  const children: Child[] = [
    skip,
    header,
    el(
      "div",
      {
        class: "paper-banner",
        role: "region",
        "aria-label": "Paper-trading notice",
      },
      el("span", { class: "paper-dot", "aria-hidden": "true" }),
      "Paper-only. Every position is virtual. No funds, accounts or keys.",
    ),
    notice && (notice !== verifiedImportNotice || currentJournal() === imported)
      ? el("div", { class: "notice", role: "status" }, notice)
      : null,
    error ? el("div", { class: "error", role: "alert" }, error) : null,
    content,
    el(
      "footer",
      {},
      p("Built for evidence, not predictions."),
      p(
        "Independent project. Not affiliated with Kraken. Policy-v1 · Open source · MIT",
      ),
    ),
  ];
  document
    .querySelector("#app")!
    .replaceChildren(...children.filter((c): c is Node | string => c != null));
  document
    .querySelectorAll<HTMLDetailsElement>("details[data-detail-key]")
    .forEach((detail) => {
      detail.open = expandedEvidence.get(detail.dataset.detailKey!) ?? false;
    });
  const trail = document.querySelector(".record-list ol");
  if (trail) trail.scrollTop = trailScroll;
  let focusTarget = activeId ? document.getElementById(activeId) : null;
  if (focusTarget instanceof HTMLButtonElement && focusTarget.disabled) {
    if (activeId === "start-agent")
      focusTarget = document.getElementById("stop-agent");
    else if (activeId === "stop-agent")
      focusTarget = document.getElementById("start-agent");
    else {
      suspendedFocusId = activeId;
      focusTarget = null;
    }
  }
  if (!focusTarget && activeHref && activeLinkIndex >= 0) {
    focusTarget =
      Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[href]"),
      ).filter((link) => link.getAttribute("href") === activeHref)[
        activeLinkIndex
      ] ?? null;
  }
  focusTarget?.focus({ preventScroll: true });
}
render();
