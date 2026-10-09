import type {Mode,JournalState,ScanInputs,ScanResult,QuoteSnapshot,EvidenceBundle,DecisionRecord} from '../domain/types';
import { POLICY,evaluate,eventKey } from '../domain/policy';
import { applyDecision } from '../domain/accounting';
import { validateBundle,validateJournal } from '../domain/schema';
import { hashValue } from '../domain/canonical';
export function emptyJournal(mode:Mode):JournalState{return {schemaVersion:1,mode,portfolio:{cash:POLICY.initialCash,realizedPnl:'0',position:null,seenEvents:[]},records:[]}}
export async function runScan(state:JournalState,inputs:ScanInputs,now:string):Promise<ScanResult>{
 if(state.mode!==inputs.mode)throw new Error('Workspace mode mismatch');
 let current=structuredClone(state);const appended:DecisionRecord[]=[];
 function append(raw:EvidenceBundle){
  const bundle=validateBundle(raw),decision=evaluate(bundle),inputHash=hashValue(bundle),id=hashValue({inputHash,decision});
  if(current.records.some(r=>r.id===id))return;
  if(current.records.length>=200)throw new Error('Journal reached 200 records. Export and reset before continuing.');
  const portfolioAfter=applyDecision(bundle,decision,current.portfolio),record={id,inputHash,bundle,decision,portfolioAfter};
  current={...current,portfolio:portfolioAfter,records:[...current.records,record]};appended.push(record);
 }
 if(current.portfolio.position&&'markQuote' in inputs){
  const source=current.records.find(r=>r.decision.action==='paper-buy'&&r.decision.eventKey===current.portfolio.position!.eventKey);
  if(!source)throw new Error('Position has no entry evidence');
  const q=inputs.markQuote??null;
  append({...source.bundle,intent:'mark',evaluatedAt:now,quote:q,sourceReceipts:[source.bundle.announcement.receipt,...(source.bundle.pair?[source.bundle.pair.receipt]:[]),...(q?[q.receipt]:[])],portfolioBefore:current.portfolio});
 }
 for(const candidate of [...inputs.candidates].sort((a,b)=>b.announcement.publishedAt.localeCompare(a.announcement.publishedAt)||a.announcement.url.localeCompare(b.announcement.url))){
  const announcement=structuredClone(candidate.announcement);
  const bundle:EvidenceBundle={schemaVersion:1,mode:state.mode,evaluatedAt:now,parserVersion:'kraken-rss-v1',policyVersion:'policy-v1',intent:'scan',claim:candidate.claim??{text:announcement.title,assetName:null,symbol:announcement.symbol||null,venue:'kraken',eventType:'spot-listing',source:'official-feed'},announcement,pair:candidate.pair,quote:candidate.quote,sourceReceipts:[announcement.receipt,...(candidate.pair?[candidate.pair.receipt]:[]),...(candidate.quote?[candidate.quote.receipt]:[])],portfolioBefore:current.portfolio};
  const key=eventKey(bundle);if(current.portfolio.seenEvents.includes(key))continue;
  const old=current.records.find(r=>r.decision.eventKey===key);if(old)announcement.firstSeenAt=old.bundle.announcement.firstSeenAt;
  append(bundle);
 }
 return {state:validateJournal(current),appended};
}
export interface RuntimeStatus {phase:'stopped'|'scanning'|'waiting'|'error';running:boolean;nextAt:string|null;lastSuccessAt:string|null;error:string|null}
export interface SchedulerDeps {now:()=>Date;readState:()=>JournalState;writeState:(s:JournalState)=>void;scan:(signal:AbortSignal)=>Promise<ScanInputs>;mark:(signal:AbortSignal)=>Promise<QuoteSnapshot|null>;status:(s:RuntimeStatus)=>void}
export function createScheduler(deps:SchedulerDeps){
 let running=false,generation=0,timer:ReturnType<typeof setTimeout>|null=null,abort:AbortController|null=null,nextScan=0,lastSuccessAt:string|null=null;
 const report=(phase:RuntimeStatus['phase'],error:string|null=null,nextAt:string|null=null)=>deps.status({phase,running,error,nextAt,lastSuccessAt});
 async function tick(gen:number){
  if(!running||gen!==generation)return;
  abort=new AbortController();report('scanning');
  try {
   const before=deps.readState(),due=deps.now().getTime()>=nextScan;
   const markQuote=before.portfolio.position?await deps.mark(abort.signal):undefined;
   const inputs=due?await deps.scan(abort.signal):{mode:before.mode,candidates:[]};
   if(due)nextScan=deps.now().getTime()+300000;
   if(markQuote!==undefined)inputs.markQuote=markQuote;
   if(!running||gen!==generation)return;
   const result=await runScan(before,inputs,deps.now().toISOString());
   if(!running||gen!==generation)return;
   deps.writeState(result.state);lastSuccessAt=deps.now().toISOString();
   const delay=deps.readState().portfolio.position?60000:Math.max(1000,nextScan-deps.now().getTime());
   report('waiting',null,new Date(deps.now().getTime()+delay).toISOString());timer=setTimeout(()=>{void tick(gen)},delay);
  }catch(error){
   if(!running||gen!==generation)return;
   const message=error instanceof Error?error.message:'Unknown source failure';report('error',message,new Date(deps.now().getTime()+60000).toISOString());timer=setTimeout(()=>{void tick(gen)},60000);
  }
 }
 return {start(){if(running)return;running=true;generation++;nextScan=0;void tick(generation)},stop(){running=false;generation++;abort?.abort();if(timer)clearTimeout(timer);timer=null;report('stopped')},isRunning:()=>running};
}
