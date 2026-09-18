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

function roleForEmail(email: string): AppRole {
  const normalized = email.trim().toLowerCase();
  if (ADMIN_EMAILS.has(normalized)) return 'admin';
  if (normalized.endsWith('@tuvsud.com')) return 'ra';
  return 'customer';
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
export async function requireActor(request:HttpRequest):Promise<AppActor>{
  const p=principal(request);if(!p?.userId)throw new AccessError('Authentication required',401);
  const email=emailOf(p);if(!email)throw new AccessError('Authenticated account has no email claim',401);
  const provider=p.identityProvider||'externalid',initialRole=roleForEmail(email),protectedAdmin=ADMIN_EMAILS.has(email),initialStatus=protectedAdmin||email.endsWith('@tuvsud.com')?'active':'pending';
  let rows=await query<any>(
    `select * from public.app_users
      where (identity_provider=$1 and identity_subject=$2) or lower(email)=lower($3)
      order by case when identity_provider=$1 and identity_subject=$2 then 0 else 1 end
      limit 1`,
    [provider,p.userId,email],
  );
  if(rows[0]){
    rows=await query<any>(
      `update public.app_users
          set email=$1,
              role=case when $2 then 'admin' else role end,
              account_status=case when $2 then 'active' else account_status end,
              identity_provider=coalesce(identity_provider,$4),
              identity_subject=coalesce(identity_subject,$5),
              updated_at=now()
        where id=$3 returning *`,
      [email,protectedAdmin,rows[0].id,provider,p.userId],
    );
  }else{
    rows=await query<any>(
      `insert into public.app_users(identity_provider,identity_subject,email,role,account_status)
       values($1,$2,$3,$4,$6)
       on conflict(identity_provider,identity_subject) do update
         set email=excluded.email,
           role=case when excluded.email=any($5::text[]) then 'admin' else public.app_users.role end,
           account_status=case when excluded.email=any($5::text[]) then 'active' else public.app_users.account_status end,
           updated_at=now()
       returning *`,
      [provider,p.userId,email,initialRole,Array.from(ADMIN_EMAILS),initialStatus],
    );
  }
  const u=rows[0];if(u.disabled||u.account_status==='disabled')throw new AccessError('Account disabled',403);if(u.account_status!=='active')throw new AccessError(u.account_status==='rejected'?'Account registration rejected':'Account approval pending. Complete company information in the Main Portal and wait for administrator approval.',403);
  return{id:u.id,email:u.email,fullName:u.full_name,role:u.role,companyName:u.company_name,businessRegistrationNumber:u.business_registration_number,jobTitle:u.job_title,phone:u.phone,disabled:u.disabled};
}
