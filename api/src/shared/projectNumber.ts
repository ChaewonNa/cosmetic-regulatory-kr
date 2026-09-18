import { query } from './db';

let ready = false;

export async function allocateProjectNumber(
  market: 'US' | 'EU' | 'CN' | 'KR',
  targetTable: string,
  companyKey: string,
): Promise<{ projectNumber: string; companyCode: string; year: number; sequence: number }> {
  if (!/^(us\.products|eu\.projects|projects|kr\.products)$/.test(targetTable)) throw new Error('Invalid project table');
  if (!ready) {
    await query(`create sequence if not exists public.company_project_code_seq start 1`);
    await query(`create table if not exists public.company_project_codes (
      company_key text primary key,
      company_code text not null unique,
      created_at timestamptz not null default now()
    )`);
    await query(`create table if not exists public.project_number_counters (
      market text not null,
      company_code text not null,
      project_year integer not null,
      last_sequence integer not null default 0,
      primary key (market, company_code, project_year)
    )`);
    await query(`alter table ${targetTable} add column if not exists company_code text`);
    await query(`alter table ${targetTable} add column if not exists project_year integer`);
    await query(`alter table ${targetTable} add column if not exists project_sequence integer`);
    await query(`alter table ${targetTable} add column if not exists project_number text`);
    await query(`create unique index if not exists ${market.toLowerCase()}_project_number_unique on ${targetTable}(project_number) where project_number is not null and project_number <> ''`);
    ready = true;
  }

  await query(
    `insert into public.company_project_codes(company_key, company_code)
     values ($1, 'C' || lpad(nextval('public.company_project_code_seq')::text, 4, '0'))
     on conflict (company_key) do nothing`,
    [companyKey],
  );
  const companyRows = await query<{ company_code: string }>(
    'select company_code from public.company_project_codes where company_key=$1',
    [companyKey],
  );
  const companyCode = companyRows[0]?.company_code;
  if (!companyCode) throw new Error('Could not allocate company code');

  const year = new Date().getUTCFullYear();
  const counterRows = await query<{ last_sequence: number }>(
    `insert into public.project_number_counters(market,company_code,project_year,last_sequence)
     values($1,$2,$3,1)
     on conflict(market,company_code,project_year)
     do update set last_sequence=public.project_number_counters.last_sequence+1
     returning last_sequence`,
    [market, companyCode, year],
  );
  const sequence = Number(counterRows[0]?.last_sequence || 1);
  return {
    companyCode,
    year,
    sequence,
    projectNumber: `${market}-${companyCode}-${String(year).slice(-2)}-${String(sequence).padStart(3, '0')}`,
  };
}
