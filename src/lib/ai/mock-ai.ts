import {InventoryInput} from './inventory-analysis';
import {Batch} from '../mock-data';
export const exampleDescription='180 unsold straight-cut denim jeans from last season. Mostly cotton denim. Around 30 have minor stitching defects but the fabric panels are still usable.';
// Transparent fixture/rule fallback. No model or image recognition runs here.
export function mockInventory(input:InventoryInput){
 const text=[input.description,input.notes,input.csv].join(' ');
 const denim=/denim|jeans/i.test(text);
 const matches=[...text.matchAll(/\b(\d+)\s+(?:(?:unsold|straight-cut|cotton|denim|pairs?\s+of|seasonal)\s+)*(?:jeans|units|pieces|pairs)\b/gi)].map(m=>Number(m[1]));
 const lines=input.csv.trim().split(/\r?\n/).filter(Boolean),cells=(line:string)=>line.split(/[,\t;]/).map(s=>s.trim().replace(/^"|"$/g,''));
 let csvQty:number|null=null;
 if(lines.length>=2){const header=cells(lines[0]).map(s=>s.toLowerCase()),row=cells(lines[1]);const index=header.findIndex(s=>s==='quantity'||s==='qty');if(index>=0&&row[index])csvQty=Number(row[index]);}
 else if(lines.length===1){const nums=cells(lines[0]).filter(c=>/^\d+$/.test(c));if(nums.length===1)csvQty=Number(nums[0]);}
 const unique=[...new Set([...matches,...(csvQty===null?[]:[csvQty])])];
 const quantity=unique.length===1?unique[0]:null;
 const material=/cotton.*blend|blend.*denim/i.test(text)?'Cotton Blend Denim':denim&&/cotton/i.test(text)?'Cotton Denim':null;
 const condition=/fibre.only|fiber.only|unusable/i.test(text)?'Unusable / Fibre Recovery Only':/broken.*(?:zip|fasten)|broken fastenings/i.test(text)?'Repairable / Broken Fastenings':/minor|stitching defect/i.test(text)?'Unsold / Minor Defects':/good condition|no defects/i.test(text)?'Unsold / Good Condition':/damaged.*panel/i.test(text)?'Damaged / Reusable Panels':null;
 const kg=text.match(/(?:reusable|measured)\s*(?:material|weight)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*kg/i);
 return {productType:denim?'Denim Jeans':null,quantity,material,condition,estimatedReusableMaterial:kg?Number(kg[1]):null,confidence:{productType:denim?0.95:null,quantity:quantity!==null?0.95:null,material:material?0.85:null,condition:condition?0.8:null,estimatedReusableMaterial:kg?0.85:null}};
}
export function mockConcepts(batch:Batch,target:string){return {suggestions:[
 {name:'Denim Tote',reason:`Reusable ${batch.material.toLowerCase()} panels could suit an everyday carry for ${target}.`},
 {name:'Laptop Sleeve',reason:'Compact panels may suit a protective everyday accessory.'},
 {name:'Patchwork Jacket',reason:'Varied denim shades could become a distinctive patchwork garment.'},
 {name:'Mini Crossbody Bag',reason:'A compact carry option worth exploring once a production recipe exists.'},
 {name:'Utility Pouch',reason:'Smaller offcuts could suit an organiser; maker validation is still required.'},
 {name:'Denim Sneakers',reason:'A speculative footwear idea needing specialist construction and additional components.'}
 ]};}
