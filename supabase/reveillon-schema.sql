-- Sir Fisher Praia — reveillon-schema.sql
-- Módulo de Réveillon: venda de mesas numeradas para a noite de 31/12.
-- Totalmente separado da reserva comum (public.reservations): tabelas próprias
-- com prefixo rv_, funções em reveillon-functions.sql, RLS em reveillon-rls.sql.
--
-- Ordem de aplicação: reveillon-schema.sql → reveillon-functions.sql →
-- reveillon-rls.sql → reveillon-seed.sql → reveillon-integration.sql.
-- Todos são idempotentes o suficiente para rodar de novo sem quebrar
-- (create ... if not exists / create or replace / on conflict).

-- =========================================================================
-- rv_events — o evento e todos os seus parâmetros (nada fixo no front)
-- =========================================================================
create table if not exists public.rv_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name text not null check (length(name) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Fortaleza',
  venue_name text,
  address text,
  menu_url text,
  included_items jsonb not null default '[]'::jsonb,   -- lista de strings
  texts jsonb not null default '{}'::jsonb,            -- textos públicos (ver seed)
  whatsapp_templates jsonb not null default '{}'::jsonb,
  map jsonb not null default '{}'::jsonb,              -- viewBox + elementos de referência (mar, mureta, DJ)
  pix_key text,
  pix_key_type text,
  pix_holder text,
  whatsapp_number text,
  deposit_pct numeric(5,2) not null default 30 check (deposit_pct > 0 and deposit_pct <= 100),
  pix_discount_pct numeric(5,2) not null default 5 check (pix_discount_pct >= 0 and pix_discount_pct < 100),
  hold_hours int not null default 48 check (hold_hours between 1 and 720),
  expiry_warning_hours int not null default 12 check (expiry_warning_hours between 0 and 720),
  balance_due_date date,
  child_discount numeric(10,2) not null default 100 check (child_discount >= 0),
  child_max_age int not null default 11 check (child_max_age between 0 and 17),
  max_active_holds_per_contact int not null default 3 check (max_active_holds_per_contact between 1 and 50),
  seat_limit int check (seat_limit is null or seat_limit > 0),
  sales_open boolean not null default true,
  emails_enabled boolean not null default false,
  tracking jsonb not null default '{"ga4": false, "meta": false, "openai_ads": false}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.app_users(id) on delete set null,
  constraint chk_rv_events_dates check (ends_at > starts_at)
);

comment on column public.rv_events.emails_enabled is
  'Liga os e-mails automáticos do réveillon (notification_queue). Nasce desligado até o template da Edge Function estar publicado.';
comment on column public.rv_events.tracking is
  'Conversões de Ads do réveillon (ga4/meta/openai_ads). Tudo false = nenhum evento disparado.';

-- =========================================================================
-- rv_terms — versões do texto integral dos termos (nunca sobrescreve)
-- =========================================================================
create table if not exists public.rv_terms (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rv_events(id) on delete cascade,
  version int not null check (version > 0),
  body text not null check (length(body) between 20 and 30000),
  created_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, version)
);

-- =========================================================================
-- rv_table_types — lateral / central / bistrô (regras de pessoas, sem preço)
-- =========================================================================
create table if not exists public.rv_table_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rv_events(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (length(name) <= 60),
  description text check (description is null or length(description) <= 300),
  color text not null default '#2f6f8f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  min_people int not null check (min_people >= 1),
  included_people int not null check (included_people >= 1),
  max_people int not null,
  allows_extra_chairs boolean not null default false,
  max_infants int not null default 4 check (max_infants >= 0),
  counts_toward_limit boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, code),
  constraint chk_rv_types_people check (min_people <= max_people and included_people <= max_people)
);

-- =========================================================================
-- rv_tables — mesas numeradas + posição no mapa SVG
-- =========================================================================
create table if not exists public.rv_tables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rv_events(id) on delete cascade,
  table_type_id uuid not null references public.rv_table_types(id) on delete restrict,
  label text not null check (length(label) between 1 and 10),
  x numeric(8,2) not null default 0,
  y numeric(8,2) not null default 0,
  w numeric(8,2) not null default 80 check (w > 0),
  h numeric(8,2) not null default 60 check (h > 0),
  rotation numeric(6,2) not null default 0,
  shape text not null default 'rect' check (shape in ('rect', 'round')),
  blocked boolean not null default false,
  block_reason text check (block_reason is null or length(block_reason) <= 200),
  -- "Em negociação" marcado à mão pelo admin: sem cliente e sem prazo.
  negotiating boolean not null default false,
  negotiation_note text check (negotiation_note is null or length(negotiation_note) <= 200),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, label)
);

create index if not exists idx_rv_tables_event on public.rv_tables(event_id);

-- =========================================================================
-- rv_lots + rv_lot_prices — lotes de venda com preço por tipo de mesa
-- =========================================================================
create table if not exists public.rv_lots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rv_events(id) on delete cascade,
  name text not null check (length(name) <= 60),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name),
  constraint chk_rv_lots_dates check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create table if not exists public.rv_lot_prices (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.rv_lots(id) on delete cascade,
  table_type_id uuid not null references public.rv_table_types(id) on delete cascade,
  table_price numeric(10,2) not null check (table_price >= 0),
  table_consumption numeric(10,2) not null default 0 check (table_consumption >= 0),
  extra_chair_price numeric(10,2) not null default 0 check (extra_chair_price >= 0),
  extra_chair_consumption numeric(10,2) not null default 0 check (extra_chair_consumption >= 0),
  updated_at timestamptz not null default now(),
  unique (lot_id, table_type_id)
);

-- =========================================================================
-- rv_bookings — reservas de mesa do réveillon
-- Os preços do lote são COPIADOS para a reserva (snapshot): mudar o lote ou o
-- preço depois não altera reservas já feitas. Os totais gravados são sempre
-- recalculados pela mesma função rv_calc_price usada na simulação pública.
-- =========================================================================
create table if not exists public.rv_bookings (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  event_id uuid not null references public.rv_events(id) on delete restrict,
  table_id uuid not null references public.rv_tables(id) on delete restrict,
  lot_id uuid references public.rv_lots(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_phone text not null check (length(customer_phone) between 8 and 30),
  customer_email citext,
  adults int not null check (adults >= 0),
  children int not null default 0 check (children >= 0),
  infants int not null default 0 check (infants >= 0),
  customer_notes text check (customer_notes is null or length(customer_notes) <= 500),
  internal_notes text check (internal_notes is null or length(internal_notes) <= 2000),
  status text not null default 'pre_reserva'
    check (status in ('pre_reserva', 'sinal_pago', 'quitada', 'cancelada', 'expirada')),
  hold_expires_at timestamptz,

  -- snapshot de preço/regra no momento da criação (ou da última troca de mesa)
  snap_table_price numeric(10,2) not null,
  snap_table_consumption numeric(10,2) not null,
  snap_extra_chair_price numeric(10,2) not null,
  snap_extra_chair_consumption numeric(10,2) not null,
  snap_included_people int not null,
  snap_allows_extra_chairs boolean not null,
  snap_child_discount numeric(10,2) not null,
  snap_pix_discount_pct numeric(5,2) not null,
  snap_deposit_pct numeric(5,2) not null,

  manual_discount_type text check (manual_discount_type in ('pct', 'amount')),
  manual_discount_value numeric(10,2) not null default 0 check (manual_discount_value >= 0),
  manual_discount_reason text check (manual_discount_reason is null or length(manual_discount_reason) <= 300),
  manual_discount_by_user_id uuid references public.app_users(id) on delete set null,
  manual_discount_at timestamptz,

  -- valores gravados (sempre = rv_calc_price sobre o snapshot)
  total_amount numeric(10,2) not null,
  total_pix_amount numeric(10,2) not null,
  consumption_total numeric(10,2) not null,
  deposit_min_amount numeric(10,2) not null,

  terms_id uuid references public.rv_terms(id) on delete restrict,
  terms_accepted_at timestamptz,
  marketing_opt_in boolean not null default false,
  source text not null check (source in ('public_site', 'admin')),
  attribution jsonb not null default '{}'::jsonb,
  below_min_override boolean not null default false,

  deposit_paid_at timestamptz,
  paid_in_full_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.app_users(id) on delete set null,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  created_by_user_id uuid references public.app_users(id) on delete set null,
  updated_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_rv_bookings_people check (adults + children >= 1),
  constraint chk_rv_bookings_terms check (source = 'admin' or (terms_id is not null and terms_accepted_at is not null)),
  constraint chk_rv_bookings_discount check (manual_discount_type <> 'pct' or manual_discount_value <= 100)
);

-- GARANTIA DE NEGÓCIO: no máximo 1 reserva ativa por mesa. É o índice que
-- impede duas pré-reservas simultâneas na mesma mesa — mesmo que duas
-- transações cheguem no mesmo milissegundo, a segunda falha com unique_violation.
create unique index if not exists uq_rv_bookings_one_active_per_table
  on public.rv_bookings(table_id)
  where status in ('pre_reserva', 'sinal_pago', 'quitada');

create index if not exists idx_rv_bookings_event_status on public.rv_bookings(event_id, status);
create index if not exists idx_rv_bookings_hold on public.rv_bookings(hold_expires_at) where status = 'pre_reserva';
create index if not exists idx_rv_bookings_phone on public.rv_bookings(customer_phone);
create index if not exists idx_rv_bookings_email on public.rv_bookings(customer_email);

-- =========================================================================
-- rv_payments — vários pagamentos por reserva; nunca apagados (estorno = void)
-- =========================================================================
create table if not exists public.rv_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.rv_bookings(id) on delete cascade,
  paid_at timestamptz not null default now(),
  amount numeric(10,2) not null check (amount > 0),
  method text not null check (method in ('pix', 'debito', 'credito')),
  payer_name text check (payer_name is null or length(payer_name) <= 120),
  notes text check (notes is null or length(notes) <= 300),
  created_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by_user_id uuid references public.app_users(id) on delete set null,
  void_reason text check (void_reason is null or length(void_reason) <= 300)
);

create index if not exists idx_rv_payments_booking on public.rv_payments(booking_id);

-- =========================================================================
-- rv_booking_history — log imutável de tudo o que acontece com a reserva
-- =========================================================================
create table if not exists public.rv_booking_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.rv_bookings(id) on delete cascade,
  action text not null,
  old_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb,
  actor_user_id uuid references public.app_users(id) on delete set null,
  actor_type text not null check (actor_type in ('customer', 'operator', 'admin', 'system')),
  created_at timestamptz not null default now()
);

create index if not exists idx_rv_history_booking on public.rv_booking_history(booking_id, created_at);

-- =========================================================================
-- rv_table_state — estado público de cada mesa (sem nome, sem valor).
-- Mantida por trigger. É a única tabela do módulo que o anon enxerga e é a
-- que entra no Supabase Realtime: o site recebe "algo mudou na mesa X" e
-- busca o estado atualizado pela função pública.
-- =========================================================================
create table if not exists public.rv_table_state (
  table_id uuid primary key references public.rv_tables(id) on delete cascade,
  event_id uuid not null references public.rv_events(id) on delete cascade,
  state text not null check (state in ('livre', 'negociacao', 'reservada', 'bloqueada')),
  updated_at timestamptz not null default now()
);

-- Para bancos criados antes destas colunas existirem.
alter table public.rv_events add column if not exists seat_limit int check (seat_limit is null or seat_limit > 0);
alter table public.rv_table_types add column if not exists counts_toward_limit boolean not null default true;
comment on column public.rv_events.seat_limit is
  'Máximo de pessoas sentadas (adultos + crianças) somando todas as reservas ativas em mesas cujo tipo conta no limite (laterais e centrais). Bistrô fica fora. Null = sem limite.';

-- =========================================================================
-- notification_queue — liga um e-mail a uma reserva de réveillon
-- =========================================================================
alter table public.notification_queue
  add column if not exists rv_booking_id uuid references public.rv_bookings(id) on delete cascade;

create index if not exists idx_notification_queue_rv_booking
  on public.notification_queue(rv_booking_id) where rv_booking_id is not null;
