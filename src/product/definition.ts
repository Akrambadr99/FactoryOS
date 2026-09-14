import { validateAuthorization as validate0 } from '../production-order/policy'
import { validateAuthorization as validate1 } from '../bom-effective/policy'
import { validateAuthorization as validate2 } from '../routing-step/policy'
import { validateAuthorization as validate3 } from '../machine-downtime/policy'
import { validateAuthorization as validate4 } from '../material-constraint/policy'
import { validateAuthorization as validate5 } from '../scrap-disposition/policy'
import { validateAuthorization as validate6 } from '../rework-release/policy'
import { validateAuthorization as validate7 } from '../shift-handoff/policy'
import type { Entity, Field, Operation, Product } from '../workspace/types'
import { entity, number, requireThat, text } from '../workspace/values'
const roles=["Production Planner","Quality Engineer","Shift Supervisor","Plant Manager"] as const
const textField=(key:string,label:string):Field=>({key,label,type:'text',required:true,initial:'Evidence pending'})
const numberField=(key:string,label:string,initial:number):Field=>({key,label,type:'number',required:true,integer:true,min:0,max:1000000000,initial})
const dateField=(key:string,label:string):Field=>({key,label,type:'date',required:true,initial:'2026-09-14'})
type Validator=(record:{measured:number;limit:number;evidence:string;revision:number})=>unknown
function workflowOperations(kind:string,label:string,validate:Validator):Operation[]{return[
  {key:kind+'-submit',label:'Submit '+label,kind,from:['draft'],roles:[roles[0]],run:({entity})=>{entity.status='review';return label+' submitted for independent review.'}},
  {key:kind+'-authorize',label:'Authorize '+label,kind,from:['review'],roles:[roles[1]],run:({entity})=>{validate({measured:number(entity.fields,'measured'),limit:number(entity.fields,'limit'),evidence:text(entity.fields,'evidence'),revision:entity.revision});entity.status='authorized';return label+' authorized against current evidence and limits.'}},
  {key:kind+'-execute',label:'Execute '+label,kind,from:['authorized'],roles:[roles[2]],run:({entity,now})=>{requireThat(text(entity.fields,'effectiveDate')<=now.slice(0,10),'The effective date has not arrived.');entity.status='active';return label+' executed with operational custody recorded.'}},
  {key:kind+'-block',label:'Block '+label,kind,from:['authorized','active'],roles:[roles[0],roles[2]],fields:[textField('reason','Blocking reason')],run:({entity,input})=>{requireThat(text(input,'reason').trim().length>=8,'A specific blocking reason is required.');entity.status='blocked';return label+' blocked without losing prior evidence.'}},
  {key:kind+'-recover',label:'Recover '+label,kind,from:['blocked'],roles:[roles[1]],fields:[textField('recovery','Recovery evidence')],run:({entity,input})=>{requireThat(text(input,'recovery').trim().length>=8,'Recovery evidence is required.');entity.status='review';return label+' returned to review with recovery evidence.'}},
  {key:kind+'-close',label:'Close '+label,kind,from:['active'],roles:[roles[3]],run:({entity})=>{entity.status='closed';return label+' closed by accountable authority.'}},
]}
const kinds=[{
    key:"production-order", label:"Production order release", states:['draft','review','authorized','active','blocked','closed'], initial:'draft', editors:[roles[0]],
    fields:[textField('owner','Accountable owner'), numberField('measured',"Required machine hours",6), numberField('limit',"Available machine hours",8), textField('evidence','Evidence reference'), dateField('effectiveDate','Effective date')]
  },
{
    key:"bom-effective", label:"BOM effective revisions", states:['draft','review','authorized','active','blocked','closed'], initial:'draft', editors:[roles[0]],
    fields:[textField('owner','Accountable owner'), numberField('measured',"Order BOM revision",4), numberField('limit',"Released BOM revision",5), textField('evidence','Evidence reference'), dateField('effectiveDate','Effective date')]
  },
{
    key:"routing-step", label:"Routing execution", states:['draft','review','authorized','active','blocked','closed'], initial:'draft', editors:[roles[0]],
    fields:[textField('owner','Accountable owner'), numberField('measured',"Completed routing step",6), numberField('limit',"Required routing step",8), textField('evidence','Evidence reference'), dateField('effectiveDate','Effective date')]
  },
{
    key:"machine-downtime", label:"Machine downtime recovery", states:['draft','review','authorized','active','blocked','closed'], initial:'draft', editors:[roles[0]],
    fields:[textField('owner','Accountable owner'), numberField('measured',"Condition reading age",4), numberField('limit',"Maximum reading age",5), textField('evidence','Evidence reference'), dateField('effectiveDate','Effective date')]
  },
{
    key:"material-constraint", label:"Material availability", states:['draft','review','authorized','active','blocked','closed'], initial:'draft', editors:[roles[0]],
    fields:[textField('owner','Accountable owner'), numberField('measured',"Available material units",6), numberField('limit',"Minimum material units",8), textField('evidence','Evidence reference'), dateField('effectiveDate','Effective date')]
  },
{
    key:"scrap-disposition", label:"Scrap disposition", states:['draft','review','authorized','active','blocked','closed'], initial:'draft', editors:[roles[0]],
    fields:[textField('owner','Accountable owner'), numberField('measured',"Scrap percentage",4), numberField('limit',"Maximum scrap percentage",5), textField('evidence','Evidence reference'), dateField('effectiveDate','Effective date')]
  },
{
    key:"rework-release", label:"Rework release", states:['draft','review','authorized','active','blocked','closed'], initial:'draft', editors:[roles[0]],
    fields:[textField('owner','Accountable owner'), numberField('measured',"Operator certification",6), numberField('limit',"Minimum certification",8), textField('evidence','Evidence reference'), dateField('effectiveDate','Effective date')]
  },
{
    key:"shift-handoff", label:"Shift handoff timing", states:['draft','review','authorized','active','blocked','closed'], initial:'draft', editors:[roles[0]],
    fields:[textField('owner','Accountable owner'), numberField('measured',"Handoff minute",4), numberField('limit',"Latest handoff minute",5), textField('evidence','Evidence reference'), dateField('effectiveDate','Effective date')]
  }]
const operations:Operation[]=[...workflowOperations("production-order", "Production order release", validate0),
...workflowOperations("bom-effective", "BOM effective revisions", validate1),
...workflowOperations("routing-step", "Routing execution", validate2),
...workflowOperations("machine-downtime", "Machine downtime recovery", validate3),
...workflowOperations("material-constraint", "Material availability", validate4),
...workflowOperations("scrap-disposition", "Scrap disposition", validate5),
...workflowOperations("rework-release", "Rework release", validate6),
...workflowOperations("shift-handoff", "Shift handoff timing", validate7)]
const seed:Entity[]=[entity("production-order-001","production-order","Production order release primary record",'review',{owner:"Production Planner",measured:4,limit:8,evidence:"EV-FACTORYOS-001",effectiveDate:'2026-09-14'}),
entity("production-order-002","production-order","Production order release recovery record",'blocked',{owner:"Shift Supervisor",measured:4,limit:8,evidence:"REC-FACTORYOS-001",effectiveDate:'2026-09-15'}),
entity("bom-effective-001","bom-effective","BOM effective revisions primary record",'review',{owner:"Production Planner",measured:5,limit:5,evidence:"EV-FACTORYOS-002",effectiveDate:'2026-09-14'}),
entity("bom-effective-002","bom-effective","BOM effective revisions recovery record",'blocked',{owner:"Shift Supervisor",measured:5,limit:5,evidence:"REC-FACTORYOS-002",effectiveDate:'2026-09-15'}),
entity("routing-step-001","routing-step","Routing execution primary record",'review',{owner:"Production Planner",measured:8,limit:5,evidence:"EV-FACTORYOS-003",effectiveDate:'2026-09-14'}),
entity("routing-step-002","routing-step","Routing execution recovery record",'blocked',{owner:"Shift Supervisor",measured:8,limit:5,evidence:"REC-FACTORYOS-003",effectiveDate:'2026-09-15'}),
entity("machine-downtime-001","machine-downtime","Machine downtime recovery primary record",'review',{owner:"Production Planner",measured:4,limit:8,evidence:"EV-FACTORYOS-004",effectiveDate:'2026-09-14'}),
entity("machine-downtime-002","machine-downtime","Machine downtime recovery recovery record",'blocked',{owner:"Shift Supervisor",measured:4,limit:8,evidence:"REC-FACTORYOS-004",effectiveDate:'2026-09-15'}),
entity("material-constraint-001","material-constraint","Material availability primary record",'review',{owner:"Production Planner",measured:8,limit:5,evidence:"EV-FACTORYOS-005",effectiveDate:'2026-09-14'}),
entity("material-constraint-002","material-constraint","Material availability recovery record",'blocked',{owner:"Shift Supervisor",measured:8,limit:5,evidence:"REC-FACTORYOS-005",effectiveDate:'2026-09-15'}),
entity("scrap-disposition-001","scrap-disposition","Scrap disposition primary record",'review',{owner:"Production Planner",measured:4,limit:8,evidence:"EV-FACTORYOS-006",effectiveDate:'2026-09-14'}),
entity("scrap-disposition-002","scrap-disposition","Scrap disposition recovery record",'blocked',{owner:"Shift Supervisor",measured:4,limit:8,evidence:"REC-FACTORYOS-006",effectiveDate:'2026-09-15'}),
entity("rework-release-001","rework-release","Rework release primary record",'review',{owner:"Production Planner",measured:8,limit:5,evidence:"EV-FACTORYOS-007",effectiveDate:'2026-09-14'}),
entity("rework-release-002","rework-release","Rework release recovery record",'blocked',{owner:"Shift Supervisor",measured:8,limit:5,evidence:"REC-FACTORYOS-007",effectiveDate:'2026-09-15'}),
entity("shift-handoff-001","shift-handoff","Shift handoff timing primary record",'review',{owner:"Production Planner",measured:4,limit:8,evidence:"EV-FACTORYOS-008",effectiveDate:'2026-09-14'}),
entity("shift-handoff-002","shift-handoff","Shift handoff timing recovery record",'blocked',{owner:"Shift Supervisor",measured:4,limit:8,evidence:"REC-FACTORYOS-008",effectiveDate:'2026-09-15'})]
export const product:Product={name:"FactoryOS",description:"Manufacturing execution and factory operations",accent:"#A14512",actors:roles.map((role,index)=>({id:'actor-'+String(index),name:role,role})),kinds,operations,seed,
 validate:(entities)=>{for(const row of entities){requireThat(kinds.some(kind=>kind.key===row.kind),'Unknown domain record.');requireThat(typeof row.fields['owner']==='string','Every workflow requires accountable ownership.')}},
 metrics:(entities)=>[{label:'Domain records',value:String(entities.length)},{label:'Active controls',value:String(entities.filter(row=>['review','authorized','active','blocked'].includes(row.status)).length)},{label:'Blocked',value:String(entities.filter(row=>row.status==='blocked').length)},{label:'Closed',value:String(entities.filter(row=>row.status==='closed').length)}]}
