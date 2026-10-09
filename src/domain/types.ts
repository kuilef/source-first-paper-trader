export type Mode = 'live' | 'illustrative-replay';
export interface SourceReceipt { url: string; observedAt: string; bodyHash: string; upstreamAgeSeconds: number | null }
export interface Announcement {
  url: string; title: string; excerpt: string; publishedAt: string; firstSeenAt: string; retrievedAt: string;
  explicitTradingDate: string | null; datePrecision: 'day' | 'unknown'; tradingDatePhrase: string;
  sourceTimezone: 'unknown'; assetName: string; symbol: string; supported: boolean; receipt: SourceReceipt;
}
export interface PairSnapshot { key: string; altname: string; wsname: string; base: string; quote: string; status: string; lotDecimals: number; orderMin: string; costMin: string; observedAt: string; receipt: SourceReceipt }
export interface QuoteSnapshot { pairKey: string; bid: string; ask: string; requestedAt: string; observedAt: string; exchangeTimestamp: null; upstreamAgeSeconds: number | null; receipt: SourceReceipt }
export interface Position { eventKey: string; symbol: string; assetName: string; pair: PairSnapshot; openedAt: string; quantity: string; fill: string; fee: string; cost: string; lastObservedAt: string | null; lastNetValue: string | null }
export interface PortfolioState { cash: string; realizedPnl: string; position: Position | null; seenEvents: string[] }
export interface Claim { text: string; assetName: string | null; symbol: string | null; venue: 'kraken'; eventType: 'spot-listing'; source: 'official-feed' | 'user-text' }
export interface EvidenceBundle { schemaVersion: 1; mode: Mode; evaluatedAt: string; parserVersion: 'kraken-rss-v1'; policyVersion: 'policy-v1'; intent: 'scan' | 'mark'; claim: Claim; announcement: Announcement; pair: PairSnapshot | null; quote: QuoteSnapshot | null; sourceReceipts: SourceReceipt[]; portfolioBefore: PortfolioState }
export interface Check { code: string; passed: boolean; detail: string }
export interface EntryQuote { quantity: string; fill: string; fee: string; cost: string }
export interface MarkResult { action: 'mark' | 'paper-close' | 'abstain'; reason: string; fill: string | null; fee: string | null; net: string | null; pnl: string | null; returnPct: string | null }
export interface Decision { action: 'paper-buy' | 'abstain' | 'paper-close' | 'mark'; eventKey: string; reasons: string[]; checks: Check[]; entry: EntryQuote | null; mark: MarkResult | null }
export interface DecisionRecord { id: string; inputHash: string; bundle: EvidenceBundle; decision: Decision; portfolioAfter: PortfolioState }
export interface JournalState { schemaVersion: 1; mode: Mode; portfolio: PortfolioState; records: DecisionRecord[] }
export interface Policy { version: 'policy-v1'; initialCash: string; budget: string; feeRate: string; slippageRate: string; maxSpread: string; quoteMaxAgeSeconds: number; stopLoss: string; takeProfit: string; maxHoldMs: number }
export interface EntryResult { portfolio: PortfolioState; position: Position }
export interface ScanInputs { mode: Mode; candidates: Array<{announcement: Announcement; pair: PairSnapshot | null; quote: QuoteSnapshot | null; claim?: Claim}>; markQuote?: QuoteSnapshot | null }
export interface ScanResult { state: JournalState; appended: DecisionRecord[] }
export type ValidatedJson = null | boolean | number | string | ValidatedJson[] | { [key: string]: ValidatedJson };
