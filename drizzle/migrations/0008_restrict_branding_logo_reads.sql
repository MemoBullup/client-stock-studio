create or replace function public.is_current_logo(_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_settings
    where id = 1 and logo_path is not null and logo_path = _name
  )
$$;
revoke all on function public.is_current_logo(text) from public;
grant execute on function public.is_current_logo(text) to anon, authenticated;

drop policy if exists "Logo legible para firmar URL" on storage.objects;

create policy "Solo el logo vigente es legible" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'branding' and public.is_current_logo(name));

create policy "Admin ve archivos de marca" on storage.objects
  for select to authenticated
  using (bucket_id = 'branding' and public.has_role(auth.uid(), 'admin'));