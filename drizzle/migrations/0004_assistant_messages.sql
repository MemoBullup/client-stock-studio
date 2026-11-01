
-- Historial del asistente de inventario: una conversación por persona
create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  message_id text not null check (length(message_id) between 1 and 200),
  role text not null check (role in ('user','assistant')),
  message jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
create index assistant_messages_user_idx on public.assistant_messages(user_id, created_at);
grant select, insert, update, delete on public.assistant_messages to authenticated;
grant all on public.assistant_messages to service_role;
alter table public.assistant_messages enable row level security;
create policy "Ver mi historial del asistente" on public.assistant_messages for select to authenticated
  using (user_id = auth.uid() and public.is_staff(auth.uid()));
create policy "Guardar en mi historial del asistente" on public.assistant_messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_staff(auth.uid()));
create policy "Actualizar mi historial del asistente" on public.assistant_messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Borrar mi historial del asistente" on public.assistant_messages for delete to authenticated
  using (user_id = auth.uid());
