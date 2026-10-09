import type { ScanInputs,SourceReceipt,PairSnapshot,QuoteSnapshot } from '../domain/types';
import { hashText } from '../domain/canonical';
import { isInstant,safeSourceUrl } from '../domain/schema';
import { parseListingFeed,parsePairs,parseTicker,SourceError } from './kraken';
export interface SourceResponse { text:string;receipt:SourceReceipt }
export interface PublicSourceClient { listings():Promise<SourceResponse>;pairs(pairId:string):Promise<SourceResponse>;ticker(pairId:string):Promise<SourceResponse> }
interface ClientDeps {now?:()=>Date;sleep?:(ms:number)=>Promise<void>;fetch?:typeof fetch;signal?:AbortSignal}
export function createPublicClient(deps:ClientDeps={}):PublicSourceClient {
 const fetcher=deps.fetch??fetch,now=deps.now??(()=>new Date());let lastStart=-Infinity;
 const pause=deps.sleep??((ms:number)=>new Promise<void>((resolve,reject)=>{const id=setTimeout(done,ms);function abort(){clearTimeout(id);reject(new DOMException('Stopped','AbortError'))}function done(){deps.signal?.removeEventListener('abort',abort);resolve()}if(deps.signal?.aborted)abort();else deps.signal?.addEventListener('abort',abort,{once:true})}));
 async function get(route:'listings'|'pairs'|'ticker',pair?:string):Promise<SourceResponse> {
  if(pair!==undefined&&!/^[A-Za-z0-9/]{1,40}$/.test(pair))throw new SourceError('PAIR_INPUT','Invalid pair identifier');
  const path=`/api/${route}${pair?`?${new URLSearchParams({pair})}`:''}`;
  for(let attempt=0;attempt<2;attempt++) {
   deps.signal?.throwIfAborted();const spacing=Math.max(0,lastStart+1000-now().getTime());if(spacing)await pause(spacing);deps.signal?.throwIfAborted();lastStart=now().getTime();
   let response:Response;
   try {response=await fetcher(path,{signal:deps.signal?AbortSignal.any([deps.signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),credentials:'omit',cache:'no-store',redirect:'error'});}catch(error){if(deps.signal?.aborted)throw error;if(attempt===0){await pause(1000);continue}throw new SourceError('NETWORK_UNAVAILABLE','Source request failed; replay was not substituted.');}
   if(!response.ok){if(attempt===0&&(response.status===429||response.status>=500)){await pause(1000);continue}throw new SourceError('SOURCE_UNAVAILABLE',`${route} is unavailable (HTTP ${response.status}).`);}
   const observedAt=response.headers.get('x-source-observed-at')??'',url=response.headers.get('x-source-url')??'',age=response.headers.get('x-source-age');
   if(!isInstant(observedAt)||!safeSourceUrl(url))throw new SourceError('RECEIPT_INVALID','Missing or invalid source receipt; use the Cloudflare Pages deployment.');
   const expected=route==='listings'?'https://blog.kraken.com/category/product/asset-listings/feed':`https://api.kraken.com/0/public/${route==='pairs'?'AssetPairs':'Ticker'}`;
   if(route==='listings'?url!==expected:!url.startsWith(`${expected}?`))throw new SourceError('RECEIPT_INVALID','Unexpected source receipt URL');
   const max=route==='listings'?262144:route==='pairs'?2097152:65536;
   const reader=response.body?.getReader();if(!reader)throw new SourceError('SOURCE_EMPTY','Source response has no body');
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>max){await reader.cancel();throw new SourceError('SOURCE_OVERSIZE','Source response exceeds bound')}chunks.push(next.value)}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}const text=new TextDecoder().decode(bytes);
   return {text,receipt:{url,observedAt,bodyHash:hashText(text),upstreamAgeSeconds:age&&/^\d+$/.test(age)&&Number(age)<=31536000?Number(age):null}};
  }
  throw new SourceError('SOURCE_UNAVAILABLE','Source unavailable after bounded retry');
 }
 return {listings:()=>get('listings'),pairs:id=>get('pairs',id),ticker:id=>get('ticker',id)};
}
export async function loadLiveEvidence(client:PublicSourceClient,now:string):Promise<ScanInputs> {
 const feed=await client.listings();const announcements=parseListingFeed(feed.text,feed.receipt).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.url.localeCompare(b.url)).slice(0,3);
 const candidates:ScanInputs['candidates']=[];
 for(const announcement of announcements) {
  announcement.firstSeenAt=now;
  let pair:PairSnapshot|null=null,quote:QuoteSnapshot|null=null;
  if(announcement.symbol&&announcement.assetName&&announcement.supported) {
   try {const raw=await client.pairs(`${announcement.symbol}USD`);const found=parsePairs(JSON.parse(raw.text),raw.receipt).filter(p=>p.base.toUpperCase()===announcement.symbol&&p.quote==='USD'&&p.wsname.toUpperCase()===`${announcement.symbol}/USD`);if(found.length===1)pair=found[0];}catch{/* Unknown market evidence is an explicit policy abstention. */}
   if(pair)try {quote=await loadQuote(client,pair);}catch{/* No quote means no virtual fill. */}
  }
  candidates.push({announcement,pair,quote});
 }
 return {mode:'live',candidates};
}
export async function loadQuote(client:PublicSourceClient,pair:PairSnapshot):Promise<QuoteSnapshot> {const raw=await client.ticker(pair.altname);return parseTicker(JSON.parse(raw.text),pair,raw.receipt)}
