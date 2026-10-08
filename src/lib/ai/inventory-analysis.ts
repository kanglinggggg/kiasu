import {Batch,Material,Condition,materials,conditions} from '../mock-data';
export type AIMode='demo'|'connected';
export type InventoryInput={description:string;notes:string;csv:string;image?:string};
export type Field='productType'|'quantity'|'material'|'condition'|'estimatedReusableMaterial';
export type Extraction={productType:string|null;quantity:number|null;material:Material|null;condition:Condition|null;estimatedReusableMaterial:number|null;confidence:Record<Field,number|null>;warnings:string[]};
export const objectValue=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function parseInventory(value:unknown):Extraction{
 const raw=typeof value==='string'?JSON.parse(value):value;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Inventory analysis must be a JSON object.');
 const v=objectValue(raw),confidence=objectValue(v.confidence);
 const numeric=(x:unknown,min:number,integer=false)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=100000&&(!integer||Number.isInteger(x))?x:null;
 const result:Extraction={
  productType:typeof v.productType==='string'&&v.productType.trim().length>0&&v.productType.length<=80?v.productType.trim():null,
  quantity:numeric(v.quantity,1,true),
  material:materials.includes(v.material as Material)?v.material as Material:null,
  condition:conditions.includes(v.condition as Condition)?v.condition as Condition:null,
  estimatedReusableMaterial:numeric(v.estimatedReusableMaterial,0),
  confidence:{productType:null,quantity:null,material:null,condition:null,estimatedReusableMaterial:null},warnings:[]
 };
 for(const field of Object.keys(result.confidence) as Field[]){const n=confidence[field];result.confidence[field]=result[field]!==null&&typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1?n:null;}
 for(const field of ['productType','quantity','material','condition'] as Field[])if(result[field]===null)result.warnings.push(`${field}: missing or unsupported. Please enter a confirmed value.`);
 if(result.estimatedReusableMaterial===null)result.warnings.push('Reusable weight is unknown. Leave blank to use the clearly labelled rule-based estimate.');
 return result;
}
export type InventoryReview={productType:string;quantity:string;material:string;condition:string;weight:string;price:string};
export function reviewFromExtraction(e:Extraction,price:number):InventoryReview{return {productType:e.productType??'',quantity:e.quantity===null?'':String(e.quantity),material:e.material??'',condition:e.condition??'',weight:e.estimatedReusableMaterial===null?'':String(e.estimatedReusableMaterial),price:String(price)};}
// The only path from an AI suggestion into inventory: explicit, validated human review.
export function confirmInventory(review:InventoryReview):Batch{
 const e=parseInventory({productType:review.productType,quantity:review.quantity.trim()?Number(review.quantity):null,material:review.material,condition:review.condition,estimatedReusableMaterial:review.weight.trim()?Number(review.weight):null});
 if(!e.productType||e.quantity===null||!e.material||!e.condition)throw new Error('Complete product, quantity, material and condition before confirming.');
 if(review.weight.trim()&&e.estimatedReusableMaterial===null)throw new Error('Reusable material must be a non-negative weight up to 100,000 kg.');
 const price=Number(review.price);if(!Number.isFinite(price)||price<1||price>100000)throw new Error('Enter an original retail price between SGD 1 and 100,000.');
 return {product:e.productType,quantity:e.quantity,material:e.material,condition:e.condition,weight:e.estimatedReusableMaterial,price};
}
export function confidenceLabel(value:number|null){return value===null?'Not inferred':`${Math.round(value*20)*5}% suggested confidence`;}
