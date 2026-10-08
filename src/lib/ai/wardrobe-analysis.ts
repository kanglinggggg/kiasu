import {analyseInventory} from './client';
import {AIMode} from './inventory-analysis';
import {ConsumerItem,itemTypes} from '../return-engine';
export async function suggestWardrobe(mode:AIMode,description:string,image?:string){
 const e=await analyseInventory(mode,{description,notes:'One personal wardrobe item. Suggest classification only; never infer weight or rewards.',csv:'',image});
 const demoType=/jacket/i.test(description)?'Denim Jacket':/t-shirt|tee/i.test(description)?'Cotton T-shirt':/jeans/i.test(description)?'Denim Jeans':null;
 const type=mode==='demo'?demoType:itemTypes.find(t=>t.toLowerCase()===e.productType?.toLowerCase())??null;
 const material:ConsumerItem['material']|null=mode==='demo'&&type==='Cotton T-shirt'&&/cotton/i.test(description)?'Cotton':e.material;
 const condition:ConsumerItem['condition']|null=e.condition==='Unsold / Good Condition'?'Good':e.condition==='Repairable / Broken Fastenings'||e.condition==='Unsold / Minor Defects'?'Repairable':e.condition==='Damaged / Reusable Panels'?'Damaged / reusable panels':e.condition==='Unusable / Fibre Recovery Only'?'Fibre only':null;
 return {type,material,condition,confidence:e.confidence};
}
