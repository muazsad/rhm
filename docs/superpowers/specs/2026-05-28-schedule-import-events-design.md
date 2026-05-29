# Design: Schedule CSV/Excel Import + Events Admin & Public Display

**Date:** 2026-05-28  
**Status:** Approved

---

## Feature 1 — Import Schedule from CSV/Excel (admin-bracket.html)

### Location
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
- Time slot headers from row 1 (col B onward) → parse 12-hour AM/PM → convert to minutes-from-midnight for sorting
- Field names from col A (row 2 onward)
- Each interior cell → split on ` vs ` (case-insensitive) → teamA, teamB
- Blank cells skipped
- Cells containing playoff keywords (Final, Semi, Championship, "Winner of") → `phase: 'playoff'`, skip group assignment
- All non-playoff games → `groupId: 'group-a'`, `groupName: 'Group 1'`

### Parsing — Flat Format
Columns: `Time | Field | Group | Team A | Team B | Round`
- Round contains "Final"/"Semi"/"Championship" → `phase: 'playoff'`; otherwise `phase: 'group'`
- Group column maps to groupId/groupName

### Shared Parsing Logic
- Built-in CSV parser (no external library): handles quoted fields, commas inside quoted values
- XLSX: load SheetJS `https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js` lazily from CDN on first `.xlsx` pick; convert to row array via `XLSX.utils.sheet_to_json(sheet, {header:1})`
- Sort all games by time (minutes), then field name
- Assign slot index: each unique sorted time gets slot 0, 1, 2…
- `startsAt` stored as 12-hour AM/PM string (e.g. "10:00 AM")

### Data Written to S
```
S.divisions[0].venues  — [{id:'venue-1', name:'Field 1'}, ...]
S.divisions[0].groups  — [{id:'group-a', name:'Group 1', teams:[...]}]
S.divisions[0].fixtures — full fixture array matching existing schema
S.divisions[0].scheduleSummary — {totalFixtures, totalSlots, gameBlockMinutes, note}
S.settings.name        — preserved (not overwritten)
```

Each fixture:
```js
{
  id: 'import-' + i,
  divisionId: 'division-main',
  phase: 'group' | 'playoff',
  groupId, groupName,
  teamA, teamB,
  venueId, venueName,
  slot,        // integer index 0,1,2...
  startsAt,    // "10:00 AM"
  scoreA: null, scoreB: null,
  ref: '',
  status: 'scheduled'
}
```

### After Import
1. Call `syncLegacyTournamentFields()` + `save()`
2. Call `switchTab('schedule')` — renders imported schedule in existing grid UI
3. Show success banner with game count

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

---

## Files Changed
1. `admin-bracket.html` — add Import section to Setup tab
2. `admin-events.html` — wire form/list to localStorage; add Edit, Delete, Link Tournament
3. `events.html` — dynamic rendering from localStorage; tournament-linked button
4. `tournament-live.html` — linked event banner at top
5. `assets/js/events-store.js` — add localStorage layer functions
