import {Batch,conceptTemplates,conditionProfiles,materialProfiles} from './mock-data';
import {roundMoney} from './economics';
export const ESTIMATED_KG_PER_ITEM=142/180;
export function materialEstimate(batch:Batch){
 const quantity=Math.max(0,Math.floor(Number.isFinite(batch.quantity)?batch.quantity:0));
 const physicalLimit=quantity*ESTIMATED_KG_PER_ITEM;
 const supplied=batch.weight===null?physicalLimit:Math.max(0,Number.isFinite(batch.weight)?batch.weight:0);
 const availableKg=Math.min(supplied,physicalLimit);
 const effectiveKg=availableKg*materialProfiles[batch.material].yield*conditionProfiles[batch.condition].panels;
 return {quantity,availableKg,effectiveKg,estimated:batch.weight===null,capped:supplied>physicalLimit};
}
export function calculateConcepts(batch:Batch){
 const material=materialProfiles[batch.material],condition=conditionProfiles[batch.condition],stock=materialEstimate(batch);
 return conceptTemplates.map(template=>{
  const max=Math.floor(stock.effectiveKg/template.inputKg+1e-9);
  const price=Math.max(1,Math.round(template.basePrice*Math.sqrt(Math.max(0,batch.price)/69)*material.price));
  const cost=roundMoney(template.baseCost*material.cost*condition.remixCost*(max<template.threshold?1.2:1));
  const utilisation=stock.effectiveKg>0?Math.round(template.baseUtilisation*material.yield):0;
  return {...template,max,price,cost,utilisation,feasible:max>=template.threshold,
   capacityExplanation:`${stock.availableKg.toFixed(1)} kg × ${material.yield} material yield × ${condition.panels} panel suitability ÷ ${template.inputKg.toFixed(3)} kg input allowance; rounded down.`,
   reason:`${template.reason} ${max>=template.threshold?`${max} possible units cover the ${template.threshold}-order prototype minimum.`:`Only ${max} units are possible, below the ${template.threshold}-order minimum; do not launch production.`}`};
 });
}
export type Concept=ReturnType<typeof calculateConcepts>[number];
