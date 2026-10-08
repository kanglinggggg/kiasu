export type UnlockInput={preorders:number;preorderThreshold:number;recoveredKg:number;materialThresholdKg:number;capacity:number};
export function calculateUnlock(input:UnlockInput){
 const valid=Object.values(input).every(Number.isFinite)&&input.preorderThreshold>0&&input.materialThresholdKg>0&&input.capacity>=0&&input.recoveredKg>=0&&Number.isInteger(input.preorders)&&input.preorders>=0;
 const demandReady=valid&&input.preorders>=input.preorderThreshold;
 const materialReady=valid&&Math.round(input.recoveredKg*1000)>=Math.round(input.materialThresholdKg*1000);
 const withinCapacity=valid&&input.preorders<=input.capacity&&input.capacity>=input.preorderThreshold;
 return {demandReady,materialReady,withinCapacity,unlocked:demandReady&&materialReady&&withinCapacity};
}
