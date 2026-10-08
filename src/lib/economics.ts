import {calculateUnlock} from './unlock-engine';
export const roundMoney=(value:number)=>Math.round(value*100)/100;
export type ProductionInputs={max:number;price:number;cost:number;threshold:number};
export function calculateEconomics(concept:ProductionInputs,confirmedOrders:number){
 const orders=Math.max(0,Math.min(concept.max,Math.floor(confirmedOrders)));
 // Brand concepts already derive capacity from assessed material. Capacity-equivalent
 // units express that material gate without inventing a second material measurement.
 const readiness=calculateUnlock({preorders:orders,preorderThreshold:concept.threshold,recoveredKg:concept.max,materialThresholdKg:concept.threshold,capacity:concept.max});
 return {confirmedOrders:orders,committedGrossSales:roundMoney(orders*concept.price),maximumGrossSales:roundMoney(concept.max*concept.price),estimatedProductionCost:roundMoney(orders*concept.cost),maximumProductionCost:roundMoney(concept.max*concept.cost),thresholdGrossSales:roundMoney(concept.threshold*concept.price),feasible:concept.max>=concept.threshold,...readiness};
}
