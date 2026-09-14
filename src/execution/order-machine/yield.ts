export interface LimitDecision{value:number;limit:number;breach:number;allowed:boolean}
export function yieldLimit(value:number,limit:number):LimitDecision{if(!Number.isFinite(value)||!Number.isFinite(limit)||limit<0)throw new Error('Invalid Yield and scrap limit.');return{value,limit,breach:Math.max(0,value-limit),allowed:value<=limit}}
