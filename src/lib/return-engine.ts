export const itemTypes=['Denim Jeans','Denim Jacket','Cotton T-shirt'] as const;
export const itemMaterials=['Cotton Denim','Cotton Blend Denim','Cotton','Unknown'] as const;
export const itemConditions=['Good','Repairable','Damaged / reusable panels','Fibre only'] as const;
export const itemUsages=['Often worn','Rarely worn','No longer used'] as const;
export type ConsumerItem={type:typeof itemTypes[number];material:typeof itemMaterials[number];condition:typeof itemConditions[number];usage:typeof itemUsages[number];ageMonths:number};
export const defaultItem:ConsumerItem={type:'Denim Jeans',material:'Cotton Denim',condition:'Damaged / reusable panels',usage:'No longer used',ageMonths:24};
export function confirmItem(raw:ConsumerItem):ConsumerItem{
 if(!itemTypes.includes(raw.type)||!itemMaterials.includes(raw.material)||!itemConditions.includes(raw.condition)||!itemUsages.includes(raw.usage)||!Number.isFinite(raw.ageMonths)||raw.ageMonths<0||raw.ageMonths>1200)throw new Error('Review the item type, material, condition, usage and age.');
 // Explicit allowlist: AI-supplied weights, credits and allocation flags never cross this boundary.
 return {type:raw.type,material:raw.material,condition:raw.condition,usage:raw.usage,ageMonths:raw.ageMonths};
}
export function recommendAction(item:ConsumerItem){
 confirmItem(item);
 if(item.condition==='Good')return item.usage==='No longer used'?{action:'RESELL / DONATE',reason:'This wearable item can preserve its original value with another owner.'}:{action:'KEEP & RESTYLE',reason:'The item is still usable. Extending its life is preferable to material recovery.'};
 if(item.usage!=='No longer used')return {action:'REPAIR',reason:'You still wear this item. Check repair options and confirm it is no longer wearable before considering material recovery.'};
 if(item.condition==='Repairable')return {action:'REPAIR',reason:'A repair can preserve the garment and extend its useful life before recovery.'};
 if(item.condition==='Damaged / reusable panels'&&item.material!=='Unknown')return {action:'RETURN FOR REMIX',reason:'The garment is no longer wearable, but reusable panels can support a registered Remix recipe.'};
 if(item.material==='Unknown')return {action:'MATERIAL REVIEW',reason:'Confirm the material label before recommending recovery. No return bonus is offered for unknown material.'};
 return {action:'RECYCLE',reason:'Usable panels are unavailable. Fibre recovery is the fallback after higher-value pathways.'};
}
export function recoverableKg(item:ConsumerItem){
 const i=confirmItem(item);
 if(recommendAction(i).action!=='RETURN FOR REMIX')return 0;
 const base=i.type==='Denim Jeans'?0.8:i.type==='Denim Jacket'?1:0.2;
 return Math.round(base*(i.material==='Cotton Blend Denim'?0.75:1)*1000)/1000;
}
export type MaterialContribution={id:string;source:'brand_surplus'|'consumer_return';sourceId:string;kg:number;items:number};
export type ReturnReservation={id:string;item:ConsumerItem;estimatedKg:number;allocatedKg:number;credits:number;bonus:number;discountPercent:number;earlyAccess:boolean;status:'Reserved'|'Received';location:string;returnBy:string};
export const collectionPoints=['NUS UTown','Kent Ridge collection desk'] as const;
export function returnDeadline(now=new Date()){const date=new Date(now);date.setDate(date.getDate()+7);return date.toLocaleDateString('en-SG',{day:'numeric',month:'long',year:'numeric'});}
export function receiveReturn(reservation:ReturnReservation,pool:MaterialContribution[],remainingKg:number){
 if(reservation.status==='Received'||pool.some(p=>p.id===reservation.id))return {reservation,pool};
 const kg=Math.max(0,Math.min(recoverableKg(reservation.item),Number.isFinite(remainingKg)?remainingKg:0));
 const updated={...reservation,status:'Received' as const,allocatedKg:Math.round(kg*1000)/1000};
 return {reservation:updated,pool:kg>0?[...pool,{id:reservation.id,source:'consumer_return' as const,sourceId:reservation.id,kg:updated.allocatedKg,items:1}]:pool};
}
