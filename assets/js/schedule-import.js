(function (window) {

  // ── CSV parser ─────────────────────────────────────────────────────────────

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuote = false;
    var i = 0;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuote = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuote = true;
        } else if (ch === ',') {
          row.push(field); field = '';
        } else if (ch === '\n') {
          row.push(field); field = '';
          rows.push(row); row = [];
        } else if (ch !== '\r') {
          field += ch;
        }
      }
      i++;
    }
    if (field || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c || '').trim(); }); });
  }

  // ── Format detection ───────────────────────────────────────────────────────

  function detectFormat(rows) {
    if (!rows || !rows.length) return null;
    var header = rows[0];
    var flat = header.join('\t').toLowerCase();
    if (flat.indexOf('time') >= 0 && flat.indexOf('field') >= 0 && flat.indexOf('team') >= 0) {
      return 'flat';
    }
    var a1 = String(header[0] || '').trim().toLowerCase();
    if (a1 === '' || a1 === 'field') {
      var hasTime = header.slice(1).some(function (cell) {
        return /^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(String(cell || '').trim());
      });
      if (hasTime) return 'matrix';
    }
    return null;
  }

  // ── Time utilities ─────────────────────────────────────────────────────────

  function parseTimeToMinutes(val) {
    val = String(val || '').trim();
    var m = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    var mer = (m[3] || '').toUpperCase();
    if (mer === 'PM' && h !== 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  function minutesToTime12(mins) {
    var h24 = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    var h12 = h24 % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' + m : String(m)) + ' ' + (h24 >= 12 ? 'PM' : 'AM');
  }

  // ── Shared constants ────────────────────────────────────────────────────────

  var GL = ['a','b','c','d','e','f','g','h'];
  var PLAYOFF_RE = /final|semi|championship|winner\s+of/i;

  // ── Fixture builder ─────────────────────────────────────────────────────────

  function buildFixturesFromGames(games) {
    var fieldNames = [];
    games.forEach(function (g) {
      if (g.fieldName && fieldNames.indexOf(g.fieldName) < 0) fieldNames.push(g.fieldName);
    });
    var venues = fieldNames.map(function (name, i) {
      return { id: 'venue-' + (i + 1), name: name };
    });

    var groupNamesOrdered = [];
    games.forEach(function (g) {
      if (!g.isPlayoff && g.groupName && groupNamesOrdered.indexOf(g.groupName) < 0) {
        groupNamesOrdered.push(g.groupName);
      }
    });

    var groupIdMap = {};
    groupNamesOrdered.forEach(function (name, i) {
      groupIdMap[name] = 'group-' + (GL[i] || ('x' + i));
    });

    games = games.slice().sort(function (a, b) {
      var ta = parseTimeToMinutes(a.timeStr);
      var tb = parseTimeToMinutes(b.timeStr);
      ta = ta === null ? 9999 : ta;
      tb = tb === null ? 9999 : tb;
      if (ta !== tb) return ta - tb;
      return a.fieldName < b.fieldName ? -1 : 1;
    });

    var slotMap = {};
    var slotIdx = 0;
    games.forEach(function (g) {
      if (!(g.timeStr in slotMap)) slotMap[g.timeStr] = slotIdx++;
    });

    var teamsByGroupId = {};
    games.forEach(function (g) {
      if (g.isPlayoff) return;
      var gid = groupIdMap[g.groupName];
      if (!teamsByGroupId[gid]) teamsByGroupId[gid] = [];
      [g.teamA, g.teamB].forEach(function (t) {
        if (t && teamsByGroupId[gid].indexOf(t) < 0) teamsByGroupId[gid].push(t);
      });
    });

    var fixtures = games.map(function (g, i) {
      var vi = fieldNames.indexOf(g.fieldName);
      var venue = venues[vi] || venues[0] || { id: 'venue-1', name: g.fieldName };
      var groupId = g.isPlayoff ? null : groupIdMap[g.groupName];
      var timeMins = parseTimeToMinutes(g.timeStr);
      var startsAt = timeMins !== null ? minutesToTime12(timeMins) : (g.timeStr || '');
      return {
        id: 'import-' + i,
        divisionId: 'division-main',
        phase: g.isPlayoff ? 'playoff' : 'group',
        groupId: groupId,
        groupName: g.isPlayoff ? (g.groupName || null) : g.groupName,
        teamA: g.teamA,
        teamB: g.teamB,
        venueId: venue.id,
        venueName: venue.name,
        slot: slotMap[g.timeStr] !== undefined ? slotMap[g.timeStr] : 0,
        startsAt: startsAt,
        scoreA: null,
        scoreB: null,
        ref: '',
        status: 'scheduled'
      };
    });

    var groups = groupNamesOrdered.map(function (name, i) {
      var id = groupIdMap[name];
      return { id: id, name: name, teams: teamsByGroupId[id] || [] };
    });

    var uniqueSlotCount = Object.keys(slotMap).length;
    var sortedMins = Object.keys(slotMap)
      .map(parseTimeToMinutes)
      .filter(function (t) { return t !== null; })
      .sort(function (a, b) { return a - b; });
    var gameBlockMinutes = 30;
    if (sortedMins.length >= 2) {
      var total = 0;
      for (var j = 1; j < sortedMins.length; j++) total += sortedMins[j] - sortedMins[j - 1];
      gameBlockMinutes = Math.round(total / (sortedMins.length - 1));
    }

    return {
      fixtures: fixtures,
      venues: venues,
      groups: groups,
      summary: {
        totalFixtures: fixtures.length,
        totalSlots: uniqueSlotCount,
        gameBlockMinutes: gameBlockMinutes,
        note: 'Imported from file'
      }
    };
  }

  // ── Matrix parser ───────────────────────────────────────────────────────────

  function parseMatrix(rows, tournamentFormat) {
    if (!rows || rows.length < 2) return buildFixturesFromGames([]);
    var header = rows[0];
    var timeHeaders = header.slice(1).map(function (c) { return String(c || '').trim(); });
    var fieldRows = rows.slice(1);
    var games = [];

    fieldRows.forEach(function (row) {
      var fieldName = String(row[0] || '').trim();
      if (!fieldName) return;
      timeHeaders.forEach(function (timeStr, ci) {
        var cell = String(row[ci + 1] || '').trim();
        if (!cell) return;
        var vsIdx = cell.search(/ vs /i);
        if (vsIdx < 0) return;
        var teamA = cell.slice(0, vsIdx).trim();
        var teamB = cell.slice(vsIdx + 4).trim();
        var isPlayoff = PLAYOFF_RE.test(cell);
        var groupName = null;
        if (!isPlayoff) {
          var gm = cell.match(/\bgroup\s+([a-z])\b/i);
          if (gm) {
            groupName = 'Group ' + gm[1].toUpperCase();
          }
        }
        games.push({ fieldName: fieldName, timeStr: timeStr, teamA: teamA, teamB: teamB, isPlayoff: isPlayoff, groupName: groupName });
      });
    });

    var hasGroupLabels = games.some(function (g) { return !g.isPlayoff && g.groupName; });
    var detectedFormat = hasGroupLabels ? 'group-stage' : (tournamentFormat || 'league');
    var defaultGroupName = detectedFormat === 'league' ? 'League Stage' : 'Group A';

    games.forEach(function (g) {
      if (!g.isPlayoff && !g.groupName) g.groupName = defaultGroupName;
    });

    return buildFixturesFromGames(games);
  }

  // ── Flat parser ─────────────────────────────────────────────────────────────

  var GROUP_PHASE_RE = /^(group|league|pool)/i;

  function parseFlat(rows) {
    if (!rows || rows.length < 2) return buildFixturesFromGames([]);
    var header = rows[0].map(function (c) { return String(c || '').trim().toLowerCase(); });

    function col(keywords) {
      for (var ki = 0; ki < keywords.length; ki++) {
        var kw = keywords[ki];
        for (var i = 0; i < header.length; i++) {
          if (header[i].indexOf(kw) >= 0) return i;
        }
      }
      return -1;
    }

    var colTime  = col(['time']);
    var colField = col(['field']);
    var colGroup = col(['group']);
    var colTeamA = col(['team a']);
    var colTeamB = col(['team b']);
    var colRound = col(['round']);

    if (colTeamA < 0) colTeamA = col(['team']);
    if (colTeamB < 0) {
      for (var i = colTeamA + 1; i < header.length; i++) {
        if (header[i].indexOf('team') >= 0) { colTeamB = i; break; }
      }
    }

    var games = [];
    rows.slice(1).forEach(function (row) {
      if (!row.some(function (c) { return String(c || '').trim(); })) return;
      var timeStr   = colTime  >= 0 ? String(row[colTime]  || '').trim() : '';
      var fieldName = colField >= 0 ? String(row[colField] || '').trim() : 'Field 1';
      var groupName = colGroup >= 0 ? String(row[colGroup] || '').trim() : 'Group A';
      var teamA     = colTeamA >= 0 ? String(row[colTeamA] || '').trim() : '';
      var teamB     = colTeamB >= 0 ? String(row[colTeamB] || '').trim() : '';
      var round     = colRound >= 0 ? String(row[colRound] || '').trim() : '';

      var isPlayoff = PLAYOFF_RE.test(round) && !GROUP_PHASE_RE.test(round);
      games.push({
        fieldName: fieldName,
        timeStr: timeStr,
        teamA: teamA,
        teamB: teamB,
        isPlayoff: isPlayoff,
        groupName: isPlayoff ? null : groupName
      });
    });

    return buildFixturesFromGames(games);
  }

  window.RHMScheduleImport = {
    parseCSV: parseCSV,
    detectFormat: detectFormat,
    parseMatrix: parseMatrix,
    parseFlat: parseFlat,
    buildFixturesFromGames: buildFixturesFromGames
  };

})(window);
