# SlideRoom Security Threat Model - Phase 0

Last updated: 2026-06-19

## Purpose

This document defines the Phase 0 security baseline for making SlideRoom safe enough to become a real service. It records the current architecture, likely attack paths, severity, and the work that must happen before public beta or paid launch.

Phase 0 is an audit and planning phase. It does not claim the application is production-ready.

## References Checked

- Supabase changelog, checked 2026-06-19: https://supabase.com/changelog.md
- Supabase RLS guide: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase Auth rate limits: https://supabase.com/docs/guides/auth/rate-limits
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

Relevant Supabase changelog items:

- 2026-04-28: New public-schema tables are no longer automatically exposed to Data and GraphQL APIs. This means future migrations must explicitly check API exposure and GRANTs, not only RLS.
- 2026-06-03: Supabase changed free-tier email template customization due to coordinated email abuse. SlideRoom should not rely on free-tier built-in email for production-scale auth mail.

## Current Architecture Observed

Application:

- Vite React SPA.
- Vercel serverless functions under `api/`.
- Supabase Auth is accessed through server API routes.
- Supabase session is stored in HttpOnly cookies, not Supabase localStorage.
- Room/file/slides state is currently centralized in `public.app_state.state` JSONB.
- Supabase Storage bucket is `slideroom-uploads`, private.
- Uploaded PPTX blobs are accessed through signed URLs or server blob endpoints.
- Client still has IndexedDB blob cache and some non-auth sessionStorage values.

Current schema:

- `public.app_state`
  - `id text primary key`
  - `state jsonb`
  - `updated_at timestamptz`
  - RLS enabled
- `storage.buckets`
  - `slideroom-uploads`
  - private
  - file size limit 300MB

Important working-tree note:

- There are uncommitted security-hardening changes currently present in `api/_shared.ts`, `api/state.ts`, `api/blob/*`, `api/auth/[action].ts`, `src/services/storageService.ts`, `src/stores/useAppStore.ts`, `src/App.tsx`, and `vercel.json`.
- These changes appear to partially mitigate some P0 risks, but they are not a replacement for the Phase 1 database/RLS redesign.

## Assets To Protect

- User accounts and auth sessions.
- Email addresses and display names.
- Room membership and invite codes.
- Uploaded PPTX files.
- Generated previews and exports.
- Room metadata, file metadata, slide ordering, and export history.
- Supabase service role key and server-only environment variables.
- Billing/customer data once Stripe is added.

## Trust Boundaries

- Browser client: untrusted. Any client state, request body, room ID, storage key, and role value can be forged.
- Vercel API routes: trusted only if they validate auth, authorization, input shape, rate limits, and origin.
- Supabase database: should be the final authorization boundary through normalized tables and RLS.
- Supabase Storage: private bucket, but service role and signed URLs can bypass normal user-level protections if server code is wrong.
- External email provider/Supabase Auth mail: abuse-sensitive.
- Future Stripe webhooks: must be verified and idempotent.

## Severity Definitions

- P0: Must fix before any external beta. Can leak files/user data, allow account abuse, or let one user modify another user's room.
- P1: Must fix before public launch. Limits damage, abuse, cost, and support exposure.
- P2: Should fix before paid launch or scale-up.

## P0 Findings

### P0-1: Centralized `app_state` JSON is not a production-safe multi-tenant model

Risk:

- Room, member, file, slide, and export metadata are all stored together.
- Correct isolation depends heavily on Vercel API filtering/merging.
- Any filtering bug can expose every room or let one user overwrite global state.
- RLS cannot enforce room-level ownership inside one JSON document.

Evidence:

- `supabase/schema.sql` only defines `public.app_state`.
- `api/_shared.ts` reads and writes `app_state` through a service-role client.

Required fix:

- Replace global JSON state with normalized tables:
  - `profiles`
  - `rooms`
  - `room_members`
  - `files`
  - `slides`
  - `exports`
  - `usage_events`
  - `audit_logs`
- Enable RLS on all exposed tables.
- Add policies based on room membership, host/admin role, and owner user ID.

### P0-2: Service-role API endpoints remain a high-risk authorization boundary

Risk:

- Supabase service role bypasses RLS.
- If a Vercel API route misses a permission check, it becomes an unrestricted database/storage backdoor.

Evidence:

- `api/_shared.ts` creates a Supabase admin client using `SUPABASE_SERVICE_ROLE_KEY`.
- Blob, state, cleanup, and signed URL flows depend on server-side authorization checks.

Required fix:

- Move ordinary user reads/writes to RLS-protected tables using the user's Supabase JWT where possible.
- Keep service role only for admin/maintenance tasks.
- Add tests that prove unauthorized users cannot read/write another room through every API route.

### P0-3: Storage policies are not yet the final authority

Risk:

- Private bucket is good, but server-generated signed URLs can bypass intended user-level access if API checks are flawed.
- Current schema does not define Storage RLS policies for `storage.objects`.

Evidence:

- `supabase/schema.sql` creates a private bucket but no `storage.objects` policies.
- Supabase docs state Storage access control is based on RLS policies on `storage.objects`, and service keys bypass access controls.

Required fix:

- Store files under `rooms/{room_id}/files/{file_id}.pptx`.
- Add `storage.objects` policies that allow access only when the authenticated user is a member of the room.
- Keep signed URL expiration short.
- Deny object listing unless explicitly needed.

### P0-4: Upload validation is incomplete for malicious PPTX payloads

Risk:

- A `.pptx` file is a ZIP container and can be abused as a ZIP bomb or malformed XML workload.
- Extension/MIME checks are not enough.
- PPTX parsing/generation can be a CPU/memory DoS vector.

Evidence:

- Client validation limits extension to `pptx`.
- Server-side validation needs to verify ZIP/OpenXML structure, size, file count, decompressed size, and per-entry size.

Required fix:

- Validate uploads on the server before storing or processing:
  - extension `.pptx`
  - MIME allowlist where available
  - ZIP magic bytes
  - required `[Content_Types].xml`
  - max compressed size
  - max uncompressed total size
  - max ZIP entries
  - max XML part size
- Reject encrypted, macro-enabled, or suspicious containers unless explicitly supported.

### P0-5: Auth abuse controls need dashboard confirmation

Risk:

- Signup, resend, password reset, OTP verify, and login can be abused for email bombing or brute force.
- In-code Vercel memory rate limits are not durable across serverless instances.

Evidence:

- Current code has API-side `checkRateLimit` in working-tree changes, but serverless memory limits are best-effort only.
- Supabase Auth has dashboard-level rate limits and returns 429 on exceeded limits.

Required fix:

- Verify Supabase Auth Rate Limits in Dashboard via Chrome extension:
  - email send limits
  - OTP limits
  - password reset limits
  - verify limits
  - token refresh limits
- Add CAPTCHA/Turnstile for signup, password reset, resend, and possibly join.
- Add durable rate limiting for Vercel routes using Upstash Redis, Vercel KV, or Supabase table-backed counters.

### P0-6: CSRF/origin protection is not complete until verified

Risk:

- HttpOnly cookies protect tokens from JS theft, but cookie-authenticated mutation endpoints can be targeted by CSRF if origin checks and SameSite behavior are insufficient.

Evidence:

- Cookies use `SameSite=Lax`.
- Working-tree changes add same-origin CORS behavior, but mutation routes still need explicit Origin/Host validation and preferably CSRF tokens for state-changing operations.

Required fix:

- Add a shared `requireSameOrigin(request)` helper for all mutation endpoints.
- Require Origin or Sec-Fetch-Site checks for POST/PUT/DELETE.
- Consider double-submit CSRF token for high-risk mutations.

## P1 Findings

### P1-1: Local browser persistence still stores sensitive app data

Risk:

- IndexedDB stores uploaded blobs.
- Previous localStorage persisted room/file/slide metadata.
- On shared or compromised devices, local data can leak.

Status:

- Working-tree changes reduce Zustand persistence to settings/UI state only.
- IndexedDB blob cache remains.

Required fix:

- Stop caching PPTX blobs in IndexedDB for production, or encrypt/cache only temporarily.
- Clear old `slideroom-state-v1` data through migration.
- Provide logout cleanup for local blob cache.

### P1-2: Security headers need verification in deployed environment

Risk:

- Missing CSP/frame restrictions can worsen XSS or clickjacking impact.

Status:

- Working-tree `vercel.json` adds CSP, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.

Required fix:

- Verify headers on Vercel production after deploy.
- Tune CSP if Supabase or asset URLs require additions.

### P1-3: Dependency vulnerability found

Risk:

- `npm audit` reports a moderate `dompurify` vulnerability via `jspdf`.

Evidence:

- `dompurify <=3.4.10`, installed `3.4.8`.
- Fix available through `npm audit fix`.

Required fix:

- Run `npm audit fix`.
- Rebuild and regression test export/preview flows.

### P1-4: No audit log model yet

Risk:

- Cannot investigate file deletion, room deletion, suspicious auth behavior, or admin actions.

Required fix:

- Add `audit_logs` table.
- Log auth-sensitive actions, room mutations, uploads, deletes, exports, admin actions, and blocked authorization attempts.

### P1-5: No production quota model yet

Risk:

- A single user can generate storage, compute, email, and bandwidth cost.

Required fix:

- Add `plans`, `usage_events`, and quota checks:
  - rooms per user
  - files per room
  - bytes per file
  - bytes per room
  - uploads per day
  - exports per day
  - password reset/resend per hour

## P2 Findings

### P2-1: No admin console

Needed before public launch:

- User lookup.
- Room/file inspection.
- Account suspension.
- Manual file/room deletion.
- Usage and quota visibility.
- Audit log viewer.

### P2-2: No paid-plan enforcement

Needed before monetization:

- Stripe customer/subscription tables.
- Verified Stripe webhook endpoint.
- Idempotency by Stripe event ID.
- Server-side plan checks.
- Customer portal.

### P2-3: Incident response and compliance documents are not ready

Needed before broad release:

- Privacy policy.
- Terms of service.
- Data retention policy.
- Abuse report/contact flow.
- Incident response runbook.
- Account deletion and data export/delete flow.

## Required Supabase Dashboard Checks

Use Chrome extension/browser operation when applying these:

- Auth > Rate Limits:
  - password reset period and hourly cap
  - signup confirmation resend period
  - verify request limit
  - OTP request limit
  - token refresh limit
- Auth > Bot and abuse protection:
  - CAPTCHA provider configured
  - custom SMTP configured before production
- Authentication URLs:
  - Site URL is production domain
  - Redirect URLs only include allowed production/preview origins
- Database:
  - exposed schemas list
  - Data API exposure/GRANTs for new tables
  - RLS enabled on all public tables
  - no unsafe `security definer` functions in exposed schemas
- Storage:
  - `slideroom-uploads` is private
  - object listing is denied by default
  - policies are scoped by room membership
- API Keys:
  - service role key exists only in Vercel server env
  - no service role key in any `VITE_*` variable

## Phase 1 Implementation Order

1. Stabilize or revert the current working-tree security hardening branch into a clean commit.
2. Create normalized Supabase schema and migration.
3. Add RLS policies and SQL tests for:
   - owner can manage room
   - member can read room
   - non-member cannot read room
   - member cannot escalate role
   - non-owner cannot delete files
4. Replace `/api/state` global JSON sync with table-backed APIs.
5. Add Storage RLS policies.
6. Add server upload validation.
7. Add durable rate limiting and same-origin mutation checks.
8. Verify with `npm run build`, API smoke tests, and Supabase RLS tests.

## Phase 0 Exit Criteria

Phase 0 is complete when:

- This document exists and is committed.
- P0/P1/P2 risks are accepted as the working backlog.
- Phase 1 starts with database/RLS redesign, not UI work.
- Supabase dashboard checks are scheduled before public beta.

