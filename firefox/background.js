// Background script for Agile PLM Inline PDF extension v4.0
//
// When the content script intercepts a form submission to IFS (the file server),
// it sends the form data here. We use fetch() with the browser's cookies to
// download the PDF bytes, then send them back as base64 for inline rendering.
// This completely bypasses Content-Disposition/X-Frame-Options issues.

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
            var binary = '';
            var chunkSize = 65536;
            for (var i = 0; i < data.length; i += chunkSize) {
              binary += String.fromCharCode.apply(null, data.subarray(i, Math.min(i + chunkSize, data.length)));
            }
            mediaFiles[name] = 'data:' + mime + ';base64,' + btoa(binary);
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
              var binary = '';
              var chunkSize = 65536;
              for (var i = 0; i < data.length; i += chunkSize) {
                var chunk = data.subarray(i, Math.min(i + chunkSize, data.length));
                binary += String.fromCharCode.apply(null, chunk);
              }
              mediaFiles[name] = 'data:' + mime + ';base64,' + btoa(binary);
            })
          );
        }
      });

      return Promise.all(mediaPromises).then(function () {
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

// --- STEP / IGES tessellation via OpenCascade (occt-import-js WASM) ---
// The WASM module is loaded once and reused. Everything runs locally in the
// background page; CAD bytes never leave the browser.
var _occtPromise = null;
function getOcct() {
  if (!_occtPromise) {
    _occtPromise = occtimportjs({
      locateFile: function (path) { return browser.runtime.getURL(path); }
    });
  }
  return _occtPromise;
}

function cadFaceNormal(a, b, c) {
  var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function f32ToBase64(f32) {
  var bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  var binary = '';
  var chunkSize = 65536;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// Convert occt-import-js meshes into flat (non-indexed) position + normal
// Float32Arrays of length triCount*9, matching what the WebGL viewer expects.
function cadMeshesToTriangles(meshes) {
  var triCount = 0;
  var i, m, idx, pos;
  for (i = 0; i < meshes.length; i++) {
    m = meshes[i];
    if (!m.attributes || !m.attributes.position || !m.attributes.position.array) continue;
    idx = m.index && m.index.array ? m.index.array : null;
    triCount += idx ? Math.floor(idx.length / 3) : Math.floor(m.attributes.position.array.length / 9);
  }
  var positions = new Float32Array(triCount * 9);
  var normals = new Float32Array(triCount * 9);
  var o = 0;
  for (i = 0; i < meshes.length; i++) {
    m = meshes[i];
    if (!m.attributes || !m.attributes.position || !m.attributes.position.array) continue;
    pos = m.attributes.position.array;
    var nrm = m.attributes.normal && m.attributes.normal.array ? m.attributes.normal.array : null;
    idx = m.index && m.index.array ? m.index.array : null;
    var triVerts = idx ? idx.length : (pos.length / 3);
    for (var k = 0; k < triVerts; k += 3) {
      var a = (idx ? idx[k] : k) * 3;
      var b = (idx ? idx[k + 1] : k + 1) * 3;
      var c = (idx ? idx[k + 2] : k + 2) * 3;
      var v0 = [pos[a], pos[a + 1], pos[a + 2]];
      var v1 = [pos[b], pos[b + 1], pos[b + 2]];
      var v2 = [pos[c], pos[c + 1], pos[c + 2]];
      var n0, n1, n2;
      if (nrm) {
        n0 = [nrm[a], nrm[a + 1], nrm[a + 2]];
        n1 = [nrm[b], nrm[b + 1], nrm[b + 2]];
        n2 = [nrm[c], nrm[c + 1], nrm[c + 2]];
      } else {
        n0 = n1 = n2 = cadFaceNormal(v0, v1, v2);
      }
      positions[o] = v0[0]; positions[o + 1] = v0[1]; positions[o + 2] = v0[2];
      positions[o + 3] = v1[0]; positions[o + 4] = v1[1]; positions[o + 5] = v1[2];
      positions[o + 6] = v2[0]; positions[o + 7] = v2[1]; positions[o + 8] = v2[2];
      normals[o] = n0[0]; normals[o + 1] = n0[1]; normals[o + 2] = n0[2];
      normals[o + 3] = n1[0]; normals[o + 4] = n1[1]; normals[o + 5] = n1[2];
      normals[o + 6] = n2[0]; normals[o + 7] = n2[1]; normals[o + 8] = n2[2];
      o += 9;
    }
  }
  return { positions: positions, normals: normals, count: triCount };
}

// --- HWT Config Creator URL discovery (via native messaging host) ---
// The Network/External URLs are this machine's LAN IP and public IP — values a
// page/content script can't read. A small local native host (hwt_urls_host,
// see hwt-protocol/) returns them so the HWT button menu can list Network and
// External without you having to read them off the terminal. The host is
// optional: if it isn't registered, sendNativeMessage rejects and we simply
// store nothing (the menu shows only the Local option).
function refreshHwtUrls() {
  return browser.runtime.sendNativeMessage('hwt_urls_host', { cmd: 'get' })
    .then(function (resp) {
      var urls = {
        network: (resp && typeof resp.network === 'string') ? resp.network.trim() : '',
        external: (resp && typeof resp.external === 'string') ? resp.external.trim() : ''
      };
      return browser.storage.local.set({ hwtUrlsAuto: urls }).then(function () {
        return urls;
      });
    })
    .catch(function (err) {
      // Host not installed/registered, or it errored. Leave existing values.
      console.log('[Agile PLM Ext BG] HWT URL host unavailable:', String(err && err.message || err));
      return { network: '', external: '' };
    });
}

// Discover once at startup so the menu is populated on the first Agile page.
refreshHwtUrls();

// Ask the native host to START the local HWT server (no hwt:// protocol prompt)
// and capture its printed URLs. Resolves with the captured network/external
// URLs once the server is up, or empty strings if the host isn't installed.
function startHwtServer() {
  return browser.runtime.sendNativeMessage('hwt_urls_host', { cmd: 'start' })
    .then(function (resp) {
      var urls = {
        network: (resp && typeof resp.network === 'string') ? resp.network.trim() : '',
        external: (resp && typeof resp.external === 'string') ? resp.external.trim() : ''
      };
      return browser.storage.local.set({ hwtUrlsAuto: urls }).then(function () {
        return urls;
      });
    })
    .catch(function (err) {
      console.log('[Agile PLM Ext BG] HWT start host unavailable:', String(err && err.message || err));
      return { network: '', external: '' };
    });
}

browser.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'start_hwt_server') {
    startHwtServer().then(function (urls) {
      sendResponse({ success: true, urls: urls });
    }).catch(function (err) {
      sendResponse({ success: false, error: String(err && err.message || err) });
    });
    return true; // async
  }

  if (msg.type === 'refresh_hwt_urls') {
    // Ask the local native messaging host for this machine's HWT Config
    // Creator Network/External URLs (its LAN IP + public IP, the same
    // addresses `hwt-config-creator` prints). The host is fully local; if it
    // isn't installed we just leave the auto URLs empty and the menu shows
    // only the Local option. Results are cached in storage for the menu.
    refreshHwtUrls().then(function (urls) {
      sendResponse({ success: true, urls: urls });
    }).catch(function (err) {
      sendResponse({ success: false, error: String(err && err.message || err) });
    });
    return true; // async
  }

  if (msg.type === 'lookup_echo_part') {
    // Resolve an Agile part number to its ECHO BOM deep link by POSTing to
    // ECHO's part search endpoint (form-urlencoded) and reading the first
    // matching row's internal ID/REV from the JSON response.
    var partNumber = String(msg.partNumber || '').trim();
    console.log('[Agile PLM Ext BG] Echo part lookup:', partNumber);

    if (!partNumber) {
      sendResponse({ success: false, error: 'No part number provided' });
      return true;
    }

    // Replicate the search form ECHO's UI submits, substituting the part number.
    var body =
      'ajaxGridLoad=true' +
      '&partnumber=' + encodeURIComponent(partNumber) +
      '&description=&partTypeId=0&mfrname=&mfrpart=&displaymfr=false' +
      '&rohs=false&reach=false&psp=false' +
      '&lifecycle20943%3DActive=true&lifecycle972%3DDiscontinued=false' +
      '&lifecycle31432%3DEnd+Of+Life=true&lifecycle32387%3DEngHold=true' +
      '&lifecycle98681%3DFinal+Production=true&lifecycle971%3DInactive=true' +
      '&lifecycle98680%3DLTB=true&lifecycle98683%3DLimited+Support=true' +
      '&lifecycle110108%3DMature=true&lifecycle32386%3DMfgHold=true' +
      '&lifecycle102897%3DOrderable+Prototype=false&lifecycle46764%3DPhaseOut=true' +
      '&lifecycle20944%3DPre-Production=true&lifecycle976%3DPreliminary=true' +
      '&lifecycle20942%3DPrototype=true&lifecycle98682%3DStandard+Support=true' +
      '&lifecycle47074%3DSubcontractor+Supplied=true';

    fetch('https://echo.natinst.com/part/search', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    })
      .then(function (response) {
        console.log('[Agile PLM Ext BG] Echo search status:', response.status);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var rows = (data && data.table) || [];
        // Prefer an exact part-number match; otherwise fall back to first row.
        var match = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i] && String(rows[i].PARTNUMBER || '').trim().toUpperCase() === partNumber.toUpperCase()) {
            match = rows[i];
            break;
          }
        }
        if (!match && rows.length > 0) match = rows[0];

        if (!match || !match.ID || !match.REV) {
          sendResponse({ success: true, found: false });
          return;
        }
        var url = 'https://echo.natinst.com/part/bom/' + match.ID + '/' + match.REV;
        console.log('[Agile PLM Ext BG] Echo deep link:', url);
        sendResponse({ success: true, found: true, url: url, partNumber: String(match.PARTNUMBER || partNumber).trim() });
      })
      .catch(function (err) {
        console.error('[Agile PLM Ext BG] Echo part lookup error:', err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // async
  }

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
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          sendResponse({ success: true, fileType: 'ppt', base64: btoa(binary) });
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
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          sendResponse({ success: true, fileType: 'xlsm', base64: btoa(binary) });
        } else if (msg.fileType === 'stl') {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          sendResponse({ success: true, fileType: 'stl', base64: btoa(binary) });
        } else if (msg.fileType === 'image') {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          var mime = 'image/jpeg';
          if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
          sendResponse({ success: true, fileType: 'image', base64: btoa(binary), mime: mime });
        } else {
          // Default: PDF
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          sendResponse({ success: true, fileType: 'pdf', base64: btoa(binary), size: bytes.length });
        }
      })
      .catch(function (err) {
        console.error('[Agile PLM Ext BG] Echo fetch error:', err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // async
  }

  if (msg.type === 'fetch_revision_text') {
    // Two-stage attachment fetch for the revision-diff feature.
    //   Stage 1: POST the openFile(...) form to PCMServlet -> a "bounce" HTML
    //            page whose <form> auto-submits to the IFS file server.
    //   Stage 2: POST that bounce form -> the actual file bytes.
    // We then extract diffable text (docx via mammoth, otherwise UTF-8 text) and
    // return it. Doing both stages here (background) is required because Stage 2
    // targets agilesvc1.natinst.com, which content scripts can't fetch cross-origin.
    console.log('[Agile PLM Ext BG] revision-text stage 1:', msg.url, 'fileType:', msg.fileType);

    const stage1Body = new URLSearchParams();
    for (const name of Object.keys(msg.fields || {})) {
      stage1Body.append(name, msg.fields[name]);
    }

    fetch(msg.url, {
      method: 'POST',
      body: stage1Body.toString(),
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
      .then(function (r) {
        if (!r.ok) throw new Error('Stage 1 HTTP ' + r.status);
        return r.text().then(function (html) { return { html: html, url: r.url }; });
      })
      .then(function (stage1) {
        // Parse the bounce page for the IFS file form (action -> agilesvc1 /
        // Filemgr / AttachmentServlet) and replay it.
        const doc = new DOMParser().parseFromString(stage1.html, 'text/html');
        const forms = Array.from(doc.querySelectorAll('form'));
        let target = forms.find(function (f) {
          const a = (f.getAttribute('action') || '');
          return /agilesvc1|Filemgr|AttachmentServlet/i.test(a);
        }) || forms[0];
        if (!target) {
          throw new Error('Could not locate the file download form for this revision (the attachment may be inaccessible).');
        }
        let action = target.getAttribute('action') || stage1.url;
        try { action = new URL(action, stage1.url).href; } catch (e) { /* keep as-is */ }
        const method = (target.getAttribute('method') || 'POST').toUpperCase();
        const fields = {};
        target.querySelectorAll('input, select, textarea').forEach(function (el) {
          if (el.name) fields[el.name] = el.value || '';
        });
        console.log('[Agile PLM Ext BG] revision-text stage 2:', action, 'method:', method,
          'fields:', Object.keys(fields).length);

        const body = new URLSearchParams();
        for (const name of Object.keys(fields)) body.append(name, fields[name]);

        const opts = { method: method, credentials: 'include' };
        let url2 = action;
        if (method === 'GET') {
          url2 = action + (action.indexOf('?') >= 0 ? '&' : '?') + body.toString();
        } else {
          opts.body = body.toString();
          opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        }
        return fetch(url2, opts).then(function (r2) {
          if (!r2.ok) throw new Error('Stage 2 HTTP ' + r2.status);
          return r2.arrayBuffer();
        });
      })
      .then(function (buffer) {
        console.log('[Agile PLM Ext BG] revision-text got', buffer.byteLength, 'bytes');
        if (msg.fileType === 'docx') {
          return mammoth.convertToHtml({ arrayBuffer: buffer }).then(function (result) {
            sendResponse({ success: true, fileType: 'docx', html: result.value });
          });
        }
        if (msg.fileType === 'doc') {
          var docParsed = parseDocBuffer(buffer);
          sendResponse({ success: true, fileType: 'doc', text: docParsed.text || '' });
          return;
        }
        // Default: treat as UTF-8 text (txt/json/xml/html/md/code).
        var text = new TextDecoder('utf-8').decode(buffer);
        sendResponse({ success: true, fileType: msg.fileType || 'txt', text: text });
      })
      .catch(function (err) {
        console.error('[Agile PLM Ext BG] revision-text error:', err);
        sendResponse({ success: false, error: String(err && err.message || err) });
      });

    return true; // async
  }

  if (msg.type === 'fetch_file') {
    console.log('[Agile PLM Ext BG] Fetching file from:', msg.url, 'fileType:', msg.fileType);

    // Build form body from the fields
    const formData = new URLSearchParams();
    for (const name of Object.keys(msg.fields)) {
      formData.append(name, msg.fields[name]);
    }

    fetch(msg.url, {
      method: 'POST',
      body: formData.toString(),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
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
          // Legacy DOC: extract text via OLE2 parser for inline preview;
          // also include base64 so the viewer can offer the original download.
          var docParsed = parseDocBuffer(buffer);
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);
          console.log('[Agile PLM Ext BG] DOC ready, text:', docParsed.text ? docParsed.text.length : 0, 'size:', bytes.length);
          sendResponse({ success: true, fileType: 'doc', text: docParsed.text || null, base64: base64, mime: 'application/msword' });
        } else if (msg.fileType === 'txt' || msg.fileType === 'json' || msg.fileType === 'xml' || msg.fileType === 'html' || msg.fileType === 'md' || msg.fileType === 'gbx') {
          // Text-based: decode bytes as UTF-8 text
          var decoder = new TextDecoder('utf-8');
          var text = decoder.decode(buffer);
          console.log('[Agile PLM Ext BG] Text decoded, length:', text.length, 'fileType:', msg.fileType);
          sendResponse({ success: true, fileType: msg.fileType, text: text });
        } else if (msg.fileType === 'xlsm') {
          // XLSM/XLSX: send as base64 for rendering with SheetJS
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);
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
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);
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
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);
          console.log('[Agile PLM Ext BG] STL base64 ready, size:', bytes.length);
          sendResponse({ success: true, fileType: 'stl', base64: base64 });
        } else if (msg.fileType === 'step' || msg.fileType === 'iges') {
          // STEP / IGES: tessellate to a triangle mesh locally via OpenCascade WASM.
          var formatLabel = msg.fileType === 'iges' ? 'IGES' : 'STEP';
          console.log('[Agile PLM Ext BG] Tessellating', formatLabel, 'with OpenCascade...');
          var cadBytes = new Uint8Array(buffer);
          return getOcct().then(function (occt) {
            var result = msg.fileType === 'iges'
              ? occt.ReadIgesFile(cadBytes, null)
              : occt.ReadStepFile(cadBytes, null);
            if (!result || !result.success || !result.meshes || !result.meshes.length) {
              sendResponse({ success: false, error: 'Could not read the ' + formatLabel + ' file (no geometry found).' });
              return;
            }
            var geo = cadMeshesToTriangles(result.meshes);
            if (!geo.count) {
              sendResponse({ success: false, error: 'The ' + formatLabel + ' file produced no triangles.' });
              return;
            }
            console.log('[Agile PLM Ext BG]', formatLabel, 'tessellated:', geo.count, 'triangles');
            sendResponse({
              success: true,
              fileType: 'cad',
              format: formatLabel,
              count: geo.count,
              positions: f32ToBase64(geo.positions),
              normals: f32ToBase64(geo.normals)
            });
          }).catch(function (err) {
            console.error('[Agile PLM Ext BG] CAD tessellation error:', err);
            sendResponse({ success: false, error: formatLabel + ' tessellation failed: ' + (err && err.message ? err.message : err) });
          });
        } else if (msg.fileType === 'image') {
          // Image: send as base64 with mime type
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);
          // Detect mime from first bytes
          var mime = 'image/jpeg';
          if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
          console.log('[Agile PLM Ext BG] Image base64 ready, mime:', mime, 'size:', bytes.length);
          sendResponse({ success: true, fileType: 'image', base64: base64, mime: mime });
        } else {
          // PDF: send as base64
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 65536;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);
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

// Strip X-Frame-Options from agile.natinst.com responses so the PCMServlet
// bounce page AND the hidden same-origin frame used by the Part Tree feature
// can load inside our own frames without being blocked. This only affects
// same-origin (agile -> agile) framing, so it does not weaken cross-site
// click-jacking protection for other origins.
browser.webRequest.onHeadersReceived.addListener(
  function (details) {
    if (details.type === 'sub_frame') {
      const filtered = details.responseHeaders.filter(function (h) {
        return h.name.toLowerCase() !== 'x-frame-options';
      });
      return { responseHeaders: filtered };
    }
  },
  { urls: ["*://agile.natinst.com/*"] },
  ["blocking", "responseHeaders"]
);

// ECHO and MVDB (APEX) are live web apps that refuse to be framed via
// X-Frame-Options and/or a CSP frame-ancestors directive. Strip both for our
// preview iframe so the ECHO BOM page and MVDB report can load in the panel.
// Azure DevOps (dev.azure.com / *.visualstudio.com) does the same; strip it too
// so an ALREADY-AUTHENTICATED work-item search renders in the sidebar.
//
// NOTE: we do NOT strip headers from the Microsoft identity platform
// (login.microsoftonline.com etc.). Microsoft's interactive sign-in page cannot
// be embedded in an iframe at all — it sends X-Frame-Options: deny AND uses
// client-side frame-busting, by design, to prevent credential phishing. Header
// stripping can't defeat that. Instead the detector listener below catches the
// login redirect and tells the content script to show its "Sign in (new tab)"
// note: the user signs in once in a real tab, then reloads the sidebar, which
// now loads dev.azure.com results directly without bouncing to login.
browser.webRequest.onHeadersReceived.addListener(
  function (details) {
    if (details.type !== 'sub_frame') return;
    const filtered = [];
    details.responseHeaders.forEach(function (h) {
      const name = h.name.toLowerCase();
      if (name === 'x-frame-options') return; // drop entirely
      if (name === 'content-security-policy' || name === 'content-security-policy-report-only') {
        // Remove only the frame-ancestors directive; keep the rest intact.
        const cleaned = String(h.value || '')
          .split(';')
          .filter(function (d) { return !/^\s*frame-ancestors/i.test(d); })
          .join(';')
          .trim();
        if (cleaned) { h.value = cleaned; filtered.push(h); }
        return;
      }
      filtered.push(h);
    });
    return { responseHeaders: filtered };
  },
  {
    urls: [
      "*://echo.natinst.com/*",
      "*://apex.natinst.com/*",
      "*://dev.azure.com/*",
      "*://*.dev.azure.com/*",
      "*://*.visualstudio.com/*"
    ]
  },
  ["blocking", "responseHeaders"]
);

// Detect when a preview sub-frame is REFUSED embedding by SSO/login pages
// (emerson.okta.com, and the Microsoft identity platform that Azure DevOps
// redirects to: login.microsoftonline.com / login.live.com / login.windows.net,
// all of which send X-Frame-Options: DENY / CSP frame-ancestors and cannot be
// embedded). We can't strip our way past those, so we notify the content script
// to reveal the "Sign in (new tab)" note — shown ONLY when a framing block
// actually happens. The user signs in once in a real tab; reloading the sidebar
// afterward loads dev.azure.com directly (no login bounce), so it renders.
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
  {
    urls: [
      "*://*.okta.com/*",
      "*://login.microsoftonline.com/*",
      "*://*.microsoftonline.com/*",
      "*://login.live.com/*",
      "*://login.windows.net/*"
    ]
  },
  ["responseHeaders"]
);

console.log('[Agile PLM Ext BG] Extension v4.0 loaded');
