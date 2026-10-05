export type Batch = { product:string; quantity:number; material:string; condition:string; price:number; weight:number };
export const defaultBatch:Batch = {product:'Denim Jeans',quantity:180,material:'Cotton Denim',condition:'Unsold / Minor Defects',price:69,weight:142};
export const routes = [
 {name:'Clearance',value:2160,recovery:100,cost:180,risk:'Low',score:62,description:'Keep the original product in use. Best for inventory with existing resale demand.'},
 {name:'Repair + Resell',value:3050,recovery:76,cost:720,risk:'Medium',score:74,description:'Restore function and extend product life when defects are economically repairable.'},
 {name:'Remix',value:4380,recovery:86,cost:1440,risk:'Medium',score:89,description:'Reusable denim and simple construction make this batch a candidate for a demand-tested remake.'},
 {name:'Recycling',value:620,recovery:91,cost:120,risk:'Low',score:51,description:'Recover fibres when keeping products or reusable panels in circulation is not feasible.'}
];
export const concepts = [
 {id:'tote',name:'Denim Tote',subtitle:'Your everyday carry. Reimagined.',max:68,cost:18,price:49,utilisation:84,difficulty:'Low',votes:382,reservations:71,preorders:41,threshold:42,position:'0%',reason:'Large reusable denim panels, a simple pattern, and versatile everyday use make this our lead concept.'},
 {id:'sleeve',name:'Laptop Sleeve',subtitle:'A softer landing for your essentials.',max:92,cost:14,price:35,utilisation:77,difficulty:'Low',votes:290,reservations:43,preorders:25,threshold:32,position:'50%',reason:'Compact panels accommodate smaller offcuts, with low assembly complexity and an accessible price.'},
 {id:'jacket',name:'Patchwork Jacket',subtitle:'Different pieces. One of a kind.',max:31,cost:42,price:95,utilisation:90,difficulty:'High',votes:195,reservations:18,preorders:11,threshold:20,position:'100%',reason:'Patchwork accepts varied denim shades and sizes, but requires more skilled sewing and quality checks.'}
] as const;
export type Concept = typeof concepts[number];
export const initialDemand = () => Object.fromEntries(concepts.map(c=>[c.id,{votes:c.votes as number,reservations:c.reservations as number,preorders:c.preorders as number,voted:false,reserved:false,ordered:false}]));
export type Demand = ReturnType<typeof initialDemand>;
export const money=(value:number)=>`SGD ${value.toLocaleString('en-SG')}`;
