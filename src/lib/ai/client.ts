import {AIMode,InventoryInput,parseInventory} from './inventory-analysis';
import {Batch} from '../mock-data';
import {mockInventory,mockConcepts} from './mock-ai';
import {parseSuggestions} from './concept-generator';
async function connected(body:unknown,signal?:AbortSignal){
 const response=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 const data=await response.json();if(!response.ok)throw new Error(data.error??'Connected AI is unavailable. Try Demo AI.');return data.result;
}
export async function analyseInventory(mode:AIMode,input:InventoryInput,signal?:AbortSignal){return parseInventory(mode==='demo'?mockInventory(input):await connected({task:'inventory',input},signal));}
export async function generateConcepts(mode:AIMode,batch:Batch,target:string,signal?:AbortSignal){
 return mode==='demo'?parseSuggestions(mockConcepts(batch,target)):parseSuggestions({suggestions:await connected({task:'concepts',batch,target},signal)});
}
