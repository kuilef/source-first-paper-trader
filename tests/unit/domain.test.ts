import { describe, it, expect } from 'vitest';
import cases from '../../fixtures/cases.json';
const fixture = cases.confirmed;
import { validateBundle, validateJournal, ValidationError } from '../../src/domain/schema';
import { canonicalJson, hashBundle } from '../../src/domain/canonical';
import { evaluate, POLICY } from '../../src/domain/policy';
import { enterPosition, markOrClose } from '../../src/domain/accounting';
import type { EvidenceBundle } from '../../src/domain/types';
const example = () => structuredClone(fixture) as EvidenceBundle;
describe('schema and canonical input', () => {
 it('validates frozen evidence without mutating input', () => expect(validateBundle(example())).toEqual(example()));
 it.each([2, '1', null])('rejects unsupported version %s', version => {const b={...example(),schemaVersion:version}; expect(()=>validateBundle(b)).toThrow(ValidationError)});
 it.each(['NaN','Infinity','1e9999','-1','0'])('rejects hostile price %s', price=>{const b=example(); b.quote!.ask=price; expect(()=>validateBundle(b)).toThrow(ValidationError)});
 it('rejects invalid dates and unrecognized fields',()=>{const b=example(); b.announcement.explicitTradingDate='2026-02-30';expect(()=>validateBundle(b)).toThrow(); expect(()=>validateBundle({...example(),surprise:true})).toThrow()});
 it('rejects prototype pollution and deep nesting',()=>{expect(()=>validateBundle(JSON.parse('{"__proto__":{}}'))).toThrow(ValidationError);let b:unknown={};for(let i=0;i<17;i++)b={nested:b};expect(()=>validateBundle(b)).toThrow(ValidationError)});
 it('hashes sorted canonical fields identically',async()=>{expect(canonicalJson({b:2,a:1})).toBe('{"a":1,"b":2}');expect(await hashBundle(example())).toMatch(/^[a-f0-9]{64}$/);expect(await hashBundle(example())).toBe(await hashBundle({...example(),claim:{...example().claim}}))});
 it('rejects too many records',()=>expect(()=>validateJournal({schemaVersion:1,mode:'live',portfolio:example().portfolioBefore,records:Array(201).fill({})})).toThrow(ValidationError));
});
describe('calendar-date listing policy',()=>{
 it('accepts a verified fresh date without inventing an exact time',()=>{const b=example();const d=evaluate(b,POLICY);expect(d.action).toBe('paper-buy');expect(b.announcement.datePrecision).toBe('day')});
 it.each([['2026-10-05','EVENT_TOO_OLD'],['2026-10-10','EVENT_FUTURE'],[null,'EVENT_DATE_UNKNOWN']])('rejects event date %s independent of publication', (date,reason)=>{const b=example();b.announcement.explicitTradingDate=date;expect(evaluate(b,POLICY).reasons).toContain(reason)});
 it('rejects conflicting names, mismatched pair and unsupported event',()=>{const b=example();b.claim.assetName='pNetwork';b.pair!.base='PNT';b.announcement.supported=false;expect(evaluate(b,POLICY).reasons).toEqual(expect.arrayContaining(['IDENTITY_CONFLICT','PAIR_MISMATCH','UNSUPPORTED_EVENT']))});
 it('rejects paused pairs, stale quote, wide spreads and low cash',()=>{const b=example();b.pair!.status='cancel_only';b.quote!.observedAt='2026-10-09T11:00:00.000Z';b.quote!.bid='8';b.portfolioBefore.cash='0.1';expect(evaluate(b,POLICY).reasons).toEqual(expect.arrayContaining(['PAIR_NOT_ONLINE','QUOTE_STALE','SPREAD_TOO_WIDE','BELOW_MINIMUM']))});
 it('rejects duplicate event and an already open position',()=>{const b=example();const d=evaluate(b,POLICY);const after=enterPosition(b,d,b.portfolioBefore).portfolio;b.portfolioBefore=after;expect(evaluate(b,POLICY).reasons).toContain('DUPLICATE_EVENT');expect(evaluate(b,POLICY).reasons).toContain('POSITION_LIMIT')});
});
describe('exact modeled accounting',()=>{
 it('rounds quantity down and fees up without exceeding the all-in budget',()=>{const b=example(),d=evaluate(b,POLICY);expect(d.entry).toEqual({quantity:'2.487552',fill:'10.01',fee:'0.09960159',cost:'24.99999711'});const entered=enterPosition(b,d,b.portfolioBefore);expect(entered.portfolio.cash).toBe('975.00000289')});
 it('closes at the newly observed price with exact fees and net pnl',()=>{const b=example();const p=enterPosition(b,evaluate(b,POLICY),b.portfolioBefore).position;const q={...b.quote!,bid:'11',ask:'11.01',observedAt:'2026-10-09T12:01:00.000Z'};const m=markOrClose(p,q,q.observedAt,POLICY);expect(m.action).toBe('paper-close');expect(m.net).toBe('27.226366088');expect(m.pnl).toBe('2.226368978');expect(m.fee).toBe('0.10934284')});
 it('uses the price gap rather than an invented stop threshold',()=>{const b=example();const p=enterPosition(b,evaluate(b,POLICY),b.portfolioBefore).position;const q={...b.quote!,bid:'5',ask:'5.01',observedAt:'2026-10-09T12:01:00.000Z'};expect(markOrClose(p,q,q.observedAt,POLICY).fill).toBe('4.995')});
 it('does not mark on old observations or invalid books',()=>{const b=example();const p=enterPosition(b,evaluate(b,POLICY),b.portfolioBefore).position;expect(markOrClose(p,{...b.quote!,bid:'11'},b.evaluatedAt,POLICY).action).toBe('abstain')});
});
describe('review regressions: chronology and derived schema closure',()=>{
 it('abstains for prices observed before agent discovery but accepts equality',()=>{const b=example();b.quote!.observedAt='2026-10-09T11:59:00.000Z';expect(evaluate(b,POLICY).reasons).toContain('QUOTE_PREDATES_DISCOVERY');b.quote!.observedAt=b.announcement.firstSeenAt;expect(evaluate(b,POLICY).action).toBe('paper-buy')});
 it('does not time-exit at a cached pre-deadline price',()=>{const b=example(),p=enterPosition(b,evaluate(b,POLICY),b.portfolioBefore).position;const q={...b.quote!,bid:'10.1',ask:'10.13',observedAt:'2026-10-09T12:59:59.000Z'};expect(markOrClose(p,q,'2026-10-09T13:00:00.000Z',POLICY).action).toBe('mark');q.observedAt='2026-10-09T13:00:00.000Z';expect(markOrClose(p,q,q.observedAt,POLICY).reason).toBe('HOLDING_LIMIT')});
 it('serializes ordinary near-breakeven marks within validated decimal bounds',()=>{const b=example(),p=enterPosition(b,evaluate(b,POLICY),b.portfolioBefore).position;const q={...b.quote!,bid:'10.1',ask:'10.13',observedAt:'2026-10-09T12:01:00.000Z'};const m=markOrClose(p,q,q.observedAt,POLICY);expect(m.action).toBe('mark');expect((m.returnPct!.split('.')[1]??'').length).toBeLessThanOrEqual(20)});
 it('abstains instead of creating unrepresentable entries or negative dust liquidation',()=>{const b=example();b.quote!.ask='0.000000000000000001';b.quote!.bid=b.quote!.ask;expect(evaluate(b,POLICY).action).toBe('abstain');const original=example(),p=enterPosition(original,evaluate(original,POLICY),original.portfolioBefore).position;const q={...original.quote!,bid:'0.000000001',ask:'0.0000000011',observedAt:'2026-10-09T12:01:00.000Z'};expect(markOrClose(p,q,q.observedAt,POLICY).reason).toBe('EXIT_VALUE_BELOW_FEE')});
});
