import type {JournalState,Mode} from '../domain/types';
import { validateJournal,ValidationError } from '../domain/schema';
import { canonicalJson,hashValue } from '../domain/canonical';
import { evaluate } from '../domain/policy';
import { applyDecision } from '../domain/accounting';
import { emptyJournal } from '../agent/engine';
export interface StorageLike{getItem(k:string):string|null;setItem(k:string,v:string):void}
export const journalKey=(mode:Mode)=>`source-first-v1:${mode}`;
export const MAX_BYTES=1048576;
export function verifyJournal(input:unknown):JournalState {
 const state=validateJournal(input);let portfolio=emptyJournal(state.mode).portfolio;let previousTime='';
 for(const record of state.records){
  const b=record.bundle;
  if(previousTime&&b.evaluatedAt<previousTime)throw new ValidationError('Journal time moved backwards');previousTime=b.evaluatedAt;
  if(canonicalJson(b.portfolioBefore)!==canonicalJson(portfolio))throw new ValidationError('Portfolio chain mismatch');
  const inputHash=hashValue(b),decision=evaluate(b),after=applyDecision(b,decision,portfolio);
  if(record.inputHash!==inputHash||record.id!==hashValue({inputHash,decision}))throw new ValidationError('Record hash mismatch');
  if(canonicalJson(record.decision)!==canonicalJson(decision)||canonicalJson(record.portfolioAfter)!==canonicalJson(after))throw new ValidationError('Derived decision or accounting mismatch');
  portfolio=after;
 }
 if(canonicalJson(state.portfolio)!==canonicalJson(portfolio))throw new ValidationError('Final portfolio mismatch');
 return state;
}
function parseText(text:string):JournalState {
 if(new TextEncoder().encode(text).length>MAX_BYTES)throw new ValidationError('Import exceeds 1 MiB');
 let input:unknown;try{input=JSON.parse(text)}catch{throw new ValidationError('Invalid JSON file')}
 return verifyJournal(input);
}
export async function parseImport(text:string):Promise<{state:JournalState;readOnly:true}>{return {state:parseText(text),readOnly:true}}
export function exportJournal(state:JournalState):string {const text=JSON.stringify(verifyJournal(state),null,2);if(new TextEncoder().encode(text).length>MAX_BYTES)throw new ValidationError('Journal exceeds 1 MiB; export a smaller history');return text}
export function loadJournal(storage:StorageLike,mode:Mode):{state:JournalState;notice:string|null}{
 const key=journalKey(mode);let raw:string|null=null;
 try{raw=storage.getItem(key);if(!raw)return {state:emptyJournal(mode),notice:null};const state=parseText(raw);if(state.mode!==mode)throw new ValidationError('Workspace mode mismatch');return {state,notice:null};}
 catch{
  if(raw)try{storage.setItem(key+'.corrupt',raw)}catch{/* Original key is left untouched. */}
  try{const backup=storage.getItem(key+'.backup');if(backup){const state=parseText(backup);if(state.mode===mode)return {state,notice:'Corrupt local state was preserved. Recovered the last valid backup; agent is stopped.'};}}catch{/* Keep raw state for recovery. */}
  return {state:emptyJournal(mode),notice:'Local storage could not be read or was corrupt. Original data is preserved where possible. A clean, stopped workspace is open.'};
 }
}
export function saveJournal(storage:StorageLike,state:JournalState):{ok:boolean;error?:string}{
 try{
  const text=exportJournal(state),key=journalKey(state.mode),previous=storage.getItem(key);
  if(previous){try{parseText(previous);storage.setItem(key+'.backup',previous)}catch(error){if(!(error instanceof ValidationError))throw error;}}
  storage.setItem(key,text);return {ok:true};
 }catch(error){return {ok:false,error:`Journal not saved: ${error instanceof Error?error.message:'storage unavailable'}. Previous valid data was kept.`};}
}
