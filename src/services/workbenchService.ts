import type{WorkItem}from'../domain/workbench/domain';
export interface DecisionSaveResult{kind:'saved'|'conflict';id:string}
export function saveDecision(item:WorkItem):Promise<DecisionSaveResult>{return new Promise(resolve=>window.setTimeout(()=>{ resolve({kind:item.hasConflict?'conflict':'saved',id:item.id}); },35))}
export interface ScenarioResult{primary:number;secondary:number;risk:number;revision:number}
export function calculateScenario(capacity:number,demand:number,factor:number,coefficient:number,revision:number):Promise<ScenarioResult>{return new Promise(resolve=>window.setTimeout(()=>{const usable=Math.max(0,capacity*factor-demand);resolve({primary:Number((usable*coefficient).toFixed(1)),secondary:Number(((capacity/(demand||1))*100).toFixed(1)),risk:Math.max(0,Math.round(demand-capacity*factor)),revision})},28))}
