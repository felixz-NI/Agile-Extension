// Background script for Agile PLM Inline PDF extension v4.0
//
// When the content script intercepts a form submission to IFS (the file server),
// it sends the form data here. We use fetch() with the browser's cookies to
// download the PDF bytes, then send them back as base64 for inline rendering.
// This completely bypasses Content-Disposition/X-Frame-Options issues.

function bytesToBase64(bytes) {
  try {
    if (typeof TextDecoder !== 'undefined') {
      return btoa(new TextDecoder('latin1').decode(bytes));
    }
  } catch (_) {
    // Fall through to the manual encoder below.
  }

  var chunkSize = 8192;
  var parts = [];
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    var chars = new Array(chunk.length);
    for (var j = 0; j < chunk.length; j++) {
      chars[j] = String.fromCharCode(chunk[j]);
    }
    parts.push(chars.join(''));
  }
  return btoa(parts.join(''));
}

function hasWorkerDomParser() {
  return typeof DOMParser !== 'undefined';
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#(\d+);/g, function (_, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    });
}

function parseXmlAttributes(tagSource) {
  var attrs = {};
  String(tagSource || '').replace(/([A-Za-z0-9:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, function (_, name, _quoted, dbl, sgl) {
    attrs[name] = decodeXmlEntities(dbl !== undefined ? dbl : sgl);
    return _;
  });
  return attrs;
}

function parsePptxRelsMap(relsXml) {
  var relsMap = {};
  if (!relsXml) return relsMap;

  var relMatches = relsXml.match(/<Relationship[^>]+>/g) || [];
  relMatches.forEach(function (rel) {
    var idMatch = rel.match(/Id="([^"]+)"/);
    var targetMatch = rel.match(/Target="([^"]+)"/);
    if (idMatch && targetMatch) {
      var target = targetMatch[1];
      if (target.startsWith('../')) {
        target = 'ppt/' + target.substring(3);
      } else if (!target.startsWith('ppt/')) {
        target = 'ppt/slides/' + target;
      }
      relsMap[idMatch[1]] = target;
    }
  });

  return relsMap;
}

function parsePptxParagraphFallback(pXml) {
  var runs = [];
  var runMatches = pXml.match(/<a:(?:r|fld)\b[\s\S]*?<\/a:(?:r|fld)>/g) || [];

  runMatches.forEach(function (runXml) {
    var textMatches = runXml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) || [];
    var text = textMatches.map(function (tXml) {
      return decodeXmlEntities(tXml.replace(/<[^>]+>/g, ''));
    }).join('');
    if (!text) return;

    var run = { text: text };
    var rPrMatch = runXml.match(/<a:rPr\b([^>]*)\/?>/);
    if (rPrMatch) {
      var attrs = parseXmlAttributes(rPrMatch[1]);
      if (attrs.b === '1') run.bold = true;
      if (attrs.i === '1') run.italic = true;
      if (attrs.u && attrs.u !== 'none') run.underline = true;
      if (attrs.sz) {
        var fontSize = Math.round(parseInt(attrs.sz, 10) / 100);
        if (!isNaN(fontSize) && fontSize > 0) run.fontSize = fontSize;
      }
      var colorMatch = runXml.match(/<a:srgbClr\b[^>]*val="([^"]+)"/);
      if (colorMatch) run.color = '#' + colorMatch[1];
    }

    runs.push(run);
  });

  if (runs.length === 0) {
    var fallbackText = (pXml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) || []).map(function (tXml) {
      return decodeXmlEntities(tXml.replace(/<[^>]+>/g, ''));
    }).join('');
    if (fallbackText.trim()) runs.push({ text: fallbackText });
  }

  var bullet = null;
  var pPrMatch = pXml.match(/<a:pPr\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/a:pPr>)/);
  if (pPrMatch) {
    var pPrXml = pPrMatch[0];
    var bulletCharMatch = pPrXml.match(/<a:buChar\b[^>]*char="([^"]+)"/);
    if (bulletCharMatch) bullet = decodeXmlEntities(bulletCharMatch[1]);
    else if (/<a:buAutoNum\b/.test(pPrXml)) bullet = 'auto';
    else if (/<a:buNone\b/.test(pPrXml)) bullet = null;
  }

  return { runs: runs, bullet: bullet };
}

function runsToHtmlFallback(runs) {
  var html = '';
  runs.forEach(function (run) {
    var span = escapeHtml(run.text);
    var styles = [];
    if (run.bold) styles.push('font-weight:bold');
    if (run.italic) styles.push('font-style:italic');
    if (run.underline) styles.push('text-decoration:underline');
    if (run.color) styles.push('color:' + run.color);
    if (run.fontSize) styles.push('font-size:' + run.fontSize + 'pt');
    if (styles.length > 0) {
      span = '<span style="' + styles.join(';') + '">' + span + '</span>';
    }
    html += span;
  });
  return html;
}

function parsePptxTableFallback(tblXml) {
  var rows = [];
  var rowMatches = tblXml.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || [];
  rowMatches.forEach(function (rowXml) {
    var row = [];
    var cellMatches = rowXml.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) || [];
    cellMatches.forEach(function (cellXml) {
      var paragraphMatches = cellXml.match(/<a:p\b[\s\S]*?<\/a:p>/g) || [];
      var cellHtml = paragraphMatches.map(function (pXml) {
        return runsToHtmlFallback(parsePptxParagraphFallback(pXml).runs);
      }).filter(function (html) {
        return html.trim();
      }).join('<br>');
      row.push(cellHtml);
    });
    if (row.length > 0) rows.push(row);
  });
  return rows;
}

function parsePptxSlideFallback(xml, relsXml, mediaFiles) {
  var relsMap = parsePptxRelsMap(relsXml);
  var contentBlocks = [];
  var workingXml = xml;
  var tableBlocks = [];

  workingXml = workingXml.replace(/<a:tbl\b[\s\S]*?<\/a:tbl>/g, function (tblXml) {
    var token = '__AGILE_PPTX_TABLE_' + tableBlocks.length + '__';
    tableBlocks.push({ token: token, rows: parsePptxTableFallback(tblXml) });
    return token;
  });

  var tokenPattern = tableBlocks.length > 0 ? tableBlocks.map(function (entry) {
    return entry.token;
  }).join('|') : null;
  var blockPattern = tokenPattern
    ? new RegExp(tokenPattern + '|<a:p\\b[\\s\\S]*?<\\/a:p>|<a:blip\\b[^>]*\/?>', 'g')
    : /<a:p\b[\s\S]*?<\/a:p>|<a:blip\b[^>]*\/?>/g;

  var blockMatches = workingXml.match(blockPattern) || [];
  blockMatches.forEach(function (blockXml) {
    var tableEntry = null;
    for (var i = 0; i < tableBlocks.length; i++) {
      if (blockXml === tableBlocks[i].token) {
        tableEntry = tableBlocks[i];
        break;
      }
    }
    if (tableEntry) {
      if (tableEntry.rows.length > 0) {
        contentBlocks.push({ type: 'table', rows: tableEntry.rows });
      }
      return;
    }

    if (blockXml.indexOf('<a:p') === 0) {
      var parsed = parsePptxParagraphFallback(blockXml);
      var html = runsToHtmlFallback(parsed.runs);
      if (html.trim()) {
        contentBlocks.push({ type: 'text', html: html, bullet: parsed.bullet });
      }
      return;
    }

    var blipAttrs = parseXmlAttributes(blockXml);
    var rId = blipAttrs['r:embed'];
    if (rId) {
      var mediaPath = relsMap[rId];
      if (mediaPath && mediaFiles[mediaPath]) {
        contentBlocks.push({ type: 'image', data: mediaFiles[mediaPath] });
      }
    }
  });

  return contentBlocks;
}

function buildDocxRelsMapFromXml(relsXml, basePath) {
  var map = {};
  var prefix = basePath || 'word/';
  var matches = String(relsXml || '').match(/<Relationship[^>]+>/g) || [];
  matches.forEach(function (rel) {
    var id = (rel.match(/Id="([^"]+)"/) || [])[1];
    var target = (rel.match(/Target="([^"]+)"/) || [])[1];
    if (!id || !target) return;
    if (target.startsWith('/')) {
      target = target.substring(1);
    } else if (target.startsWith('../')) {
      target = prefix.replace(/[^/]+\/$/, '') + target.substring(3);
    } else {
      target = prefix + target;
    }
    target = target.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/');
    map[id] = target;
  });
  return map;
}

function extractDocxParagraphTextFallback(pXml) {
  return ((pXml.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) || []).map(function (tXml) {
    return decodeXmlEntities(tXml.replace(/<[^>]+>/g, ''));
  }).join(''))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDocxParagraphFallback(pXml, relsMap, mediaFiles) {
  var paraHtml = '';
  var runMatches = pXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) || [];

  runMatches.forEach(function (runXml) {
    var textMatches = runXml.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) || [];
    var text = textMatches.map(function (tXml) {
      return decodeXmlEntities(tXml.replace(/<[^>]+>/g, ''));
    }).join('');

    if (text) {
      var styles = [];
      if (/<w:b(?:\s|\/|>)/.test(runXml)) styles.push('font-weight:bold');
      if (/<w:i(?:\s|\/|>)/.test(runXml)) styles.push('font-style:italic');
      var sizeMatch = runXml.match(/<w:sz\b[^>]*(?:w:val|val)="([^"]+)"/);
      if (sizeMatch) {
        var pts = Math.round(parseInt(sizeMatch[1], 10) / 2);
        if (!isNaN(pts) && pts > 0) styles.push('font-size:' + pts + 'pt');
      }
      var colorMatch = runXml.match(/<w:color\b[^>]*(?:w:val|val)="([^"]+)"/);
      if (colorMatch && colorMatch[1] !== 'auto') styles.push('color:#' + colorMatch[1]);

      var escaped = escapeHtml(text);
      paraHtml += styles.length > 0 ? '<span style="' + styles.join(';') + '">' + escaped + '</span>' : escaped;
    }

    var blipMatches = runXml.match(/<a:blip\b[^>]*(?:r:embed|embed)="([^"]+)"[^>]*\/?>/g) || [];
    blipMatches.forEach(function (blipXml) {
      var attrs = parseXmlAttributes(blipXml);
      var embed = attrs['r:embed'] || attrs.embed;
      var imgPath = embed ? relsMap[embed] : null;
      if (imgPath && mediaFiles[imgPath]) {
        paraHtml += '<img src="' + mediaFiles[imgPath] + '" style="max-height:40px;vertical-align:middle;margin:0 4px;">';
      }
    });
  });

  if (!paraHtml) {
    var fallbackText = extractDocxParagraphTextFallback(pXml);
    if (fallbackText) paraHtml = escapeHtml(fallbackText);
  }

  return paraHtml;
}

function parseDocxTableFallback(tblXml, relsMap, mediaFiles) {
  var rowMatches = tblXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  if (rowMatches.length === 0) return '';

  var tableHtml = '<table style="border-collapse:collapse;width:100%;margin:4px 0;font-size:12px;">';

  rowMatches.forEach(function (rowXml) {
    var cellMatches = rowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    if (cellMatches.length === 0) return;

    tableHtml += '<tr>';
    cellMatches.forEach(function (cellXml) {
      var cellStyle = 'border:1px solid #999;padding:4px 8px;vertical-align:top;';
      var shdMatch = cellXml.match(/<w:shd\b[^>]*(?:w:fill|fill)="([^"]+)"/);
      if (shdMatch && shdMatch[1] && shdMatch[1] !== 'auto') {
        cellStyle += 'background:#' + shdMatch[1] + ';';
      }

      var colSpanMatch = cellXml.match(/<w:gridSpan\b[^>]*(?:w:val|val)="([^"]+)"/);
      var rowSpanActive = /<w:vMerge\b[^>]*(?:w:val|val)="restart"/.test(cellXml);
      var rowSpanContinue = /<w:vMerge\b(?:[^>]*)\/>/.test(cellXml) || /<w:vMerge\b[^>]*(?:w:val|val)="continue"/.test(cellXml);

      if (rowSpanContinue) {
        return;
      }

      tableHtml += '<td style="' + cellStyle + '"';
      if (colSpanMatch) {
        tableHtml += ' colspan="' + escapeHtml(colSpanMatch[1]) + '"';
      }
      if (rowSpanActive) {
        tableHtml += ' rowspan="2"';
      }
      tableHtml += '>';

      var paragraphMatches = cellXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
      paragraphMatches.forEach(function (pXml) {
        var pHtml = parseDocxParagraphFallback(pXml, relsMap, mediaFiles);
        if (pHtml.trim()) {
          tableHtml += '<p style="margin:1px 0;">' + pHtml + '</p>';
        }
      });

      tableHtml += '</td>';
    });
    tableHtml += '</tr>';
  });

  tableHtml += '</table>';
  return tableHtml;
}

function extractDocxBlockHtmlFallback(xmlStr, relsMap, mediaFiles) {
  var html = '';
  var blockMatches = String(xmlStr || '').match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g) || [];

  blockMatches.forEach(function (blockXml) {
    if (blockXml.indexOf('<w:tbl') === 0) {
      var tblHtml = parseDocxTableFallback(blockXml, relsMap, mediaFiles);
      if (tblHtml.trim()) html += tblHtml;
      return;
    }

    var pHtml = parseDocxParagraphFallback(blockXml, relsMap, mediaFiles);
    if (pHtml.trim()) html += '<p style="margin:2px 0;">' + pHtml + '</p>';
  });

  return html;
}

function extractDocxHeadingFromDocumentXml(xmlStr) {
  var paragraphs = String(xmlStr || '').match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  var bestHeading = '';
  var firstParagraph = '';

  for (var i = 0; i < paragraphs.length; i++) {
    var pXml = paragraphs[i];
    var text = extractDocxParagraphTextFallback(pXml);
    if (!text) continue;

    if (!firstParagraph) firstParagraph = text;

    var styleMatch = pXml.match(/<w:pStyle\b[^>]*(?:w:val|val)="([^"]+)"/i);
    var styleName = styleMatch ? styleMatch[1] : '';
    if (/^(title|subtitle|heading[1-6])$/i.test(styleName)) {
      bestHeading = text;
      break;
    }
  }

  var chosen = bestHeading || firstParagraph;
  if (!chosen) return '';
  return '<p style="margin:0;font-size:18px;font-weight:700;color:#1f1f1f;">' + escapeHtml(chosen) + '</p>';
}

function extractDocxHeaderFooterFallback(buffer) {
  return JSZip.loadAsync(buffer).then(function (zip) {
    var headerFiles = [];
    var footerFiles = [];
    var mediaFiles = {};
    var mediaPromises = [];

    Object.keys(zip.files).forEach(function (name) {
      if (/^word\/header\d+\.xml$/.test(name)) headerFiles.push(name);
      if (/^word\/footer\d+\.xml$/.test(name)) footerFiles.push(name);
      if (/^word\/media\//.test(name) && !zip.files[name].dir) {
        mediaPromises.push(zip.file(name).async('uint8array').then(function (data) {
          var ext = name.split('.').pop().toLowerCase();
          var mime = 'image/png';
          if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
          else if (ext === 'gif') mime = 'image/gif';
          else if (ext === 'svg') mime = 'image/svg+xml';
          mediaFiles[name] = 'data:' + mime + ';base64,' + bytesToBase64(data);
        }));
      }
    });

    headerFiles.sort();
    footerFiles.sort();

    function parsePart(partName) {
      var file = zip.file(partName);
      if (!file) return Promise.resolve('');
      var relsPath = 'word/_rels/' + partName.replace('word/', '') + '.rels';
      return Promise.all([
        file.async('string'),
        zip.file(relsPath) ? zip.file(relsPath).async('string') : Promise.resolve('')
      ]).then(function (pair) {
        var xmlStr = pair[0];
        var relsMap = buildDocxRelsMapFromXml(pair[1], 'word/');
        return extractDocxBlockHtmlFallback(xmlStr, relsMap, mediaFiles);
      });
    }

    return Promise.all(mediaPromises).then(function () {
      return Promise.all([
        Promise.all(headerFiles.map(parsePart)),
        Promise.all(footerFiles.map(parsePart)),
        zip.file('word/document.xml') ? zip.file('word/document.xml').async('string') : Promise.resolve('')
      ]);
    }).then(function (results) {
      var headers = results[0].filter(function (h) { return h.trim().length > 0; });
      var footers = results[1].filter(function (f) { return f.trim().length > 0; });
      var documentHeadingHtml = extractDocxHeadingFromDocumentXml(results[2]);
      return {
        headerHtml: headers.length > 0 ? headers.reduce(function (a, b) { return a.length > b.length ? a : b; }) : documentHeadingHtml,
        footerHtml: footers.length > 0 ? footers.reduce(function (a, b) { return a.length > b.length ? a : b; }) : ''
      };
    });
  });
}

// --- DOC (legacy Word binary) text extractor ---
function parseDocBuffer(buffer) {
  var bytes = new Uint8Array(buffer);
  var view = new DataView(buffer);

  // Check OLE2 signature: D0 CF 11 E0 A1 B1 1A E1
  if (bytes[0] !== 0xD0 || bytes[1] !== 0xCF || bytes[2] !== 0x11 || bytes[3] !== 0xE0) {
    return { text: null };
  }

  // Parse OLE2 Compound File Header
  var sectorSizePow = view.getUint16(30, true);
  var sectorSize = 1 << sectorSizePow; // typically 512
  var miniSectorSizePow = view.getUint16(32, true);
  var miniSectorSize = 1 << miniSectorSizePow;
  var fatSectors = view.getInt32(44, true);
  var firstDirSector = view.getInt32(48, true);
  var miniStreamCutoff = view.getUint32(56, true);
  var firstMiniFatSector = view.getInt32(60, true);
  var numMiniFatSectors = view.getInt32(64, true);
  var firstDifatSector = view.getInt32(68, true);
  var numDifatSectors = view.getInt32(72, true);

  // Read DIFAT (first 109 entries in header, then chained)
  var difat = [];
  for (var d = 0; d < 109; d++) {
    var sec = view.getInt32(76 + d * 4, true);
    if (sec >= 0) difat.push(sec);
  }
  // Follow DIFAT chain for large files
  var difatSec = firstDifatSector;
  while (difatSec >= 0 && difat.length < fatSectors) {
    var offset = (difatSec + 1) * sectorSize;
    var entries = (sectorSize / 4) - 1;
    for (var dd = 0; dd < entries && difat.length < fatSectors; dd++) {
      var s = view.getInt32(offset + dd * 4, true);
      if (s >= 0) difat.push(s);
    }
    difatSec = view.getInt32(offset + entries * 4, true);
  }

  // Build FAT
  var fat = [];
  for (var f = 0; f < difat.length; f++) {
    var fatOffset = (difat[f] + 1) * sectorSize;
    for (var fi = 0; fi < sectorSize / 4; fi++) {
      fat.push(view.getInt32(fatOffset + fi * 4, true));
    }
  }

  function sectorOffset(sec) { return (sec + 1) * sectorSize; }

  // Read a stream chain from FAT
  function readStream(startSec, streamSize) {
    var data = new Uint8Array(streamSize);
    var pos = 0;
    var sec = startSec;
    while (sec >= 0 && pos < streamSize) {
      var off = sectorOffset(sec);
      var chunk = Math.min(sectorSize, streamSize - pos);
      data.set(bytes.subarray(off, off + chunk), pos);
      pos += chunk;
      sec = fat[sec] !== undefined ? fat[sec] : -2;
    }
    return data;
  }

  // Read directory entries
  var dirData = readStream(firstDirSector, fat.length * sectorSize);
  var dirView = new DataView(dirData.buffer, dirData.byteOffset, dirData.byteLength);
  var dirEntries = [];
  var numDirEntries = Math.floor(dirData.length / 128);
  for (var de = 0; de < numDirEntries; de++) {
    var base = de * 128;
    var nameLen = dirView.getUint16(base + 64, true);
    if (nameLen === 0) continue;
    var name = '';
    for (var nc = 0; nc < (nameLen - 2) / 2; nc++) {
      name += String.fromCharCode(dirView.getUint16(base + nc * 2, true));
    }
    var type = dirData[base + 66];
    var startSect = dirView.getInt32(base + 116, true);
    var size = dirView.getUint32(base + 120, true);
    dirEntries.push({ name: name, type: type, start: startSect, size: size });
  }

  // Find WordDocument and table streams
  var wordDocEntry = null, tableEntry = null;
  for (var ei = 0; ei < dirEntries.length; ei++) {
    var ename = dirEntries[ei].name;
    if (ename === 'WordDocument') wordDocEntry = dirEntries[ei];
    else if (ename === '1Table' || ename === '0Table') {
      if (!tableEntry) tableEntry = dirEntries[ei];
      // Prefer the correct table based on FIB flag (checked later)
    }
  }

  if (!wordDocEntry) return { text: null };

  // Read WordDocument stream
  var wordDoc = readStream(wordDocEntry.start, wordDocEntry.size);
  var wdView = new DataView(wordDoc.buffer, wordDoc.byteOffset, wordDoc.byteLength);

  // FIB: read key fields
  var fibFlags = wdView.getUint16(10, true); // FIB base flags at offset 0x000A
  var fWhichTblStm = (fibFlags >> 9) & 1; // bit 9: which table stream (0Table or 1Table)

  // Find the correct table stream
  for (var ti = 0; ti < dirEntries.length; ti++) {
    if (dirEntries[ti].name === (fWhichTblStm ? '1Table' : '0Table')) {
      tableEntry = dirEntries[ti];
      break;
    }
  }

  // FIB RgFcLcb: read character counts from FIB
  // ccpText at offset 0x004C, ccpFtn at 0x0050, etc.
  var ccpText = wdView.getInt32(0x004C, true);
  var ccpFtn = wdView.getInt32(0x0050, true);
  var ccpHdd = wdView.getInt32(0x0054, true);
  var ccpAtn = wdView.getInt32(0x005C, true);
  var totalChars = ccpText + ccpFtn + ccpHdd + ccpAtn;
  if (totalChars <= 0 || totalChars > 10000000) {
    // Fallback: heuristic text extraction
    return { text: heuristicDocText(bytes) };
  }

  // Get CLX from table stream
  var fcClx, lcbClx;
  // FIB RgFcLcb97 starts at offset 0x009A in FIB
  // fcClx is at a variable offset depending on FIB version; try common location
  // In Word 97 FIB: offset 0x01A2 = fcClx, 0x01A6 = lcbClx
  if (wordDoc.length > 0x01AA) {
    fcClx = wdView.getUint32(0x01A2, true);
    lcbClx = wdView.getUint32(0x01A6, true);
  } else {
    return { text: heuristicDocText(bytes) };
  }

  if (!tableEntry || lcbClx === 0) {
    return { text: heuristicDocText(bytes) };
  }

  // Read table stream
  var tableData = readStream(tableEntry.start, tableEntry.size);
  if (fcClx + lcbClx > tableData.length) {
    return { text: heuristicDocText(bytes) };
  }

  // Parse CLX to get piece table
  var clxView = new DataView(tableData.buffer, tableData.byteOffset, tableData.byteLength);
  var clxPos = fcClx;
  // Skip any Grpprl (type 0x01) entries before the piece table (type 0x02)
  while (clxPos < fcClx + lcbClx) {
    var clxType = tableData[clxPos];
    if (clxType === 0x02) break;
    if (clxType === 0x01) {
      var grpprlLen = clxView.getUint16(clxPos + 1, true);
      clxPos += 3 + grpprlLen;
    } else {
      break;
    }
  }

  if (clxPos >= fcClx + lcbClx || tableData[clxPos] !== 0x02) {
    return { text: heuristicDocText(bytes) };
  }

  clxPos++; // skip type byte
  var pcdt_len = clxView.getUint32(clxPos, true);
  clxPos += 4;

  // Piece table: array of CP values followed by PCD entries
  // Number of pieces = (pcdt_len - 4*(n+1)) / 8 where n+1 CPs
  // Actually: n+1 CPs (4 bytes each) + n PCDs (8 bytes each) = pcdt_len
  // So: 4*(n+1) + 8*n = pcdt_len => 4n + 4 + 8n = pcdt_len => n = (pcdt_len - 4) / 12
  var numPieces = Math.floor((pcdt_len - 4) / 12);
  if (numPieces <= 0 || numPieces > 100000) {
    return { text: heuristicDocText(bytes) };
  }

  // Read CPs
  var cps = [];
  for (var cp = 0; cp <= numPieces; cp++) {
    cps.push(clxView.getUint32(clxPos + cp * 4, true));
  }

  // Read PCDs (each 8 bytes, starting after CPs)
  var pcdStart = clxPos + (numPieces + 1) * 4;
  var extractedText = '';

  for (var pi = 0; pi < numPieces; pi++) {
    var cpStart = cps[pi];
    var cpEnd = cps[pi + 1];
    var charCount = cpEnd - cpStart;
    if (charCount <= 0) continue;
    // Only extract main document text (up to ccpText chars)
    if (cpStart >= ccpText) break;
    if (cpEnd > ccpText) charCount = ccpText - cpStart;

    var pcdOffset = pcdStart + pi * 8;
    // PCD structure: 2 bytes flags, 4 bytes fc, 2 bytes prm
    var fcValue = clxView.getUint32(pcdOffset + 2, true);
    var fCompressed = (fcValue >> 30) & 1; // bit 30 = fCompressed
    var fc = fcValue & 0x3FFFFFFF;

    if (fCompressed) {
      // ANSI: fc/2 is the byte offset in WordDocument stream
      var textOff = fc / 2;
      for (var ci = 0; ci < charCount && textOff + ci < wordDoc.length; ci++) {
        var ch = wordDoc[textOff + ci];
        if (ch === 13) extractedText += '\n';
        else if (ch === 7) extractedText += '\t'; // table cell/row mark
        else if (ch >= 32 && ch < 127) extractedText += String.fromCharCode(ch);
        else if (ch >= 128) extractedText += String.fromCharCode(ch); // extended ASCII
        else if (ch === 9) extractedText += '\t';
      }
    } else {
      // Unicode UTF-16LE: fc is byte offset in WordDocument stream
      for (var ui = 0; ui < charCount && fc + ui * 2 + 1 < wordDoc.length; ui++) {
        var code = wordDoc[fc + ui * 2] | (wordDoc[fc + ui * 2 + 1] << 8);
        if (code === 13) extractedText += '\n';
        else if (code === 7) extractedText += '\t';
        else if (code >= 32) extractedText += String.fromCharCode(code);
        else if (code === 9) extractedText += '\t';
      }
    }
  }

  if (extractedText.trim().length > 0) {
    return { text: extractedText };
  }
  return { text: heuristicDocText(bytes) };
}

// Fallback heuristic: extract readable text runs from binary
function heuristicDocText(bytes) {
  var runs = [];
  var current = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) {
      current += String.fromCharCode(b);
    } else {
      if (current.length > 20) {
        // Filter out obvious non-text (XML tags, binary format strings)
        if (!/^[\x00-\x1f]*$/.test(current) && !/^[A-F0-9]+$/i.test(current)) {
          runs.push(current.trim());
        }
      }
      current = '';
    }
  }
  if (current.length > 20) runs.push(current.trim());
  return runs.length > 0 ? runs.join('\n') : null;
}

// --- DOCX header/footer extractor (uses JSZip) ---
function extractDocxHeaderFooter(buffer) {
  if (!hasWorkerDomParser()) {
    console.warn('[Agile PLM Ext BG] DOMParser unavailable in service worker; using DOCX header/footer fallback');
    return extractDocxHeaderFooterFallback(buffer);
  }

  return JSZip.loadAsync(buffer).then(function (zip) {
    var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

    // Find header and footer XML files
    var headerFiles = [];
    var footerFiles = [];
    Object.keys(zip.files).forEach(function (name) {
      if (/^word\/header\d+\.xml$/.test(name)) headerFiles.push(name);
      if (/^word\/footer\d+\.xml$/.test(name)) footerFiles.push(name);
    });
    headerFiles.sort();
    footerFiles.sort();

    // Also load relationships to find images
    var relsFile = 'word/_rels/document.xml.rels';
    var relsPromise = zip.file(relsFile) ? zip.file(relsFile).async('string') : Promise.resolve('');

    // Load all media files
    var mediaFiles = {};
    var mediaPromises = [];
    Object.keys(zip.files).forEach(function (name) {
      if (/^word\/media\//.test(name) && !zip.files[name].dir) {
        mediaPromises.push(
          zip.file(name).async('uint8array').then(function (data) {
            var ext = name.split('.').pop().toLowerCase();
            var mime = 'image/png';
            if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
            else if (ext === 'gif') mime = 'image/gif';
            else if (ext === 'svg') mime = 'image/svg+xml';
            mediaFiles[name] = 'data:' + mime + ';base64,' + bytesToBase64(data);
          })
        );
      }
    });

    function parseWParagraphs(xmlStr, relsMap) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(xmlStr, 'application/xml');
      var html = '';

      // Extract formatted text from a single paragraph
      function parsePara(para) {
        var paraHtml = '';
        var runs = para.getElementsByTagNameNS(NS_W, 'r');
        for (var r = 0; r < runs.length; r++) {
          var tNodes = runs[r].getElementsByTagNameNS(NS_W, 't');
          var text = '';
          for (var t = 0; t < tNodes.length; t++) text += tNodes[t].textContent;
          if (!text) continue;
          var rPr = runs[r].getElementsByTagNameNS(NS_W, 'rPr')[0];
          var styles = [];
          if (rPr) {
            if (rPr.getElementsByTagNameNS(NS_W, 'b').length > 0) styles.push('font-weight:bold');
            if (rPr.getElementsByTagNameNS(NS_W, 'i').length > 0) styles.push('font-style:italic');
            var sz = rPr.getElementsByTagNameNS(NS_W, 'sz')[0];
            if (sz && sz.getAttribute('w:val')) {
              var pts = Math.round(parseInt(sz.getAttribute('w:val')) / 2);
              if (pts) styles.push('font-size:' + pts + 'pt');
            }
            var color = rPr.getElementsByTagNameNS(NS_W, 'color')[0];
            if (color && color.getAttribute('w:val') && color.getAttribute('w:val') !== 'auto') {
              styles.push('color:#' + color.getAttribute('w:val'));
            }
          }
          var escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          if (styles.length > 0) {
            paraHtml += '<span style="' + styles.join(';') + '">' + escaped + '</span>';
          } else {
            paraHtml += escaped;
          }
        }
        // Check for images (w:drawing > a:blip)
        var drawings = para.getElementsByTagNameNS(NS_W, 'drawing');
        for (var d = 0; d < drawings.length; d++) {
          var blips = drawings[d].getElementsByTagNameNS(NS_A, 'blip');
          for (var b = 0; b < blips.length; b++) {
            var embed = blips[b].getAttributeNS(NS_R, 'embed');
            if (embed && relsMap[embed]) {
              var imgPath = relsMap[embed];
              if (mediaFiles[imgPath]) {
                paraHtml += '<img src="' + mediaFiles[imgPath] + '" style="max-height:40px;vertical-align:middle;margin:0 4px;">';
              }
            }
          }
        }
        return paraHtml;
      }

      // Parse a table element into HTML
      function parseTable(tblNode) {
        var tblHtml = '<table style="border-collapse:collapse;width:100%;margin:4px 0;font-size:12px;">';
        var rows = tblNode.childNodes;
        for (var r = 0; r < rows.length; r++) {
          if (rows[r].nodeType !== 1 || rows[r].localName !== 'tr') continue;
          tblHtml += '<tr>';
          var cells = rows[r].childNodes;
          for (var c = 0; c < cells.length; c++) {
            if (cells[c].nodeType !== 1 || cells[c].localName !== 'tc') continue;
            // Get cell properties for shading/width
            var cellStyle = 'border:1px solid #999;padding:4px 8px;vertical-align:top;';
            var tcPr = cells[c].getElementsByTagNameNS(NS_W, 'tcPr')[0];
            if (tcPr) {
              var shd = tcPr.getElementsByTagNameNS(NS_W, 'shd')[0];
              if (shd && shd.getAttribute('w:fill') && shd.getAttribute('w:fill') !== 'auto') {
                cellStyle += 'background:#' + shd.getAttribute('w:fill') + ';';
              }
            }
            tblHtml += '<td style="' + cellStyle + '">';
            // Parse paragraphs inside cell
            var cellParas = cells[c].getElementsByTagNameNS(NS_W, 'p');
            for (var p = 0; p < cellParas.length; p++) {
              var pHtml = parsePara(cellParas[p]);
              if (pHtml.trim()) tblHtml += '<p style="margin:1px 0;">' + pHtml + '</p>';
            }
            tblHtml += '</td>';
          }
          tblHtml += '</tr>';
        }
        tblHtml += '</table>';
        return tblHtml;
      }

      // Walk top-level children of the body in document order
      var body = doc.getElementsByTagNameNS(NS_W, 'body')[0] || doc.documentElement;
      var children = body.childNodes;
      for (var i = 0; i < children.length; i++) {
        var node = children[i];
        if (node.nodeType !== 1) continue;
        if (node.localName === 'tbl') {
          html += parseTable(node);
        } else if (node.localName === 'p') {
          var pH = parsePara(node);
          if (pH.trim()) html += '<p style="margin:2px 0;">' + pH + '</p>';
        }
      }
      return html;
    }

    // Build relationships map for header/footer files
    function buildRelsMap(partName) {
      var relsPath = 'word/_rels/' + partName.replace('word/', '') + '.rels';
      var f = zip.file(relsPath);
      if (!f) return Promise.resolve({});
      return f.async('string').then(function (relsXml) {
        var map = {};
        var matches = relsXml.match(/<Relationship[^>]+>/g) || [];
        matches.forEach(function (rel) {
          var id = (rel.match(/Id="([^"]+)"/) || [])[1];
          var target = (rel.match(/Target="([^"]+)"/) || [])[1];
          if (id && target) {
            if (!target.startsWith('/')) target = 'word/' + target;
            else target = target.substring(1);
            map[id] = target;
          }
        });
        return map;
      });
    }

    return Promise.all(mediaPromises).then(function () {
      var headerPromises = headerFiles.map(function (hf) {
        return Promise.all([zip.file(hf).async('string'), buildRelsMap(hf)]).then(function (pair) {
          return parseWParagraphs(pair[0], pair[1]);
        });
      });
      var footerPromises = footerFiles.map(function (ff) {
        return Promise.all([zip.file(ff).async('string'), buildRelsMap(ff)]).then(function (pair) {
          return parseWParagraphs(pair[0], pair[1]);
        });
      });
      return Promise.all([Promise.all(headerPromises), Promise.all(footerPromises)]);
    }).then(function (results) {
      // Combine headers (use longest/most content-rich one as the "default")
      var headers = results[0].filter(function (h) { return h.trim().length > 0; });
      var footers = results[1].filter(function (f) { return f.trim().length > 0; });
      return {
        headerHtml: headers.length > 0 ? headers.reduce(function (a, b) { return a.length > b.length ? a : b; }) : '',
        footerHtml: footers.length > 0 ? footers.reduce(function (a, b) { return a.length > b.length ? a : b; }) : ''
      };
    });
  });
}

// --- DOCX checklist checked-label extractor (source XML based) ---
function extractDocxCheckedLabels(buffer) {
  if (!hasWorkerDomParser()) {
    console.warn('[Agile PLM Ext BG] DOMParser unavailable in service worker; skipping DOCX checked-label extraction');
    return Promise.resolve({});
  }

  return JSZip.loadAsync(buffer).then(function (zip) {
    var docFile = zip.file('word/document.xml');
    if (!docFile) return {};

    return docFile.async('string').then(function (xmlStr) {
      var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      var parser = new DOMParser();
      var doc = parser.parseFromString(xmlStr, 'application/xml');

      function normalizeLabel(text) {
        return String(text || '')
          .replace(/^(?:\u2610|\u2611|\u2612|\u25a1|\u25fb|\u25a2|\u2713|\u2714|\u2716|\u00d7)\s*/, '')
          .replace(/\s+/g, ' ')
          .trim()
          .toUpperCase();
      }

      function getCellText(tcNode) {
        if (!tcNode) return '';
        var tNodes = tcNode.getElementsByTagNameNS(NS_W, 't');
        var txt = '';
        for (var i = 0; i < tNodes.length; i++) txt += tNodes[i].textContent || '';
        return txt.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      }

      function getCellColSpan(tcNode) {
        if (!tcNode) return 1;
        var tcPr = tcNode.getElementsByTagNameNS(NS_W, 'tcPr')[0];
        if (!tcPr) return 1;
        var gridSpan = tcPr.getElementsByTagNameNS(NS_W, 'gridSpan')[0];
        if (!gridSpan) return 1;
        var spanVal = parseInt(gridSpan.getAttribute('w:val') || gridSpan.getAttribute('val') || '1', 10);
        return isNaN(spanVal) || spanVal < 1 ? 1 : spanVal;
      }

      function getCellMarkerSignature(tcNode) {
        if (!tcNode) return '';
        var symNodes = tcNode.getElementsByTagNameNS(NS_W, 'sym');
        var parts = [];
        for (var i = 0; i < symNodes.length; i++) {
          var font = (symNodes[i].getAttribute('w:font') || symNodes[i].getAttribute('font') || '').toLowerCase();
          var chr = (symNodes[i].getAttribute('w:char') || symNodes[i].getAttribute('char') || '').toUpperCase();
          if (font || chr) parts.push(font + ':' + chr);
        }
        var textToken = getCellText(tcNode).replace(/\s+/g, '');
        return parts.join('|') + '||' + textToken;
      }

      function isMarkLike(sig, markText) {
        if (!sig && !markText) return false;
        if (sig && sig.indexOf(':') !== -1) return true;
        var compact = String(markText || '').replace(/\s+/g, '');
        return compact.length <= 3;
      }

      function getLogicalCell(row, logicalCol) {
        if (!row || !row.cells) return null;
        var cursor = 0;
        for (var i = 0; i < row.cells.length; i++) {
          var cell = row.cells[i];
          if (logicalCol >= cursor && logicalCol < cursor + cell.colspan) return cell;
          cursor += cell.colspan;
        }
        return null;
      }

      var checkedMap = {};
      var tables = doc.getElementsByTagNameNS(NS_W, 'tbl');

      for (var t = 0; t < tables.length; t++) {
        var trNodes = tables[t].getElementsByTagNameNS(NS_W, 'tr');
        var rows = [];
        var maxCols = 0;

        for (var r = 0; r < trNodes.length; r++) {
          var tcNodes = [];
          var children = trNodes[r].childNodes;
          for (var c = 0; c < children.length; c++) {
            if (children[c].nodeType === 1 && children[c].localName === 'tc') tcNodes.push(children[c]);
          }
          if (tcNodes.length === 0) continue;

          var row = { cells: [] };
          var logicalCount = 0;
          for (var ci = 0; ci < tcNodes.length; ci++) {
            var cellNode = tcNodes[ci];
            var cell = {
              colspan: getCellColSpan(cellNode),
              text: getCellText(cellNode),
              sig: getCellMarkerSignature(cellNode)
            };
            row.cells.push(cell);
            logicalCount += cell.colspan;
          }
          if (logicalCount > maxCols) maxCols = logicalCount;
          rows.push(row);
        }

        if (rows.length === 0 || maxCols < 4) continue;

        var pairStarts = [];
        for (var col = 0; col + 1 < maxCols; col += 2) {
          var present = 0;
          var labelCount = 0;
          var markLikeCount = 0;
          for (var rr = 0; rr < rows.length; rr++) {
            var labelCell = getLogicalCell(rows[rr], col + 1);
            if (!labelCell) continue;
            present++;
            var labelText = normalizeLabel(labelCell.text);
            if (labelText) labelCount++;
            var markCell = getLogicalCell(rows[rr], col);
            if (markCell && isMarkLike(markCell.sig, markCell.text)) markLikeCount++;
          }
          if (present > 0) {
            var labelRatio = labelCount / present;
            var markRatio = markLikeCount / present;
            if (labelRatio >= 0.55 && markRatio >= 0.8) pairStarts.push(col);
          }
        }

        if (pairStarts.length < 2) continue;

        var baselineSigByCol = {};
        for (var ps = 0; ps < pairStarts.length; ps++) {
          var startCol = pairStarts[ps];
          var counts = {};
          var total = 0;
          for (var rr2 = 0; rr2 < rows.length; rr2++) {
            var lCell = getLogicalCell(rows[rr2], startCol + 1);
            var lbl = normalizeLabel(lCell ? lCell.text : '');
            if (!lbl) continue;
            var mCell = getLogicalCell(rows[rr2], startCol);
            var sig = mCell ? mCell.sig : '';
            if (!sig) continue;
            counts[sig] = (counts[sig] || 0) + 1;
            total++;
          }
          var dominantSig = '';
          var dominantCount = 0;
          Object.keys(counts).forEach(function (k) {
            if (counts[k] > dominantCount) {
              dominantCount = counts[k];
              dominantSig = k;
            }
          });
          if (dominantSig && dominantCount >= 2 && (dominantCount / Math.max(total, 1)) >= 0.45) {
            baselineSigByCol[startCol] = dominantSig;
          }
        }

        for (var rr3 = 0; rr3 < rows.length; rr3++) {
          for (var ps2 = 0; ps2 < pairStarts.length; ps2++) {
            var pairCol = pairStarts[ps2];
            var labelCell2 = getLogicalCell(rows[rr3], pairCol + 1);
            var labelKey = normalizeLabel(labelCell2 ? labelCell2.text : '');
            if (!labelKey) continue;
            var markCell2 = getLogicalCell(rows[rr3], pairCol);
            var sig2 = markCell2 ? markCell2.sig : '';
            var baseline = baselineSigByCol[pairCol] || '';
            if (sig2 && baseline && sig2 !== baseline) {
              checkedMap[labelKey] = true;
            }
          }
        }
      }

      return checkedMap;
    });
  }).catch(function () {
    // Never fail preview rendering due to checklist metadata extraction.
    return {};
  });
}

// --- ZIP listing helper (uses JSZip loaded in this context) ---
function parseZipBuffer(buffer) {
  return JSZip.loadAsync(buffer).then(function (zip) {
    var entries = [];
    Object.keys(zip.files).forEach(function (path) {
      var f = zip.files[path];
      entries.push({
        path: path,
        dir: !!f.dir,
        size: (f._data && typeof f._data.uncompressedSize === 'number') ? f._data.uncompressedSize : 0,
        date: f.date ? f.date.toISOString() : null
      });
    });
    // Sort by path for a stable, alphabetized tree
    entries.sort(function (a, b) {
      return a.path.localeCompare(b.path);
    });
    return { entries: entries };
  });
}

// --- PPTX parsing helper (uses JSZip loaded in this context) ---
function parsePptxBuffer(buffer) {
  return JSZip.loadAsync(buffer).then(function (zip) {
    // Find slide files
    var slideFiles = [];
    Object.keys(zip.files).forEach(function (name) {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) slideFiles.push(name);
    });
    slideFiles.sort(function (a, b) {
      return parseInt(a.match(/slide(\d+)/)[1]) - parseInt(b.match(/slide(\d+)/)[1]);
    });

    if (slideFiles.length === 0) {
      return { slides: [] };
    }

    // Load all slide XMLs and their relationship files
    var slidePromises = slideFiles.map(function (slideFile) {
      var slideNum = slideFile.match(/slide(\d+)/)[1];
      var relsFile = 'ppt/slides/_rels/slide' + slideNum + '.xml.rels';
      var relsPromise = zip.file(relsFile) ? zip.file(relsFile).async('string') : Promise.resolve('');
      var xmlPromise = zip.file(slideFile).async('string');
      return Promise.all([xmlPromise, relsPromise]);
    });

    return Promise.all(slidePromises).then(function (results) {
      // Pre-load all media files as base64 data URLs
      var mediaFiles = {};
      var mediaPromises = [];
      Object.keys(zip.files).forEach(function (name) {
        if (/^ppt\/media\//.test(name) && !zip.files[name].dir) {
          mediaPromises.push(
            zip.file(name).async('uint8array').then(function (data) {
              var mime = 'image/png';
              var ext = name.split('.').pop().toLowerCase();
              if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
              else if (ext === 'gif') mime = 'image/gif';
              else if (ext === 'svg') mime = 'image/svg+xml';
              else if (ext === 'bmp') mime = 'image/bmp';
              else if (ext === 'emf') mime = 'image/x-emf';
              else if (ext === 'wmf') mime = 'image/x-wmf';
              else if (ext === 'tiff' || ext === 'tif') mime = 'image/tiff';
              mediaFiles[name] = 'data:' + mime + ';base64,' + bytesToBase64(data);
            })
          );
        }
      });

      return Promise.all(mediaPromises).then(function () {
        if (!hasWorkerDomParser()) {
          console.warn('[Agile PLM Ext BG] DOMParser unavailable in service worker; using PPTX fallback parser');
          return {
            slides: results.map(function (pair) {
              return parsePptxSlideFallback(pair[0], pair[1], mediaFiles);
            })
          };
        }

        var slides = results.map(function (pair) {
          var xml = pair[0];
          var relsXml = pair[1];

          // Parse relationships: rId -> media file path
          var relsMap = {};
          if (relsXml) {
            var relMatches = relsXml.match(/<Relationship[^>]+>/g) || [];
            relMatches.forEach(function (rel) {
              var idMatch = rel.match(/Id="([^"]+)"/);
              var targetMatch = rel.match(/Target="([^"]+)"/);
              if (idMatch && targetMatch) {
                var target = targetMatch[1];
                if (target.startsWith('../')) {
                  target = 'ppt/' + target.substring(3);
                } else if (!target.startsWith('ppt/')) {
                  target = 'ppt/slides/' + target;
                }
                relsMap[idMatch[1]] = target;
              }
            });
          }

          // Use DOMParser for robust XML parsing
          var parser = new DOMParser();
          var doc = parser.parseFromString(xml, 'application/xml');
          var contentBlocks = [];
          var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
          var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

          // Extract formatted runs from a paragraph <a:p>
          function parseParagraph(pNode) {
            var runs = [];
            // Use getElementsByTagNameNS to find all runs at any depth
            var rNodes = pNode.getElementsByTagNameNS(NS_A, 'r');
            for (var i = 0; i < rNodes.length; i++) {
              var rNode = rNodes[i];
              var rPr = null;
              // Find direct child rPr
              for (var c = 0; c < rNode.childNodes.length; c++) {
                if (rNode.childNodes[c].localName === 'rPr') { rPr = rNode.childNodes[c]; break; }
              }
              var tNodes = rNode.getElementsByTagNameNS(NS_A, 't');
              var text = '';
              for (var t = 0; t < tNodes.length; t++) text += tNodes[t].textContent;
              if (!text) continue;
              var run = { text: text };
              if (rPr) {
                if (rPr.getAttribute('b') === '1') run.bold = true;
                if (rPr.getAttribute('i') === '1') run.italic = true;
                if (rPr.getAttribute('u') && rPr.getAttribute('u') !== 'none') run.underline = true;
                var sz = rPr.getAttribute('sz');
                if (sz) run.fontSize = Math.round(parseInt(sz) / 100);
                var fill = rPr.getElementsByTagNameNS(NS_A, 'solidFill')[0];
                if (fill) {
                  var srgb = fill.getElementsByTagNameNS(NS_A, 'srgbClr')[0];
                  if (srgb) run.color = '#' + srgb.getAttribute('val');
                }
              }
              runs.push(run);
            }
            // Also find field elements <a:fld> at any depth
            var fldNodes = pNode.getElementsByTagNameNS(NS_A, 'fld');
            for (var f = 0; f < fldNodes.length; f++) {
              var fldT = fldNodes[f].getElementsByTagNameNS(NS_A, 't');
              var fldText = '';
              for (var ft = 0; ft < fldT.length; ft++) fldText += fldT[ft].textContent;
              if (fldText) runs.push({ text: fldText });
            }
            // Fallback: if no runs found, try getting all <a:t> directly
            if (runs.length === 0) {
              var allT = pNode.getElementsByTagNameNS(NS_A, 't');
              var fallbackText = '';
              for (var at = 0; at < allT.length; at++) fallbackText += allT[at].textContent;
              if (fallbackText.trim()) runs.push({ text: fallbackText });
            }
            // Check paragraph properties for bullet/numbering
            var pPr = null;
            for (var pp = 0; pp < pNode.childNodes.length; pp++) {
              if (pNode.childNodes[pp].localName === 'pPr') { pPr = pNode.childNodes[pp]; break; }
            }
            var bullet = null;
            if (pPr) {
              var buChar = pPr.getElementsByTagNameNS(NS_A, 'buChar')[0];
              var buAutoNum = pPr.getElementsByTagNameNS(NS_A, 'buAutoNum')[0];
              if (buChar) bullet = buChar.getAttribute('char') || '\u2022';
              else if (buAutoNum) bullet = 'auto';
              var buNone = pPr.getElementsByTagNameNS(NS_A, 'buNone')[0];
              if (buNone) bullet = null;
            }
            return { runs: runs, bullet: bullet };
          }

          // Convert paragraph runs to HTML string
          function runsToHtml(runs) {
            var html = '';
            runs.forEach(function (run) {
              if (run.text === '\n') { html += '<br>'; return; }
              var span = run.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              var styles = [];
              if (run.bold) styles.push('font-weight:bold');
              if (run.italic) styles.push('font-style:italic');
              if (run.underline) styles.push('text-decoration:underline');
              if (run.color) styles.push('color:' + run.color);
              if (run.fontSize) styles.push('font-size:' + run.fontSize + 'pt');
              if (styles.length > 0) {
                span = '<span style="' + styles.join(';') + '">' + span + '</span>';
              }
              html += span;
            });
            return html;
          }

          // Parse a table <a:tbl> into an HTML table block
          function parseTable(tblNode) {
            var rows = [];
            var trNodes = tblNode.getElementsByTagNameNS(NS_A, 'tr');
            for (var r = 0; r < trNodes.length; r++) {
              var row = [];
              var tcNodes = trNodes[r].childNodes;
              for (var c = 0; c < tcNodes.length; c++) {
                if (tcNodes[c].nodeType !== 1 || tcNodes[c].localName !== 'tc') continue;
                var cellParas = tcNodes[c].getElementsByTagNameNS(NS_A, 'p');
                var cellHtml = '';
                for (var p = 0; p < cellParas.length; p++) {
                  var parsed = parseParagraph(cellParas[p]);
                  var h = runsToHtml(parsed.runs);
                  if (h) cellHtml += (cellHtml ? '<br>' : '') + h;
                }
                row.push(cellHtml);
              }
              rows.push(row);
            }
            return rows;
          }

          // Main tree walker - processes shapes in document order
          function processNode(node) {
            if (node.nodeType !== 1) return;
            var localName = node.localName;
            var ns = node.namespaceURI || '';

            // Table: render as structured table block
            if (localName === 'tbl' && ns.indexOf('drawingml') !== -1) {
              var tableRows = parseTable(node);
              if (tableRows.length > 0) {
                contentBlocks.push({ type: 'table', rows: tableRows });
              }
              return;
            }

            // Paragraph: extract formatted text
            if (localName === 'p' && ns.indexOf('drawingml') !== -1) {
              // Don't process paragraphs that are inside table cells (already handled)
              var ancestor = node.parentNode;
              while (ancestor) {
                if (ancestor.localName === 'tc' && ancestor.namespaceURI && ancestor.namespaceURI.indexOf('drawingml') !== -1) return;
                ancestor = ancestor.parentNode;
              }
              var parsed = parseParagraph(node);
              var html = runsToHtml(parsed.runs);
              if (html.trim()) {
                contentBlocks.push({ type: 'text', html: html, bullet: parsed.bullet });
              }
              return;
            }

            // Image: <a:blip> with embed reference
            if (localName === 'blip' && ns.indexOf('drawingml') !== -1) {
              var rId = node.getAttributeNS(NS_R, 'embed');
              if (rId) {
                var mediaPath = relsMap[rId];
                if (mediaPath && mediaFiles[mediaPath]) {
                  contentBlocks.push({ type: 'image', data: mediaFiles[mediaPath] });
                }
              }
              return;
            }

            // Recurse into children
            var children = node.childNodes;
            for (var i = 0; i < children.length; i++) {
              processNode(children[i]);
            }
          }

          processNode(doc.documentElement);

          return contentBlocks;
        });

        return { slides: slides };
      });
    });
  });
}

browser.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'fetch_echo_file') {
    // Direct GET fetch for echo.natinst.com attachments
    console.log('[Agile PLM Ext BG] Echo fetch:', msg.url, 'fileType:', msg.fileType);

    fetch(msg.url, {
      method: 'GET',
      credentials: 'include'
    })
      .then(function (response) {
        console.log('[Agile PLM Ext BG] Echo response status:', response.status);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        console.log('[Agile PLM Ext BG] Echo got', buffer.byteLength, 'bytes');

        if (msg.fileType === 'docx') {
          var bufferCopyForMeta = buffer.slice(0);
          return Promise.all([
            mammoth.convertToHtml({ arrayBuffer: buffer }),
            extractDocxCheckedLabels(bufferCopyForMeta)
          ]).then(function (results) {
            var result = results[0];
            var checkedLabels = results[1] || {};
            sendResponse({ success: true, fileType: 'docx', html: result.value, checkedLabels: checkedLabels });
          });
        } else if (msg.fileType === 'doc') {
          // Parse legacy .doc binary format
          var docResult = parseDocBuffer(buffer);
          if (docResult.text) {
            sendResponse({ success: true, fileType: 'doc', text: docResult.text });
          } else {
            sendResponse({ success: true, fileType: 'doc', text: null });
          }
        } else if (msg.fileType === 'txt' || msg.fileType === 'json' || msg.fileType === 'xml' || msg.fileType === 'html' || msg.fileType === 'md' || msg.fileType === 'gbx') {
          var decoder = new TextDecoder('utf-8');
          var text = decoder.decode(buffer);
          sendResponse({ success: true, fileType: msg.fileType, text: text });
        } else if (msg.fileType === 'pptx') {
          // Parse PPTX using JSZip — extract text and images
          console.log('[Agile PLM Ext BG] Parsing PPTX with JSZip...');
          parsePptxBuffer(buffer).then(function (result) {
            sendResponse({ success: true, fileType: 'pptx', slides: result.slides });
          }).catch(function (err) {
            console.error('[Agile PLM Ext BG] PPTX parse error:', err);
            sendResponse({ success: false, error: 'PPTX parse failed: ' + err.message });
          });
        } else if (msg.fileType === 'ppt') {
          const bytes = new Uint8Array(buffer);
          sendResponse({ success: true, fileType: 'ppt', base64: bytesToBase64(bytes) });
        } else if (msg.fileType === 'zip') {
          // Parse ZIP using JSZip — list folder structure only
          console.log('[Agile PLM Ext BG] Listing ZIP contents with JSZip...');
          parseZipBuffer(buffer).then(function (result) {
            sendResponse({ success: true, fileType: 'zip', entries: result.entries });
          }).catch(function (err) {
            console.error('[Agile PLM Ext BG] ZIP parse error:', err);
            sendResponse({ success: false, error: 'ZIP parse failed: ' + err.message });
          });
        } else if (msg.fileType === 'xlsm') {
          const bytes = new Uint8Array(buffer);
          sendResponse({ success: true, fileType: 'xlsm', base64: bytesToBase64(bytes) });
        } else if (msg.fileType === 'stl') {
          // STL: send as base64 (may be binary or ASCII; preserved as bytes)
          const bytes = new Uint8Array(buffer);
          sendResponse({ success: true, fileType: 'stl', base64: bytesToBase64(bytes) });
        } else if (msg.fileType === 'image') {
          const bytes = new Uint8Array(buffer);
          var mime = 'image/jpeg';
          if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
          sendResponse({ success: true, fileType: 'image', base64: bytesToBase64(bytes), mime: mime });
        } else {
          // Default: PDF
          const bytes = new Uint8Array(buffer);
          sendResponse({ success: true, fileType: 'pdf', base64: bytesToBase64(bytes), size: bytes.length });
        }
      })
      .catch(function (err) {
        console.error('[Agile PLM Ext BG] Echo fetch error:', err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // async
  }

  if (msg.type === 'fetch_file') {
    var method = (msg.method || 'POST').toUpperCase();
    console.log('[Agile PLM Ext BG] Fetching file from:', msg.url, 'fileType:', msg.fileType, 'method:', method);

    // Build form body from the fields
    const formData = new URLSearchParams();
    const fields = msg.fields || {};
    for (const name of Object.keys(fields)) {
      formData.append(name, fields[name]);
    }

    var fetchOptions = {
      method: method,
      credentials: 'include',
      headers: {}
    };

    if (method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = formData.toString();
      fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    fetch(msg.url, fetchOptions)
      .then(function (response) {
        console.log('[Agile PLM Ext BG] Response status:', response.status,
          'content-type:', response.headers.get('content-type'));
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        console.log('[Agile PLM Ext BG] Got', buffer.byteLength, 'bytes');

        if (msg.fileType === 'docx') {
          // Convert DOCX to HTML using mammoth.js + extract headers/footers
          console.log('[Agile PLM Ext BG] Converting DOCX to HTML with mammoth...');
          var bufferCopy = buffer.slice(0);
          var bufferCopy2 = buffer.slice(0);
          return Promise.all([
            mammoth.convertToHtml({ arrayBuffer: buffer }),
            extractDocxHeaderFooter(bufferCopy),
            extractDocxCheckedLabels(bufferCopy2)
          ]).then(function (results) {
            var mammothResult = results[0];
            var hf = results[1];
            var checkedLabels = results[2] || {};
            console.log('[Agile PLM Ext BG] DOCX converted. HTML length:', mammothResult.value.length,
              'header:', hf.headerHtml.length, 'footer:', hf.footerHtml.length);
            sendResponse({ success: true, fileType: 'docx', html: mammothResult.value, headerHtml: hf.headerHtml, footerHtml: hf.footerHtml, checkedLabels: checkedLabels });
          });
        } else if (msg.fileType === 'doc') {
          // Legacy DOC: send as base64 for blob URL rendering in iframe
          const bytes = new Uint8Array(buffer);
          const base64 = bytesToBase64(bytes);
          console.log('[Agile PLM Ext BG] DOC base64 ready, size:', bytes.length);
          sendResponse({ success: true, fileType: 'doc', base64: base64, mime: 'application/msword' });
        } else if (msg.fileType === 'txt' || msg.fileType === 'json' || msg.fileType === 'xml' || msg.fileType === 'html' || msg.fileType === 'md' || msg.fileType === 'gbx') {
          // Text-based: decode bytes as UTF-8 text
          var decoder = new TextDecoder('utf-8');
          var text = decoder.decode(buffer);
          console.log('[Agile PLM Ext BG] Text decoded, length:', text.length, 'fileType:', msg.fileType);
          sendResponse({ success: true, fileType: msg.fileType, text: text });
        } else if (msg.fileType === 'xlsm') {
          // XLSM/XLSX: send as base64 for rendering with SheetJS
          const bytes = new Uint8Array(buffer);
          const base64 = bytesToBase64(bytes);
          console.log('[Agile PLM Ext BG] XLSM base64 ready, size:', bytes.length);
          sendResponse({ success: true, fileType: 'xlsm', base64: base64 });
        } else if (msg.fileType === 'pptx') {
          // PPTX: parse with JSZip to extract text and images
          console.log('[Agile PLM Ext BG] Parsing PPTX with JSZip...');
          return parsePptxBuffer(buffer).then(function (result) {
            sendResponse({ success: true, fileType: 'pptx', slides: result.slides });
          }).catch(function (err) {
            console.error('[Agile PLM Ext BG] PPTX parse error:', err);
            sendResponse({ success: false, error: 'PPTX parse failed: ' + err.message });
          });
        } else if (msg.fileType === 'ppt') {
          // Legacy PPT: send as base64 for blob URL rendering in iframe
          const bytes = new Uint8Array(buffer);
          const base64 = bytesToBase64(bytes);
          console.log('[Agile PLM Ext BG] PPT base64 ready, size:', bytes.length);
          sendResponse({ success: true, fileType: 'ppt', base64: base64 });
        } else if (msg.fileType === 'zip') {
          // ZIP: list folder structure only
          console.log('[Agile PLM Ext BG] Listing ZIP contents with JSZip...');
          return parseZipBuffer(buffer).then(function (result) {
            sendResponse({ success: true, fileType: 'zip', entries: result.entries });
          }).catch(function (err) {
            console.error('[Agile PLM Ext BG] ZIP parse error:', err);
            sendResponse({ success: false, error: 'ZIP parse failed: ' + err.message });
          });
        } else if (msg.fileType === 'stl') {
          // STL: send as base64 (may be binary or ASCII; preserved as bytes)
          const bytes = new Uint8Array(buffer);
          const base64 = bytesToBase64(bytes);
          console.log('[Agile PLM Ext BG] STL base64 ready, size:', bytes.length);
          sendResponse({ success: true, fileType: 'stl', base64: base64 });
        } else if (msg.fileType === 'step' || msg.fileType === 'iges') {
          // STEP / IGES: return the raw bytes. Tessellation (occt-import-js,
          // which uses new Function() — forbidden in the MV3 service worker) is
          // done in the sandboxed page occt-sandbox.html, driven by the preview
          // iframe (content-iframe.js).
          const bytes = new Uint8Array(buffer);
          const base64 = bytesToBase64(bytes);
          console.log('[Agile PLM Ext BG]', msg.fileType, 'bytes ready (sandbox will tessellate), size:', bytes.length);
          sendResponse({ success: true, fileType: msg.fileType, base64: base64 });
        } else if (msg.fileType === 'image') {
          // Image: send as base64 with mime type
          const bytes = new Uint8Array(buffer);
          const base64 = bytesToBase64(bytes);
          // Detect mime from first bytes
          var mime = 'image/jpeg';
          if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
          console.log('[Agile PLM Ext BG] Image base64 ready, mime:', mime, 'size:', bytes.length);
          sendResponse({ success: true, fileType: 'image', base64: base64, mime: mime });
        } else {
          // PDF: send as base64
          const bytes = new Uint8Array(buffer);
          const base64 = bytesToBase64(bytes);
          console.log('[Agile PLM Ext BG] PDF base64 ready, length:', base64.length);
          sendResponse({ success: true, fileType: 'pdf', base64: base64, size: bytes.length });
        }
      })
      .catch(function (err) {
        console.error('[Agile PLM Ext BG] Fetch/process error:', err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // Keep message channel open for async sendResponse
  }
});

// NOTE (Chrome MV3): X-Frame-Options stripping that the Firefox build does via
// blocking webRequest.onHeadersReceived is handled declaratively here by the
// declarativeNetRequest ruleset in rules.json (modifyHeaders -> remove
// x-frame-options / content-security-policy on PCMServlet sub_frame requests).
// MV3 does not allow blocking webRequest for normal extensions, so that code
// path is intentionally omitted in the Chrome build.

// Detect when a preview sub-frame is REFUSED embedding by SSO/login pages
// (e.g. emerson.okta.com sends X-Frame-Options: DENY / CSP frame-ancestors).
// We don't strip those (signing in inside a frame is unsafe/blocked), but we
// notify the page so it can reveal the "sign in to cache your session" note —
// shown ONLY when this framing block actually happens. This is a NON-blocking
// observer (responseHeaders only), which MV3 still permits.
browser.webRequest.onHeadersReceived.addListener(
  function (details) {
    if (details.type !== 'sub_frame') return;
    var headers = details.responseHeaders || [];
    var blocked = false;
    for (var i = 0; i < headers.length; i++) {
      var name = headers[i].name.toLowerCase();
      var value = String(headers[i].value || '').toLowerCase();
      if (name === 'x-frame-options' && (value.indexOf('deny') !== -1 || value.indexOf('sameorigin') !== -1)) {
        blocked = true;
        break;
      }
      if (name === 'content-security-policy' && /frame-ancestors\s+(?:'none'|'self')/.test(value)) {
        blocked = true;
        break;
      }
    }
    if (blocked && details.tabId >= 0) {
      browser.tabs.sendMessage(details.tabId, { type: 'preview_frame_blocked', url: details.url })
        .catch(function () { /* tab may not have a content script; ignore */ });
    }
  },
  { urls: ["*://*.okta.com/*", "*://*.visualstudio.com/*"] },
  ["responseHeaders"]
);

console.log('[Agile PLM Ext BG] Extension v5.0 (Chrome MV3) loaded');
