<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Project rules

- Client spec lives in `docs/especificacion.md`; architecture summary and first-admin procedure in `docs/ARQUITECTURA.md`. Keep both current — the spec is the acceptance reference.
- Permissions are enforced in the database (RLS + SECURITY DEFINER functions with explicit `has_role`/`is_staff` checks); UI role checks are cosmetic only. Why: the spec forbids relying on hidden UI for security.
- Costs live only in `variant_costs`/`cost_history` (admin-only RLS); never join cost columns into editor-reachable queries, views, exports or audit rows. Absence of a row means "costo pendiente", never 0.
- SKU is assigned only by the `variants_before_write` trigger via `generate_sku()` (Postgres sequence) when a variant becomes `registered`; client code never sends or edits `sku`. Relations and URLs use `variants.id` (stable UUID).
- Stock: no `stock_levels` row = pending count; a row with 0 = counted zero. Initial counts allow one `confirmed` row per variant+location+session; duplicates go to `in_review`, never summed.
- Multi-step writes (product + variant + attributes + count) must go through a single Postgres function with an idempotency key, so retries/double clicks don't duplicate.
- Routes: signed-in pages under `src/routes/_authenticated/`; admin-only pages under `_authenticated/_admin/` (client gate + RLS). Public signup is disabled; accounts are created by admins via `src/lib/users.functions.ts` (service role loaded inside the handler after an admin check).
- Every operational table has `is_demo` so demo data can be removed without touching real records.
- Design tokens (lime primary, graphite, sky panels, brand pink) live in `src/styles.css`; components use tokens/utilities (`surface-card`, `surface-graphite`, badge/button variants), never raw colors.
- Logo files are Lovable asset pointers in `src/assets/*.asset.json`; a custom logo uploaded by admins lives in the private `branding` bucket and is read through signed URLs.
