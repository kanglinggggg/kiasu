import {ConsumerItem,MaterialContribution,recoverableKg} from './return-engine';
// Shared rule table for all persisted drops; scores are not AI predictions or mass yields.
export function materialCompatibility(material:string,requirement:{material_type:string;allowed_blend:boolean}){
 if(material===requirement.material_type&&material!=='Unknown')return {compatible:true,compatibilityScore:material==='Cotton Blend Denim'?.85:1,reason:'Registered exact material compatibility.'};
 if(material==='Cotton Blend Denim'&&requirement.material_type==='Cotton Denim'&&requirement.allowed_blend)return {compatible:true,compatibilityScore:.85,reason:'Registered blend-compatible recipe; blending is explicitly allowed.'};
 return {compatible:false,compatibilityScore:0,reason:'No registered compatibility for this material and component.'};
}
export const loopRecipe={id:'DROP024',name:'Denim Utility Bag',material:'Cotton Denim',kgPerUnit:1,materialThresholdKg:68,preorderThreshold:42,price:49,cost:18};
export const totalKg=(pool:MaterialContribution[])=>Math.round(pool.reduce((n,p)=>n+Math.max(0,p.kg),0)*1000)/1000;
export function matchMaterial(item:ConsumerItem,pool:MaterialContribution[]){
 const remaining=Math.max(0,Math.round((loopRecipe.materialThresholdKg-totalKg(pool))*1000)/1000);
 const compatible=item.material===loopRecipe.material;
 const kg=recoverableKg(item);
 return {materialMatch:compatible?'high' as const:'none' as const,compatibleDrop:compatible?loopRecipe.id:null,estimatedRecoverableKg:kg,materialStillNeededKg:remaining,eligible:compatible&&kg>0&&remaining>0,allocatedKg:compatible?Math.min(kg,remaining):0};
}
export function loopCapacity(pool:MaterialContribution[]){return Math.floor((totalKg(pool)+1e-8)/loopRecipe.kgPerUnit);}
