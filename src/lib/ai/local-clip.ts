import { z } from 'zod';
import { ScanInput, scanInputSchema, WardrobeSuggestion } from './wardrobe-schema';

export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
export const clothingLabels = ['denim jeans', 'denim jacket', 'a T-shirt', 'a dress', 'a sweater', 'shoes', 'a bag', 'an object other than clothing'] as const;
export const attributeLabels = ['a garment with no obvious damage', 'a garment with visible tears or holes', 'a garment with visible stains', 'an obscured garment whose condition cannot be seen'] as const;
export type Ranking = {label:string;score:number};
export type ClipProgress = {message:string;percent?:number};
export type ClipResult = {suggestion:WardrobeSuggestion;types:Ranking[];attributes:Ranking[];elapsedMs:number};
export type Classifier = (image:string,labels:string[])=>Promise<unknown>;
const rankingsSchema=z.array(z.object({label:z.string(),score:z.number().min(0).max(1)}).strict()).min(1);
function rankings(raw:unknown,labels:readonly string[]):Ranking[]{
  const list=rankingsSchema.parse(raw);
  if(list.length!==labels.length||new Set(list.map(v=>v.label)).size!==labels.length||list.some(v=>!labels.includes(v.label)))throw new Error('Local CLIP returned invalid labels. Retry or use Demo AI.');
  return list.sort((a,b)=>b.score-a.score);
}
export function clipSuggestion(rawTypes:unknown,rawAttributes:unknown):Omit<ClipResult,'elapsedMs'>{
  const types=rankings(rawTypes,clothingLabels),attributes=rankings(rawAttributes,attributeLabels);
  const top=types[0];
  // A shortlist always produces a winner; a small lead is not reliable evidence.
  const clearLead=top.score-types[1].score>=0.1;
  const value=clearLead&&top.label==='denim jeans'?'Denim Jeans':clearLead&&top.label==='denim jacket'?'Denim Jacket':null;
  return {types,attributes,suggestion:{
    itemType:{value,confidence:0,evidence:`Closest visual label: ${top.label}. Relative shortlist ranking only. Appearance cannot establish fibre composition.`},
    visibleCondition:{value:null,confidence:0,evidence:`Closest visual attribute: ${attributes[0].label}. Inspect the garment and select its condition.`},
    material:{value:'Unknown',confidence:0,evidence:'Local CLIP cannot establish fibre composition or read care labels. Review the label manually, or use Gemini Vision.'},
    composition:{fibres:[],source:'unknown'},visibleDamage:[],reusablePanelsLikely:null,
  }};
}
export function createClipRunner(load:(progress:(p:ClipProgress)=>void)=>Promise<Classifier>){
  let model:Promise<Classifier>|null=null;
  let running=false;
  return async(input:ScanInput,progress:(p:ClipProgress)=>void):Promise<ClipResult>=>{
    scanInputSchema.parse(input);
    if(!input.garmentPhoto)throw new Error('Local CLIP needs a garment photo. It does not read care labels or descriptions.');
    if(running)throw new Error('A local scan is already running. Please wait.');
    running=true;const start=performance.now();
    try{
      progress({message:model?'Reusing Local CLIP…':'Loading Local CLIP…'});
      model??=load(progress).catch(e=>{model=null;throw e;});
      const classifier=await model;
      progress({message:'Comparing clothing types…'});
      const types=await classifier(input.garmentPhoto,[...clothingLabels]);
      progress({message:'Comparing visible attributes…'});
      const attributes=await classifier(input.garmentPhoto,[...attributeLabels]);
      return {...clipSuggestion(types,attributes),elapsedMs:Math.round(performance.now()-start)};
    }finally{running=false;}
  };
}
