'use client';
import {FashionHome,ShopDrop} from './fashion-commerce';
import type {Snapshot} from '@/lib/server/types';
import {loopSummary,placeLoopOrder} from '@/lib/loop-engine';
import {checkoutQuote,demandBonus,materialShortage} from '@/lib/commerce-engine';
import {useEffect,useRef,useState} from 'react';
import {Check,CheckCircle2,ChevronRight,Layers3,Package,RotateCcw,Scissors,Sparkles,X} from 'lucide-react';
import {Batch,ConceptId,Condition,Material,conditions,materials,defaultBatch,initialDemand,money} from '@/lib/mock-data';
import {calculateConcepts,materialEstimate} from '@/lib/remix-engine';
import {calculateRoutes} from '@/lib/circular-engine';
import {calculateEconomics} from '@/lib/economics';
import {RouteAnalysis} from './route-analysis';
import {ConceptsView} from './concepts-view';
import {ConsumerDrop} from './consumer-drop';
import {RemixLoop} from './remix-loop';
import {createLoopState} from '@/lib/loop-engine';
import {InventoryAssistant} from './inventory-assistant';
import {OpportunityAssistant,OpportunityResult} from './opportunity-assistant';
import {verifyOpportunities} from '@/lib/ai/concept-generator';
import {AccessibleModal} from './accessible-modal';
import {ImpactView} from './impact-view';
import {ProductImage,SectionTitle} from './ui';
type Stage='home'|'inventory'|'routes'|'concepts'|'drop'|'impact'|'loop';
const steps:Stage[]=['inventory','routes','concepts','drop','impact'];
const labels=['Surplus inventory','Route analysis','Remix concepts','Consumer drop','Impact'];
export default function RemixApp(){
 const [stage,setStage]=useState<Stage>('home');
 const [spentCredits,setSpentCredits]=useState(0),[usedDiscount,setUsedDiscount]=useState(false),[shopReceipts,setShopReceipts]=useState<any[]>([]);
 const [loop,setLoop]=useState(()=>createLoopState(defaultBatch));
 const [opportunities,setOpportunities]=useState<OpportunityResult|null>(null); 
 const [batch,setBatch]=useState<Batch>(defaultBatch);
 const materialDensity=useRef(142/180);
 const [selectedConcept,setSelectedConcept]=useState<ConceptId>('tote');
 const concepts=calculateConcepts(batch);
 const analysis=calculateRoutes(batch);
 const stock=materialEstimate(batch);
 const [demand,setDemand]=useState(()=>initialDemand(calculateConcepts(defaultBatch)));
 const [notice,setNotice]=useState('');
 const [checkout,setCheckout]=useState<ConceptId|null>(null);
 const [selectedRoute,setSelectedRoute]=useState(analysis.recommendation??'Remix');
 const heading=useRef<HTMLDivElement>(null);
 const activeConcept=concepts.find(c=>c.id===selectedConcept)!;
 const economics=calculateEconomics(activeConcept,demand[selectedConcept].preorders);
 const go=(next:Stage)=>{setStage(next);};
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t);},[notice]);
 useEffect(()=>{heading.current?.focus({preventScroll:true});window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[stage]);
 const updateBatch=(next:Batch)=>{
  if(next.quantity!==batch.quantity&&next.weight!==null){next={...next,weight:Math.round(next.quantity*materialDensity.current*10)/10};}
  else if(next.weight!==null&&next.quantity>0){materialDensity.current=next.weight/next.quantity;}
  setSpentCredits(0);setUsedDiscount(false);setShopReceipts([]);
  setBatch(next);setLoop(createLoopState(next));setOpportunities(null);setSelectedConcept('tote');setDemand(initialDemand(calculateConcepts(next)));
  setSelectedRoute(calculateRoutes(next).recommendation??'Remix');setCheckout(null);
 };
 const reset=()=>{materialDensity.current=142/180;updateBatch(defaultBatch);go('inventory');setNotice('Demo reset. Ready for a new run.');};
 const selectConcept=(id:ConceptId)=>{
  if(id===selectedConcept)return;
  if(Object.values(demand).some(d=>d.ordered)){setNotice('Reset or edit inventory to start another production scenario.');return;}
  setSelectedConcept(id);setDemand(initialDemand(concepts,id));setNotice('Concept selected. The simulated demand scenario has been reset.');
 };
 const engage=(id:ConceptId,kind:'votes'|'reservations'|'preorders')=>{
  const c=concepts.find(c=>c.id===id)!;
  const flag=kind==='votes'?'voted':kind==='reservations'?'reserved':'ordered';
  if(demand[id][flag])return;
  if(kind!=='votes'&&!c.feasible)return;
  if(kind==='preorders'&&(id!==selectedConcept||demand[id].preorders>=c.max))return;
  const nextOrders=demand[id].preorders+1;
  setDemand(old=>({...old,[id]:{...old[id],[kind]:old[id][kind]+1,[flag]:true}}));
  setCheckout(null);
  if(kind==='preorders'&&calculateEconomics(c,nextOrders).unlocked){go('impact');}
  else setNotice(kind==='votes'?'Your vote is in. Thanks for shaping this drop.':kind==='reservations'?'Spot reserved in this demo. No payment taken.':'Demo pre-order confirmed. No payment taken.');
 };
 useEffect(()=>{
  const doc=document as Document&{modelContext?:{registerTool:(tool:unknown,options:unknown)=>void|Promise<void>}};
  if(!doc.modelContext)return;const controller=new AbortController();
  try{void Promise.resolve(doc.modelContext.registerTool({name:'navigate_remix_demo',description:'Open a Remix Drop demo workflow stage.',inputSchema:{type:'object',properties:{stage:{type:'string',enum:steps}},required:['stage'],additionalProperties:false},annotations:{readOnlyHint:false},execute:(input:unknown)=>{const value=(input as {stage?:Stage})?.stage;if(!value||!steps.includes(value))throw new Error('Invalid stage');setStage(value);window.scrollTo({top:0,behavior:'smooth'});return {stage:value};}},{signal:controller.signal})).catch(()=>{/* Optional browser capability may be cancelled on unmount. */});}catch{/* Optional browser capability. */}
  return()=>controller.abort();
 },[]);
 const loopStats=loopSummary(loop.pool,loop.orders,loop.completed);
 const received=loop.reservation?.status==='Received';
 const walletCredits=received?loop.reservation!.credits:0;
 const unallocatedKg=Math.max(0,stock.effectiveKg-loop.pool.filter(p=>p.source==='brand_surplus').reduce((n,p)=>n+p.kg,0));
 const shopDrops:ShopDrop[]=[{id:'utility',code:'DROP024',name:'Denim Utility Bag',price:49,orders:loop.orders,threshold:42,capacity:loopStats.capacity,maximum:68,kg:loopStats.kg,requiredKg:loopStats.requiredKg,phase:loopStats.unlocked?'unlocked':'market_test',recipe:'utility',reservations:0,myOrder:loop.ordered,myPreorderStatus:loop.ordered?'confirmed':null},...concepts.map(c=>({id:c.id,code:'DESIGN PREVIEW',name:c.name,price:c.price,orders:demand[c.id].preorders,threshold:c.threshold,capacity:c.max,maximum:c.max,kg:stock.availableKg,requiredKg:0,phase:'preview',recipe:c.id,reservations:demand[c.id].reservations,myOrder:demand[c.id].ordered,myPreorderStatus:demand[c.id].ordered?'confirmed':null}))];
 const shopData={entitlements:received?[{id:'static-return-discount',receipt_id:loop.reservation!.id,percent:10,status:usedDiscount?'redeemed':'available',expires_at:new Date(Date.now()+90*86400000).toISOString(),eligible_recipes:['utility']}]:[],checkouts:shopReceipts,waitlist:[],bounties:loop.completed?[]:[{dropId:'utility',code:'DROP024',name:'Denim Utility Bag',material:'Cotton Denim',grades:['A','B'],requiredKg:loopStats.requiredKg,allocatedKg:loopStats.kg,availableStockKg:unallocatedKg,shortageKg:materialShortage(loopStats.requiredKg,loopStats.kg,unallocatedKg),orders:loop.orders,reservations:0,waitlist:0,bonus:demandBonus(100,materialShortage(loopStats.requiredKg,loopStats.kg,unallocatedKg),loop.orders,0,0,10000)}],policy:{credits_per_sgd:100,stack_cap_percent:25,bonus_budget:10000},community:{accepted_returns:9+(received?1:0),recovered_kg:7.2+(received?.8:0),contributors:9+(received?1:0),products:loopStats.produced,fulfilled:loop.completed?1:0,residual_kg:loop.completed?loopStats.residualKg:0,confirmed_preorders:loop.orders},locations:[],sales:{gmv_cents:loop.orders*4900,discount_cents:shopReceipts.reduce((n,r)=>n+r.discount_cents,0),credit_cents:spentCredits,net_cents:loop.orders*4900-shopReceipts.reduce((n,r)=>n+r.discount_cents+r.credit_cents,0),scope:'simulated_static'}} as Snapshot['commerce'];
 function shopConfirm(d:ShopDrop,q:ReturnType<typeof checkoutQuote>,entitlementId?:string){
  if(d.id!=='utility'||loop.ordered||Object.values(demand).some(d=>d.ordered))throw new Error('This batch already has a commitment. Reset the demo to start another scenario.');
  setLoop(placeLoopOrder);setSpentCredits(old=>old+q.credits);if(entitlementId)setUsedDiscount(true);
  setShopReceipts(old=>[...old,{id:'static-checkout',code:'DROP024',status:'confirmed',price_cents:q.priceCents,discount_cents:q.discountCents,credit_cents:q.creditCents,payable_cents:q.payableCents}]);
 }
 return <><header className="header"><button className="logo" onClick={()=>go('home')} aria-label="terise home"><span className="logo-mark">t.</span>terise<span className="logo-dot"/></button><nav aria-label="Main navigation"><button className={['inventory','routes','concepts'].includes(stage)?'active':''} aria-current={['inventory','routes','concepts'].includes(stage)?'page':undefined} onClick={()=>go('inventory')}>Brand studio</button><button className={['home','drop','impact'].includes(stage)?'active':''} aria-current={['home','drop','impact'].includes(stage)?'page':undefined} onClick={()=>go('home')}>Explore drops</button><button className={stage==='loop'?'active':''} aria-current={stage==='loop'?'page':undefined} onClick={()=>go('loop')}>Scan an item</button></nav><div className="header-right"><span className="demo-tag">INTERACTIVE DEMO</span><button className="icon-button" onClick={reset} title="Reset demo" aria-label="Reset demo"><RotateCcw size={17}/></button><span className="avatar">t.</span></div></header>
 <div className="fine-print" role="note" style={{padding:"12px 5%",background:"#eef2ff"}}>PUBLIC DEMO · Simulated data, no payments or live collections. Changes reset on refresh. Full database and accounting workflows run in the local app.</div>{stage!=='home'&&<div className="workflow"><div className="workflow-inner">{steps.map((s,i)=><button key={s} onClick={()=>go(s)} aria-current={stage===s?'step':undefined} className={stage===s?'current':steps.indexOf(stage)>i?'complete':''}><span>{steps.indexOf(stage)>i?<Check size={13}/>:String(i+1).padStart(2,'0')}</span>{labels[i]}{i<4&&<ChevronRight size={14} className="step-chevron"/>}</button>)}</div></div>}
 <main ref={heading} tabIndex={-1} className="main" key={stage}>
 {stage==='home'&&<FashionHome drops={shopDrops} commerce={shopData} balance={Math.max(0,walletCredits-spentCredits)} onWardrobe={()=>go('loop')} staticOnly onStaticConfirm={shopConfirm}/>}
 {stage==='loop'&&<RemixLoop state={loop} onChange={update=>setLoop(old=>{const next=update(old);if(next.reservation){const base=next.reservation.credits-next.reservation.bonus;const bonus=demandBonus(base,materialShortage(loopSummary(old.pool,old.orders).requiredKg,loopSummary(old.pool,old.orders).kg,unallocatedKg),old.orders,0,0,10000);return {...next,reservation:{...next.reservation,credits:base+bonus,bonus,discountPercent:10}};}return next;})} availableStockKg={unallocatedKg} onShop={()=>go('home')} batch={batch} mode="demo" connected={false} onMode={()=>{}} brandLocked={false}/>}
 {stage==='inventory'&&<><div className="page-heading"><SectionTitle eyebrow="THE BRAND STUDIO / BATCH D102" title="Good materials. New possibilities." description="Give surplus a considered second life. Start with what you already have."/><span className="outline-tag"><Layers3 size={15}/> Circular retail, reimagined</span></div><div className="inventory-layout"><section className="panel inventory-panel"><div className="panel-heading"><div className="square-icon"><Package size={21}/></div><div><h2>Your surplus, in focus</h2><p>Tell us what’s ready for its next chapter.</p></div><span className="small-tag">01 / INPUT</span></div><InventoryAssistant price={batch.price} mode="demo" connected={false} onMode={()=>{}} onConfirm={updateBatch}/><form onSubmit={e=>{e.preventDefault();setSelectedRoute(analysis.recommendation??'Remix');go('routes');}}><div className="form-grid"><label className="full">Product<input required value={batch.product} onChange={e=>updateBatch({...batch,product:e.target.value})} maxLength={80}/></label><label>Quantity<span className="input-unit"><input required type="number" min="1" max="100000" step="1" value={batch.quantity} onChange={e=>updateBatch({...batch,quantity:Number(e.target.value),weight:batch.weight===null?null:Math.round(Number(e.target.value)*(batch.weight/Math.max(1,batch.quantity))*10)/10})}/><span>units</span></span></label><label>Reusable material (optional)<span className="input-unit"><input type="number" min="0" max="100000" step="0.1" value={batch.weight??''} onChange={e=>updateBatch({...batch,weight:e.target.value===''?null:Number(e.target.value)})}/><span>kg</span></span></label><label>Material<select value={batch.material} onChange={e=>updateBatch({...batch,material:e.target.value as Material})}>{materials.map(m=><option key={m}>{m}</option>)}</select></label><label>Original retail price<span className="input-unit"><input required type="number" min="1" max="100000" value={batch.price} onChange={e=>updateBatch({...batch,price:Number(e.target.value)})}/><span>SGD</span></span></label><label className="full">Condition<select value={batch.condition} onChange={e=>updateBatch({...batch,condition:e.target.value as Condition})}>{conditions.map(c=><option key={c}>{c}</option>)}</select></label></div><div className="form-note"><CheckCircle2 size={17}/><span>No new materials. Just new possibilities.</span></div><button className="primary full-button" type="submit"><Sparkles size={17}/> Analyse circular routes</button><p className="fine-print">Prototype decision estimate. Changing quantity scales entered material weight at the same kg/item; edit weight to override, or leave blank to estimate. Changes reset the demand scenario.</p></form></section><aside className="inventory-story"><div className="story-top"><span className="eyebrow">THE NEXT CHAPTER</span><span>DROP / 017</span></div><h2>A second life.<br/><em>A first choice.</em></h2><div className="story-product"><ProductImage concept={concepts[0]}/><span className="floating-label"><Scissors size={14}/> Recovered denim. Reimagined.</span></div><div className="story-bottom"><div><strong>{batch.quantity}</strong><span>surplus {batch.product.toLowerCase()}</span></div><div><strong>{stock.availableKg.toFixed(1)}<small> kg</small></strong><span>material with potential</span></div></div></aside></div><div className="principle-strip"><span>THE REMIX PRINCIPLE</span><p>The waste already exists. <strong>The demand is validated.</strong> Only then do we produce.</p></div></>}

 {stage==='routes'&&<RouteAnalysis batch={batch} analysis={analysis} selected={selectedRoute} onSelect={setSelectedRoute} onEdit={()=>go('inventory')} onExplore={()=>go('concepts')}/>}
 {stage==='concepts'&&<><OpportunityAssistant batch={batch} mode="demo" connected={false} onMode={()=>{}} result={opportunities} onResult={setOpportunities} locked={Object.values(demand).some(d=>d.ordered)}/><ConceptsView verification={opportunities?verifyOpportunities(batch,opportunities.suggestions):[]} concepts={concepts} selected={selectedConcept} onSelect={selectConcept} onLaunch={()=>go('drop')} locked={Object.values(demand).some(d=>d.ordered)}/></>}
 {stage==='drop'&&<ConsumerDrop batch={batch} concepts={concepts} selected={selectedConcept} demand={demand} onEngage={engage} onCheckout={setCheckout} onImpact={()=>go('impact')} onSelect={()=>go('concepts')}/>}
 {stage==='impact'&&<ImpactView batch={batch} concept={activeConcept} orders={economics.confirmedOrders} onReturn={()=>go('drop')}/>}
 </main><footer><span className="footer-brand">terise</span><span>Made from what exists. Chosen for what’s next.</span><span>SDG 12 · RESPONSIBLE PRODUCTION</span></footer>
 {notice&&<div className="toast" role="status"><CheckCircle2 size={18}/>{notice}</div>}
 {checkout&&<AccessibleModal label="Demo preorder" onClose={()=>setCheckout(null)}><span className="eyebrow">DEMO PRE-ORDER</span><h2>Make the next chapter happen.</h2><p>{concepts.find(c=>c.id===checkout)!.name} · {money(concepts.find(c=>c.id===checkout)!.price)}</p><div className="modal-note">This is a simulated order. No payment or personal details are collected. In a real drop, orders would be cancelled and refunded if the threshold is not met by the deadline.</div><button autoFocus className="primary full-button" onClick={()=>engage(checkout,'preorders')}>Confirm demo pre-order</button></AccessibleModal>}

 </>;
}
