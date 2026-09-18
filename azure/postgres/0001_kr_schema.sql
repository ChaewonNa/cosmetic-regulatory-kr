create extension if not exists pgcrypto;
create schema if not exists kr;

-- KR platform uses the shared public.app_users identity table managed by the Main Portal.
-- Product ownership/reviewer authorization is enforced by the Azure Functions API.

create table if not exists kr.products (
  id uuid primary key default gen_random_uuid(),
  project_number text not null default '',
  company_code text,
  project_year integer,
  project_sequence integer,
  product_code text,
  user_id uuid not null references public.app_users(id),
  reviewer_id uuid references public.app_users(id),
  company_id uuid,
  company_name text not null default '',
  name text not null,
  brand text not null default '',
  product_type text not null default '',
  responsible_seller text,
  manufacturer text,
  manufacturer_address text,
  country_of_origin text,
  supply_type text not null default 'domestic' check (supply_type in ('domestic','import')),
  content_amount text,
  shelf_life text,
  launch_date date,
  sales_status text not null default 'planned' check (sales_status in ('planned','on_market','discontinued','recalled')),
  application_area text,
  usage_method text,
  target_users text,
  infant_child_claim boolean not null default false,
  overseas_manufacturer_name text,
  overseas_manufacturer_address text,
  first_import_date date,
  lot_number text,
  lot_import_date date,
  lot_import_quantity text,
  status text not null default 'draft',
  current_step integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_number)
);
create index if not exists kr_products_user_idx on kr.products(user_id);
create index if not exists kr_products_reviewer_idx on kr.products(reviewer_id);
create index if not exists kr_products_company_idx on kr.products(company_id);

create table if not exists kr.product_classification (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references kr.products(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  classification text not null default 'general' check (classification in ('general','functional_report','functional_review')),
  classification_basis text,
  functional_type text,
  active_ingredient text,
  active_ingredient_content text,
  efficacy_claims text,
  usage_dosage text,
  test_method text,
  report_date date,
  review_date date,
  report_number text,
  review_number text,
  change_report_required boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kr.formula_ingredients (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references kr.products(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  master_code text,
  ingredient_name text not null,
  component_name text,
  korean_name text,
  inci text,
  cas_number text,
  concentration text,
  purpose text,
  ingredient_manufacturer text,
  restrictions text,
  screening_result text not null default 'pending' check (screening_result in ('pass','prohibited','restricted','exceeded','preservative','colorant','uv_filter','functional_active','allergen','review_required','pending')),
  screening_note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kr_formula_product_idx on kr.formula_ingredients(product_id,sort_order);

create table if not exists kr.functional_procedures (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references kr.products(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  procedure_type text not null default 'report' check (procedure_type in ('report','review')),
  status text not null default 'draft' check (status in ('draft','required_documents','report_preparation','submitted','supplement_requested','supplement_submitted','report_completed','review_completed','na')),
  submission_date date,
  completion_date date,
  reference_number text,
  supplement_request_date date,
  supplement_submit_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kr.labels (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references kr.products(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  label_type text not null default 'existing_review' check (label_type in ('existing_review','generated')),
  version_number integer not null default 1,
  file_name text,
  file_type text,
  blob_name text,
  file_data text,
  file_size bigint not null default 0,
  ocr_text text,
  notes text,
  review_status text not null default 'pending' check (review_status in ('pending','pass','revise')),
  reviewer_comments text,
  generated_content jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kr_labels_product_idx on kr.labels(product_id,created_at desc);

create table if not exists kr.safety_assessment (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references kr.products(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  assessment_period text,
  product_photo text,
  product_appearance text,
  product_color text,
  product_odor text,
  product_ph text,
  product_viscosity text,
  product_specific_gravity text,
  product_other_physical text,
  manufacturing_date date,
  lot_no text,
  shelf_life_test text,
  pao_test text,
  test_method_stability text,
  test_condition_stability text,
  test_period_stability text,
  storage_condition text,
  stability_result text,
  packaging_compatibility text,
  active_ingredient_result text,
  microbial_test_result jsonb,
  preservative_test_result jsonb,
  microbial_test_skipped boolean not null default false,
  microbial_skip_justification text,
  exposure_area text,
  exposure_amount text,
  exposure_frequency text,
  exposure_duration text,
  rinse_off boolean not null default false,
  exposure_route text,
  sed_data jsonb,
  toxicology_data jsonb,
  adverse_event_summary text,
  other_safety_info text,
  assessment_conclusion text not null default 'pending' check (assessment_conclusion in ('pending','safe','additional_info_required','reassessment_required')),
  assessment_discussion text,
  conclusion_text text,
  precautions text,
  assessor_name text,
  assessor_organization text,
  assessor_qualification text,
  assessment_date date,
  assessor_signature text,
  assessor_approved boolean not null default false,
  report_status text not null default 'draft' check (report_status in ('draft','final')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kr.quality_records (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references kr.products(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  test_name text not null,
  test_method text,
  acceptance_criteria text,
  test_date date,
  result text,
  pass_fail text not null default 'pending' check (pass_fail in ('pass','fail','pending')),
  next_review_date date,
  lot_number text,
  manufacturing_date date,
  report_file text,
  report_blob_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kr_quality_product_idx on kr.quality_records(product_id,created_at desc);

create table if not exists kr.import_records (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references kr.products(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  korean_product_name text,
  ingredient_spec_content text,
  country_of_origin text,
  manufacturer_name text,
  manufacturer_address text,
  functional_review_notice text,
  manufacturing_sales_certificate text,
  korean_product_description text,
  first_import_date date,
  lot_number text,
  lot_import_date date,
  lot_import_quantity text,
  item_status text not null default 'required' check (item_status in ('required','conditional','na','completed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kr.postmarket_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references kr.products(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  event_type text not null check (event_type in ('consumer_complaint','adverse_event','serious_adverse_event','quality_nonconformity','recall','sales_stop','investigation','capa','regulatory_report','follow_up')),
  event_date date,
  description text,
  severity text not null default 'minor' check (severity in ('minor','moderate','serious','critical')),
  status text not null default 'open' check (status in ('open','investigating','resolved','closed')),
  investigation text,
  capa_actions text,
  regulatory_report_required boolean not null default false,
  regulatory_report_date date,
  follow_up_actions text,
  safety_impact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kr_postmarket_product_idx on kr.postmarket_events(product_id,created_at desc);

create table if not exists kr.product_documents (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references kr.products(id) on delete cascade,
  user_id uuid references public.app_users(id),
  workflow_step text,
  document_type text not null default '',
  document_category text not null default '',
  file_name text not null default '',
  file_type text not null default '',
  blob_name text,
  file_size bigint not null default 0,
  review_status text not null default 'not_started',
  reviewer_comments text,
  version_number integer not null default 1,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kr_documents_product_idx on kr.product_documents(product_id,created_at desc);

create table if not exists kr.step_comments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references kr.products(id) on delete cascade,
  parent_id uuid references kr.step_comments(id) on delete cascade,
  author_id uuid references public.app_users(id),
  author_name text not null default '',
  author_role text not null default 'customer',
  workflow_step text not null default '',
  body text not null,
  is_edited boolean not null default false,
  edited_at timestamptz,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kr.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  user_id uuid references public.app_users(id),
  action text not null,
  field_name text,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index if not exists kr_audit_record_idx on kr.audit_logs(table_name,record_id,created_at desc);
