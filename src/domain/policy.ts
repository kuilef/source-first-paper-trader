import type { Decision, EvidenceBundle, Policy, Check } from "./types";
import { D, markOrClose, proposedEntry, quoteProblem } from "./accounting";
export const POLICY: Policy = Object.freeze({
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
export const eventKey = (b: EvidenceBundle) =>
  `kraken:spot:${b.announcement.symbol.toUpperCase()}:${b.announcement.assetName.toLowerCase()}:${b.announcement.explicitTradingDate ?? "unknown"}`;
export function evaluate(b: EvidenceBundle, policy: Policy = POLICY): Decision {
  const checks: Check[] = [];
  const check = (code: string, passed: boolean, detail: string) =>
    checks.push({ code, passed, detail });
  const key = eventKey(b);
  if (b.intent === "mark") {
    const p = b.portfolioBefore.position;
    const m =
      p && b.quote ? markOrClose(p, b.quote, b.evaluatedAt, policy) : null;
    const reason = m?.reason ?? "QUOTE_UNAVAILABLE";
    return {
      action: m?.action ?? "abstain",
      eventKey: p?.eventKey ?? key,
      reasons: [reason],
      checks: [
        {
          code: reason,
          passed: !!m && m.action !== "abstain",
          detail: "Uses only a newly observed public quote.",
        },
      ],
      entry: null,
      mark: m,
    };
  }
  const a = b.announcement,
    p = b.pair,
    q = b.quote;
  check(
    "UNSUPPORTED_EVENT",
    a.supported,
    "Original wording must explicitly describe live spot trading.",
  );
  check(
    "EVENT_DATE_UNKNOWN",
    !!a.explicitTradingDate && a.datePrecision === "day",
    "An explicit source year, month and day are required.",
  );
  check(
    "IDENTITY_UNKNOWN",
    !!a.assetName && !!a.symbol,
    "The original announcement must bind a full name and symbol.",
  );
  check(
    "IDENTITY_CONFLICT",
    (!b.claim.assetName ||
      b.claim.assetName.trim().toLowerCase() === a.assetName.toLowerCase()) &&
      (!b.claim.symbol ||
        b.claim.symbol.toUpperCase() === a.symbol.toUpperCase()),
    "A claim cannot override the original source identity.",
  );
  check(
    "PAIR_MISMATCH",
    !!p &&
      p.base.toUpperCase() === a.symbol.toUpperCase() &&
      p.quote === "USD" &&
      p.wsname.toUpperCase() === `${a.symbol.toUpperCase()}/USD` &&
      (!q || q.pairKey === p.key),
    "One exact USD spot pair must match this venue-specific symbol.",
  );
  const today = b.evaluatedAt.slice(0, 10),
    yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86400000)
      .toISOString()
      .slice(0, 10);
  check(
    "EVENT_FUTURE",
    !a.explicitTradingDate || a.explicitTradingDate <= today,
    "Future calendar dates cannot qualify.",
  );
  check(
    "EVENT_TOO_OLD",
    !a.explicitTradingDate || a.explicitTradingDate >= yesterday,
    "Only today or yesterday in the UTC-calendar policy; not a 48-hour window.",
  );
  check(
    "SOURCE_FUTURE",
    a.firstSeenAt <= b.evaluatedAt &&
      a.publishedAt <= b.evaluatedAt &&
      (!p || p.observedAt <= b.evaluatedAt),
    "Source discovery/publication and pair receipt cannot be in the future.",
  );
  check(
    "QUOTE_PREDATES_DISCOVERY",
    !q || q.observedAt >= a.firstSeenAt,
    "A paper entry cannot use a price observed before this agent discovered the event.",
  );
  check(
    "PAIR_NOT_ONLINE",
    p?.status === "online",
    "Pair must currently report online.",
  );
  check(
    "DUPLICATE_EVENT",
    !b.portfolioBefore.seenEvents.includes(key),
    "A listing event can create at most one paper entry.",
  );
  check(
    "POSITION_LIMIT",
    !b.portfolioBefore.position,
    "Maximum one open virtual position.",
  );
  const issue = quoteProblem(q, b.evaluatedAt, policy);
  check(
    issue ?? "QUOTE_CURRENT",
    !issue,
    "Observed response age plus upstream Age must be at most 90 seconds; no exchange timestamp is supplied.",
  );
  if (q && !["QUOTE_INVALID", "QUOTE_UNAVAILABLE"].includes(issue ?? ""))
    check(
      "SPREAD_TOO_WIDE",
      new D(q.ask).minus(q.bid).div(q.ask).lte(policy.maxSpread),
      "Ask-relative spread must not exceed 1.00%.",
    );
  const entry =
    p && q && !["QUOTE_INVALID", "QUOTE_UNAVAILABLE"].includes(issue ?? "")
      ? proposedEntry(p, q, b.portfolioBefore.cash, policy)
      : null;
  check(
    "BELOW_MINIMUM",
    !!entry,
    "Rounded quantity/notional must satisfy source minima and fit cash and the all-in $25 budget.",
  );
  const reasons = checks.filter((c) => !c.passed).map((c) => c.code);
  return {
    action: reasons.length ? "abstain" : "paper-buy",
    eventKey: key,
    reasons: reasons.length ? reasons : ["VERIFIED_FRESH_LISTING"],
    checks,
    entry: reasons.length ? null : entry,
    mark: null,
  };
}
