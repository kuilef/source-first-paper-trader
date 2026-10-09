import Decimal from 'decimal.js';
import type { EvidenceBundle, Decision, PortfolioState, EntryResult, Position, QuoteSnapshot, Policy, MarkResult, EntryQuote, PairSnapshot } from './types';
import { isDecimal } from './schema';
export const D = Decimal.clone({precision:40,rounding:Decimal.ROUND_HALF_UP,toExpNeg:-45,toExpPos:45});
export function quoteProblem(q: QuoteSnapshot | null, now: string, policy: Policy): string | null {
 if(!q)return 'QUOTE_UNAVAILABLE';
 if(!isDecimal(q.ask)||!isDecimal(q.bid)||new D(q.ask).lte(0)||new D(q.bid).lte(0)||new D(q.bid).gt(q.ask))return 'QUOTE_INVALID';
 const elapsed=(Date.parse(now)-Date.parse(q.observedAt))/1000;
 if(!Number.isFinite(elapsed)||elapsed<0)return 'QUOTE_FUTURE';
 if(elapsed+(q.upstreamAgeSeconds??0)>policy.quoteMaxAgeSeconds)return 'QUOTE_STALE';
 return null;
}
export function proposedEntry(pair:PairSnapshot,quote:QuoteSnapshot,cash:string,policy:Policy): EntryQuote | null {
 const fill=new D(quote.ask).mul(new D(1).plus(policy.slippageRate));
 const budget=D.min(cash,policy.budget);
 if(budget.lte('0.00000001'))return null;
 const quantity=budget.minus('0.00000001').div(fill.mul(new D(1).plus(policy.feeRate))).toDecimalPlaces(pair.lotDecimals,Decimal.ROUND_DOWN);
 const notional=quantity.mul(fill),fee=notional.mul(policy.feeRate).toDecimalPlaces(8,Decimal.ROUND_UP),cost=notional.plus(fee);
 if(quantity.lte(0)||quantity.lt(pair.orderMin)||notional.lt(pair.costMin)||cost.gt(budget))return null;
 const entry={quantity:quantity.toFixed(),fill:fill.toFixed(),fee:fee.toFixed(),cost:cost.toFixed()};
 if(!Object.values(entry).every(isDecimal))return null;return entry;
}
export function enterPosition(b:EvidenceBundle,d:Decision,state:PortfolioState):EntryResult {
 if(d.action!=='paper-buy'||!d.entry||!b.pair||state.position||state.seenEvents.includes(d.eventKey)||new D(state.cash).lt(d.entry.cost))throw new Error('Entry violates paper ledger invariant');
 const position:Position={eventKey:d.eventKey,symbol:b.announcement.symbol,assetName:b.announcement.assetName,pair:b.pair,openedAt:b.evaluatedAt,...d.entry,lastObservedAt:b.quote!.observedAt,lastNetValue:null};
 return {position,portfolio:{...state,cash:new D(state.cash).minus(d.entry.cost).toFixed(),position,seenEvents:[...state.seenEvents,d.eventKey]}};
}
export function markOrClose(p:Position,q:QuoteSnapshot,now:string,policy:Policy):MarkResult {
 const reject=(reason:string):MarkResult=>({action:'abstain',reason,fill:null,fee:null,net:null,pnl:null,returnPct:null});
 const invalid=quoteProblem(q,now,policy);if(invalid)return reject(invalid);
 if(q.pairKey!==p.pair.key)return reject('PAIR_MISMATCH');
 if(Date.parse(q.observedAt)<=Date.parse(p.lastObservedAt??p.openedAt)||Date.parse(q.observedAt)<Date.parse(p.openedAt))return reject('NO_NEW_OBSERVATION');
 const fill=new D(q.bid).mul(new D(1).minus(policy.slippageRate)),gross=fill.mul(p.quantity),fee=gross.mul(policy.feeRate).toDecimalPlaces(8,Decimal.ROUND_UP),net=gross.minus(fee),pnl=net.minus(p.cost),ratio=pnl.div(p.cost);
 if(net.lt(0))return reject('EXIT_VALUE_BELOW_FEE');
 const values=[fill.toFixed(),fee.toFixed(),net.toFixed(),pnl.toFixed()];if(!values.every(isDecimal))return reject('NUMERIC_RANGE');
 const reason=ratio.lte(policy.stopLoss)?'STOP_LOSS':ratio.gte(policy.takeProfit)?'TAKE_PROFIT':Date.parse(q.observedAt)-Date.parse(p.openedAt)>=policy.maxHoldMs?'HOLDING_LIMIT':'POSITION_MARKED';
 return {action:reason==='POSITION_MARKED'?'mark':'paper-close',reason,fill:fill.toFixed(),fee:fee.toFixed(),net:net.toFixed(),pnl:pnl.toFixed(),returnPct:ratio.mul(100).toDecimalPlaces(20).toFixed()};
}
export function applyDecision(b:EvidenceBundle,d:Decision,state:PortfolioState):PortfolioState {
 if(d.action==='paper-buy')return enterPosition(b,d,state).portfolio;
 if((d.action==='mark'||d.action==='paper-close')&&d.mark?.net&&d.mark.pnl&&state.position) {
  if(d.action==='paper-close')return {...state,cash:new D(state.cash).plus(d.mark.net).toFixed(),realizedPnl:new D(state.realizedPnl).plus(d.mark.pnl).toFixed(),position:null};
  return {...state,position:{...state.position,lastObservedAt:b.quote!.observedAt,lastNetValue:d.mark.net}};
 }
 return structuredClone(state);
}
export const money=(value:string)=>new D(value).toFixed(2);
