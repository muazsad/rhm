# Hosting DNS Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host `rhmathletic.com` on Vercel and move admin-managed data behind Supabase Auth, roles, and Row Level Security.

**Architecture:** Keep the existing static HTML site and add small shared JavaScript modules for Supabase config, auth guards, events, and tournament persistence. Vercel serves the static files; Supabase owns authentication, authorization, and shared data. Namecheap DNS points the apex and `www` hostnames to Vercel.

**Tech Stack:** Static HTML/CSS/JS, Vercel static hosting, Namecheap DNS, Supabase Auth, Supabase Postgres with RLS, Supabase CDN JavaScript client.

---

### File Structure

- Create: `vercel.json` for static hosting behavior and security headers.
- Create: `.env.example` documenting the public Supabase variables used by the browser.
- Create: `supabase/schema.sql` containing tables, helper functions, and RLS policies.
- Create: `assets/js/supabase-config.js` for project URL/key configuration.
- Create: `assets/js/admin-auth.js` for login, logout, session checks, and admin role checks.
- Create: `assets/js/events-store.js` for event reads and admin event writes.
- Create: `assets/js/tournament-store.js` for tournament reads and admin tournament writes.
- Modify: `admin-login.html` to call Supabase Auth instead of redirecting.
- Modify: `admin-dashboard.html`, `admin-events.html`, and `admin-bracket.html` to require an admin session and use real logout.
- Modify: `events.html` to read published events from Supabase when configured.
- Modify: `tournament-live.html` and `admin-bracket.html` to use shared tournament state when configured, while keeping `localStorage` as a development fallback.
- Create: `docs/deployment.md` with exact Vercel and Namecheap steps.

### Task 1: Hosting Configuration

**Files:**
- Create: `vercel.json`
- Create: `.env.example`
- Create: `docs/deployment.md`

- [ ] **Step 1: Add Vercel static configuration**

Create `vercel.json` with clean static behavior and conservative browser security headers:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Add environment example**

Create `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

- [ ] **Step 3: Document deployment and DNS**

Create `docs/deployment.md` with the Vercel setup command, custom domain steps, Namecheap records, and Supabase configuration notes.

- [ ] **Step 4: Verify static serving locally**

Run:

```bash
python3 -m http.server 4173
```

Expected: `http://localhost:4173` serves `index.html`, admin pages, and public pages.

### Task 2: Supabase Schema

**Files:**
- Create: `supabase/schema.sql`

- [ ] **Step 1: Add admin and content tables**

Create tables for `admin_profiles`, `events`, and `tournament_state`. Include timestamps and `updated_by` fields where admin edits occur.

- [ ] **Step 2: Add admin helper function and RLS policies**

Add a `public.is_admin()` function that checks `admin_profiles` for the current `auth.uid()`. Enable RLS on every table. Allow public reads for published events and the active tournament. Allow admin-only writes.

- [ ] **Step 3: Add bootstrap instructions**

Add SQL comments explaining how to promote a signed-up user to admin:

```sql
insert into public.admin_profiles (id, email, role)
values ('AUTH_USER_UUID', 'admin@example.com', 'admin')
on conflict (id) do update set role = excluded.role;
```

### Task 3: Shared Supabase Client and Auth Guard

**Files:**
- Create: `assets/js/supabase-config.js`
- Create: `assets/js/admin-auth.js`
- Modify: `admin-login.html`
- Modify: `admin-dashboard.html`
- Modify: `admin-events.html`
- Modify: `admin-bracket.html`

- [ ] **Step 1: Add configuration module**

Create a small browser module that exposes `window.RHM_SUPABASE_CONFIG` and `window.RHM_SUPABASE_READY`. Use placeholder values that the site owner replaces after creating the Supabase project.

- [ ] **Step 2: Add auth helper**

Create helpers for `getSupabaseClient`, `loginAdmin`, `requireAdmin`, and `logoutAdmin`. If Supabase config is missing, admin pages should show a setup message instead of pretending to be secure.

- [ ] **Step 3: Replace fake login**

Update `admin-login.html` so form submission calls `loginAdmin(email, password)` and displays an error if Supabase rejects the login or the user lacks the `admin` role.

- [ ] **Step 4: Protect admin pages**

Update admin pages to include the Supabase client CDN, config module, and auth helper. Call `requireAdmin()` on page load and wire logout links/buttons to `logoutAdmin()`.

### Task 4: Events Persistence

**Files:**
- Create: `assets/js/events-store.js`
- Modify: `admin-events.html`
- Modify: `events.html`

- [ ] **Step 1: Add event store helper**

Create functions for `listPublishedEvents`, `listAdminEvents`, `createEvent`, and `deleteEvent`.

- [ ] **Step 2: Update admin event page**

Load events from Supabase for admins, create records on submit, and delete records through Supabase. Keep the current sample event only as an empty-state fallback when Supabase is not configured.

- [ ] **Step 3: Update public events page**

Render published Supabase events when configured. Keep the existing static event cards as fallback content if Supabase is not configured or returns no records.

### Task 5: Tournament Persistence

**Files:**
- Create: `assets/js/tournament-store.js`
- Modify: `admin-bracket.html`
- Modify: `tournament-live.html`

- [ ] **Step 1: Add tournament store helper**

Create `loadTournamentState()` and `saveTournamentState(state)` that use Supabase when configured and fall back to `localStorage` in local development.

- [ ] **Step 2: Update admin tournament page**

Make `tryLoad()` async and load from the shared helper. Make `save()` persist to the shared helper. Keep local UI behavior unchanged.

- [ ] **Step 3: Update public live page**

Make live rendering async and fetch the active tournament from Supabase. Preserve the existing 30-second refresh behavior.

### Task 6: Deployment

**Files:**
- Modify only if verification reveals a static routing problem.

- [ ] **Step 1: Check Vercel CLI availability**

Run:

```bash
vercel --version
```

Expected: prints a version if installed, or command not found if it needs installation/login.

- [ ] **Step 2: Deploy if logged in**

Run:

```bash
vercel --prod
```

Expected: Vercel returns a production deployment URL.

- [ ] **Step 3: Add custom domains in Vercel**

Run when the project exists:

```bash
vercel domains add rhmathletic.com
vercel domains add www.rhmathletic.com
```

Expected: Vercel accepts the domain or prints DNS records to add.

- [ ] **Step 4: Configure Namecheap DNS**

In Namecheap Advanced DNS, add:

```text
Type: A Record
Host: @
Value: 76.76.21.21
TTL: Automatic

Type: CNAME Record
Host: www
Value: cname.vercel-dns.com
TTL: Automatic
```

Expected: DNS propagates and Vercel marks both domains as valid.

### Self-Review

- Spec coverage: hosting, Namecheap DNS, Supabase admin roles, public static HTML safety, public reads, admin writes, and verification are all covered.
- Placeholder scan: no implementation step relies on an unspecified table, file, or command.
- Type consistency: helper names are consistent across auth, events, and tournament tasks.
