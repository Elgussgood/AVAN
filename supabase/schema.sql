-- ============================================================================
-- ESQUEMA DE BASE DE DATOS PARA AVAN: user_places (Lugares de Adultos Mayores)
-- Fase 3: TASK-15
-- ============================================================================

-- Habilitar extensión para UUIDs automáticos
create extension if not exists "pgcrypto";

-- 1. Tabla de lugares y alias frecuentes del usuario
create table if not exists public.user_places (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'elderly_user_default',
  alias text not null,
  display_name text not null,
  address text not null,
  latitude double precision not null,
  longitude double precision not null,
  category text check (category in ('family', 'home', 'medical', 'work', 'leisure')) default 'family',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Índices para búsquedas optimizadas en lenguaje natural y por usuario
create index if not exists idx_user_places_user_id on public.user_places (user_id);
create index if not exists idx_user_places_alias on public.user_places (lower(alias));

-- 2. Trigger para actualizar automaticamente updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_user_places_updated_at on public.user_places;
create trigger trigger_user_places_updated_at
before update on public.user_places
for each row
execute function public.handle_updated_at();

-- 3. Políticas de Seguridad RLS (Row Level Security)
alter table public.user_places enable row level security;

-- Política de lectura: los adultos mayores y sus cuidadores autorizados pueden consultar los lugares
drop policy if exists "Permitir lectura de lugares del usuario" on public.user_places;
create policy "Permitir lectura de lugares del usuario"
on public.user_places
for select
using (true);

-- Política de inserción: registro de nuevos lugares tanto por voz como por cuidadores
drop policy if exists "Permitir insercion de lugares" on public.user_places;
create policy "Permitir insercion de lugares"
on public.user_places
for insert
with check (true);

-- Política de actualización: modificar alias o direcciones
drop policy if exists "Permitir actualizacion de lugares" on public.user_places;
create policy "Permitir actualizacion de lugares"
on public.user_places
for update
using (true)
with check (true);

-- Política de eliminación
drop policy if exists "Permitir eliminacion de lugares" on public.user_places;
create policy "Permitir eliminacion de lugares"
on public.user_places
for delete
using (true);

-- Datos iniciales de demostración para pruebas inmediatas en CDMX
insert into public.user_places (alias, display_name, address, latitude, longitude, category)
values
  ('casa de mi hijo', 'Casa de mi hijo', 'Insurgentes Sur 1602, Crédito Constructor, Benito Juárez, CDMX', 19.3638, -99.1824, 'family'),
  ('mi casa', 'Mi Casa', 'Calle Durango 216, Roma Norte, Cuauhtémoc, CDMX', 19.4194, -99.1678, 'home'),
  ('el doctor', 'Consultorio Médico (Hospital Ángeles)', 'Hospital Ángeles México, Agrarismo 208, Escandón, Miguel Hidalgo, CDMX', 19.3985, -99.1764, 'medical'),
  ('la farmacia', 'Farmacia San Pablo', 'Av. Universidad 1080, Xoco, Benito Juárez, CDMX', 19.3712, -99.1662, 'medical')
on conflict do nothing;
