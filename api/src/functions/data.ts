import { app,HttpRequest,HttpResponseInit,InvocationContext } from '@azure/functions';
import { AccessError,AppActor,requireActor } from '../shared/auth';
import { query } from '../shared/db';
import { allocateProjectNumber } from '../shared/projectNumber';

type Filter={op?:string;column?:string;value?:unknown};
type Order={column?:string;ascending?:boolean};
type Body={table?:string;action?:'select'|'insert'|'update'|'delete';payload?:any;columns?:string;filters?:Filter[];orders?:Order[];limit?:number|null;single?:boolean;count?:string|null;head?:boolean};

const TABLES:Record<string,string>={
  kr_products:'kr.products',
  kr_product_classification:'kr.product_classification',
  kr_formula_ingredients:'kr.formula_ingredients',
  kr_functional_procedures:'kr.functional_procedures',
  kr_labels:'kr.labels',
  kr_safety_assessment:'kr.safety_assessment',
  kr_quality_records:'kr.quality_records',
  kr_import_records:'kr.import_records',
  kr_postmarket_events:'kr.postmarket_events',
  kr_product_documents:'kr.product_documents',
  kr_step_comments:'kr.step_comments',
  kr_audit_logs:'kr.audit_logs',
  user_profiles:'public.app_users',
};

const PRODUCT_CHILD=new Set([
  'kr_product_classification','kr_formula_ingredients','kr_functional_procedures','kr_labels',
  'kr_safety_assessment','kr_quality_records','kr_import_records','kr_postmarket_events',
  'kr_product_documents','kr_step_comments',
]);
const IDENT=/^[a-z_][a-z0-9_]*$/i;

function id(v:string|undefined){if(!v||!IDENT.test(v))throw new Error('Invalid identifier');return v}
function cols(v:string|undefined){if(!v||v==='*')return'*';const l=v.split(',').map(x=>x.trim()).filter(Boolean);return l.length&&l.every(x=>IDENT.test(x))?l.map(id).join(', '):'*'}

function scope(logical:string,a:AppActor,vals:unknown[]):string[]{
  if(a.role==='admin')return[];
  if(logical==='user_profiles'){vals.push(a.id);return[`id=$${vals.length}`]}
  if(logical==='kr_products'){
    vals.push(a.id);
    return a.role==='ra'?[`reviewer_id=$${vals.length}`]:[`user_id=$${vals.length}`];
  }
  if(PRODUCT_CHILD.has(logical)){
    vals.push(a.id);
    return a.role==='ra'
      ?[`product_id in (select id from kr.products where reviewer_id=$${vals.length})`]
      :[`product_id in (select id from kr.products where user_id=$${vals.length})`];
  }
  if(logical==='kr_audit_logs')return['false'];
  return['false'];
}

function fsql(fs:Filter[]|undefined,vals:unknown[]){
  const o:string[]=[];
  for(const f of fs||[]){
    const c=id(String(f.column||''));
    if(f.op==='is'&&(f.value==null)){o.push(`${c} is null`);continue}
    if(f.op==='in'){vals.push(Array.isArray(f.value)?f.value:[]);o.push(`${c}=any($${vals.length})`);continue}
    vals.push(f.value);o.push(`${c} is not distinct from $${vals.length}`)
  }
  return o;
}
function where(p:string[]){return p.length?` where ${p.join(' and ')}`:''}
function order(os:Order[]|undefined){const l=(os||[]).filter(o=>o.column&&IDENT.test(o.column)).map(o=>`${id(o.column!)} ${o.ascending===false?'desc':'asc'}`);return l.length?` order by ${l.join(', ')}`:''}

async function requireOwnedProduct(productId:string,a:AppActor){
  if(a.role==='admin')return;
  const rows=a.role==='ra'
    ?await query<any>('select id from kr.products where id=$1 and reviewer_id=$2 limit 1',[productId,a.id])
    :await query<any>('select id from kr.products where id=$1 and user_id=$2 limit 1',[productId,a.id]);
  if(!rows[0])throw new AccessError('Product access denied',403);
}

async function own(logical:string,a:AppActor,row:any){
  if(a.role==='admin')return;
  if(logical==='user_profiles'||logical==='kr_audit_logs')throw new AccessError('Write access denied',403);
  if(logical==='kr_products'){
    if(a.role==='customer')row.user_id=a.id;
    if(a.role==='ra')row.reviewer_id=a.id;
    return;
  }
  if(PRODUCT_CHILD.has(logical)){
    const pid=row?.product_id;
    if(!pid)throw new AccessError('Product is required',403);
    await requireOwnedProduct(pid,a);
    if(a.role==='customer')row.user_id=a.id;
  }
}

async function audit(actor:AppActor,logical:string,action:string,recordId:unknown,fields:string[]=[]){
  if(logical==='kr_audit_logs')return;
  try{
    await query(
      'insert into kr.audit_logs(table_name,record_id,user_id,action,field_name) values($1,$2::uuid,$3,$4,$5)',
      [logical,typeof recordId==='string'?recordId:null,actor.id,action,fields.length?fields.join(','):null],
    );
  }catch{}
}

async function insertRows(table:string,logical:string,a:AppActor,payload:any){
  const arr=Array.isArray(payload)?payload:[payload],out:any[]=[];
  for(const src of arr){
    const row={...(src||{})};
    await own(logical,a,row);
    if(logical==='kr_products'&&!String(row.project_number||'').trim()){
      let companyKey=`USER:${row.user_id||a.id}`;
      if(row.company_id) companyKey=`COMPANY:${row.company_id}`;
      else if(a.businessRegistrationNumber){
        const registration=String(a.businessRegistrationNumber).replace(/[\s-]/g,'').toUpperCase();
        if(registration)companyKey=`BRN:${registration}`;
      }
      const number=await allocateProjectNumber('KR','kr.products',companyKey);
      Object.assign(row,{
        project_number:number.projectNumber,
        company_code:number.companyCode,
        project_year:number.year,
        project_sequence:number.sequence,
      });
    }
    const keys=Object.keys(row).filter(k=>IDENT.test(k));
    if(!keys.length)throw new Error('Empty insert');
    const vals=keys.map(k=>row[k]);
    const rows=await query<any>(`insert into ${table} (${keys.map(id).join(',')}) values (${keys.map((_,i)=>`$${i+1}`).join(',')}) returning *`,vals);
    out.push(...rows);
    for(const inserted of rows)await audit(a,logical,'insert',inserted?.id,keys);
  }
  return Array.isArray(payload)?out:out[0]||null;
}

export async function data(req:HttpRequest,ctx:InvocationContext):Promise<HttpResponseInit>{
  try{
    const a=await requireActor(req),b=await req.json() as Body,logical=String(b.table||''),table=TABLES[logical];
    if(!table)return{status:400,jsonBody:{error:'Unsupported table'}};
    const action=b.action||'select';

    if(logical==='kr_audit_logs'&&a.role!=='admin')throw new AccessError('Access denied',403);

    if(action==='insert'){
      const d=await insertRows(table,logical,a,b.payload);
      return{status:200,jsonBody:{data:b.single?(Array.isArray(d)?d[0]||null:d):d,error:null}};
    }

    const vals:unknown[]=[];
    const w=where([...scope(logical,a,vals),...fsql(b.filters,vals)]);

    if(action==='select'){
      let count:number|null=null;
      if(b.count){const c=await query<{count:string}>(`select count(*)::text count from ${table}${w}`,vals);count=Number(c[0]?.count||0)}
      if(b.head)return{status:200,jsonBody:{data:null,error:null,count}};
      const lim=Number.isInteger(b.limit)&&Number(b.limit)>0?` limit ${Math.min(Number(b.limit),1000)}`:'';
      const rows=await query<any>(`select ${cols(b.columns)} from ${table}${w}${order(b.orders)}${lim}`,vals);
      return{status:200,jsonBody:{data:b.single?(rows[0]||null):rows,error:null,count}};
    }

    if(action==='update'){
      const row={...(b.payload||{})};
      if(logical==='user_profiles'){
        delete row.role;delete row.disabled;delete row.account_status;delete row.disabled_at;delete row.disabled_by;delete row.disabled_reason;
      }
      if(a.role!=='admin'&&logical==='kr_products'){
        delete row.reviewer_id;delete row.user_id;delete row.project_number;delete row.company_code;delete row.project_year;delete row.project_sequence;
      }
      const keys=Object.keys(row).filter(k=>IDENT.test(k));
      if(!keys.length)return{status:200,jsonBody:{data:b.single?null:[],error:null}};
      const sv=keys.map(k=>row[k]);
      const sets=keys.map((k,i)=>`${id(k)}=$${i+1}`).join(',');
      const shifted=w.replace(/\$(\d+)/g,(_,n)=>`$${Number(n)+sv.length}`);
      const rows=await query<any>(`update ${table} set ${sets}${shifted} returning *`,[...sv,...vals]);
      for(const changed of rows)await audit(a,logical,'update',changed?.id,keys);
      return{status:200,jsonBody:{data:b.single?(rows[0]||null):rows,error:null}};
    }

    if(action==='delete'){
      const rows=await query<any>(`delete from ${table}${w} returning *`,vals);
      for(const deleted of rows)await audit(a,logical,'delete',deleted?.id,[]);
      return{status:200,jsonBody:{data:b.single?(rows[0]||null):rows,error:null}};
    }

    return{status:400,jsonBody:{error:'Unsupported action'}};
  }catch(e){
    if(e instanceof AccessError)return{status:e.status,jsonBody:{error:e.message}};
    ctx.error(e);
    return{status:500,jsonBody:{error:e instanceof Error?e.message:'Azure data request failed'}};
  }
}

app.http('data',{methods:['POST'],authLevel:'anonymous',route:'data',handler:data});
