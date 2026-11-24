-- 2026 RHM Soccer Tournament — run once in the Supabase SQL editor.
insert into public.events (title, sport, status, event_date, event_time, location, description, registration, is_published)
select
  '2026 RHM Soccer Tournament', 'soccer', 'open', '2026-12-26', '12:30', '226 Main St, East Windsor, CT 06088',
  'One-day 7v7 tournament for teams of 9–12 players, ages 16+. Every team gets 3–4 guaranteed group games, then the top teams advance to a single-elimination bracket. $330 per team (+$5 processing) includes team uniforms. Registration closes November 29 — spots are first come, first served.',
  '{"enabled": true, "paymentRequired": true, "paymentLink": "", "registrationLink": "https://tally.so/r/M1EMo8", "questions": []}'::jsonb,
  true
where not exists (select 1 from public.events where title = '2026 RHM Soccer Tournament');
