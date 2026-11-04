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
- Minimum stock lives in `stock_minimums` (per variant + location, base unit, admin-write). An alert means a counted quantity strictly below the minimum; no count = pending, never an alert. DB functions `list_stock_minimums`/`low_stock_summary` and `src/lib/stock.ts` must agree on this rule.
- AI-assisted adjustments UI was removed at the client's request; DB functions (`apply_stock_adjustment`, `review_adjustment_request`) and `src/lib/adjustments.server.ts` remain unused. Why: keep adjustment history intact.
- Inventory assistant chat: streaming server route `src/routes/api/assistant.ts` → `src/lib/assistant/chat.server.ts`; read-only tools in `src/lib/assistant/tools.server.ts` run with the user's own token (RLS, never costs). One conversation per user stored as AI SDK `UIMessage` rows in `assistant_messages`; the server rebuilds history from the DB and only accepts the new user message from the client. Chat UI uses AI Elements in `src/components/ai-elements/`.
- Demo SKUs use the `DEMO-` prefix (seeded by temporarily switching `sku_prefix`), so real SKUs still start at `ALY-000001`.
- Multi-step writes (product + variant + attributes + count) must go through a single Postgres function with an idempotency key, so retries/double clicks don't duplicate.
- Routes: signed-in pages under `src/routes/_authenticated/`; admin-only pages under `_authenticated/_admin/` (client gate + RLS). Public signup is disabled; accounts are created by admins via `src/lib/users.functions.ts` (service role loaded inside the handler after an admin check).
- Every operational table has `is_demo` so demo data can be removed without touching real records.
- Design tokens (lime primary, graphite, sky panels, brand pink) live in `src/styles.css`; components use tokens/utilities (`surface-card`, `surface-graphite`, badge/button variants), never raw colors.
- Logo files are Lovable asset pointers in `src/assets/*.asset.json`; a custom logo uploaded by admins lives in the private `branding` bucket and is read through signed URLs.
- Capture (Bloque B): `save_capture(jsonb)` is the only write path for product + variants + attributes + initial count (per-save and per-variant idempotency keys; drafts keep the pending count in `variants.draft_count`). Exact duplicates are blocked via `defining_signature` from `variant_signature_from()` (only when all variant-defining attributes are answered); partial matches only warn in the UI (`isPossibleDuplicate`). Why: one transaction, no duplicates on retries.
- Counts go through `_record_initial_count` (internal, called by `save_capture`/`record_count`); a repeat count for a variant+location goes `in_review` and only `review_count` (admin) replaces the stock, logging an adjustment. Why: counts are never summed or silently overwritten.
- Inventory list uses `search_catalog` (SECURITY INVOKER, server-side accent-insensitive search, filters, sort, pagination); costs are fetched separately and only for admins. Why: scales past 5,000 SKUs without leaking costs.
