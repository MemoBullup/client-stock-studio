
-- Funciones internas: solo se ejecutan desde disparadores, nunca por API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tree_guard() from public, anon, authenticated;
revoke execute on function public.tree_cascade_depth() from public, anon, authenticated;
revoke execute on function public.products_before_write() from public, anon, authenticated;
revoke execute on function public.variants_before_write() from public, anon, authenticated;
revoke execute on function public.validate_quantity_unit() from public, anon, authenticated;
revoke execute on function public.track_cost_change() from public, anon, authenticated;
revoke execute on function public.audit_trigger() from public, anon, authenticated;
-- Verificadores de rol: necesarios para las políticas de usuarios con sesión, no para anónimos
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_staff(uuid) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_staff(uuid) to authenticated;
