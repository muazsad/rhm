# Design: Schedule CSV/Excel Import + Events Admin & Public Display

**Date:** 2026-05-28  
**Status:** Approved (rev 2 — Tournament Format selector + dynamic groupName rendering)

---

## Feature 1 — Import Schedule from CSV/Excel (admin-bracket.html)

### Tournament Format Selector (new — Setup tab)
A new field added to the Tournament Settings card in the Setup tab:

- **Label:** Tournament Format
- **Select options:**
  - `group-stage` — "Group Stage" (default): teams divided into named groups (Group A, Group B, …)
  - `league` — "League Stage": all teams in one pool, no group separation
- Stored in `S.divisions[0].settings.tournamentFormat`
- Used as the fallback when import auto-detection is ambiguous

### Location (Import section)
New full-width `s-card` section in the Setup tab, below the Generate Schedule button. Labelled "OR IMPORT EXISTING SCHEDULE". Does not replace the existing generate flow — it's an alternative entry point.

### UI Elements
- Section header: "OR IMPORT EXISTING SCHEDULE"
- Helper text: "Export your Google Sheet as CSV or Excel, then import here"
- File input accepting `.csv` and `.xlsx`
- "Download Template" link — generates and downloads a flat-format CSV with headers + 2 example rows + a comment row
- "IMPORT" button — triggers parse + load
- Green success banner: "Schedule imported successfully — X games loaded"
- Red error banner on malformed input or zero games parsed

### Format Auto-Detection
Two formats are supported. Detection happens before parsing:

**Matrix format** (Google Sheets style):
- Cell A1 blank or equals "Field"
- Row 1 cols B onward contain time values (regex: `\d{1,2}:\d{2}\s*(AM|PM)?`)
- Rows 2+ col A = field names; interior cells = "Team A vs Team B"

**Flat/tabular format** (template format):
- Row 1 headers contain "Time", "Field", "Team" keywords

### Parsing — Matrix Format

**Time and field extraction:**
- Time slot headers from row 1 (col B onward) → parse 12-hour AM/PM → convert to minutes-from-midnight for sorting
- Field names from col A (row 2 onward)
- Each interior cell → split on ` vs ` (case-insensitive) → teamA, teamB
- Blank cells skipped
- Cells containing playoff keywords (Final, Semi, Championship, "Winner of") → `phase: 'playoff'`, skip group assignment

**Tournament format auto-detection (matrix only):**
After collecting all non-playoff game cells, scan cell text for group indicators:
- If any cell text contains a pattern like "Group A", "Group B", "Grp A", etc. (regex `\bGroup\s+[A-Z]\b` case-insensitive) → treat as **Group Stage**, extract and preserve group names per cell
- If all non-playoff games have no group indicators → treat as **League Stage**; set `groupId: 'league'`, `groupName: 'League Stage'`
- If detection is ambiguous (e.g. some cells have group labels, some don't) → fall back to `S.divisions[0].settings.tournamentFormat`; use `league` or derive group names accordingly

**Group name derivation when Group Stage detected:**
- If the matrix has an optional "Group" label row above the field rows (row label contains "Group"), use those labels
- Otherwise assign all games to `groupName: 'Group A'` (single group) unless cell text itself encodes a group (e.g. "Group A: Team X vs Team Y")
- If cell text encodes no group info, use the user-selected Tournament Format to decide

### Parsing — Flat Format
Columns: `Time | Field | Group | Team A | Team B | Round`

**Round column → phase mapping:**
- Contains any of: "Final", "Semi", "Championship" → `phase: 'playoff'`
- Contains any of: "Group Stage", "Group A"–"Group Z", "League Stage", "League", "Pool" → `phase: 'group'`
- Default (unrecognised): `phase: 'group'`

**Group column → groupId/groupName:**
- Group column value is used verbatim as `groupName`
- `groupId` is derived by slugifying `groupName` (lowercase, spaces → hyphens)
- Examples: "Group A" → `group-a`, "League Stage" → `league-stage`, "Pool 1" → `pool-1`

### Shared Parsing Logic
- Built-in CSV parser (no external library): handles quoted fields, commas inside quoted values
- XLSX: load SheetJS `https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js` lazily from CDN on first `.xlsx` pick; convert to row array via `XLSX.utils.sheet_to_json(sheet, {header:1})`
- Sort all games by time (minutes), then field name
- Assign slot index: each unique sorted time gets slot 0, 1, 2…
- `startsAt` stored as 12-hour AM/PM string (e.g. "10:00 AM")
- `gameBlockMinutes` in scheduleSummary: derived from median time difference between consecutive slots, or 30 if only one slot

### Data Written to S
```
S.divisions[0].venues   — [{id:'venue-1', name:'Field 1'}, ...]
S.divisions[0].groups   — one entry per unique groupName found
S.divisions[0].fixtures — full fixture array matching existing schema
S.divisions[0].scheduleSummary — {totalFixtures, totalSlots, gameBlockMinutes, note}
S.divisions[0].settings.tournamentFormat — 'group-stage' | 'league'
S.settings.name         — preserved (not overwritten)
```

Each fixture:
```js
{
  id: 'import-' + i,
  divisionId: 'division-main',
  phase: 'group' | 'playoff',
  groupId,      // slugified from groupName
  groupName,    // stored verbatim from source — never hardcoded
  teamA, teamB,
  venueId, venueName,
  slot,         // integer index 0,1,2...
  startsAt,     // "10:00 AM"
  scoreA: null, scoreB: null,
  ref: '',
  status: 'scheduled'
}
```

### After Import
1. Call `syncLegacyTournamentFields()` + `save()`
2. Call `switchTab('schedule')` — renders imported schedule in existing grid UI
3. Show success banner with game count

### Dynamic groupName rendering — everywhere
- **Schedule tab game cards:** render `fixture.groupName` directly — never substitute a hardcoded label
- **Standings tab:** group fixtures by `groupName`; each unique `groupName` gets its own standings table labelled with that name. One group → one table; six groups → six tables.
- **tournament-live.html standings panel:** same — group by `fixture.groupName` dynamically. A league import produces one table labelled whatever `groupName` is stored (e.g. "League Stage"). Multiple groups produce multiple tables.
- **Bracket & Standings tab in admin:** same dynamic grouping
- No code anywhere should conditionally render "Group Stage" or "League Stage" as a label — the label always comes from the data.

---

## Feature 2A — Admin Events (admin-events.html)

### localStorage Key: `rhm_events`
Each event object shape:
```js
{
  id: String(Date.now()),
  name: string,
  sport: string,           // 'flag-football' | 'basketball' | ...
  date: string,            // 'YYYY-MM-DD'
  time: string,            // '14:30' (stored as HH:MM, displayed as 12hr)
  location: string,
  description: string,
  status: string,          // 'open' | 'closed' | 'soon'
  tournamentLinked: boolean
}
```

### events-store.js additions (localStorage layer)
New functions added to `window.RHMEventsStore`:
- `saveLocalEvent(event)` — upsert by id into `rhm_events` array
- `listLocalEvents()` — read + parse `rhm_events`, return array
- `deleteLocalEvent(id)` — filter out by id, write back
- `getLinkedEvent()` — return first event where `tournamentLinked === true`, or null

Existing Supabase methods unchanged.

### admin-events.html behaviour
- On page load: read from `listLocalEvents()`; if empty, seed one fallback Flag Football event
- POST EVENT form saves to localStorage via `saveLocalEvent()`; re-renders list
- Edit: pre-fills all form fields; re-submit updates existing record (same id)
- Delete: `confirm()` dialog → `deleteLocalEvent(id)` → re-render
- "Link Tournament" button: sets `tournamentLinked: true` on this event, sets `false` on all others, re-saves all, re-renders
- Event count badge updates dynamically
- All times displayed in 12-hour AM/PM via `formatTime()`

### Seeded fallback event
```js
{
  id: 'seed-flag-football-1',
  name: 'RHM Flag Football Tournament',
  sport: 'flag-football',
  date: '2025-06-14',
  time: '10:00',
  location: 'Mississauga Sports Park',
  description: '',
  status: 'open',
  tournamentLinked: false
}
```

---

## Feature 2B — Public Events (events.html)

- On load: read `rhm_events` from localStorage via `listLocalEvents()`
- If array has items: replace `#events-list` content with dynamic cards
- If empty: show `<div class="notice">No upcoming events. Check back soon.</div>`
- Existing hardcoded card removed; dynamic rendering uses existing CSS classes
- Cards preserve: date block, event-badge (status), title, meta (location, time, date), description
- If `tournamentLinked === true`: render green "VIEW LIVE RESULTS →" button linking to `tournament-live.html`
- If `registration.enabled`: render "Register Now →" button (wired to existing modal)
- Fallback: if localStorage empty AND Supabase hydration returns data, Supabase path still works (existing `hydratePublicEvents()` kept)
- The registration modal continues to function unchanged — event config is passed through

---

## Feature 2C — tournament-live.html

- In `render()`, before building `html`, call `getLinkedEventBanner()`
- `getLinkedEventBanner()`: reads `localStorage.getItem('rhm_events')`, finds `tournamentLinked === true`
- If found: prepend a `.event-banner` block above the hero:
  ```
  ┌──────────────────────────────────────────┐
  │  FLAG FOOTBALL  ·  JUNE 14 · MISSISSAUGA │
  │  RHM FLAG FOOTBALL TOURNAMENT            │
  └──────────────────────────────────────────┘
  ```
  - Event name in Bebas Neue, sport/date/location in DM Sans, dark theme
- If not found: no banner (existing hero shows tournament name from bracket store — unchanged)
- All existing live results logic (tabs, schedule, standings, bracket, auto-refresh) untouched

---

## General Constraints
- All times displayed in 12-hour AM/PM everywhere
- No external libraries except SheetJS (for .xlsx), loaded from CDN
- Dark theme: `#0a0a0a` background, `#2db84b` green accent, Bebas Neue headlines, DM Sans body
- No existing bracket tool functionality broken (Setup, Schedule, Bracket & Standings tabs all still work)
- `groupName` is always rendered from fixture data — never substituted with a hardcoded string in display code

---

## Files Changed
1. `admin-bracket.html` — Tournament Format selector in Setup; Import section; dynamic groupName rendering in standings
2. `admin-events.html` — wire form/list to localStorage; add Edit, Delete, Link Tournament
3. `events.html` — dynamic rendering from localStorage; tournament-linked button
4. `tournament-live.html` — linked event banner at top; dynamic groupName-based standings
5. `assets/js/events-store.js` — add localStorage layer functions
