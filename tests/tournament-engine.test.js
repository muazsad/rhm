const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadBrowserScript(relativePath, sandbox) {
  const code = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: relativePath });
  return sandbox;
}

function makeSandbox() {
  const sandbox = { window: {} };
  sandbox.window = sandbox;
  return sandbox;
}

function sampleGroups() {
  return [
    { name: 'Group A', teams: ['Aqsa Avengers', 'EH Warriors', 'Halal Marys'] },
    { name: 'Group B', teams: ['Intifada Black Ops', 'Strap Kings', 'Rafey Khan'] }
  ];
}

function playoffSideKey(side) {
  if (!side) return '';
  if (side.sourceFixtureId) return `winner:${side.sourceFixtureId}`;
  return `seed:${side.groupId}:${side.seed}`;
}

function assertPlayablePlayoffFixtures(fixtures) {
  const playoffs = fixtures.filter(fixture => fixture.phase === 'playoff');
  assert.ok(playoffs.length > 0);
  playoffs.forEach(fixture => {
    assert.ok(fixture.seedA, `${fixture.id} is missing seedA`);
    assert.ok(fixture.seedB, `${fixture.id} is missing seedB`);
    assert.notEqual(playoffSideKey(fixture.seedA), playoffSideKey(fixture.seedB), `${fixture.id} is a self-match`);
  });
}

test('round robin schedule omits unused fields when requested fields exceed possible concurrency', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateSchedule({
    settings: {
      numFields: 3,
      gameDuration: 25,
      breakBetween: 5,
      startTime: '13:00',
      playoffFormat: 'top2'
    },
    groups: sampleGroups()
  });

  assert.equal(result.summary.requestedFields, 3);
  assert.equal(result.summary.activeFields, 2);
  assert.equal(result.schedule.length, 6);
  assert.deepEqual([...new Set(result.schedule.map(game => game.field))], [0, 1]);
  assert.equal(result.summary.note, '3 fields requested; 2 can be used without teams playing twice in the same slot.');
});

test('round robin schedule keeps teams from double-booking in a time slot', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateSchedule({
    settings: {
      numFields: 4,
      gameDuration: 20,
      breakBetween: 5,
      startTime: '10:00',
      playoffFormat: 'top2'
    },
    groups: [
      { name: 'Group A', teams: ['A1', 'A2', 'A3', 'A4'] },
      { name: 'Group B', teams: ['B1', 'B2', 'B3', 'B4'] },
      { name: 'Group C', teams: ['C1', 'C2', 'C3', 'C4'] }
    ]
  });

  const slots = [...new Set(result.schedule.map(game => game.slot))];
  slots.forEach(slot => {
    const teams = result.schedule
      .filter(game => game.slot === slot)
      .flatMap(game => [game.tA, game.tB]);
    assert.equal(teams.length, new Set(teams).size);
  });
});

test('round robin schedule packs every possible field in each slot', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'adult',
    settings: {
      numFields: 3,
      startTime: '13:30',
      gameDuration: 20,
      breakBetween: 5,
      breakBeforePlayoffs: 0,
      playoffGameDuration: 20,
      advancePerGroup: 1
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' },
      { id: 'field-3', name: 'Field 3' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2', 'A3', 'A4'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2', 'B3', 'B4'] },
      { id: 'group-c', name: 'Group C', teams: ['C1', 'C2', 'C3', 'C4'] }
    ],
    blockedWindows: []
  });

  const groupFixtures = result.fixtures.filter(fixture => fixture.phase === 'group');
  const slots = [...new Set(groupFixtures.map(fixture => fixture.slot))].sort((a, b) => a - b);

  assert.equal(groupFixtures.length, 18);
  assert.equal(slots.length, 6);
  slots.forEach(slot => {
    const games = groupFixtures.filter(fixture => fixture.slot === slot);
    assert.equal(games.length, 3, `slot ${slot} should use all three fields`);
    assert.equal(JSON.stringify(games.map(fixture => fixture.venueIndex)), JSON.stringify([0, 1, 2]));
    const teams = games.flatMap(fixture => [fixture.teamA, fixture.teamB]);
    assert.equal(teams.length, new Set(teams).size, `slot ${slot} double-books a team`);
  });
  assert.equal(groupFixtures[0].startsAt, '1:30 PM');
});

test('generateDivisionSchedule creates group and playoff fixtures with seed placeholders', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'adult',
    settings: {
      sport: 'Flag Football',
      startTime: '10:00',
      gameDuration: 20,
      breakBetween: 5,
      breakBeforePlayoffs: 30,
      playoffGameDuration: 25,
      advancePerGroup: 2
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2', 'A3'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2', 'B3'] }
    ],
    blockedWindows: []
  });

  assert.equal(result.fixtures.filter(fixture => fixture.phase === 'group').length, 6);
  assert.equal(result.fixtures.filter(fixture => fixture.phase === 'playoff').length, 3);
  assert.equal(result.fixtures.find(fixture => fixture.phase === 'playoff').seedA.label, '1A');
});

test('generateDivisionSchedule builds a six-team bracket with top seeds on byes', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'adult',
    settings: {
      startTime: '10:00 AM',
      gameDuration: 20,
      breakBetween: 0,
      breakBeforePlayoffs: 30,
      playoffGameDuration: 20,
      advancePerGroup: 3
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2', 'A3'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2', 'B3'] }
    ],
    blockedWindows: []
  });

  const playoffs = result.fixtures.filter(fixture => fixture.phase === 'playoff');
  const quarterfinals = playoffs.filter(fixture => fixture.roundName === 'Quarterfinals');
  const semifinals = playoffs.filter(fixture => fixture.roundName === 'Semifinals');
  const final = playoffs.filter(fixture => fixture.roundName === 'Final');

  assert.equal(playoffs.length, 5);
  assert.equal(quarterfinals.length, 2);
  assert.equal(semifinals.length, 2);
  assert.equal(final.length, 1);
  assert.equal(JSON.stringify(
    quarterfinals.map(fixture => [fixture.seedA.label, fixture.seedB.label]),
  ), JSON.stringify([['2A', '3B'], ['2B', '3A']]));
  assert.equal(JSON.stringify(
    semifinals.map(fixture => [fixture.seedA.label, fixture.seedB.label]),
  ), JSON.stringify([['1A', 'Winner of adult-playoff-0'], ['1B', 'Winner of adult-playoff-1']]));
  assert.equal(new Set(quarterfinals.map(fixture => fixture.slot)).size, 1);
  assert.equal(JSON.stringify(quarterfinals.map(fixture => fixture.venueIndex)), JSON.stringify([0, 1]));
});

test('generateDivisionSchedule respects venue blocks', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'adult',
    settings: {
      startTime: '10:00',
      gameDuration: 20,
      breakBetween: 0,
      breakBeforePlayoffs: 0,
      playoffGameDuration: 20,
      playoffFormat: 'top1'
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2'] }
    ],
    blockedWindows: [
      { venueId: 'field-1', startSlot: 0, endSlot: 1, reason: 'Setup' }
    ]
  });

  assert.equal(result.fixtures.some(fixture => fixture.venueId === 'field-1' && fixture.slot === 0), false);
});

test('validateFixtureMove blocks team conflicts and blocked windows', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const fixtures = [
    { id: 'f1', teamA: 'A', teamB: 'B', venueId: 'field-1', slot: 0 },
    { id: 'f2', teamA: 'A', teamB: 'C', venueId: 'field-2', slot: 1 }
  ];

  assert.deepEqual(
    sandbox.window.RHMTournamentEngine.validateFixtureMove({
      fixtureId: 'f2',
      fixtures,
      targetVenueId: 'field-2',
      targetSlot: 0,
      blockedWindows: []
    }),
    { ok: false, reason: 'A already plays at this time.' }
  );

  assert.deepEqual(
    sandbox.window.RHMTournamentEngine.validateFixtureMove({
      fixtureId: 'f2',
      fixtures,
      targetVenueId: 'field-2',
      targetSlot: 2,
      blockedWindows: [{ venueId: 'field-2', startSlot: 2, endSlot: 3, reason: 'Prayer break' }]
    }),
    { ok: false, reason: 'Field/court is blocked: Prayer break.' }
  );
});

test('generateDivisionSchedule avoids self matches and one-sided playoff fixtures for three groups top1', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'adult',
    settings: {
      startTime: '10:00',
      gameDuration: 20,
      breakBetween: 0,
      breakBeforePlayoffs: 0,
      playoffGameDuration: 20,
      playoffFormat: 'top1'
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2'] },
      { id: 'group-c', name: 'Group C', teams: ['C1', 'C2'] }
    ],
    blockedWindows: []
  });

  assertPlayablePlayoffFixtures(result.fixtures);
});

test('generateDivisionSchedule avoids self matches and one-sided playoff fixtures for three groups top2', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'adult',
    settings: {
      startTime: '10:00',
      gameDuration: 20,
      breakBetween: 0,
      breakBeforePlayoffs: 0,
      playoffGameDuration: 20,
      playoffFormat: 'top2'
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2'] },
      { id: 'group-c', name: 'Group C', teams: ['C1', 'C2'] }
    ],
    blockedWindows: []
  });

  assertPlayablePlayoffFixtures(result.fixtures);
});

test('generateDivisionSchedule packs two five-team groups across three fields', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'rhm',
    settings: {
      startTime: '12:30',
      gameDuration: 25,
      breakBetween: 5,
      breakBeforePlayoffs: 30,
      playoffGameDuration: 30,
      playoffFormat: 'top2',
      numFields: 3
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' },
      { id: 'field-3', name: 'Field 3' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2', 'A3', 'A4', 'A5'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2', 'B3', 'B4', 'B5'] }
    ],
    blockedWindows: []
  });

  const groupFixtures = result.fixtures.filter(fixture => fixture.phase === 'group');
  const groupSlots = [...new Set(groupFixtures.map(fixture => fixture.slot))].sort((a, b) => a - b);

  assert.equal(groupFixtures.length, 20);
  assert.equal(groupSlots.length, 7);

  groupSlots.forEach((slot) => {
    const gamesInSlot = groupFixtures.filter(fixture => fixture.slot === slot);
    assert.ok(gamesInSlot.length <= 3);
  });

  groupSlots.forEach((slot) => {
    const gamesInSlot = groupFixtures.filter(fixture => fixture.slot === slot);
    const expectedFields = Array.from({ length: gamesInSlot.length }, (_, index) => index);
    assert.equal(JSON.stringify(gamesInSlot.map(fixture => fixture.venueIndex)), JSON.stringify(expectedFields));
  });

  const slotsByTeam = {};
  groupFixtures.forEach(fixture => {
    [fixture.teamA, fixture.teamB].forEach(team => {
      slotsByTeam[team] = slotsByTeam[team] || [];
      slotsByTeam[team].push(fixture.slot);
    });
  });

  Object.entries(slotsByTeam).forEach(([team, slots]) => {
    const ordered = [...new Set(slots)].sort((a, b) => a - b);
    for (let i = 2; i < ordered.length; i++) {
      assert.notEqual(
        ordered[i - 2] + 1 === ordered[i - 1] && ordered[i - 1] + 1 === ordered[i],
        true,
        `${team} plays three consecutive slots: ${ordered.join(', ')}`
      );
    }
  });
});

test('generateDivisionSchedule never schedules a team three slots in a row', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'division-main',
    settings: {
      startTime: '10:00',
      gameDuration: 25,
      breakBetween: 5,
      breakBeforePlayoffs: 30,
      playoffGameDuration: 30,
      advancePerGroup: 2,
      numFields: 3
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' },
      { id: 'field-3', name: 'Field 3' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['Team 1', 'Team 2', 'Team 3', 'Team 4'] },
      { id: 'group-b', name: 'Group B', teams: ['Team 5', 'Team 6', 'Team 7', 'Team 8'] }
    ],
    blockedWindows: []
  });

  const groupFixtures = result.fixtures.filter(fixture => fixture.phase === 'group');
  const slotsByTeam = {};
  let backToBackPairs = 0;

  groupFixtures.forEach(fixture => {
    [fixture.teamA, fixture.teamB].forEach(team => {
      slotsByTeam[team] = slotsByTeam[team] || [];
      slotsByTeam[team].push(fixture.slot);
    });
  });

  Object.entries(slotsByTeam).forEach(([team, slots]) => {
    const ordered = [...new Set(slots)].sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i - 1] + 1 === ordered[i]) backToBackPairs++;
    }
    for (let i = 2; i < ordered.length; i++) {
      assert.notEqual(
        ordered[i - 2] + 1 === ordered[i - 1] && ordered[i - 1] + 1 === ordered[i],
        true,
        `${team} plays three consecutive slots: ${ordered.join(', ')}`
      );
    }
  });

  const firstFourSlots = [0, 1, 2, 3].map(slot => groupFixtures.filter(fixture => fixture.slot === slot).length);
  assert.notDeepEqual(firstFourSlots, [3, 3, 3, 3]);
  assert.ok(backToBackPairs <= 4, `expected at most 4 back-to-back pairs, got ${backToBackPairs}`);
});
