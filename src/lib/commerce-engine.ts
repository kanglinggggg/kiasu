import { z } from 'zod';
export const commercePolicy={creditsPerSgd:100,stackCapPercent:25,bonusCap:120,workspaceBonusBudget:10000};
const cents=z.number().int().min(0).max(100000000);
export function checkoutQuote(raw:{priceCents:number;credits:number;balance:number;discountPercent:number;creditsPerSgd?:number;capPercent?:number}){
 const v=z.object({priceCents:cents,credits:z.number().int().min(0).max(1000000),balance:z.number().int().min(0),discountPercent:z.number().int().min(0).max(100),creditsPerSgd:z.number().int().min(1).max(100000).default(100),capPercent:z.number().int().min(0).max(100).default(25)}).strict().parse(raw);
 const cap=Math.floor(v.priceCents*v.capPercent/100),discount=Math.min(cap,Math.floor(v.priceCents*v.discountPercent/100));
 const creditValue=Math.floor(v.credits*100/v.creditsPerSgd);
 if(v.credits>v.balance)throw new Error('Credits exceed the available balance.');
 if(discount+creditValue>cap)throw new Error('Combined incentives exceed the checkout cap.');
 if(v.credits>0&&creditValue===0)throw new Error('Choose enough credits to redeem at least one cent.');
 return {priceCents:v.priceCents,discountCents:discount,creditCents:creditValue,payableCents:v.priceCents-discount-creditValue,credits:v.credits,remainingCredits:v.balance-v.credits,capCents:cap};
}
export function materialShortage(required:number,allocated:number,stock:number){return Math.max(0,Math.round((required-allocated-stock)*1000)/1000);}
export function demandBonus(base:number,needed:number,orders:number,reservations:number,waitlist:number,budget:number){
 if(![base,needed,orders,reservations,waitlist,budget].every(Number.isFinite)||needed<=0||base<=0)return 0;
 const factor=orders>=42?1:orders>=32?.8:orders>0?.4:0;
 // Unpaid signals have a small, explicit ceiling and never count toward production.
 return Math.max(0,Math.min(commercePolicy.bonusCap,Math.floor(budget),Math.round(base*(factor+Math.min(.2,(reservations+waitlist)*.002)))));
}
export type MarginInputs={price:number;units:number;capacity:number;fixed:number;manufacturing:number;sorting:number;preparation:number;logistics:number;auxiliary:number;fees:number;discount:number;credits:number;cancellationRisk:number;other:number};
export function marginScenario(x:MarginInputs){
 for(const n of Object.values(x))if(!Number.isFinite(n)||n<0)throw new Error('Enter finite, non-negative assumptions.');
 const units=Math.min(Math.floor(x.units),Math.floor(x.capacity));
 const netUnit=Math.max(0,Math.round(x.price*100)-Math.round(x.discount*100)-Math.round(x.credits*100));
 const costUnit=Math.round((x.manufacturing+x.sorting+x.preparation+x.logistics+x.auxiliary+x.fees+x.cancellationRisk+x.other)*100);
 const gmv=units*Math.round(x.price*100),net=units*netUnit,cost=Math.round(x.fixed*100)+units*costUnit,profit=net-cost;
 const breakEven=netUnit>costUnit?Math.ceil(Math.round(x.fixed*100)/(netUnit-costUnit)):null;
 return {units,gmv:gmv/100,netSales:net/100,costs:cost/100,profit:profit/100,margin:net?profit/net*100:null,breakEven,breakEvenWithinCapacity:breakEven!==null&&breakEven<=Math.floor(x.capacity)};
}
export function compareMargins(baseline:MarginInputs,circular:MarginInputs){const a=marginScenario(baseline),b=marginScenario(circular);return {baseline:a,circular:b,incremental:b.profit-a.profit,uplift:a.margin===null||b.margin===null?null:b.margin-a.margin};}
