(function (window) {
  var GL = ['A', 'B', 'C', 'D'];
  var ADV = { top1: 1, top2: 2, top4: 4 };

  function cleanTeams(group) {
    var teams = Array.isArray(group) ? group : (group.teams || []);
    return teams.map(function (team) { return String(team || '').trim(); }).filter(Boolean);
  }

  function parseMinutes(value, fallback) {
    var parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getGameBlockMinutes(settings) {
    return parseMinutes(settings.gameDuration, 25) + parseMinutes(settings.breakBetween, 0);
  }

  function formatTime(totalMinutes) {
    return String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0') + ':' + String(totalMinutes % 60).padStart(2, '0');
  }

  function startsAtForSlot(settings, slot) {
    var parts = String(settings.startTime || '10:00').split(':').map(Number);
    var sh = Number.isFinite(parts[0]) ? parts[0] : 10;
    var sm = Number.isFinite(parts[1]) ? parts[1] : 0;
    return formatTime((sh * 60) + sm + (slot * getGameBlockMinutes(settings)));
  }

  function normalizeGroups(groups) {
    return (groups || []).map(function (group, gi) {
      return {
        id: group.id || 'group-' + GL[gi],
        name: group.name || 'Group ' + GL[gi],
        teams: cleanTeams(group)
      };
    });
  }

  function normalizeVenues(venues, settings) {
    var requestedFields = Math.max(1, Math.min(8, parseMinutes(settings.numFields, 1)));
    if (venues && venues.length) {
      return venues.map(function (venue, index) {
        return {
          id: venue.id || 'field-' + (index + 1),
          name: venue.name || 'Field ' + (index + 1),
          index: index
        };
      });
    }

    return Array.from({ length: requestedFields }, function (_, index) {
      return {
        id: 'field-' + (index + 1),
        name: 'Field ' + (index + 1),
        index: index
      };
    });
  }

  function roundName(ri, total) {
    if (ri === total - 1) return 'Final';
    if (ri === total - 2) return 'Semifinals';
    if (ri === total - 3) return 'Quarterfinals';
    return 'Round ' + (ri + 1);
  }

  function buildPlayoffs(total) {
    var rounds = [];
    var t = total;
    while (t > 1) {
      rounds.push(Math.ceil(t / 2));
      t = Math.ceil(t / 2);
    }

    var matches = [];
    var mid = 0;
    rounds.forEach(function (count, ri) {
      for (var m = 0; m < count; m++) {
        matches.push({
          id: 'po' + mid++,
          ri: ri,
          rName: roundName(ri, rounds.length),
          mi: m,
          tA: null,
          tB: null,
          sA: null,
          sB: null
        });
      }
    });
    return matches;
  }

  function getActiveFieldCount(schedule) {
    if (!schedule || !schedule.length) return 0;
    return Math.max.apply(null, schedule.map(function (game) { return game.field; })) + 1;
  }

  function getTimeSlots(schedule) {
    return Array.from(new Set((schedule || []).map(function (game) { return game.slot; }))).sort(function (a, b) { return a - b; });
  }

  function generateRoundRobinFixtures(divisionId, groups) {
    var fixtures = [];
    groups.forEach(function (group, gi) {
      var teams = cleanTeams(group);
      for (var i = 0; i < teams.length; i++) {
        for (var j = i + 1; j < teams.length; j++) {
          fixtures.push({
            id: divisionId + '-group-' + fixtures.length,
            divisionId: divisionId,
            phase: 'group',
            groupId: group.id,
            groupName: group.name,
            groupIndex: gi,
            teamA: teams[i],
            teamB: teams[j],
            scoreA: null,
            scoreB: null
          });
        }
      }
    });
    return fixtures;
  }

  function teamsForFixture(fixture) {
    return [fixture.teamA, fixture.teamB].filter(Boolean);
  }

  function isBlocked(venueId, slot, blockedWindows) {
    return (blockedWindows || []).find(function (block) {
      var appliesToVenue = block.venueId === 'all' || block.venueId === venueId;
      return appliesToVenue && slot >= block.startSlot && slot < block.endSlot;
    });
  }

  function fixtureHasTeamConflict(fixture, fixtures, slot) {
    var teams = new Set(teamsForFixture(fixture));
    if (!teams.size) return false;
    return fixtures.find(function (other) {
      if (other.id === fixture.id || other.slot !== slot) return false;
      return teamsForFixture(other).some(function (team) { return teams.has(team); });
    });
  }

  function canPlaceFixture(fixture, venueId, slot, scheduled, blockedWindows, busyTeams) {
    if (isBlocked(venueId, slot, blockedWindows)) return false;
    if (scheduled.find(function (other) { return other.venueId === venueId && other.slot === slot; })) return false;
    return !teamsForFixture(fixture).some(function (team) {
      return busyTeams.has(team) || Boolean(fixtureHasTeamConflict(fixture, scheduled, slot));
    });
  }

  function prefersFreshTeams(fixture, previousSlotTeams) {
    return !teamsForFixture(fixture).some(function (team) { return previousSlotTeams.has(team); });
  }

  function slotTeams(fixtures, slot) {
    var teams = new Set();
    (fixtures || []).forEach(function (fixture) {
      if (fixture.slot === slot) {
        teamsForFixture(fixture).forEach(function (team) { teams.add(team); });
      }
    });
    return teams;
  }

  function createsThirdConsecutive(fixture, scheduled, slot) {
    if (slot < 2) return false;
    var previous = slotTeams(scheduled, slot - 1);
    var twoBack = slotTeams(scheduled, slot - 2);
    return teamsForFixture(fixture).some(function (team) {
      return previous.has(team) && twoBack.has(team);
    });
  }

  function backToBackCount(fixture, scheduled, slot) {
    var previous = slotTeams(scheduled, slot - 1);
    return teamsForFixture(fixture).filter(function (team) { return previous.has(team); }).length;
  }

  function availableVenuesForSlot(venues, slot, scheduled, blockedWindows) {
    return venues.filter(function (venue) {
      if (isBlocked(venue.id, slot, blockedWindows)) return false;
      return !scheduled.find(function (fixture) {
        return fixture.venueId === venue.id && fixture.slot === slot;
      });
    });
  }

  function canShareSlot(fixture, combo) {
    var teams = new Set(teamsForFixture(fixture));
    return !combo.some(function (other) {
      return teamsForFixture(other).some(function (team) { return teams.has(team); });
    });
  }

  function scoreSlotCombo(combo, scheduled, slot) {
    var backToBack = 0;
    combo.forEach(function (fixture) {
      backToBack += backToBackCount(fixture, scheduled, slot);
    });
    return (combo.length * 1000000) - (backToBack * 1000);
  }

  function findBestSlotCombo(remaining, maxGames, scheduled, slot, allowThirdConsecutive) {
    var candidates = remaining.filter(function (fixture) {
      if (fixtureHasTeamConflict(fixture, scheduled, slot)) return false;
      return allowThirdConsecutive || !createsThirdConsecutive(fixture, scheduled, slot);
    }).sort(function (a, b) {
      return backToBackCount(a, scheduled, slot) - backToBackCount(b, scheduled, slot);
    });

    var best = [];
    var bestScore = -Infinity;
    var nodeCount = 0;
    var nodeLimit = 50000;

    function consider(combo) {
      var score = scoreSlotCombo(combo, scheduled, slot);
      if (score > bestScore) {
        best = combo.slice();
        bestScore = score;
      }
    }

    function search(start, combo) {
      nodeCount++;
      if (nodeCount > nodeLimit) {
        consider(combo);
        return;
      }
      if (combo.length === maxGames || start >= candidates.length) {
        consider(combo);
        return;
      }
      if (combo.length + (candidates.length - start) < Math.min(maxGames, best.length)) return;

      for (var i = start; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (!canShareSlot(candidate, combo)) continue;
        combo.push(candidate);
        search(i + 1, combo);
        combo.pop();
      }
      consider(combo);
    }

    search(0, []);
    return best;
  }

  function scheduleFixtures(fixtures, options) {
    var settings = options.settings || {};
    var venues = normalizeVenues(options.venues || [], settings);
    var blockedWindows = options.blockedWindows || [];
    var remaining = fixtures.slice();
    var scheduled = (options.existingFixtures || []).slice();
    var placed = [];
    var slot = parseMinutes(options.startSlot, 0);
    var safety = 0;

    while (remaining.length > 0 && safety < 10000) {
      var scheduledAtSlot = scheduled.filter(function (fixture) { return fixture.slot === slot; });
      var availableVenues = availableVenuesForSlot(venues, slot, scheduled, blockedWindows);
      var currentPlaced = [];

      if (availableVenues.length) {
        var combo = findBestSlotCombo(remaining, availableVenues.length, scheduled, slot, false);
        if (!combo.length) combo = findBestSlotCombo(remaining, availableVenues.length, scheduled, slot, true);

        combo.forEach(function (selected, index) {
          var venue = availableVenues[index];
          var fixture = Object.assign({}, selected, {
            venueId: venue.id,
            venueName: venue.name,
            venueIndex: venue.index,
            slot: slot,
            startsAt: startsAtForSlot(settings, slot)
          });

          currentPlaced.push(fixture);
          placed.push(fixture);
        });

        currentPlaced.forEach(function (fixture) {
          var remainingIndex = remaining.findIndex(function (candidate) {
            return candidate.id === fixture.id;
          });
          if (remainingIndex !== -1) remaining.splice(remainingIndex, 1);
        });
      }

      if (!currentPlaced.length && scheduledAtSlot.length) {
        slot++;
        safety++;
        continue;
      }

      if (!currentPlaced.length && !scheduledAtSlot.length && availableVenues.length) {
        slot++;
        safety++;
        continue;
      }

      scheduled = scheduled.concat(currentPlaced);
      slot++;
      safety++;
    }

    return placed;
  }

  function seedPlaceholder(group, seed) {
    return {
      groupId: group.id,
      groupName: group.name,
      seed: seed,
      label: group.name + ' Seed ' + seed
    };
  }

  function buildOpeningSeeds(groups, advance) {
    var seeds = [];
    for (var seed = 1; seed <= advance; seed++) {
      groups.forEach(function (group) {
        seeds.push(seedPlaceholder(group, seed));
      });
    }
    return seeds;
  }

  function playoffSideKey(side) {
    if (!side) return '';
    if (side.sourceFixtureId) return 'winner:' + side.sourceFixtureId;
    return 'seed:' + side.groupId + ':' + side.seed;
  }

  function isSamePlayoffSide(sideA, sideB) {
    return Boolean(sideA && sideB && playoffSideKey(sideA) === playoffSideKey(sideB));
  }

  function nextPowerOfTwo(value) {
    var power = 1;
    while (power < value) power *= 2;
    return power;
  }

  function pickPairPartner(side, remaining) {
    for (var i = remaining.length - 1; i >= 0; i--) {
      if (remaining[i].groupId !== side.groupId) return i;
    }
    return remaining.length - 1;
  }

  function sourcePlaceholder(fixture) {
    return {
      sourceFixtureId: fixture.id,
      label: 'Winner of ' + fixture.id
    };
  }

  function createPlayoffFixture(divisionId, fixtures, roundIndex, totalRounds, matchIndex, sideA, sideB) {
    return {
      id: divisionId + '-playoff-' + fixtures.length,
      divisionId: divisionId,
      phase: 'playoff',
      roundIndex: roundIndex,
      roundName: roundName(roundIndex, totalRounds),
      matchIndex: matchIndex,
      seedA: sideA,
      seedB: sideB,
      scoreA: null,
      scoreB: null
    };
  }

  function interleaveByeAdvancers(byes, winners) {
    var advancers = [];
    var max = Math.max(byes.length, winners.length);
    for (var i = 0; i < max; i++) {
      if (byes[i]) advancers.push(byes[i]);
      if (winners[i]) advancers.push(winners[i]);
    }
    return advancers;
  }

  function buildFirstRound(entries, context) {
    var power = nextPowerOfTwo(entries.length);
    var byeCount = power - entries.length;
    var byes = entries.slice(0, byeCount);
    var remaining = entries.slice(byeCount);
    var winners = [];
    var matchIndex = 0;

    while (remaining.length > 1) {
      var sideA = remaining.shift();
      var partnerIndex = pickPairPartner(sideA, remaining);
      var sideB = remaining.splice(partnerIndex, 1)[0];
      if (sideA && sideB && !isSamePlayoffSide(sideA, sideB)) {
        var fixture = createPlayoffFixture(context.divisionId, context.fixtures, 0, context.totalRounds, matchIndex++, sideA, sideB);
        context.fixtures.push(fixture);
        winners.push(sourcePlaceholder(fixture));
      } else {
        winners.push(sideA || sideB);
      }
    }

    if (remaining.length === 1) byes.push(remaining[0]);
    return interleaveByeAdvancers(byes, winners);
  }

  function buildPlayoffFixtures(options) {
    var divisionId = options.divisionId || 'division';
    var groups = normalizeGroups(options.groups || []);
    var advance = ADV[(options.settings || {}).playoffFormat] || 2;
    var fixtures = [];
    var entries = buildOpeningSeeds(groups, advance);
    if (entries.length < 2) return fixtures;

    var totalRounds = Math.ceil(Math.log2(nextPowerOfTwo(entries.length)));
    var currentRound = buildFirstRound(entries, {
      divisionId: divisionId,
      fixtures: fixtures,
      totalRounds: totalRounds
    });
    var roundIndex = 1;

    while (currentRound.length > 1) {
      var nextRound = [];
      var matchIndex = 0;
      for (var i = 0; i < currentRound.length; i += 2) {
        var sideA = currentRound[i];
        var sideB = currentRound[i + 1];
        if (sideA && sideB && !isSamePlayoffSide(sideA, sideB)) {
          var nextFixture = createPlayoffFixture(divisionId, fixtures, roundIndex, totalRounds, matchIndex++, sideA, sideB);
          fixtures.push(nextFixture);
          nextRound.push(sourcePlaceholder(nextFixture));
        } else {
          nextRound.push(sideA || sideB);
        }
      }
      currentRound = nextRound;
      roundIndex++;
    }

    return fixtures;
  }

  function maxSlot(fixtures) {
    if (!fixtures.length) return -1;
    return Math.max.apply(null, fixtures.map(function (fixture) { return fixture.slot; }));
  }

  function schedulePlayoffFixtures(fixtures, options) {
    var scheduled = [];
    var existingFixtures = (options.existingFixtures || []).slice();
    var slot = options.startSlot || 0;
    var roundIndexes = Array.from(new Set(fixtures.map(function (fixture) { return fixture.roundIndex; }))).sort(function (a, b) { return a - b; });

    roundIndexes.forEach(function (roundIndex) {
      var roundFixtures = fixtures.filter(function (fixture) { return fixture.roundIndex === roundIndex; });
      var placed = scheduleFixtures(roundFixtures, Object.assign({}, options, {
        startSlot: slot,
        existingFixtures: existingFixtures
      }));
      scheduled = scheduled.concat(placed);
      existingFixtures = existingFixtures.concat(placed);
      slot = maxSlot(placed) + 1;
    });

    return scheduled;
  }

  function generateDivisionSchedule(input) {
    var settings = input.settings || {};
    var divisionId = input.divisionId || 'division';
    var groups = normalizeGroups(input.groups || []);
    var venues = normalizeVenues(input.venues || [], settings);
    var groupFixtures = generateRoundRobinFixtures(divisionId, groups);
    var scheduledGroups = scheduleFixtures(groupFixtures, {
      venues: venues,
      settings: settings,
      blockedWindows: input.blockedWindows || [],
      startSlot: 0
    });
    var groupBlockMinutes = getGameBlockMinutes(settings);
    var breakSlots = Math.ceil(parseMinutes(settings.breakBeforePlayoffs, 0) / groupBlockMinutes);
    var playoffFixtures = buildPlayoffFixtures({
      divisionId: divisionId,
      groups: groups,
      settings: settings
    });
    var playoffStartSlot = Math.max(0, maxSlot(scheduledGroups) + 1 + breakSlots);
    var scheduledPlayoffs = schedulePlayoffFixtures(playoffFixtures, {
      venues: venues,
      settings: settings,
      blockedWindows: input.blockedWindows || [],
      startSlot: playoffStartSlot,
      existingFixtures: scheduledGroups
    });
    var fixtures = scheduledGroups.concat(scheduledPlayoffs);

    return {
      divisionId: divisionId,
      settings: Object.assign({}, settings),
      venues: venues,
      groups: groups,
      fixtures: fixtures,
      summary: {
        groupFixtures: scheduledGroups.length,
        playoffFixtures: scheduledPlayoffs.length,
        totalFixtures: fixtures.length,
        totalSlots: getTimeSlots(fixtures).length,
        gameBlockMinutes: groupBlockMinutes,
        breakSlotsBeforePlayoffs: breakSlots
      }
    };
  }

  function assignRefs(schedule, groups) {
    schedule.forEach(function (game) {
      var playing = new Set(schedule.filter(function (g) {
        return g.slot === game.slot;
      }).flatMap(function (g) {
        return [g.tA, g.tB];
      }));
      var ref = '';

      groups.some(function (grp, gi) {
        if (gi === game.gi) return false;
        ref = cleanTeams(grp).find(function (team) { return !playing.has(team); }) || '';
        return Boolean(ref);
      });

      if (!ref) {
        ref = cleanTeams(groups[game.gi]).find(function (team) {
          return team !== game.tA && team !== game.tB && !playing.has(team);
        }) || '-';
      }
      game.ref = ref;
    });
  }

  function adaptFixtureToGame(fixture) {
    return {
      id: fixture.id,
      gi: fixture.groupIndex,
      gName: fixture.groupName,
      tA: fixture.teamA,
      tB: fixture.teamB,
      field: fixture.venueIndex,
      slot: fixture.slot,
      time: fixture.startsAt,
      scoreA: fixture.scoreA,
      scoreB: fixture.scoreB,
      ref: ''
    };
  }

  function generateSchedule(input) {
    var settings = input.settings || {};
    var requestedFields = Math.max(1, Math.min(8, parseMinutes(settings.numFields, 1)));
    var groups = normalizeGroups(input.groups || []).map(function (group) {
      return {
        id: group.id,
        name: group.name,
        teams: group.teams
      };
    });
    var result = generateDivisionSchedule(Object.assign({}, input, {
      divisionId: input.divisionId || 'division',
      settings: settings,
      groups: groups,
      venues: input.venues || normalizeVenues([], settings)
    }));
    var schedule = result.fixtures.filter(function (fixture) {
      return fixture.phase === 'group';
    }).map(adaptFixtureToGame);

    assignRefs(schedule, groups);

    var activeFields = getActiveFieldCount(schedule);
    var slots = getTimeSlots(schedule);
    var note = '';
    if (activeFields > 0 && requestedFields > activeFields) {
      note = requestedFields + ' fields requested; ' + activeFields + ' can be used without teams playing twice in the same slot.';
    }

    var advance = ADV[settings.playoffFormat] || 2;
    return {
      settings: Object.assign({}, settings, {
        numFields: requestedFields,
        effectiveFields: activeFields
      }),
      groups: groups,
      schedule: schedule,
      playoffs: buildPlayoffs(groups.length * advance),
      summary: {
        totalGames: schedule.length,
        totalSlots: slots.length,
        requestedFields: requestedFields,
        activeFields: activeFields,
        gameBlockMinutes: getGameBlockMinutes(settings),
        note: note
      }
    };
  }

  function makeResult(options, props) {
    var result = {};
    if (options && typeof options.constructor === 'function') {
      try {
        result = new options.constructor();
      } catch (error) {
        result = {};
      }
    }
    Object.keys(props).forEach(function (key) {
      result[key] = props[key];
    });
    return result;
  }

  function validateFixtureMove(options) {
    var moving = (options.fixtures || []).find(function (fixture) {
      return fixture.id === options.fixtureId;
    });
    if (!moving) return makeResult(options, { ok: false, reason: 'Fixture not found.' });

    var block = isBlocked(options.targetVenueId, options.targetSlot, options.blockedWindows || []);
    if (block) return makeResult(options, { ok: false, reason: 'Field/court is blocked: ' + (block.reason || 'Unavailable') + '.' });

    var venueConflict = (options.fixtures || []).find(function (fixture) {
      return fixture.id !== moving.id && fixture.venueId === options.targetVenueId && fixture.slot === options.targetSlot;
    });
    if (venueConflict) return makeResult(options, { ok: false, reason: 'Field/court already has a game at this time.' });

    var movingTeams = new Set(teamsForFixture(moving));
    var teamConflict = (options.fixtures || []).find(function (fixture) {
      if (fixture.id === moving.id || fixture.slot !== options.targetSlot) return false;
      return teamsForFixture(fixture).some(function (team) { return movingTeams.has(team); });
    });
    if (teamConflict) {
      var team = teamsForFixture(teamConflict).find(function (name) { return movingTeams.has(name); });
      return makeResult(options, { ok: false, reason: team + ' already plays at this time.' });
    }

    return makeResult(options, { ok: true });
  }

  function moveFixture(options) {
    var validation = validateFixtureMove(options);
    if (!validation.ok) return validation;

    var venues = options.venues || [];
    var targetVenue = venues.find(function (venue) { return venue.id === options.targetVenueId; });
    var fixtures = (options.fixtures || []).map(function (fixture) {
      if (fixture.id !== options.fixtureId) return fixture;
      var moved = Object.assign({}, fixture, {
        venueId: options.targetVenueId,
        slot: options.targetSlot
      });
      if (targetVenue) moved.venueName = targetVenue.name;
      if (options.settings) moved.startsAt = startsAtForSlot(options.settings, options.targetSlot);
      return moved;
    });

    return makeResult(options, { ok: true, fixtures: fixtures });
  }

  window.RHMTournamentEngine = {
    generateSchedule: generateSchedule,
    getActiveFieldCount: getActiveFieldCount,
    getTimeSlots: getTimeSlots,
    buildPlayoffs: buildPlayoffs,
    generateDivisionSchedule: generateDivisionSchedule,
    validateFixtureMove: validateFixtureMove,
    moveFixture: moveFixture,
    buildPlayoffFixtures: buildPlayoffFixtures
  };
})(window);
