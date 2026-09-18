import { HttpRequest } from '@azure/functions';
import { query } from './db';

export type AppRole='admin'|'ra'|'customer';
export type AppActor={id:string;email:string;fullName:string|null;role:AppRole;companyName:string|null;businessRegistrationNumber:string|null;jobTitle:string|null;phone:string|null;disabled:boolean};
type ClientPrincipal={identityProvider?:string;userId?:string;userDetails?:string;claims?:Array<{typ?:string;val?:string}>};
export class AccessError extends Error{constructor(message:string,public status:400|401|403|404=401){super(message)}}

const ADMIN_EMAILS = new Set([
  'ellin9311@gmail.com',
  'hye-lin.hong@tuvsud.com',
]);

function roleForEmail(email:string):AppRole{
  const normalized=email.trim().toLowerCase();
  if(ADMIN_EMAILS.has(normalized))return'admin';
  if(normalized.endsWith('@tuvsud.com'))return'ra';
  return'customer';
}
function principal(request:HttpRequest):ClientPrincipal|null{
  const raw=request.headers.get('x-ms-client-principal');if(!raw)return null;
  try{return JSON.parse(Buffer.from(raw,'base64').toString('utf8')) as ClientPrincipal}catch{return null}
}
function emailOf(p:ClientPrincipal):string{
  const preferred=['portal_email','emails','email','http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress','preferred_username'];
  for(const key of preferred){const found=(p.claims||[]).find(c=>c.typ===key&&c.val);if(found?.val)return found.val.trim().toLowerCase()}
  return String(p.userDetails||'').trim().toLowerCase();
}
function missingIdentityTable(error:unknown){return typeof error==='object'&&error!==null&&'code'in error&&(error as {code?:string}).code==='42P01'}

async function findMappedUser(provider:string,subject:string):Promise<any|undefined>{
  try{
    return (await query<any>(
      `select u.* from public.app_user_identities i
       join public.app_users u on u.id=i.app_user_id
       where i.identity_provider=$1 and i.identity_subject=$2
       limit 1`,[provider,subject]))[0];
  }catch(error){if(missingIdentityTable(error))return undefined;throw error}
}
async function linkIdentity(userId:string,provider:string,subject:string,email:string){
  try{
    await query(
      `insert into public.app_user_identities(app_user_id,identity_provider,identity_subject,email_snapshot,updated_at)
       values($1,$2,$3,$4,now())
       on conflict(identity_provider,identity_subject) do update
       set app_user_id=excluded.app_user_id,email_snapshot=excluded.email_snapshot,updated_at=now()`,
      [userId,provider,subject,email]);
  }catch(error){if(!missingIdentityTable(error))throw error}
}

async function resolveUser(provider:string,subject:string,email:string):Promise<any>{
  const protectedAdmin=ADMIN_EMAILS.has(email),initialRole=roleForEmail(email),initialStatus=protectedAdmin||email.endsWith('@tuvsud.com')?'active':'pending';
  let user=await findMappedUser(provider,subject);
  if(!user){
    user=(await query<any>(
      `select * from public.app_users where lower(email)=lower($1)
       order by case when account_status='active' then 0 else 1 end,
                case when disabled=false then 0 else 1 end,
                created_at asc,id asc limit 1`,[email]))[0];
  }
  if(!user){
    const inserted=await query<any>(
      `insert into public.app_users(identity_provider,identity_subject,email,role,account_status)
       values($1,$2,$3,$4,$5)
       on conflict do nothing returning *`,[provider,subject,email,initialRole,initialStatus]);
    user=inserted[0]||(await query<any>(`select * from public.app_users where lower(email)=lower($1) order by created_at asc limit 1`,[email]))[0];
  }
  if(!user)throw new AccessError('Unable to provision shared portal account',403);
  await linkIdentity(user.id,provider,subject,email);
  const updated=(await query<any>(
    `update public.app_users set email=$1,
       role=case when $2 then 'admin' else role end,
       account_status=case when $2 then 'active' else account_status end,
       updated_at=now() where id=$3 returning *`,[email,protectedAdmin,user.id]))[0];
  return updated||user;
}

export async function requireActor(request:HttpRequest):Promise<AppActor>{
  const p=principal(request);if(!p?.userId)throw new AccessError('Authentication required',401);
  const email=emailOf(p);if(!email)throw new AccessError('Authenticated account has no email claim',401);
  const provider=p.identityProvider||'externalid';
  const u=await resolveUser(provider,p.userId,email);
  if(u.disabled||u.account_status==='disabled')throw new AccessError('Account disabled',403);
  if(u.account_status!=='active')throw new AccessError(u.account_status==='rejected'?'Account registration rejected':'Account approval pending. Complete company information in the Main Portal and wait for administrator approval.',403);
  return{id:u.id,email:u.email,fullName:u.full_name,role:u.role,companyName:u.company_name,businessRegistrationNumber:u.business_registration_number,jobTitle:u.job_title,phone:u.phone,disabled:u.disabled};
}
