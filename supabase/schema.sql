-- Sir Fisher Praia — schema.sql
-- Tabelas, índices e constraints. RLS/policies/grants em rls.sql, funções/triggers em functions.sql.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- =========================================================================
-- app_users — perfis internos autorizados (admin/operador)
-- =========================================================================
create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email citext not null unique,
  name text,
  role text not null check (role in ('admin', 'operator')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_app_users_auth_user_id on public.app_users(auth_user_id);

comment on table public.app_users is
  'Cadastro por e-mail feito pelo admin; auth_user_id é vinculado automaticamente no primeiro login (ver fn_claim_app_user).';

-- =========================================================================
-- access_requests — pedido de acesso de quem loga sem estar em app_users
-- =========================================================================
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email citext not null,
  name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by_user_id uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  role_granted text check (role_granted in ('admin', 'operator'))
);

create index idx_access_requests_status on public.access_requests(status);

-- =========================================================================
-- customers — CRM básico, separado das reservas
-- =========================================================================
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email citext,
  phone text,
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  first_reservation_at timestamptz,
  last_reservation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_customer_contact check (email is not null or phone is not null)
);

create index idx_customers_phone on public.customers(phone);
create index idx_customers_email on public.customers(email);

-- =========================================================================
-- reservations
-- =========================================================================
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name_snapshot text not null check (length(customer_name_snapshot) <= 120),
  customer_email_snapshot citext,
  customer_phone_snapshot text not null,
  reservation_date date not null,
  reservation_time time not null,
  party_size int not null check (party_size > 0 and party_size <= 1000),
  status text not null default 'confirmada' check (status in (
    'confirmada', 'cancelada_cliente', 'cancelada_restaurante',
    'compareceu', 'no_show', 'desistiu', 'recusada'
  )),
  customer_notes text check (customer_notes is null or length(customer_notes) <= 500),
  internal_notes text check (internal_notes is null or length(internal_notes) <= 2000),
  cancellation_token_hash text unique,
  source text not null check (source in ('public_site', 'admin')),
  created_by_user_id uuid references public.app_users(id) on delete set null,
  updated_by_user_id uuid references public.app_users(id) on delete set null,
  accepted_policy boolean not null default false,
  marketing_opt_in boolean not null default false,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('customer', 'operator', 'admin', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_reservations_date_time on public.reservations(reservation_date, reservation_time);
create index idx_reservations_status on public.reservations(status);
create index idx_reservations_customer on public.reservations(customer_id);

-- =========================================================================
-- reservation_status_history — log imutável (só o trigger grava)
-- =========================================================================
create table public.reservation_status_history (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by_user_id uuid references public.app_users(id) on delete set null,
  changed_by_type text not null check (changed_by_type in ('customer', 'operator', 'admin', 'system')),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);

create index idx_status_history_reservation on public.reservation_status_history(reservation_id);

-- =========================================================================
-- restaurant_settings — parâmetros globais chave/valor
-- =========================================================================
create table public.restaurant_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text,
  is_public boolean not null default false,
  updated_by_user_id uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- availability_rules — grade recorrente por dia da semana (0=domingo..6=sábado)
-- =========================================================================
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  weekday int not null check (weekday between 0 and 6),
  time_slot time not null,
  enabled boolean not null default true,
  max_people int not null default 0 check (max_people >= 0),
  max_reservations int not null default 0 check (max_reservations >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (weekday, time_slot)
);

-- =========================================================================
-- blocked_dates — bloqueio pontual de um dia inteiro
-- =========================================================================
create table public.blocked_dates (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  reason text,
  active boolean not null default true,
  created_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- blocked_time_slots — bloqueio pontual de uma faixa em uma data específica
-- =========================================================================
create table public.blocked_time_slots (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  time_slot time not null,
  reason text,
  active boolean not null default true,
  created_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (date, time_slot)
);

-- =========================================================================
-- notification_queue — estrutura pronta para Fase 2 (e-mail/WhatsApp automático)
-- =========================================================================
create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations(id) on delete cascade,
  type text not null,
  channel text not null check (channel in ('email', 'whatsapp', 'system')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  payload jsonb,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index idx_notification_queue_status on public.notification_queue(status);
