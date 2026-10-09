import { z } from 'zod';
import type { EvidenceBundle, JournalState } from './types';
export class ValidationError extends Error { constructor(message: string) { super(message); this.name='ValidationError'; } }
const str = (max=240) => z.string().max(max);
export const isDecimal = (s: unknown): s is string => typeof s==='string' && /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,40})?$/.test(s);
const decimal = z.string().refine(isDecimal,'Invalid bounded decimal');
const nonnegative = decimal.refine(v=>!v.startsWith('-'),'Negative amount');
const positive = nonnegative.refine(v=>/[1-9]/.test(v),'Zero amount');
export const isInstant = (s: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString()===s;
export const isDay = (s: string) => /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
const instant = z.string().refine(isInstant,'Invalid UTC instant');
const day = z.string().refine(isDay,'Invalid calendar date');
export const safeSourceUrl = (s: string) => { try { const u=new URL(s); return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['blog.kraken.com','api.kraken.com'].includes(u.hostname); } catch { return false; } };
const url = str(2048).refine(safeSourceUrl,'Unapproved evidence URL');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const receiptSchema = z.strictObject({url,observedAt:instant,bodyHash:hash,upstreamAgeSeconds:z.number().int().min(0).max(31536000).nullable()});
export const announcementSchema = z.strictObject({url,title:str(240),excerpt:str(240).refine(s=>s.trim().split(/\s+/).length<=25),publishedAt:instant,firstSeenAt:instant,retrievedAt:instant,explicitTradingDate:day.nullable(),datePrecision:z.enum(['day','unknown']),tradingDatePhrase:str(100),sourceTimezone:z.literal('unknown'),assetName:str(120),symbol:str(20),supported:z.boolean(),receipt:receiptSchema});
export const pairSchema = z.strictObject({key:str(40),altname:str(40),wsname:str(40),base:str(20),quote:str(20),status:str(40),lotDecimals:z.number().int().min(0).max(18),orderMin:nonnegative,costMin:nonnegative,observedAt:instant,receipt:receiptSchema});
export const quoteSchema = z.strictObject({pairKey:str(40),bid:positive,ask:positive,requestedAt:instant,observedAt:instant,exchangeTimestamp:z.null(),upstreamAgeSeconds:z.number().int().min(0).max(31536000).nullable(),receipt:receiptSchema});
const positionSchema = z.strictObject({eventKey:str(300),symbol:str(20),assetName:str(120),pair:pairSchema,openedAt:instant,quantity:positive,fill:positive,fee:nonnegative,cost:positive,lastObservedAt:instant.nullable(),lastNetValue:nonnegative.nullable()});
export const portfolioSchema = z.strictObject({cash:nonnegative,realizedPnl:decimal,position:positionSchema.nullable(),seenEvents:z.array(str(300)).max(200)});
export const bundleSchema = z.strictObject({schemaVersion:z.literal(1),mode:z.enum(['live','illustrative-replay']),evaluatedAt:instant,parserVersion:z.literal('kraken-rss-v1'),policyVersion:z.literal('policy-v1'),intent:z.enum(['scan','mark']),claim:z.strictObject({text:str(600),assetName:str(120).nullable(),symbol:str(20).nullable(),venue:z.literal('kraken'),eventType:z.literal('spot-listing'),source:z.enum(['official-feed','user-text'])}),announcement:announcementSchema,pair:pairSchema.nullable(),quote:quoteSchema.nullable(),sourceReceipts:z.array(receiptSchema).max(20),portfolioBefore:portfolioSchema});
const entrySchema = z.strictObject({quantity:positive,fill:positive,fee:nonnegative,cost:positive});
const markSchema = z.strictObject({action:z.enum(['mark','paper-close','abstain']),reason:str(80),fill:positive.nullable(),fee:nonnegative.nullable(),net:nonnegative.nullable(),pnl:decimal.nullable(),returnPct:decimal.nullable()});
export const decisionSchema = z.strictObject({action:z.enum(['paper-buy','abstain','paper-close','mark']),eventKey:str(300),reasons:z.array(str(80)).max(30),checks:z.array(z.strictObject({code:str(80),passed:z.boolean(),detail:str(300)})).max(30),entry:entrySchema.nullable(),mark:markSchema.nullable()});
const recordSchema = z.strictObject({id:hash,inputHash:hash,bundle:bundleSchema,decision:decisionSchema,portfolioAfter:portfolioSchema});
export const journalSchema = z.strictObject({schemaVersion:z.literal(1),mode:z.enum(['live','illustrative-replay']),portfolio:portfolioSchema,records:z.array(recordSchema).max(200)});
export function guardJson(input: unknown, depth=0): void {
 if(depth>16)throw new ValidationError('JSON nesting exceeds 16');
 if(typeof input==='number'&&!Number.isFinite(input))throw new ValidationError('Non-finite number');
 if(typeof input==='string'&&input.length>12000)throw new ValidationError('String is too long');
 if(input&&typeof input==='object') {
  if(!Array.isArray(input)&&Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null)throw new ValidationError('Expected plain object');
  if(Array.isArray(input)&&input.length>1000)throw new ValidationError('Array is too long');
  for(const key of Object.keys(input)) {if(['__proto__','prototype','constructor'].includes(key))throw new ValidationError('Unsafe object key');guardJson((input as Record<string,unknown>)[key],depth+1);}
 }
}
function validated<T>(schema: z.ZodType<T>, input: unknown): T { guardJson(input);const r=schema.safeParse(input);if(!r.success)throw new ValidationError(r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).slice(0,3).join('; '));return r.data; }
export function validateBundle(input: unknown): EvidenceBundle { return validated(bundleSchema,input); }
export function validateJournal(input: unknown): JournalState { const s=validated(journalSchema,input);if(new Set(s.records.map(r=>r.id)).size!==s.records.length)throw new ValidationError('Duplicate record ID');if(s.records.some(r=>r.bundle.mode!==s.mode))throw new ValidationError('Mixed workspaces');return s; }
