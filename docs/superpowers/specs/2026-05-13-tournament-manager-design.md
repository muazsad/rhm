# RHM Tournament Manager Design

## Goal

Build out the existing RHM tournament bracket creator into a fully functional tournament manager while preserving the current visual design. The tool should support group stages, round robin scheduling, playoff brackets, editable fixtures, live admin scoring, private drafts, and a published public live page for players.

## Current Context

The site is a static HTML/CSS/JavaScript project backed by Supabase for admin authentication and shared tournament state. The current tournament surface lives mainly in `admin-bracket.html`, `tournament-live.html`, `assets/js/tournament-engine.js`, and `assets/js/tournament-store.js`.

The existing implementation can generate group round robin games, place games across fields without same-slot team conflicts, enter group scores, compute basic standings, and show a projected bracket. It does not yet model playoff games as scheduled fixtures, support rich schedule editing, handle publishing states, support divisions, or provide enough validation and tests for tournament-day reliability.

## Recommended Approach

Keep the current static/Supabase architecture and visual design. Rebuild the tournament model and shared JavaScript engine around real fixtures, divisions, venues, schedule validation, standings rules, playoff projection, and publishing state.

This avoids a framework migration while making the tournament logic testable outside the HTML pages. The HTML pages should become UI shells that call shared modules for generation, validation, standings, bracket projection, and persistence.

## Tournament Structure

A tournament can contain one or more divisions. Most events will use one default division, but the model should support future divisions such as Adult, Youth, Basketball, or Flag Football.

Each division owns its teams, groups, standings rules, group-stage fixtures, playoff fixtures, and bracket state. Divisions can be scheduled in either mode:

- Shared venues and timeline: all divisions use one master schedule and cannot double-book the same venue.
- Independent divisions: each division has its own schedule, useful for different locations, sports, or time windows.

Each division supports two setup modes:

- Team List: the admin enters all teams, chooses the number of groups, and lets the app distribute teams.
- Manual Groups: the admin creates and edits groups directly.

Auto-grouping supports these methods:

- Random draw.
- Seeded snake distribution.
- Manual seeded order before grouping.

The first implementation should be tested around 16-team tournaments and designed to handle up to 64 teams without changing the data model.

## Scheduling Rules

The scheduler creates group-stage round robin fixtures first, then appends scheduled playoff fixtures after the group stage.

Scheduler hard rules:

- A team cannot play two games in the same time slot.
- A fixture cannot be placed during a blocked venue/time window.
- A venue cannot host more than one fixture at the same time.
- Fixture times must be generated from the configured start time, game duration, and breaks.

Scheduler optimization priorities:

1. Avoid team double-booking.
2. Respect venue and time blocks.
3. Minimize back-to-back games for the same team.
4. Minimize total tournament duration after the fairness rules are handled.

Admin scheduling controls:

- Group game length.
- Break between games.
- Break before playoffs.
- Playoff game length.
- Number of venues.
- Custom venue names.
- Venue/time blocks for all venues or specific venues.

Venue names should be customizable. Sport-aware placeholders should default to Court 1, Court 2, etc. for basketball and Field 1, Field 2, etc. for soccer and flag football.

## Schedule Editing

The generated schedule must remain editable after creation.

Admins can:

- Drag and drop fixtures between time and venue slots.
- Edit time.
- Edit venue.
- Edit teams.
- Edit referee or helper assignment.
- Edit fixture labels.
- Edit scores with an explicit Save button.

Invalid drag/drop or manual edits should be blocked when they would double-book a team, double-book a venue, or violate a blocked window. The UI should show the reason so admins know what to fix.

Schedule edits after publishing should update the public page immediately.

## Standings Rules

Standings rules are configurable per tournament or division.

Admin can configure:

- Points for a win.
- Points for a draw.
- Points for a loss.
- Whether ties are allowed.

Default tiebreaker order:

1. Standings points or wins, depending on the selected scoring model.
2. Point differential.
3. Head-to-head.
4. Points scored.
5. Admin override.

Point differential must rank before head-to-head by default.

Admins always have override power for standings rank and playoff seed decisions.

## Playoff Bracket

The playoff bracket is a live projection during group play. Before teams are known, playoff fixtures should show seed placeholders such as Group A Seed 1 vs Group B Seed 2. As group scores are saved, standings update and the projected bracket replaces placeholders with team names.

Playoff games are real scheduled fixtures, not only a visual bracket. They appear in the schedule after group play, can be edited, can receive scores, and progress winners through the bracket.

Admins can:

- Override projected seeds.
- Override playoff fixture teams.
- Enter playoff scores with an explicit Save button.
- Manually advance winners if needed.

The public bracket should clearly communicate when the bracket is projected and when playoff teams are locked.

## Publishing and Public Live Page

Admin work can be saved privately as a draft. The public live page only shows a tournament after the admin publishes it.

After a tournament is published, these updates should become public immediately when saved:

- Score updates.
- Schedule edits.
- Standings changes.
- Playoff seed overrides.
- Playoff fixture edits.
- Bracket progression.

RHM usually has one public tournament at a time, so the public live page should display the single published tournament. Admin can still keep drafts or archived tournaments privately.

The public live page should keep the current visual style and provide separate views or tabs:

- Schedule.
- Standings.
- Bracket.

Team and venue filters are out of scope for the first build because current tournaments are small enough to read directly.

## Data Model

The tournament state should be structured enough to support drafts, publishing, divisions, fixtures, and validation.

Suggested top-level shape:

```js
{
  id,
  status: 'draft' | 'published' | 'archived',
  publishedAt,
  settings,
  divisions: [],
  activePublicTournament: true
}
```

Suggested division shape:

```js
{
  id,
  name,
  sport,
  setupMode,
  schedulingMode,
  teams: [],
  groups: [],
  venues: [],
  blockedWindows: [],
  standingsRules,
  playoffRules,
  fixtures: [],
  seedOverrides: []
}
```

Suggested fixture shape:

```js
{
  id,
  divisionId,
  phase: 'group' | 'playoff',
  round,
  groupId,
  bracketPosition,
  label,
  teamA,
  teamB,
  seedA,
  seedB,
  venueId,
  slot,
  startsAt,
  durationMinutes,
  ref,
  scoreA,
  scoreB,
  winner,
  status: 'scheduled' | 'in_progress' | 'final'
}
```

Supabase can continue storing the active tournament JSON in `tournament_state` for the first implementation. If tournament history or reporting grows later, the JSON can be normalized into separate tables.

## Reliability and Tests

Core tournament behavior should move into shared JavaScript modules so it can be tested with `node:test`.

Required test coverage:

- Team-list group generation.
- Manual group preservation.
- Random grouping.
- Seeded snake grouping.
- Round robin generation for uneven group sizes.
- No team double-booked in the same time slot.
- No venue double-booked in the same time slot.
- Venue/time blocks are respected.
- Back-to-back games are minimized where possible.
- Drag/drop validation blocks invalid moves.
- Configurable standings points.
- Tiebreakers with point differential before head-to-head.
- Admin seed overrides.
- Projected playoff placeholders.
- Projected playoff team updates after score changes.
- Playoff score progression.
- Draft tournaments do not appear publicly.
- Published tournament updates appear publicly after save.

Verification should include automated engine tests and a manual local browser pass through setup, schedule generation, schedule editing, score entry, publish, and public live views.

## Scope Boundaries

In scope:

- Preserve current admin and public visual style.
- Improve the tournament engine and data model.
- Add divisions, setup modes, scheduling rules, editable fixtures, standings rules, playoff fixtures, publishing, and tests.

Out of scope for the first build:

- Migrating to React, Next.js, or another app framework.
- Public schedule filters by team or venue.
- Team-specific unavailable times.
- Multi-tournament public browsing.
- Fully normalized Supabase tournament tables.
- Supabase realtime subscriptions, unless the existing refresh behavior proves insufficient.

## Success Criteria

The tournament manager is successful when an RHM admin can create a draft tournament, enter teams, generate fair groups and schedules, edit fixtures safely, publish the tournament, enter group and playoff scores live, override seeds when needed, and have players see the current schedule, standings, and bracket on the public page without exposing private drafts or requiring manual page edits.
