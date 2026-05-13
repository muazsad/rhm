# RHM Hosting, DNS, and Supabase Design

## Goal

Launch `rhmathletic.com` on reliable static hosting and make the admin area safe enough for real use by moving authentication, roles, events, and tournament state into Supabase.

## Current State

The site is a static HTML/CSS/JavaScript project with no build step. Public pages can be hosted as static files. The admin login currently redirects without authenticating, event management only changes the current page DOM, and tournament data is stored in `localStorage`, which means live results only exist on the admin user's browser.

## Recommended Architecture

Use Vercel for static hosting and connect `rhmathletic.com` plus `www.rhmathletic.com` through Namecheap DNS. Keep public pages static. Add Supabase Auth and database tables for admin users, events, and tournament state. The browser should only use the Supabase publishable `anon` key. Admin permissions must be enforced through Row Level Security policies, not through hidden links or client-side checks.

## DNS and Hosting

The apex domain `rhmathletic.com` should point to Vercel with an `A` record of `76.76.21.21`. The `www` host should point to Vercel with a `CNAME` record of `cname.vercel-dns.com`. Vercel should be configured to serve both domains and redirect one canonical version to the other. The recommended canonical domain is `https://rhmathletic.com`.

## Supabase Data Model

Create an `admin_profiles` table keyed by Supabase Auth user ID with a `role` field. Create an `events` table for public event listings. Create a `tournament_state` table with a single active tournament JSON payload for the current live tournament experience. Public visitors may read published/live data. Only users whose profile role is `admin` may create, update, or delete admin-managed content.

## Client Behavior

Admin pages should require a Supabase session and admin role before rendering controls. Logout should call Supabase Auth instead of just navigating to the login page. Public pages should fetch published events and active tournament state from Supabase, with graceful empty states if Supabase is not configured yet.

## Security Boundary

Static HTML is acceptable for the public website. It is not a security boundary for admin features. The real boundary is Supabase Auth plus Row Level Security. The service role key must never appear in frontend code, HTML, JavaScript, Vercel public environment variables, or committed files.

## Verification

Verify static hosting locally with a simple HTTP server. Verify the admin pages reject unauthenticated users, allow admins after login, and persist tournament state across browsers once Supabase credentials and tables are configured.
