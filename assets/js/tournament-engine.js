(function (window) {
  var GL = ['A', 'B', 'C', 'D'];
  var ADV = { top1: 1, top2: 2, top3: 3, top4: 4 };

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

  function getPlayoffBlockMinutes(settings) {
    return parseMinutes(settings.playoffGameDuration, parseMinutes(settings.gameDuration, 25)) + parseMinutes(settings.breakBetween, 0);
  }

  function formatTime24(totalMinutes) {
    return String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0') + ':' + String(totalMinutes % 60).padStart(2, '0');
  }

  function formatTime12(totalMinutes) {
    var minutes = ((totalMinutes % 1440) + 1440) % 1440;
    var hours24 = Math.floor(minutes / 60);
    var hours12 = hours24 % 12 || 12;
    var suffix = hours24 >= 12 ? 'PM' : 'AM';
    return hours12 + ':' + String(minutes % 60).padStart(2, '0') + ' ' + suffix;
  }

  function parseTimeToMinutes(value, fallback) {
    var raw = String(value || '').trim();
    var match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return fallback;

    var hours = parseInt(match[1], 10);
    var minutes = parseInt(match[2] || '0', 10);
    var meridiem = match[3] ? match[3].toUpperCase() : '';
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) return fallback;

    if (meridiem) {
      if (hours < 1 || hours > 12) return fallback;
      hours = hours % 12;
      if (meridiem === 'PM') hours += 12;
    } else if (hours < 0 || hours > 23) {
      return fallback;
    }

    return (hours * 60) + minutes;
  }

  function startsAtForSlot(settings, slot) {
    var start = parseTimeToMinutes(settings.startTime || '10:00', 600);
    return formatTime12(start + (slot * getGameBlockMinutes(settings)));
  }

  function parseAdvance(settings, groupCount) {
    var config = settings || {};
    var value = config.advancePerGroup;
    if (value === undefined || value === null || value === '') value = ADV[config.playoffFormat];
    var parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) parsed = 2;
    return Math.max(1, Math.min(16, parsed));
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

  function slotTeams(fixtures, slot) {
    var teams = new Set();
    (fixtures || []).forEach(function (fixture) {
      if (fixture.slot === slot) {
        teamsForFixture(fixture).forEach(function (team) { teams.add(team); });
      }
    });
    return teams;
  }

  function backToBackCount(fixture, scheduled, slot) {
    var previous = slotTeams(scheduled, slot - 1);
    return teamsForFixture(fixture).filter(function (team) { return previous.has(team); }).length;
  }

  function createsThirdConsecutive(fixture, scheduled, slot) {
    if (slot < 2) return false;
    var previous = slotTeams(scheduled, slot - 1);
    var twoBack = slotTeams(scheduled, slot - 2);
    return teamsForFixture(fixture).some(function (team) {
      return previous.has(team) && twoBack.has(team);
    });
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

  function enumerateSlotCombos(remaining, maxGames, scheduled, slot, limit) {
    var candidates = remaining.filter(function (fixture) {
      if (fixtureHasTeamConflict(fixture, scheduled, slot)) return false;
      return !createsThirdConsecutive(fixture, scheduled, slot);
    }).sort(function (a, b) {
      return backToBackCount(a, scheduled, slot) - backToBackCount(b, scheduled, slot);
    });

    var combos = [];
    var nodeCount = 0;
    var nodeLimit = 75000;

    function search(start, combo) {
      nodeCount++;
      if (nodeCount > nodeLimit) return;
      if (combo.length) combos.push(combo.slice());
      if (combo.length === maxGames || start >= candidates.length) return;

      for (var i = start; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (!canShareSlot(candidate, combo)) continue;
        combo.push(candidate);
        search(i + 1, combo);
        combo.pop();
      }
    }

    search(0, []);
    combos.sort(function (a, b) {
      if (b.length !== a.length) return b.length - a.length;
      var backToBackDiff = comboBackToBackCount(a, scheduled, slot) - comboBackToBackCount(b, scheduled, slot);
      if (backToBackDiff !== 0) return backToBackDiff;
      return groupCount(a) - groupCount(b);
    });
    return combos.slice(0, limit || 80);
  }

  function groupCount(combo) {
    return new Set(combo.map(function (fixture) { return fixture.groupId || fixture.groupName || ''; })).size;
  }

  function comboBackToBackCount(combo, scheduled, slot) {
    return combo.reduce(function (total, fixture) {
      return total + backToBackCount(fixture, scheduled, slot);
    }, 0);
  }

  function sortScheduleStates(a, b) {
    if (a.remaining.length !== b.remaining.length) return a.remaining.length - b.remaining.length;
    if (a.backToBack !== b.backToBack) return a.backToBack - b.backToBack;
    if (a.slot !== b.slot) return a.slot - b.slot;
    return a.placed.length - b.placed.length;
  }

  function pruneScheduleStates(states, beamWidth) {
    var buckets = {};
    states.forEach(function (state) {
      var key = String(state.remaining.length);
      buckets[key] = buckets[key] || [];
      buckets[key].push(state);
    });

    var kept = [];
    Object.keys(buckets).forEach(function (key) {
      buckets[key].sort(function (a, b) {
        if (a.backToBack !== b.backToBack) return a.backToBack - b.backToBack;
        if (a.slot !== b.slot) return a.slot - b.slot;
        return b.placed.length - a.placed.length;
      });
      kept = kept.concat(buckets[key].slice(0, Math.max(20, Math.floor(beamWidth / 6))));
    });

    kept.sort(sortScheduleStates);
    return kept.slice(0, beamWidth);
  }

  function recentTeamKey(scheduled, slot) {
    return [slot - 1, slot - 2].map(function (recentSlot) {
      return Array.from(slotTeams(scheduled, recentSlot)).sort().join(',');
    }).join('|');
  }

  function exactScheduleFixtures(fixtures, venues, blockedWindows, settings, startSlot, existing) {
    var best = null;
    var seen = {};
    var maxVenueCount = Math.max(1, venues.length);
    var nodeCount = 0;
    var nodeLimit = 250000;

    function stateKey(remaining, scheduled, slot) {
      return remaining.map(function (fixture) { return fixture.id; }).sort().join(',') + '::' + slot + '::' + recentTeamKey(scheduled, slot);
    }

    function placeCombo(state, combo, availableVenues) {
      var currentPlaced = combo.map(function (selected, index) {
        var venue = availableVenues[index];
        return Object.assign({}, selected, {
          venueId: venue.id,
          venueName: venue.name,
          venueIndex: venue.index,
          slot: state.slot,
          startsAt: startsAtForSlot(settings, state.slot)
        });
      });
      var placedIds = new Set(currentPlaced.map(function (fixture) { return fixture.id; }));
      return {
        remaining: state.remaining.filter(function (fixture) { return !placedIds.has(fixture.id); }),
        scheduled: state.scheduled.concat(currentPlaced),
        placed: state.placed.concat(currentPlaced),
        slot: state.slot + 1,
        backToBack: state.backToBack + comboBackToBackCount(combo, state.scheduled, state.slot)
      };
    }

    function search(state) {
      nodeCount++;
      if (nodeCount > nodeLimit) return;

      if (!state.remaining.length) {
        if (!best || state.slot < best.slot || (state.slot === best.slot && state.backToBack < best.backToBack)) {
          best = state;
        }
        return;
      }

      if (best) {
        var optimisticFinish = state.slot + Math.ceil(state.remaining.length / maxVenueCount);
        if (optimisticFinish > best.slot) return;
        if (optimisticFinish === best.slot && state.backToBack >= best.backToBack) return;
      }

      var key = stateKey(state.remaining, state.scheduled, state.slot);
      if (seen[key] !== undefined && seen[key] <= state.backToBack) return;
      seen[key] = state.backToBack;

      var availableVenues = availableVenuesForSlot(venues, state.slot, state.scheduled, blockedWindows);
      if (!availableVenues.length) {
        search(Object.assign({}, state, { slot: state.slot + 1 }));
        return;
      }

      var combos = enumerateSlotCombos(state.remaining, availableVenues.length, state.scheduled, state.slot, 10000);
      if (!combos.length) {
        search(Object.assign({}, state, { slot: state.slot + 1 }));
        return;
      }

      combos.forEach(function (combo) {
        search(placeCombo(state, combo, availableVenues));
      });
    }

    search({
      remaining: fixtures.slice(),
      scheduled: existing,
      placed: [],
      slot: startSlot,
      backToBack: 0
    });

    return best ? best.placed : null;
  }

  function scheduleFixtures(fixtures, options) {
    var settings = options.settings || {};
    var venues = normalizeVenues(options.venues || [], settings);
    var blockedWindows = options.blockedWindows || [];
    var startSlot = parseMinutes(options.startSlot, 0);
    var existing = (options.existingFixtures || []).slice();
    if (fixtures.length <= 14 && !existing.length) {
      var exact = exactScheduleFixtures(fixtures, venues, blockedWindows, settings, startSlot, existing);
      if (exact) return exact;
    }

    var states = [{
      remaining: fixtures.slice(),
      scheduled: existing,
      placed: [],
      slot: startSlot,
      backToBack: 0
    }];
    var completed = [];
    var bestCompletedSlot = Infinity;
    var beamWidth = parseMinutes(options.beamWidth, 500);
    var safety = 0;

    while (states.length > 0 && safety < 10000) {
      var nextStates = [];

      states.forEach(function (state) {
        if (!state.remaining.length) {
          completed.push(state);
          if (state.slot < bestCompletedSlot) bestCompletedSlot = state.slot;
          return;
        }

        if (state.slot >= bestCompletedSlot) return;

        var availableVenues = availableVenuesForSlot(venues, state.slot, state.scheduled, blockedWindows);
        if (!availableVenues.length) {
          nextStates.push(Object.assign({}, state, { slot: state.slot + 1 }));
          return;
        }

        var combos = enumerateSlotCombos(state.remaining, availableVenues.length, state.scheduled, state.slot);
        if (!combos.length) {
          nextStates.push(Object.assign({}, state, { slot: state.slot + 1 }));
          return;
        }

        combos.forEach(function (combo) {
          var currentPlaced = combo.map(function (selected, index) {
            var venue = availableVenues[index];
            return Object.assign({}, selected, {
              venueId: venue.id,
              venueName: venue.name,
              venueIndex: venue.index,
              slot: state.slot,
              startsAt: startsAtForSlot(settings, state.slot)
            });
          });
          var placedIds = new Set(currentPlaced.map(function (fixture) { return fixture.id; }));
          nextStates.push({
            remaining: state.remaining.filter(function (fixture) { return !placedIds.has(fixture.id); }),
            scheduled: state.scheduled.concat(currentPlaced),
            placed: state.placed.concat(currentPlaced),
            slot: state.slot + 1,
            backToBack: state.backToBack + comboBackToBackCount(combo, state.scheduled, state.slot)
          });
        });
      });

      states = pruneScheduleStates(nextStates, beamWidth);
      safety++;
    }

    completed = completed.concat(states.filter(function (state) { return !state.remaining.length; }));
    if (!completed.length) return [];
    completed.sort(function (a, b) {
      if (a.slot !== b.slot) return a.slot - b.slot;
      if (a.backToBack !== b.backToBack) return a.backToBack - b.backToBack;
      return a.placed.length - b.placed.length;
    });
    return completed[0].placed;
  }

  function groupShortCode(group, index) {
    var name = String(group.name || '').trim();
    var groupLetter = name.match(/Group\s+([A-Z0-9]+)/i);
    if (groupLetter) return groupLetter[1].toUpperCase();
    return GL[index] || String(index + 1);
  }

  function seedPlaceholder(group, seed, index) {
    var shortCode = groupShortCode(group, index);
    return {
      groupId: group.id,
      groupName: group.name,
      seed: seed,
      groupCode: shortCode,
      label: seed + shortCode
    };
  }

  function buildOpeningSeeds(groups, advance) {
    var seeds = [];
    for (var seed = 1; seed <= advance; seed++) {
      groups.forEach(function (group, index) {
        seeds.push(seedPlaceholder(group, seed, index));
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
    var advance = parseAdvance(options.settings || {}, groups.length);
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

  function applyPlayoffStartTimes(playoffFixtures, settings, groupFixtures) {
    if (!playoffFixtures.length) return playoffFixtures;

    var groupBlock = getGameBlockMinutes(settings);
    var playoffBlock = getPlayoffBlockMinutes(settings);
    var startMinutes = parseTimeToMinutes(settings.startTime || '10:00', 600);
    var groupEndMinutes = startMinutes + ((maxSlot(groupFixtures) + 1) * groupBlock);
    var firstPlayoffMinutes = groupEndMinutes + parseMinutes(settings.breakBeforePlayoffs, 0);
    var playoffSlots = getTimeSlots(playoffFixtures);
    var slotOffsets = {};

    playoffSlots.forEach(function (slot, index) {
      slotOffsets[slot] = index;
    });

    return playoffFixtures.map(function (fixture) {
      return Object.assign({}, fixture, {
        startsAt: formatTime12(firstPlayoffMinutes + (slotOffsets[fixture.slot] * playoffBlock))
      });
    });
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
    scheduledPlayoffs = applyPlayoffStartTimes(scheduledPlayoffs, settings, scheduledGroups);
    var fixtures = scheduledGroups.concat(scheduledPlayoffs);

    return {
      divisionId: divisionId,
      settings: Object.assign({}, settings, {
        advancePerGroup: parseAdvance(settings, groups.length),
        startTime: formatTime24(parseTimeToMinutes(settings.startTime || '10:00', 600))
      }),
      venues: venues,
      groups: groups,
      fixtures: fixtures,
      summary: {
        groupFixtures: scheduledGroups.length,
        playoffFixtures: scheduledPlayoffs.length,
        totalFixtures: fixtures.length,
        totalSlots: getTimeSlots(fixtures).length,
        gameBlockMinutes: groupBlockMinutes,
        playoffBlockMinutes: getPlayoffBlockMinutes(settings),
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

    var advance = parseAdvance(settings, groups.length);
    return {
      settings: Object.assign({}, settings, {
        numFields: requestedFields,
        effectiveFields: activeFields,
        advancePerGroup: advance,
        startTime: formatTime24(parseTimeToMinutes(settings.startTime || '10:00', 600))
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
    buildPlayoffFixtures: buildPlayoffFixtures,
    parseAdvance: parseAdvance,
    formatTime12: formatTime12,
    formatTime24: formatTime24,
    parseTimeToMinutes: parseTimeToMinutes
  };
})(window);
