export type Material = 'Cotton Denim' | 'Cotton Blend Denim';
export type Condition = 'Unsold / Minor Defects' | 'Unsold / Good Condition' | 'Repairable / Broken Fastenings' | 'Damaged / Reusable Panels' | 'Unusable / Fibre Recovery Only';
export type Batch = { product:string; quantity:number; material:Material; condition:Condition; price:number; weight:number|null };
export const defaultBatch:Batch = {product:'Denim Jeans',quantity:180,material:'Cotton Denim',condition:'Unsold / Minor Defects',price:69,weight:142};
export const materials:Material[]=['Cotton Denim','Cotton Blend Denim'];
export const conditions:Condition[]=['Unsold / Minor Defects','Unsold / Good Condition','Repairable / Broken Fastenings','Damaged / Reusable Panels','Unusable / Fibre Recovery Only'];
// Prototype assumptions, not measured observations or trained predictions.
export const materialProfiles = {
 'Cotton Denim':{yield:1,cost:1,price:1,recyclePrice:1.4},
 'Cotton Blend Denim':{yield:0.85,cost:1.1,price:0.95,recyclePrice:0.7}
};
export const conditionProfiles = {
 'Unsold / Minor Defects':{panels:1,resellDemand:0.12,repairDemand:0.2,remixDemand:0.88,clearancePrice:0.25,repairPrice:0.45,repairCost:5,remixCost:1},
 'Unsold / Good Condition':{panels:1,resellDemand:0.9,repairDemand:0.8,remixDemand:0.65,clearancePrice:0.65,repairPrice:0.65,repairCost:4,remixCost:1},
 'Repairable / Broken Fastenings':{panels:0.95,resellDemand:0.08,repairDemand:0.88,remixDemand:0.65,clearancePrice:0.15,repairPrice:0.7,repairCost:6,remixCost:1.1},
 'Damaged / Reusable Panels':{panels:0.7,resellDemand:0.02,repairDemand:0.04,remixDemand:0.82,clearancePrice:0.1,repairPrice:0.3,repairCost:14,remixCost:1.2},
 'Unusable / Fibre Recovery Only':{panels:0,resellDemand:0,repairDemand:0,remixDemand:0,clearancePrice:0,repairPrice:0,repairCost:20,remixCost:1.5}
};
export const conceptTemplates = [
 {id:'tote',name:'Denim Tote',subtitle:'Your everyday carry. Reimagined.',inputKg:142/68,baseCost:18,basePrice:49,baseUtilisation:84,difficulty:'Low',votes:382,reservations:71,seedOrders:41,threshold:42,position:'0%',reason:'Large reusable panels and a simple pattern suit an everyday carry.'},
 {id:'sleeve',name:'Laptop Sleeve',subtitle:'A softer landing for your essentials.',inputKg:142/92,baseCost:14,basePrice:35,baseUtilisation:77,difficulty:'Low',votes:290,reservations:43,seedOrders:25,threshold:32,position:'50%',reason:'Compact patterns accommodate smaller panels with relatively simple assembly.'},
 {id:'jacket',name:'Patchwork Jacket',subtitle:'Different pieces. One of a kind.',inputKg:142/31,baseCost:42,basePrice:95,baseUtilisation:90,difficulty:'High',votes:195,reservations:18,seedOrders:11,threshold:20,position:'100%',reason:'Patchwork accepts varied shades, but needs skilled sewing and quality checks.'}
] as const;
export type ConceptId=typeof conceptTemplates[number]['id'];
export type DemandEntry={votes:number;reservations:number;preorders:number;voted:boolean;reserved:boolean;ordered:boolean};
export type Demand=Record<ConceptId,DemandEntry>;
export const initialDemand=(concepts:readonly {id:ConceptId;max:number}[],selected:ConceptId='tote'):Demand=>Object.fromEntries(conceptTemplates.map(c=>[c.id,{votes:c.votes,reservations:c.reservations,preorders:c.id===selected&&(concepts.find(x=>x.id===c.id)?.max??0)>=c.threshold?c.seedOrders:0,voted:false,reserved:false,ordered:false}])) as Demand;
export const money=(value:number)=>`SGD ${value.toLocaleString('en-SG',{maximumFractionDigits:2})}`;
