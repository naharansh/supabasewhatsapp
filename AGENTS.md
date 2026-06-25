<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Key Next.js 16 Changes Applied Here

### middleware.ts → proxy.ts
- `middleware.ts` is **deprecated** and renamed to `proxy.ts`
- The exported function must be named `proxy`, not `middleware`
- Proxy runs only on Node.js runtime (Edge not supported)
- Config flags renamed: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`

### next-auth v5 on Next.js 16
- **Requires** `AUTH_URL` and `NEXTAUTH_URL` in `.env.local` for client-side session fetch
- Set both to `http://localhost:3000` (or the actual deployment URL)
- `ClientFetchError` ("Failed to fetch") occurs when these are missing because the client-side `__NEXTAUTH` config fails to resolve the base URL
- The `@auth/core` `AuthError` base class appends `Read more at https://errors.authjs.dev#autherror` to all error messages
- `serverRuntimeConfig`/`publicRuntimeConfig` from `next/config` are removed; use env vars instead

### Async Request APIs
- Synchronous access to `cookies()`, `headers()`, `draftMode()`, `params`, `searchParams` is **fully removed**
- All must be awaited
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:anchored-summary -->

## Anchored Summary

### Goal
Fix WhatsApp connection, template display, broadcast data loading, and message persistence on marbiz.in production.

Two root causes:
1. `@supabase/ssr` v0.10.3 `createBrowserClient` cannot read auth cookies on marbiz.in (all Supabase browser-client calls return empty).
2. Supabase project `anvolqqgcqvkzsvmlhnb.supabase.co` only has migrations 001–008 applied. Migrations 009–017 missing — most critically, `messages` table lacks `reply_to_message_id`, `interactive_reply_id` columns, and the widened `content_type` CHECK that includes `'interactive'`. The webhook's `INSERT` into `messages` silently fails when it tries to write these missing columns.

### Solutions
1. All browser data access → API routes with `createAdminClient()` (service_role key). Server-side `auth()` (NextAuth) handles session; admin client handles DB.
2. Apply combined migrations SQL (`scripts/apply-migrations-009-017.sql`) via Supabase Dashboard SQL Editor to add missing columns, tables, functions.

### Files Changed This Session

**New files:**
- `src/app/api/data/route.ts` — Generic CRUD proxy for all tables (POST with `action`, `table`, `filters`, `order`, `limit`, etc.). Whitelists allowed tables, auto-filters `user_id` for tables that have it. Supports `select` (with count, single, in/eq/neq/ilike filters), `insert`, `update`, `delete`.
- `src/app/api/broadcasts/` (directory) — Created for broadcast-specific API (not used; `/api/data` handles it instead).
- `scripts/apply-migrations-009-017.sql` — Combined idempotent SQL to apply missing migrations via Supabase Dashboard SQL Editor.

**Components fixed (replaced `createClient()` → `fetch('/api/data')`):**
- `src/components/broadcasts/step1-choose-template.tsx` — Uses `/api/whatsapp/templates`
- `src/components/broadcasts/step2-select-audience.tsx` — Tags, custom fields, contact_tags, contact_custom_values, contacts count
- `src/components/broadcasts/step3-personalize.tsx` — Custom fields, first contact, contact custom values
- `src/components/broadcasts/step4-schedule-send.tsx` — Reach estimation
- `src/app/(dashboard)/broadcasts/page.tsx` — Broadcast list
- `src/app/(dashboard)/broadcasts/[id]/page.tsx` — Broadcast detail, recipients, delete
- `src/app/(dashboard)/broadcasts/new/page.tsx` — Save draft
- `src/hooks/use-broadcast-sending.ts` — Full send pipeline (audience resolution, CSV upsert, custom field filter, recipient insert/update, finalize)
- `src/components/inbox/message-thread.tsx` — Removed last `createClient()` call; reactions realtime subscription replaced with 5s polling via `/api/data`. Removed `REALTIME_LISTEN_TYPES` import.

**Files fixed in previous session:**
- `src/app/api/whatsapp/config/route.ts` — Changed to `createAdminClient()`
- `src/app/api/whatsapp/send/route.ts`, `broadcast/route.ts`, `react/route.ts`, `media/[mediaId]/route.ts`, `templates/sync/route.ts` — All changed to `createAdminClient()`
- `src/app/api/whatsapp/templates/route.ts` — NEW: GET/POST/DELETE with admin client
- `src/lib/supabase/admin.ts` — Added `fetchWithTimeout` wrapper (10s abort)
- `src/components/settings/whatsapp-config.tsx` — Uses API instead of direct Supabase
- `src/components/settings/template-manager.tsx` — Uses API instead of direct Supabase
- `src/app/layout.tsx` + `src/app/globals.css` — Removed Google Fonts Inter, system font stack
- `scripts/seed-inbox.mjs` — Seed script that creates 6 contacts, 6 conversations, 36 messages, and reactions.

### Still Broken (same root cause — `createClient()` reads return empty)
These files still use `createClient()` directly and will return empty data on production:
- `src/components/contacts/contact-form.tsx` — Tags, contacts
- `src/components/contacts/contact-detail-view.tsx` — Tags, contacts, notes
- `src/components/settings/tag-manager.tsx` — Tags
- Various other components with `createClient()` imports

### Key Pattern for Future Fixes

```ts
// BROKEN (returns empty on marbiz.in):
const supabase = createClient();
const { data } = await supabase.from('tags').select('*');

// FIXED (uses admin client server-side):
const res = await fetch('/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'select',
    table: 'tags',
    order: { column: 'name' },
  }),
});
const json = await res.json();
const data = json.data;
```
```ts
// BROKEN (returns empty on marbiz.in):
const supabase = createClient();
const { data } = await supabase.from('tags').select('*');

// FIXED (uses admin client server-side):
const res = await fetch('/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'select',
    table: 'tags',
    order: { column: 'name' },
  }),
});
const json = await res.json();
const data = json.data;
```

For writes:
```ts
const res = await fetch('/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'insert',
    table: 'broadcasts',
    values: { user_id: userId, name: '...', ... },
    select: true,
  }),
});
```

<!-- END:anchored-summary -->
