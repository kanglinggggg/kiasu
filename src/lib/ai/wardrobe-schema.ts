import { z } from 'zod';
import { itemTypes, itemConditions, itemMaterials, ConsumerItem } from '../return-engine';

export const MATERIAL_CONFIDENCE_THRESHOLD = 0.75;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const image = z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 100)
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
export const scanInputSchema = z.object({
  description: z.string().trim().max(6000).default(''),
  garmentPhoto: image.optional(), careLabelPhoto: image.optional(),
}).strict().refine(v => !!(v.description || v.garmentPhoto || v.careLabelPhoto), 'Add a photo or description.');
export type ScanInput = z.infer<typeof scanInputSchema>;
const field = z.object({value:z.string().max(100).nullable(),confidence:z.number().min(0).max(1),evidence:z.string().max(1000)}).strict();
export const suggestionSchema = z.object({
  itemType:field, visibleCondition:field, material:field,
  composition:z.object({fibres:z.array(z.object({name:z.string().min(1).max(80),percent:z.number().min(0).max(100).nullable()}).strict()).max(12),source:z.enum(['care_label','visual_guess','unknown'])}).strict(),
  visibleDamage:z.array(z.string().max(300)).max(20),reusablePanelsLikely:z.boolean().nullable(),
}).strict();
export type WardrobeSuggestion = z.infer<typeof suggestionSchema>;
export function parseWardrobe(raw:unknown, input:ScanInput):WardrobeSuggestion {
  const v=suggestionSchema.parse(raw);
  if(!itemTypes.includes(v.itemType.value as ConsumerItem['type'])) v.itemType={value:null,confidence:0,evidence:'No supported clothing type identified. Select it manually.'};
  if(!itemConditions.includes(v.visibleCondition.value as ConsumerItem['condition'])) v.visibleCondition={value:null,confidence:0,evidence:'Visible condition is uncertain. Review manually.'};
  const total=v.composition.fibres.reduce((sum,f)=>sum+(f.percent??0),0);
  if(total>100.5) throw new Error('Composition percentages exceed 100%.');
  // A high model confidence is not proof of fibre composition. Require label evidence.
  const labelEvidence=!!input.careLabelPhoto && v.composition.source==='care_label' && v.composition.fibres.length>0;
  if(!labelEvidence){v.composition={fibres:[],source:v.composition.source==='visual_guess'?'visual_guess':'unknown'};}
  if(!labelEvidence || v.material.confidence<MATERIAL_CONFIDENCE_THRESHOLD || !itemMaterials.includes(v.material.value as ConsumerItem['material'])){
    v.material={value:'Unknown',confidence:0,evidence:'Material composition is uncertain. Scan the care label for a more reliable result.'};
  }
  return v;
}
export function demoWardrobe(input:ScanInput):WardrobeSuggestion {
  scanInputSchema.parse(input);
  const text=input.description.toLowerCase();
  const type=/jacket/.test(text)?'Denim Jacket':/t-shirt|tee/.test(text)?'Cotton T-shirt':/jeans/.test(text)?'Denim Jeans':null;
  const condition=/damaged|reusable panels/.test(text)?'Damaged / reusable panels':/repair/.test(text)?'Repairable':/good/.test(text)?'Good':null;
  const mock=(value:string|null)=>({value,confidence:value?0.8:0,evidence:'Mock text suggestion only; uploaded images are not analysed in Demo AI.'});
  return parseWardrobe({itemType:mock(type),visibleCondition:mock(condition),material:mock('Unknown'),composition:{fibres:[],source:'unknown'},visibleDamage:[],reusablePanelsLikely:null},input);
}
export function reviewedWardrobe(type:string,material:string,condition:string):Pick<ConsumerItem,'type'|'material'|'condition'> {
  return z.object({type:z.enum(itemTypes),material:z.enum(itemMaterials),condition:z.enum(itemConditions)}).parse({type,material,condition});
}
