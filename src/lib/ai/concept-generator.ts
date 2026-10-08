import {Batch,conditionProfiles} from '../mock-data';
import {calculateConcepts,materialEstimate,Concept} from '../remix-engine';
import {objectValue} from './inventory-analysis';
export type Suggestion={name:string;reason:string};
export function parseSuggestions(value:unknown):Suggestion[]{
 const raw=objectValue(typeof value==='string'?JSON.parse(value):value);
 if(!Array.isArray(raw.suggestions)||raw.suggestions.length===0||raw.suggestions.length>8)throw new Error('Expected one to eight concept suggestions.');
 const result:Suggestion[]=[],seen=new Set<string>();
 for(const item of raw.suggestions){const v=objectValue(item);if(typeof v.name!=='string'||!v.name.trim()||v.name.length>80||typeof v.reason!=='string'||v.reason.length>400)throw new Error('A concept is missing a valid name or qualitative reason.');const name=v.name.trim();if(!seen.has(name.toLowerCase())){result.push({name,reason:v.reason.trim()});seen.add(name.toLowerCase());}}
 return result;
}
export type FeasibilityCheck={label:string;passed:boolean;detail:string};
export type VerifiedOpportunity={suggestion:Suggestion;concept:Concept|null;checks:FeasibilityCheck[];approved:boolean;why:string[]};
export function verifyOpportunities(batch:Batch,suggestions:Suggestion[]):VerifiedOpportunity[]{
 const calculated=calculateConcepts(batch),stock=materialEstimate(batch);
 return suggestions.map(s=>{
  // Names match a trusted recipe. AI numeric fields, recipe IDs and approval flags are never read.
  const concept=calculated.find(c=>c.name.toLowerCase()===s.name.trim().toLowerCase())??null;
  const checks:FeasibilityCheck[]=[
   {label:'Material feasibility',passed:stock.effectiveKg>0&&(!concept||concept.max>0),detail:concept?`${concept.max} units from ${stock.effectiveKg.toFixed(1)} kg effective material.`:`${stock.effectiveKg.toFixed(1)} kg available; product-specific yield is unverified.`},
   {label:'Manufacturing rule',passed:concept!==null,detail:concept?`Supported ${concept.name} recipe · ${concept.difficulty.toLowerCase()} complexity.`:'Unsupported manufacturing recipe.'},
   {label:'Economic feasibility',passed:!!concept&&concept.max>=concept.threshold&&concept.price>concept.cost,detail:concept?`Capacity ${concept.max} / minimum ${concept.threshold}; SGD ${concept.price} price / SGD ${concept.cost} unit production cost.`:'Not evaluated without a supported recipe.'}
  ];
  return {suggestion:{name:s.name,reason:s.reason},concept,checks,approved:checks.every(c=>c.passed),why:concept?[`${stock.effectiveKg.toFixed(1)} kg of reusable material after rule-based grading`,`${concept.difficulty} relative manufacturing complexity`,`${concept.utilisation}% estimated material utilisation`,concept.feasible?'Capacity exceeds or meets maker minimum':'Capacity is below maker minimum',`${Math.round(conditionProfiles[batch.condition].remixDemand*100)}% prototype demand assumption — not observed demand`]:[]};
 });
}
