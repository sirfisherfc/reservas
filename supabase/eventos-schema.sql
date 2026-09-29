-- Configurador de eventos Sir Fisher - objetos isolados do módulo.
-- Aplicar depois do schema principal de reservas. Não altera tabelas existentes.

create table if not exists public.event_pricing_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  cmv_rate numeric(6,5) not null default 0.35 check (cmv_rate between 0 and 1),
  service_rate numeric(6,5) not null default 0.10 check (service_rate between 0 and 1),
  target_contribution_margin numeric(6,5) not null default 0.52 check (target_contribution_margin between 0 and 0.90),
  freelancer_day numeric(12,2) not null default 100 check (freelancer_day >= 0),
  public_notes text,
  internal_notes text,
  effective_from timestamptz not null default now(),
  created_by_user_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists event_pricing_versions_one_active
  on public.event_pricing_versions ((status)) where status = 'active';

create table if not exists public.event_package_rules (
  id uuid primary key default gen_random_uuid(),
  pricing_version_id uuid not null references public.event_pricing_versions(id) on delete restrict,
  food_style text not null check (food_style in ('petiscos', 'petiscos_principal', 'refeicao')),
  profile text not null check (profile in ('essencial', 'equilibrada', 'completa')),
  guest_min int not null check (guest_min >= 1),
  guest_max int not null check (guest_max >= guest_min),
  food_units_per_person numeric(8,3) not null check (food_units_per_person > 0),
  retail_per_person numeric(12,2) not null check (retail_per_person >= 0),
  kitchen_labor_per_person numeric(12,2) not null check (kitchen_labor_per_person >= 0),
  composition jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (pricing_version_id, food_style, profile, guest_min, guest_max)
);

create table if not exists public.event_beverage_rules (
  id uuid primary key default gen_random_uuid(),
  pricing_version_id uuid not null references public.event_pricing_versions(id) on delete restrict,
  mode text not null check (mode in ('individual', 'sem_alcool', 'credito', 'fichas', 'chope', 'selecionado', 'open_bar')),
  retail_per_adult numeric(12,2) not null check (retail_per_adult >= 0),
  units_per_adult numeric(8,3) not null default 0 check (units_per_adult >= 0),
  waste_risk numeric(6,5) not null default 0 check (waste_risk between 0 and 1),
  needs_validation boolean not null default false,
  composition jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  unique (pricing_version_id, mode)
);

create table if not exists public.event_product_rules (
  id uuid primary key default gen_random_uuid(),
  menu_version text not null,
  product_id text not null,
  classification text not null check (classification in ('recommended', 'limited', 'approval', 'not_recommended')),
  batch_friendly boolean not null default false,
  max_guests int,
  rationale text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (menu_version, product_id)
);

create table if not exists public.event_demand_baselines (
  id uuid primary key default gen_random_uuid(),
  month int not null check (month between 1 and 12),
  weekday int not null check (weekday between 0 and 6),
  start_hour int not null check (start_hour between 0 and 23),
  duration_hours numeric(5,2) not null default 3 check (duration_hours > 0),
  sample_size int not null default 0 check (sample_size >= 0),
  median_revenue numeric(14,2) not null,
  low_revenue numeric(14,2) not null,
  high_revenue numeric(14,2) not null,
  opportunity_cost numeric(14,2) not null,
  source_window daterange,
  calculated_at timestamptz not null default now(),
  unique (month, weekday, start_hour, duration_hours)
);

create table if not exists public.event_requests (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  customer_phone text not null check (customer_phone ~ '^[0-9]{10,11}$'),
  event_date date not null,
  start_time time not null,
  duration_hours numeric(5,2) not null check (duration_hours between 2 and 8),
  guests int not null check (guests between 1 and 300),
  children int not null default 0 check (children >= 0 and children <= guests),
  configuration jsonb not null,
  selected_option_id text not null,
  public_snapshot jsonb not null,
  internal_snapshot jsonb not null,
  risk_level text not null check (risk_level in ('verde', 'amarelo', 'vermelho')),
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'adjustment_requested', 'rejected',
    'information_requested', 'alternative_offered', 'final_proposal_ready'
  )),
  pricing_version text not null,
  menu_version text not null,
  accepted_privacy_at timestamptz not null,
  source text not null default 'site' check (source in ('site', 'admin')),
  reviewed_by_user_id uuid,
  discount_approved boolean not null default false,
  discount_reason text,
  discount_approved_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_discount_approval_complete check (
    not discount_approved or (discount_reason is not null and discount_approved_by_user_id is not null)
  )
);

create index if not exists event_requests_queue_idx on public.event_requests(status, risk_level, created_at desc);
create index if not exists event_requests_date_idx on public.event_requests(event_date, start_time);
create index if not exists event_requests_phone_idx on public.event_requests(customer_phone, created_at desc);

create table if not exists public.event_request_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.event_requests(id) on delete restrict,
  action text not null,
  actor_type text not null check (actor_type in ('customer', 'admin', 'socio', 'gerente', 'system')),
  actor_user_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists event_request_audit_request_idx on public.event_request_audit(request_id, created_at);

comment on table public.event_requests is 'Solicitações do configurador; snapshots público e interno preservam o cálculo auditável.';
comment on table public.event_demand_baselines is 'Agregados sem dados brutos para custo de oportunidade; deve ser alimentada por rotina interna read-only sobre as views financeiras.';
