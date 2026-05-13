# RHM Deployment

## Hosting

The site is static HTML/CSS/JavaScript, so Vercel can host it directly from the repository root.

1. Install or open Vercel.
2. Import this repository as a Vercel project.
3. Use the default static settings. There is no build command and no output directory.
4. Add these production domains in Vercel:
   - `rhmathletic.com`
   - `www.rhmathletic.com`
5. Set `rhmathletic.com` as the primary domain.

## Namecheap DNS

In Namecheap, open **Domain List > rhmathletic.com > Manage > Advanced DNS**.

Remove conflicting parking, redirect, or default records for `@` and `www`, then add:

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

DNS can take a few minutes to a few hours to validate. Vercel will show the domain as valid once propagation reaches its checks.

## Supabase

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase/schema.sql`.
3. Open **Project Settings > API** and copy:
   - Project URL
   - `anon` public key
4. Paste those values into `assets/js/supabase-config.js`.
5. Create the first admin user in Supabase Auth.
6. Run this SQL with the new user's Auth UUID and email:

```sql
insert into public.admin_profiles (id, email, role)
values ('AUTH_USER_UUID', 'admin@example.com', 'admin')
on conflict (id) do update
set email = excluded.email,
    role = excluded.role,
    updated_at = now();
```

Never put the Supabase `service_role` key in this repository, Vercel public variables, or frontend code.

## Local Verification

Run:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.
