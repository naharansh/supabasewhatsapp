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
