export const roundMoney=(value:number)=>Math.round(value*100)/100;
export type ProductionInputs={max:number;price:number;cost:number;threshold:number};
export function calculateEconomics(concept:ProductionInputs,confirmedOrders:number){
 const orders=Math.max(0,Math.min(concept.max,Math.floor(confirmedOrders)));
 return {confirmedOrders:orders,committedGrossSales:roundMoney(orders*concept.price),maximumGrossSales:roundMoney(concept.max*concept.price),estimatedProductionCost:roundMoney(orders*concept.cost),maximumProductionCost:roundMoney(concept.max*concept.cost),thresholdGrossSales:roundMoney(concept.threshold*concept.price),feasible:concept.max>=concept.threshold,unlocked:concept.max>=concept.threshold&&orders>=concept.threshold};
}
