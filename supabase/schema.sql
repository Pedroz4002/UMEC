create extension if not exists pgcrypto;

create sequence if not exists public.senha_numero_seq
  start with 1
  increment by 1
  no minvalue
  no maxvalue
  cache 1;

create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  whatsapp text not null,
  email text not null,
  quantidade integer not null check (quantidade > 0),
  valor_unitario numeric(10, 2) not null,
  valor_total numeric(10, 2) not null,
  entrega boolean not null default false,
  taxa_entrega numeric(10, 2) not null default 0,
  endereco_rua text,
  endereco_numero text,
  endereco_bairro text,
  endereco_referencia text,
  status_pagamento text not null default 'pendente',
  mercado_pago_payment_id text,
  pix_qr_code text,
  pix_qr_code_base64 text,
  pdf_path text,
  codigo_compra text unique not null,
  email_enviado boolean not null default false,
  email_enviado_at timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  constraint compras_status_pagamento_check
    check (status_pagamento in ('pendente', 'pago', 'cancelado', 'erro'))
);

create table if not exists public.senhas (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid references public.compras(id) on delete cascade,
  numero_senha integer unique not null,
  nome text not null,
  email text not null,
  whatsapp text not null,
  usada boolean default false,
  created_at timestamp default now()
);

alter table public.compras
  add column if not exists entrega boolean not null default false,
  add column if not exists taxa_entrega numeric(10, 2) not null default 0,
  add column if not exists endereco_rua text,
  add column if not exists endereco_numero text,
  add column if not exists endereco_bairro text,
  add column if not exists endereco_referencia text;

create index if not exists idx_compras_codigo_compra on public.compras (codigo_compra);
create index if not exists idx_compras_email on public.compras (lower(email));
create index if not exists idx_compras_whatsapp on public.compras (whatsapp);
create index if not exists idx_compras_mercado_pago_payment_id on public.compras (mercado_pago_payment_id);
create index if not exists idx_senhas_numero_senha on public.senhas (numero_senha);
create index if not exists idx_senhas_compra_id on public.senhas (compra_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_compras_updated_at on public.compras;
create trigger trg_compras_updated_at
before update on public.compras
for each row execute function public.set_updated_at();

create or replace function public.gerar_senhas_para_compra(p_compra_id uuid)
returns table (
  id uuid,
  compra_id uuid,
  numero_senha integer,
  nome text,
  email text,
  whatsapp text,
  usada boolean,
  created_at timestamp
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra public.compras%rowtype;
  v_existentes integer;
  v_i integer;
begin
  select *
    into v_compra
    from public.compras
   where compras.id = p_compra_id
   for update;

  if not found then
    raise exception 'Compra não encontrada';
  end if;

  if v_compra.status_pagamento <> 'pago' then
    raise exception 'Compra ainda não está paga';
  end if;

  select count(*)
    into v_existentes
    from public.senhas
   where senhas.compra_id = p_compra_id;

  if v_existentes < v_compra.quantidade then
    for v_i in 1..(v_compra.quantidade - v_existentes) loop
      insert into public.senhas (compra_id, numero_senha, nome, email, whatsapp)
      values (
        v_compra.id,
        nextval('public.senha_numero_seq')::integer,
        v_compra.nome,
        v_compra.email,
        v_compra.whatsapp
      );
    end loop;
  end if;

  return query
  select s.id, s.compra_id, s.numero_senha, s.nome, s.email, s.whatsapp, s.usada, s.created_at
    from public.senhas s
   where s.compra_id = p_compra_id
   order by s.numero_senha;
end;
$$;

alter table public.compras enable row level security;
alter table public.senhas enable row level security;

insert into storage.buckets (id, name, public)
values ('senhas-pdf', 'senhas-pdf', false)
on conflict (id) do nothing;
