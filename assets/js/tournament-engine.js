(function (window) {
  var GL = ['A', 'B', 'C', 'D'];
  var ADV = { top1: 1, top2: 2, top4: 4 };

  function cleanTeams(group) {
    return (group.teams || []).map(function (team) { return String(team || '').trim(); }).filter(Boolean);
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
    return [].concat(new Set((schedule || []).map(function (game) { return game.slot; }))).sort(function (a, b) { return a - b; });
  }

  function generateRoundRobinGames(groups) {
    var allGames = [];
    groups.forEach(function (grp, gi) {
      var teams = cleanTeams(grp);
      for (var i = 0; i < teams.length; i++) {
        for (var j = i + 1; j < teams.length; j++) {
          allGames.push({ gi: gi, gName: 'Group ' + GL[gi], tA: teams[i], tB: teams[j] });
        }
      }
    });
    return allGames;
  }

  function interleaveGroups(groups, allGames) {
    var byGrp = groups.map(function (_, gi) {
      return allGames.filter(function (game) { return game.gi === gi; });
    });
    var maxLen = Math.max.apply(null, byGrp.map(function (games) { return games.length; }));
    var interleaved = [];
    for (var i = 0; i < maxLen; i++) {
      byGrp.forEach(function (games) {
        if (games[i]) interleaved.push(games[i]);
      });
    }
    return interleaved;
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

  function addTimes(schedule, settings) {
    var parts = String(settings.startTime || '10:00').split(':').map(Number);
    var sh = Number.isFinite(parts[0]) ? parts[0] : 10;
    var sm = Number.isFinite(parts[1]) ? parts[1] : 0;
    var dur = (parseInt(settings.gameDuration, 10) || 25) + (parseInt(settings.breakBetween, 10) || 0);

    schedule.forEach(function (game) {
      var tot = sh * 60 + sm + game.slot * dur;
      game.time = String(Math.floor(tot / 60) % 24).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0');
    });
  }

  function generateSchedule(input) {
    var settings = input.settings || {};
    var groups = (input.groups || []).map(function (group, gi) {
      return {
        name: group.name || 'Group ' + GL[gi],
        teams: group.teams || []
      };
    });
    var requestedFields = Math.max(1, Math.min(8, parseInt(settings.numFields, 10) || 1));
    var allGames = generateRoundRobinGames(groups);
    var remaining = interleaveGroups(groups, allGames);
    var schedule = [];
    var slot = 0;

    while (remaining.length > 0) {
      var busy = new Set();
      var placed = 0;

      for (var f = 0; f < requestedFields; f++) {
        var idx = remaining.findIndex(function (game) {
          return !busy.has(game.tA) && !busy.has(game.tB);
        });
        if (idx === -1) break;

        var g = remaining.splice(idx, 1)[0];
        busy.add(g.tA);
        busy.add(g.tB);
        schedule.push({
          id: 'g' + g.gi + '_' + schedule.length,
          gi: g.gi,
          gName: g.gName,
          tA: g.tA,
          tB: g.tB,
          field: f,
          slot: slot,
          scoreA: null,
          scoreB: null
        });
        placed++;
      }

      if (placed > 0) slot++;
      else slot++;
    }

    addTimes(schedule, settings);
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
        gameBlockMinutes: (parseInt(settings.gameDuration, 10) || 25) + (parseInt(settings.breakBetween, 10) || 0),
        note: note
      }
    };
  }

  window.RHMTournamentEngine = {
    generateSchedule: generateSchedule,
    getActiveFieldCount: getActiveFieldCount,
    getTimeSlots: getTimeSlots,
    buildPlayoffs: buildPlayoffs
  };
})(window);
