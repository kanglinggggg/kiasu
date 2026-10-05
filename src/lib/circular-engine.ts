import {Batch,conditionProfiles,materialProfiles} from './mock-data';
import {calculateConcepts,materialEstimate} from './remix-engine';
import {roundMoney} from './economics';
export const scoreWeights={value:0.30,waste:0.20,utilisation:0.15,effort:0.10,risk:0.10,demand:0.15};
export function calculateRoutes(batch:Batch){
 const condition=conditionProfiles[batch.condition],material=materialProfiles[batch.material];
 const stock=materialEstimate(batch),tote=calculateConcepts(batch)[0];
 const raw=[
  {name:'Resell / Clearance',value:stock.quantity*batch.price*condition.clearancePrice*condition.resellDemand,waste:condition.resellDemand*100,utilisation:100,effort:100,confidence:condition.resellDemand*100,demand:condition.resellDemand*100,cost:stock.quantity*1.2,processing:'Low',viable:condition.resellDemand>=0.1&&stock.quantity>0,description:'Prefer resale when the original product still has viable demand.',formula:`${stock.quantity} items × SGD ${batch.price} × ${condition.clearancePrice} price retention × ${condition.resellDemand} assumed sell-through`},
  {name:'Repair + Resell',value:stock.quantity*batch.price*condition.repairPrice*condition.repairDemand,waste:condition.repairDemand*95,utilisation:95,effort:65,confidence:condition.repairDemand*100,demand:condition.repairDemand*100,cost:stock.quantity*condition.repairCost,processing:'Medium',viable:condition.repairDemand>=0.15&&stock.quantity>0,description:'Prefer minor repairs when they preserve more original product value.',formula:`${stock.quantity} items × SGD ${batch.price} × ${condition.repairPrice} price retention × ${condition.repairDemand} assumed sell-through`},
  {name:'Remix',value:tote.max*tote.price*condition.remixDemand,waste:tote.utilisation*condition.remixDemand,utilisation:tote.utilisation,effort:45,confidence:condition.remixDemand*100,demand:condition.remixDemand*100,cost:tote.max*tote.cost,processing:'Medium',viable:tote.feasible&&condition.remixDemand>0,description:'Prefer Remix when resale demand is weak and reusable panels support a higher-value remake.',formula:`${tote.max} Tote units × SGD ${tote.price} × ${condition.remixDemand} assumed sell-through`},
  {name:'Recycle',value:stock.availableKg*material.recyclePrice,waste:90,utilisation:90,effort:85,confidence:95,demand:95,cost:stock.availableKg*0.3,processing:'Low',viable:stock.availableKg>0,description:'Fallback when higher-value resale, repair and Remix pathways are not viable.',formula:`${stock.availableKg.toFixed(1)} kg × SGD ${material.recyclePrice} assumed fibre value/kg`}
 ];
 const bestValue=Math.max(1,...raw.map(r=>r.value));
 const routes=raw.map(r=>{
  const factors=[{label:'Expected value recovery',rating:100*r.value/bestValue,weight:scoreWeights.value},{label:'Estimated waste avoidance',rating:r.waste,weight:scoreWeights.waste},{label:'Material utilisation',rating:r.utilisation,weight:scoreWeights.utilisation},{label:'Processing ease',rating:r.effort,weight:scoreWeights.effort},{label:'Lower production / sales risk',rating:r.confidence,weight:scoreWeights.risk},{label:'Estimated demand',rating:r.demand,weight:scoreWeights.demand}].map(f=>({...f,points:roundMoney(f.rating*f.weight)}));
  const score=Math.round(factors.reduce((sum,f)=>sum+f.points,0));
  return {...r,value:roundMoney(r.value),cost:roundMoney(r.cost),waste:Math.round(r.waste),score,factors,risk:r.confidence>=80?'Low':r.confidence>=40?'Medium':'High',explanation:[r.description,r.formula,`Estimated processing cost: SGD ${roundMoney(r.cost)}. This is not an all-in cost or profit calculation.`,r.viable?'Meets the prototype viability gate.':'Fails the prototype viability gate: insufficient demand or material capacity.']};
 });
 const higherValue=routes.filter(r=>r.name!=='Recycle'&&r.viable);
 const eligible=higherValue.length?higherValue:routes.filter(r=>r.viable);
 const recommendation=[...eligible].sort((a,b)=>b.score-a.score)[0]?.name??null;
 return {routes,recommendation};
}
export type CircularAnalysis=ReturnType<typeof calculateRoutes>;
