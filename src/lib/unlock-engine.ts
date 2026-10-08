export function plannedQuantity(orders:number,minimum:number,committedUnits?:number){
 return committedUnits ?? Math.max(minimum,orders);
}
// Round required input up to the ledger's gram precision; never round supply up.
export const requiredMaterial=(units:number,perUnit:number)=>Math.ceil((units*perUnit-1e-8)*1000)/1000;
export type UnlockInput={preorders:number;preorderThreshold:number;recoveredKg:number;kgPerUnit:number;capacity:number;plannedUnits?:number};
export function calculateUnlock(input:UnlockInput){
 const plannedUnits=plannedQuantity(input.preorders,input.preorderThreshold,input.plannedUnits);
 const valid=Object.values(input).every(Number.isFinite)&&Number.isInteger(input.preorderThreshold)&&input.preorderThreshold>0&&input.kgPerUnit>0&&Number.isInteger(input.capacity)&&input.capacity>=0&&input.recoveredKg>=0&&Number.isInteger(input.preorders)&&input.preorders>=0&&Number.isInteger(plannedUnits)&&plannedUnits>=input.preorderThreshold;
 const requiredKg=requiredMaterial(plannedUnits,input.kgPerUnit);
 const demandReady=valid&&input.preorders>=plannedUnits;
 const materialReady=valid&&input.recoveredKg+1e-8>=requiredKg;
 const withinCapacity=valid&&plannedUnits<=input.capacity&&input.preorders<=input.capacity;
 return {plannedUnits,requiredKg,demandReady,materialReady,withinCapacity,unlocked:demandReady&&materialReady&&withinCapacity};
}
