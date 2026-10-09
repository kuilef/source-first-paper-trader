import type { Announcement,PairSnapshot,QuoteSnapshot,SourceReceipt } from '../domain/types';
import { announcementSchema,pairSchema,quoteSchema,isDay } from '../domain/schema';
import { D } from '../domain/accounting';
export class SourceError extends Error { constructor(public code:string,message:string){super(message);this.name='SourceError'} }
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new SourceError('SOURCE_FORMAT','Expected an object');return value as Record<string,unknown>};
const text=(v:unknown):string=>{if(typeof v!=='string')throw new SourceError('SOURCE_FORMAT','Expected source text');return v};
const result=(json:unknown)=>{const j=object(json);if(!Array.isArray(j.error)||j.error.length)throw new SourceError('UPSTREAM_ERROR','Kraken returned errors or omitted status');return object(j.result)};
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function parseListingFeed(xml:string,receipt:SourceReceipt):Announcement[]{
 if(new TextEncoder().encode(xml).length>262144||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new SourceError('UNSAFE_XML','Unsupported XML declaration or size');
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 if(doc.querySelector('parsererror')||!doc.querySelector('rss > channel'))throw new SourceError('INVALID_XML','Source is not a valid RSS feed');
 const items=[...doc.querySelectorAll('item')];if(items.length>30)throw new SourceError('FEED_LIMIT','Too many source entries');
 return items.map(item=>{
  const title=clean(item.querySelector('title')?.textContent??'').slice(0,240),url=item.querySelector('link')?.textContent?.trim()??'';
  if(!/^https:\/\/blog\.kraken\.com\/product\/asset-listings\/[a-z0-9-]+\/?$/.test(url))throw new SourceError('SOURCE_URL','Unexpected announcement URL');
  const published=Date.parse(item.querySelector('pubDate')?.textContent??'');if(!Number.isFinite(published))throw new SourceError('SOURCE_DATE','Invalid publication date');
  const html=item.getElementsByTagNameNS('http://purl.org/rss/1.0/modules/content/','encoded')[0]?.textContent??'';
  const body=new DOMParser().parseFromString(html,'text/html');body.querySelectorAll('script,style,iframe,object,template').forEach(n=>n.remove());
  const bodyText=clean(body.body.textContent??'');
  const match=title.match(/^([a-z0-9]{1,20}) is (?:now )?available for trading!?$/i),symbol=match?.[1].toUpperCase()??'';
  const bindings=[...body.querySelectorAll('h2,h3,h4')].map(h=>clean(h.textContent??'').match(/^(.{1,120}?)\s*\(([a-z0-9]{1,20})\)$/i)).filter(m=>m&&m[2].toUpperCase()===symbol);
  const assetName=bindings.length===1?bindings[0]![1].trim():'';
  const escaped=symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const phrase=bodyText.match(new RegExp(`\\b${escaped} trading is live as of (${months.join('|')}) (\\d{1,2}), (\\d{4})\\b`,'i'));
  const month=phrase?months.findIndex(m=>m.toLowerCase()===phrase[1].toLowerCase())+1:0;
  const date=phrase?`${phrase[3]}-${String(month).padStart(2,'0')}-${phrase[2].padStart(2,'0')}`:null;
  const validDate=date&&isDay(date)?date:null;
  const excerpt=(phrase?.[0]??'').split(/\s+/).slice(0,Math.max(0,25-title.split(/\s+/).length)).join(' ').slice(0,240);
  return announcementSchema.parse({url,title,excerpt,publishedAt:new Date(published).toISOString(),firstSeenAt:receipt.observedAt,retrievedAt:receipt.observedAt,explicitTradingDate:validDate,datePrecision:validDate?'day':'unknown',tradingDatePhrase:phrase?`${phrase[1]} ${phrase[2]}, ${phrase[3]}`:'',sourceTimezone:'unknown',assetName,symbol,supported:!!match&&new RegExp(`\\b${escaped} trading is live as of `,'i').test(bodyText),receipt});
 });
}
export function parsePairs(json:unknown,receipt:SourceReceipt):PairSnapshot[]{
 const rows=Object.entries(result(json));if(rows.length>20)throw new SourceError('PAIR_LIMIT','Targeted pair response too large');
 return rows.map(([key,v])=>{const p=object(v);return pairSchema.parse({key,altname:text(p.altname),wsname:text(p.wsname),base:text(p.base),quote:text(p.quote),status:text(p.status),lotDecimals:p.lot_decimals,orderMin:text(p.ordermin),costMin:text(p.costmin),observedAt:receipt.observedAt,receipt})});
}
export function parseTicker(json:unknown,pair:PairSnapshot,receipt:SourceReceipt):QuoteSnapshot{
 const rows=Object.entries(result(json)).filter(([key])=>[pair.key,pair.altname,pair.wsname].includes(key));
 if(rows.length!==1)throw new SourceError('PAIR_AMBIGUOUS','Ticker must resolve exactly one canonical pair');
 const row=object(rows[0][1]);if(!Array.isArray(row.a)||!Array.isArray(row.b))throw new SourceError('QUOTE_FORMAT','Missing bid or ask');
 const q=quoteSchema.parse({pairKey:pair.key,bid:row.b[0],ask:row.a[0],requestedAt:receipt.observedAt,observedAt:receipt.observedAt,exchangeTimestamp:null,upstreamAgeSeconds:receipt.upstreamAgeSeconds,receipt});
 if(new D(q.bid).gt(q.ask))throw new SourceError('QUOTE_CROSSED','Bid exceeds ask');return q;
}
