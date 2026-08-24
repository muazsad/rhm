# Design: Basketball League Section (Public + Admin)

**Date:** 2026-08-24
**Status:** Approved

---

## Summary

Add a "League" section to the site for the RHM Fall 2026 Basketball League (10 teams,
starting Sunday Aug 30, 2026), plus an admin dashboard to manage it: teams, schedule
(custom matchups, not auto-generated round-robin), standings (computed, not manually
edited), and a standalone manual playoff bracket. Built to support future seasons with
history (each league is its own record, not a singleton).

Reuses existing infrastructure where the shape fits:
- `tournament-standings.js` `computeStandings()` for W/L/PF/PA/diff + tiebreakers (head-to-head,
  point diff) — leagues are modeled as a single synthetic "group" of fixtures.
- The `tournament_state` dual-write pattern (Supabase + localStorage fallback) — mirrored
  by a new `league-store.js`, but list-based instead of singleton.
- `RHMScheduleImport.parseCSV()` (the CSV tokenizer only) reused for the new league CSV
  importer — the existing matrix/flat parsers are tournament-specific (no date column) and
  are not reused.
- Admin dark theme (`#0a0a0a` / `#2db84b` / Bebas Neue + DM Sans), `admin-auth.js`
  `requireAdmin()` gate, same nav chrome as `admin-events.html` / `admin-bracket.html`.

---

## Data Model

### Supabase table: `leagues`

```sql
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season text,
  sport text not null default 'basketball',
  start_date date,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  state jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

RLS, following the `events` table pattern exactly:
- `anon, authenticated` can `select` where `status = 'published'`
- `authenticated` + `is_admin()` can do everything (`for all`)
- `set_updated_at` trigger reused

Appended to `supabase/schema.sql` (idempotent `create table if not exists`, `drop policy if
exists` / `create policy`, matching existing style).

### `state` JSONB shape

```js
{
  teams: [
    { id: 'team-1', name: 'Team Name' }
  ],
  games: [
    {
      id: 'game-1',
      date: '2026-08-30',      // YYYY-MM-DD
      time: '14:00',           // 24h HH:MM, displayed 12h everywhere
      location: 'Court 1',
      homeTeamId: 'team-1',
      awayTeamId: 'team-2',
      homeScore: null,         // number once entered
      awayScore: null,
      status: 'scheduled'      // 'scheduled' | 'final' | 'postponed'
    }
  ],
  playoffs: {
    enabled: false,
    rounds: [
      {
        id: 'round-1',
        name: 'Semifinals',
        matchups: [
          {
            id: 'matchup-1',
            label: 'Semifinal 1',
            homeTeamId: 'team-1',   // or null if TBD — admin fills in manually
            awayTeamId: 'team-4',
            homeScore: null,
            awayScore: null,
            winnerTeamId: null,
            status: 'scheduled'     // 'scheduled' | 'final'
          }
        ]
      }
    ]
  }
}
```

No auto-generated round-robin, no auto-advance logic. Admin adds every game and every
playoff matchup by hand (per your answers: custom matchups in the dashboard; manual
playoff matchups + score entry, admin declares the winner).

---

## `assets/js/league-store.js` (new)

Mirrors `tournament-store.js`'s dual-write approach, list-based:

- `listLocalLeagues()` / `saveLocalLeagues(list)` — localStorage key `RHM_leagues`, array of
  full league records
- `loadLeagues()` — Supabase `select *` (admin: all rows; falls back to localStorage list if
  no client)
- `loadLeague(id)` — single record
- `loadPublishedLeagues()` — public read, `status = 'published'`, ordered by `start_date desc`
- `saveLeague(league)` — upsert (Supabase `upsert` + mirror to localStorage list, same
  `updated_by` pattern as `saveTournamentState`)
- `publishLeague(id)` / `unpublishLeague(id)` / `archiveLeague(id)` — status transitions
- `deleteLeague(id)` — hard delete (draft leagues only; UI will block deleting a
  published/archived league without first archiving/unpublishing)

---

## Standings computation (no new math)

New thin adapter, `leagueToStandingsConfig(league)`, added at the bottom of
`league-store.js` (not a new file — it's ~15 lines):

```js
function leagueToStandingsConfig(league) {
  var teamNames = league.teams.map(function (t) { return t.name; });
  var byId = {};
  league.teams.forEach(function (t) { byId[t.id] = t.name; });

  var fixtures = league.games
    .filter(function (g) { return g.status === 'final'; })
    .map(function (g) {
      return {
        phase: 'group',
        groupId: 'league',
        teamA: byId[g.homeTeamId],
        teamB: byId[g.awayTeamId],
        scoreA: g.homeScore,
        scoreB: g.awayScore
      };
    });

  return {
    groups: [{ id: 'league', name: league.name, teams: teamNames }],
    fixtures: fixtures,
    rules: { winPoints: 1, drawPoints: 0, lossPoints: 0, tiesAllowed: false }
  };
}
```

Both admin and public pages call `window.RHMTournamentStandings.computeStandings(
leagueToStandingsConfig(league))` and render `row.rank / row.team / row.wins / row.losses /
row.pf / row.pa / row.diff` — the `points`/`draws` fields exist internally but aren't shown
(basketball has no ties or league-points system, just win/loss records).

---

## CSV Schedule Import (new, admin only)

New functions in `league-store.js`: `parseLeagueScheduleCSV(text, teams)`.

- Reuses `window.RHMScheduleImport.parseCSV(text)` for tokenizing (handles quoted fields,
  commas-in-quotes) — nothing else from that module, since its matrix/flat parsers assume a
  single-day tournament schedule with no date column.
- Header row column detection by keyword (case-insensitive `indexOf`, same technique as
  `schedule-import.js`'s `col()` helper): `date`, `time`, `location` (falls back to
  `court`/`field`), `home` (team), `away` (team), `home score` (optional), `away score`
  (optional).
- Each row maps to a `games[]` entry. Team names are matched case-insensitively against
  `league.teams`; unmatched names are auto-created as new teams (mirrors how the existing
  importer handles unknown teams via `findUnknownTeams`, but here we add them rather than
  block — CSV owns the roster for the games it defines).
- Row-level errors collected (`{ rowNumber, message }`) for: missing date, missing home/away
  team name, unparseable date.
- "Download Template" link generates a CSV with headers + 2 example rows, same convention as
  the bracket importer's template.

---

## `admin-league.html` (new)

Structure/chrome matches `admin-events.html` and `admin-bracket.html`: `admin-nav` with
Logout, `requireAdmin()` on load, dark theme.

**List view** (default): cards/table of all leagues (name, season, status badge, start
date), "+ New League" button, click a league to open the editor. Status badges: Draft
(gray), Published (green), Archived (muted).

**Editor view**, tabbed (same tab-button pattern as `tournament-live.html`):

1. **Details** — name, season, sport (defaults to "Basketball"), start date, status
   controls (Publish / Unpublish / Archive), Delete (only enabled for draft).
2. **Teams** — simple list, add team (name input + button), rename inline, remove (blocked
   with an inline warning if the team has games/playoff matchups referencing it — must
   remove those first).
3. **Schedule** — table of games (date, time, location, home, away, score, status),
   "+ Add Game" form (team selects populated from Teams tab, date/time/location inputs),
   inline score entry with a "Mark Final" action, delete per row, CSV import button + Download
   Template link, error banner listing row-level import errors.
4. **Standings** — read-only table computed live via `leagueToStandingsConfig` +
   `computeStandings`. Recomputes on every render; nothing stored.
5. **Playoffs** — enable/disable toggle. When enabled: "+ Add Round" (name input), within a
   round "+ Add Matchup" (two team selects — options include all teams plus, once prior
   rounds have declared winners, "Winner of <round> <matchup label>" as a pickable value
   resolved to that `winnerTeamId` at save time), score inputs, "Declare Winner" button
   (enabled once both scores are entered; sets `winnerTeamId` + `status: 'final'`).

Every tab writes back to one in-memory `league` object; a single "Save" persists via
`saveLeague()` (same explicit-save model as `admin-bracket.html`, not autosave-on-every-
keystroke).

Added to `admin-dashboard.html`'s `.cards` grid as a third `.dash-card` ("League Manager" /
"Create and manage league teams, schedules, standings, and playoffs." / links to
`admin-league.html`).

---

## `league.html` (new, public)

Visual structure copied from `tournament-live.html`: sticky `site-header` (logo left, no
live-badge since a league isn't a single-day live event), `main` with a hero (league name +
season + start date), tab nav: **Standings / Schedule / Teams / Playoffs**.

- Loads via `loadPublishedLeagues()`. If more than one published league exists, a season
  switcher `<select>` appears in the hero (defaults to the most recent by `start_date`); with
  exactly one, the switcher is hidden. If zero published leagues, shows a "No league is
  currently active — check back soon" notice.
- **Standings tab**: same `stg-tbl` styling as tournament standings, one table (league is a
  single group), columns Rank/Team/W/L/PF/PA/Diff.
- **Schedule tab**: same `sched-table` styling as tournament schedule — rows grouped by date
  (date as a sub-header, matching the "sort by time within venue" spirit but for a
  multi-week season it's grouped/sorted by date then time), showing time, matchup, location,
  score (if final) or "—" (if scheduled).
- **Teams tab**: simple grid of team name cards (name only, per your answer — no logos/
  colors/captains in v1).
- **Playoffs tab**: only shown if `playoffs.enabled`; renders each round as a labeled section
  with matchup cards (`Team A  score – score  Team B`, winner highlighted in green, "TBD" for
  unset teams/scores). Stacked sections, not a connector-line bracket graphic — simpler CSS,
  matches the "standalone, keep it simple" direction from the format discussion.

### Nav additions
- `index.html`: `#topnav-ghost` link list, `#bottom-nav` link list, and footer "Navigate"
  list all get a "League" entry pointing to `league.html`.

---

## General Constraints

- All times displayed 12-hour AM/PM everywhere (reuse the existing `formatTime12` pattern
  from `admin-events.html`).
- Dark theme tokens (`--green: #2db84b`, `--black: #0a0a0a`, Bebas Neue / DM Sans) —
  no new design system.
- No changes to the existing tournament/bracket tool or its data — the league is fully
  separate (its own table, its own store module, its own standings config adapter call, no
  shared state with `tournament_state`).
- Draft leagues are never visible on the public page (RLS-enforced, same as `events`).

---

## Files Changed / Added

**New:**
1. `assets/js/league-store.js` — Supabase+localStorage store, standings adapter, CSV importer
2. `admin-league.html` — admin league manager
3. `league.html` — public league page
4. `tests/league-store.test.js` — store + standings-adapter + CSV-import tests
5. Migration appended to `supabase/schema.sql` — `leagues` table + RLS policies

**Modified:**
6. `admin-dashboard.html` — add "League Manager" card
7. `index.html` — add "League" nav link (topnav-ghost, bottom-nav, footer)
