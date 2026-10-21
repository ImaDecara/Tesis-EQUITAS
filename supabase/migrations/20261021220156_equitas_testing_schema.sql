-- Solo instalacion en proyecto VACIO de testing. Modelo observado el 21/10/2026.

-- Paso historico: conserva las SELECT permisivas para reproducir DEF-SUP-001.

-- Aplicar active_membership_rls inmediatamente despues del ensayo rojo.

do $$ begin if exists(select 1 from pg_tables where schemaname='public') then raise exception 'El esquema public debe estar vacio'; end if; end $$;

create table public."address" (
  "id" bigint not null,
  "person" bigint not null,
  "street" text,
  "number" numeric,
  "neighborhood" text,
  "city" bigint,
  "floor" numeric,
  "apartment" text,
  "tower" text,
  "building_name" text,
  "lot" text,
  "block" text,
  "reference" text,
  "coordinates" text,
  "active" boolean default true not null
);

create table public."city" (
  "id" bigint not null,
  "province" bigint not null,
  "name" text not null,
  "postal_code" text,
  "active" boolean default true not null
);

create table public."contact_type" (
  "id" bigint not null,
  "key" text not null,
  "value" text not null,
  "priority" integer,
  "active" boolean default true not null
);

create table public."currency" (
  "id" bigint not null,
  "code" text not null,
  "name" text not null,
  "active" boolean default true not null
);

create table public."data_source" (
  "id" bigint not null,
  "tenant" bigint not null,
  "name" text not null,
  "type" bigint,
  "connection_info" jsonb,
  "active" boolean default true not null
);

create table public."data_source_type" (
  "id" bigint not null,
  "name" text not null,
  "description" text,
  "active" boolean default true not null
);

create table public."debt" (
  "id" bigint not null,
  "external_id" bigint not null,
  "debtor" bigint not null,
  "type" text,
  "description" text,
  "original_amount" numeric default 0 not null,
  "current_amount" numeric default 0 not null,
  "updated_amount" numeric,
  "currency" bigint,
  "issue_date" date,
  "due_date" date,
  "last_collection_date" date,
  "period" text,
  "status" bigint
);

create table public."debt_status" (
  "id" bigint not null,
  "key" text not null,
  "value" text not null,
  "description" text,
  "active" boolean default true not null
);

create table public."debtor" (
  "id" bigint not null,
  "tenant" bigint not null,
  "external_id" bigint not null,
  "type" bigint,
  "identifier" text,
  "description" text,
  "status" boolean default true not null
);

create table public."debtor_contact" (
  "id" bigint not null,
  "person" bigint not null,
  "type" bigint not null,
  "value" text not null,
  "active" boolean default true not null
);

create table public."debtor_person" (
  "id" bigint not null,
  "debtor" bigint not null,
  "person" bigint not null,
  "priority" numeric,
  "role" text,
  "active" boolean default true not null
);

create table public."debtor_profile" (
  "id" bigint not null,
  "debtor" bigint not null,
  "total_debt_amount" numeric default 0 not null,
  "overdue_debt_amount" numeric default 0 not null,
  "debt_count" integer default 0 not null,
  "overdue_debt_count" integer default 0 not null,
  "oldest_debt_days" integer default 0 not null,
  "average_debt_age_days" integer default 0 not null,
  "active_person_count" integer default 0 not null,
  "available_contact_count" integer default 0 not null,
  "previous_contact_count" integer default 0 not null,
  "previous_response_count" integer default 0 not null,
  "socioeconomic_risk_level" integer default 0 not null,
  "profile_generated_at" timestamp with time zone,
  "active" boolean default true not null
);

create table public."debtor_profile_detail" (
  "id" bigint not null,
  "debtor_profile" bigint not null,
  "person" bigint not null,
  "risk_value" numeric default 0 not null,
  "reason" text,
  "active" boolean default true not null
);

create table public."debtor_type" (
  "id" bigint not null,
  "key" text,
  "value" text not null,
  "active" boolean default true not null
);

create table public."document_type" (
  "id" bigint not null,
  "key" text not null,
  "value" text not null,
  "active" boolean default true not null
);

create table public."person" (
  "id" bigint not null,
  "external_id" bigint not null,
  "document_type" bigint,
  "document_number" text,
  "full_name" text,
  "type" bigint,
  "birth_date" date,
  "status" bigint
);

create table public."person_status" (
  "id" bigint not null,
  "key" text not null,
  "value" text not null,
  "active" boolean default true not null
);

create table public."person_type" (
  "id" bigint not null,
  "key" text not null,
  "value" text not null,
  "active" boolean default true not null
);

create table public."province" (
  "id" bigint not null,
  "name" text not null,
  "active" boolean default true not null
);

create table public."role" (
  "id" bigint not null,
  "name" text not null,
  "description" text
);

create table public."tenant" (
  "id" bigint not null,
  "name" text not null,
  "legal_name" text,
  "schema_name" text,
  "status" text default 'ACTIVE'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."tenant_user" (
  "id" bigint not null,
  "tenant" bigint not null,
  "user" bigint not null,
  "role" bigint not null,
  "status" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."user" (
  "id" bigint not null,
  "auth_user" uuid,
  "full_name" text not null,
  "email" text not null,
  "password_hash" text,
  "status" text default 'ACTIVE'::text not null,
  "last_login_at" timestamp with time zone
);

alter table public."address" add constraint "address_person_key" UNIQUE (person);

alter table public."address" add constraint "address_pkey" PRIMARY KEY (id);

alter table public."city" add constraint "city_pkey" PRIMARY KEY (id);

alter table public."city" add constraint "city_province_name_postal_code_key" UNIQUE (province, name, postal_code);

alter table public."contact_type" add constraint "contact_type_key_key" UNIQUE (key);

alter table public."contact_type" add constraint "contact_type_pkey" PRIMARY KEY (id);

alter table public."currency" add constraint "currency_code_key" UNIQUE (code);

alter table public."currency" add constraint "currency_pkey" PRIMARY KEY (id);

alter table public."data_source" add constraint "data_source_pkey" PRIMARY KEY (id);

alter table public."data_source_type" add constraint "data_source_type_name_key" UNIQUE (name);

alter table public."data_source_type" add constraint "data_source_type_pkey" PRIMARY KEY (id);

alter table public."debt" add constraint "debt_debtor_external_id_key" UNIQUE (debtor, external_id);

alter table public."debt" add constraint "debt_pkey" PRIMARY KEY (id);

alter table public."debt_status" add constraint "debt_status_key_key" UNIQUE (key);

alter table public."debt_status" add constraint "debt_status_pkey" PRIMARY KEY (id);

alter table public."debtor" add constraint "debtor_pkey" PRIMARY KEY (id);

alter table public."debtor" add constraint "debtor_tenant_type_external_id_key" UNIQUE (tenant, type, external_id);

alter table public."debtor_contact" add constraint "debtor_contact_person_type_value_key" UNIQUE (person, type, value);

alter table public."debtor_contact" add constraint "debtor_contact_pkey" PRIMARY KEY (id);

alter table public."debtor_person" add constraint "debtor_person_debtor_person_key" UNIQUE (debtor, person);

alter table public."debtor_person" add constraint "debtor_person_pkey" PRIMARY KEY (id);

alter table public."debtor_profile" add constraint "debtor_profile_debtor_key" UNIQUE (debtor);

alter table public."debtor_profile" add constraint "debtor_profile_pkey" PRIMARY KEY (id);

alter table public."debtor_profile" add constraint "debtor_profile_socioeconomic_risk_level_check" CHECK (((socioeconomic_risk_level >= 0) AND (socioeconomic_risk_level <= 100)));

alter table public."debtor_profile_detail" add constraint "debtor_profile_detail_debtor_profile_person_key" UNIQUE (debtor_profile, person);

alter table public."debtor_profile_detail" add constraint "debtor_profile_detail_pkey" PRIMARY KEY (id);

alter table public."debtor_profile_detail" add constraint "debtor_profile_detail_risk_value_check" CHECK (((risk_value >= (0)::numeric) AND (risk_value <= (100)::numeric)));

alter table public."debtor_type" add constraint "debtor_type_key_key" UNIQUE (key);

alter table public."debtor_type" add constraint "debtor_type_pkey" PRIMARY KEY (id);

alter table public."document_type" add constraint "document_type_key_key" UNIQUE (key);

alter table public."document_type" add constraint "document_type_pkey" PRIMARY KEY (id);

alter table public."person" add constraint "person_external_id_key" UNIQUE (external_id);

alter table public."person" add constraint "person_pkey" PRIMARY KEY (id);

alter table public."person_status" add constraint "person_status_key_key" UNIQUE (key);

alter table public."person_status" add constraint "person_status_pkey" PRIMARY KEY (id);

alter table public."person_type" add constraint "person_type_key_key" UNIQUE (key);

alter table public."person_type" add constraint "person_type_pkey" PRIMARY KEY (id);

alter table public."province" add constraint "province_name_key" UNIQUE (name);

alter table public."province" add constraint "province_pkey" PRIMARY KEY (id);

alter table public."role" add constraint "role_name_key" UNIQUE (name);

alter table public."role" add constraint "role_pkey" PRIMARY KEY (id);

alter table public."tenant" add constraint "tenant_pkey" PRIMARY KEY (id);

alter table public."tenant_user" add constraint "tenant_user_pkey" PRIMARY KEY (id);

alter table public."tenant_user" add constraint "tenant_user_tenant_user_key" UNIQUE (tenant, "user");

alter table public."user" add constraint "user_auth_user_key" UNIQUE (auth_user);

alter table public."user" add constraint "user_email_key" UNIQUE (email);

alter table public."user" add constraint "user_pkey" PRIMARY KEY (id);

alter table public."address" add constraint "address_city_fkey" FOREIGN KEY (city) REFERENCES city(id);

alter table public."address" add constraint "address_person_fkey" FOREIGN KEY (person) REFERENCES person(id) ON DELETE CASCADE;

alter table public."city" add constraint "city_province_fkey" FOREIGN KEY (province) REFERENCES province(id);

alter table public."data_source" add constraint "data_source_tenant_fkey" FOREIGN KEY (tenant) REFERENCES tenant(id) ON DELETE CASCADE;

alter table public."data_source" add constraint "data_source_type_fkey" FOREIGN KEY (type) REFERENCES data_source_type(id);

alter table public."debt" add constraint "debt_currency_fkey" FOREIGN KEY (currency) REFERENCES currency(id);

alter table public."debt" add constraint "debt_debtor_fkey" FOREIGN KEY (debtor) REFERENCES debtor(id) ON DELETE CASCADE;

alter table public."debt" add constraint "debt_status_fkey" FOREIGN KEY (status) REFERENCES debt_status(id);

alter table public."debtor" add constraint "debtor_tenant_fkey" FOREIGN KEY (tenant) REFERENCES tenant(id) ON DELETE CASCADE;

alter table public."debtor" add constraint "debtor_type_fkey" FOREIGN KEY (type) REFERENCES debtor_type(id);

alter table public."debtor_contact" add constraint "debtor_contact_person_fkey" FOREIGN KEY (person) REFERENCES person(id) ON DELETE CASCADE;

alter table public."debtor_contact" add constraint "debtor_contact_type_fkey" FOREIGN KEY (type) REFERENCES contact_type(id);

alter table public."debtor_person" add constraint "debtor_person_debtor_fkey" FOREIGN KEY (debtor) REFERENCES debtor(id) ON DELETE CASCADE;

alter table public."debtor_person" add constraint "debtor_person_person_fkey" FOREIGN KEY (person) REFERENCES person(id) ON DELETE CASCADE;

alter table public."debtor_profile" add constraint "debtor_profile_debtor_fkey" FOREIGN KEY (debtor) REFERENCES debtor(id) ON DELETE CASCADE;

alter table public."debtor_profile_detail" add constraint "debtor_profile_detail_debtor_profile_fkey" FOREIGN KEY (debtor_profile) REFERENCES debtor_profile(id) ON DELETE CASCADE;

alter table public."debtor_profile_detail" add constraint "debtor_profile_detail_person_fkey" FOREIGN KEY (person) REFERENCES person(id) ON DELETE CASCADE;

alter table public."person" add constraint "person_document_type_fkey" FOREIGN KEY (document_type) REFERENCES document_type(id);

alter table public."person" add constraint "person_status_fkey" FOREIGN KEY (status) REFERENCES person_status(id);

alter table public."person" add constraint "person_type_fkey" FOREIGN KEY (type) REFERENCES person_type(id);

alter table public."tenant_user" add constraint "tenant_user_role_fkey" FOREIGN KEY (role) REFERENCES role(id);

alter table public."tenant_user" add constraint "tenant_user_tenant_fkey" FOREIGN KEY (tenant) REFERENCES tenant(id) ON DELETE CASCADE;

alter table public."tenant_user" add constraint "tenant_user_user_fkey" FOREIGN KEY ("user") REFERENCES "user"(id) ON DELETE CASCADE;

alter table public."user" add constraint "user_auth_user_fkey" FOREIGN KEY (auth_user) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."address" enable row level security;

revoke all on public."address" from anon, authenticated;

grant select on public."address" to anon, authenticated;

grant all on public."address" to service_role;

create policy "authenticated_read_address" on public."address" for select to authenticated using (true);

alter table public."city" enable row level security;

revoke all on public."city" from anon, authenticated;

grant select on public."city" to anon, authenticated;

grant all on public."city" to service_role;

create policy "authenticated_read_city" on public."city" for select to authenticated using (true);

alter table public."contact_type" enable row level security;

revoke all on public."contact_type" from anon, authenticated;

grant select on public."contact_type" to anon, authenticated;

grant all on public."contact_type" to service_role;

create policy "authenticated_read_contact_type" on public."contact_type" for select to authenticated using (true);

alter table public."currency" enable row level security;

revoke all on public."currency" from anon, authenticated;

grant select on public."currency" to anon, authenticated;

grant all on public."currency" to service_role;

create policy "authenticated_read_currency" on public."currency" for select to authenticated using (true);

alter table public."data_source" enable row level security;

revoke all on public."data_source" from anon, authenticated;

grant select on public."data_source" to anon, authenticated;

grant all on public."data_source" to service_role;

create policy "authenticated_read_data_source" on public."data_source" for select to authenticated using (true);

alter table public."data_source_type" enable row level security;

revoke all on public."data_source_type" from anon, authenticated;

grant select on public."data_source_type" to anon, authenticated;

grant all on public."data_source_type" to service_role;

create policy "authenticated_read_data_source_type" on public."data_source_type" for select to authenticated using (true);

alter table public."debt" enable row level security;

revoke all on public."debt" from anon, authenticated;

grant select on public."debt" to anon, authenticated;

grant all on public."debt" to service_role;

create policy "authenticated_read_debt" on public."debt" for select to authenticated using (true);

alter table public."debt_status" enable row level security;

revoke all on public."debt_status" from anon, authenticated;

grant select on public."debt_status" to anon, authenticated;

grant all on public."debt_status" to service_role;

create policy "authenticated_read_debt_status" on public."debt_status" for select to authenticated using (true);

alter table public."debtor" enable row level security;

revoke all on public."debtor" from anon, authenticated;

grant select on public."debtor" to anon, authenticated;

grant all on public."debtor" to service_role;

create policy "authenticated_read_debtor" on public."debtor" for select to authenticated using (true);

alter table public."debtor_contact" enable row level security;

revoke all on public."debtor_contact" from anon, authenticated;

grant select on public."debtor_contact" to anon, authenticated;

grant all on public."debtor_contact" to service_role;

create policy "authenticated_read_debtor_contact" on public."debtor_contact" for select to authenticated using (true);

alter table public."debtor_person" enable row level security;

revoke all on public."debtor_person" from anon, authenticated;

grant select on public."debtor_person" to anon, authenticated;

grant all on public."debtor_person" to service_role;

create policy "authenticated_read_debtor_person" on public."debtor_person" for select to authenticated using (true);

alter table public."debtor_profile" enable row level security;

revoke all on public."debtor_profile" from anon, authenticated;

grant select on public."debtor_profile" to anon, authenticated;

grant all on public."debtor_profile" to service_role;

create policy "authenticated_read_debtor_profile" on public."debtor_profile" for select to authenticated using (true);

alter table public."debtor_profile_detail" enable row level security;

revoke all on public."debtor_profile_detail" from anon, authenticated;

grant select on public."debtor_profile_detail" to anon, authenticated;

grant all on public."debtor_profile_detail" to service_role;

create policy "authenticated_read_debtor_profile_detail" on public."debtor_profile_detail" for select to authenticated using (true);

alter table public."debtor_type" enable row level security;

revoke all on public."debtor_type" from anon, authenticated;

grant select on public."debtor_type" to anon, authenticated;

grant all on public."debtor_type" to service_role;

create policy "authenticated_read_debtor_type" on public."debtor_type" for select to authenticated using (true);

alter table public."document_type" enable row level security;

revoke all on public."document_type" from anon, authenticated;

grant select on public."document_type" to anon, authenticated;

grant all on public."document_type" to service_role;

create policy "authenticated_read_document_type" on public."document_type" for select to authenticated using (true);

alter table public."person" enable row level security;

revoke all on public."person" from anon, authenticated;

grant select on public."person" to anon, authenticated;

grant all on public."person" to service_role;

create policy "authenticated_read_person" on public."person" for select to authenticated using (true);

alter table public."person_status" enable row level security;

revoke all on public."person_status" from anon, authenticated;

grant select on public."person_status" to anon, authenticated;

grant all on public."person_status" to service_role;

create policy "authenticated_read_person_status" on public."person_status" for select to authenticated using (true);

alter table public."person_type" enable row level security;

revoke all on public."person_type" from anon, authenticated;

grant select on public."person_type" to anon, authenticated;

grant all on public."person_type" to service_role;

create policy "authenticated_read_person_type" on public."person_type" for select to authenticated using (true);

alter table public."province" enable row level security;

revoke all on public."province" from anon, authenticated;

grant select on public."province" to anon, authenticated;

grant all on public."province" to service_role;

create policy "authenticated_read_province" on public."province" for select to authenticated using (true);

alter table public."role" enable row level security;

revoke all on public."role" from anon, authenticated;

grant select on public."role" to anon, authenticated;

grant all on public."role" to service_role;

create policy "authenticated_read_role" on public."role" for select to authenticated using (true);

alter table public."tenant" enable row level security;

revoke all on public."tenant" from anon, authenticated;

grant select on public."tenant" to anon, authenticated;

grant all on public."tenant" to service_role;

create policy "authenticated_read_tenant" on public."tenant" for select to authenticated using (true);

alter table public."tenant_user" enable row level security;

revoke all on public."tenant_user" from anon, authenticated;

grant select on public."tenant_user" to anon, authenticated;

grant all on public."tenant_user" to service_role;

create policy "authenticated_read_tenant_user" on public."tenant_user" for select to authenticated using (true);

alter table public."user" enable row level security;

revoke all on public."user" from anon, authenticated;

grant select on public."user" to anon, authenticated;

grant all on public."user" to service_role;

create policy "authenticated_read_user" on public."user" for select to authenticated using (true);

notify pgrst, 'reload schema';
