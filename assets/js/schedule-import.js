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

  window.RHMScheduleImport = {
    parseCSV: parseCSV,
    detectFormat: detectFormat
  };

})(window);
