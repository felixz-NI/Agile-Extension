// Content script for Agile PLM Inline PDF extension v4.0
// Runs at document_start in ALL frames on agile.natinst.com.
//
// When the sessionStorage flag is set (by the Tampermonkey preview script):
// 1. Blocks window.open (suppresses "please close this dialogue" popup)
// 2. Intercepts the form submission to IFS (captures all fields incl. uid)
// 3. Sends form data to background script which fetches the PDF bytes
// 4. Renders the PDF bytes as a blob URL in this iframe

(function () {
  'use strict';

  var PREVIEW_FLAG = '__preview_pane_active';
  var INTERCEPT_ATTR = 'data-agile-preview-intercepted';
  var flagValue = sessionStorage.getItem(PREVIEW_FLAG);

  // Only activate when flag is set
  if (!flagValue) return;

  // Only activate in iframes (not the top-level page)
  if (window === window.top) return;

  // NOTE: do not remove the preview flag here. The MAIN-world hook
  // (page-iframe-hooks.js) also reads it at document_start to install the IFS
  // form interceptor; the top page clears it on a short timeout instead.

  var fileType = flagValue; // e.g. 'pdf', 'docx', 'doc'
  console.log('[Agile PLM Ext CS] Bounce page in iframe detected. fileType:', fileType);

  function clearPendingIntercept() {
    try {
      if (document.documentElement) {
        document.documentElement.removeAttribute(INTERCEPT_ATTR);
      }
    } catch (_) { }
  }

  function readPendingIntercept() {
    try {
      if (!document.documentElement) return null;
      return document.documentElement.getAttribute(INTERCEPT_ATTR);
    } catch (_) {
      return null;
    }
  }

  // --- ZIP folder-structure renderer (shared shape with content-echo.js) ---
  function renderZipTree(entries) {
    function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function fmtSize(n) {
      if (n < 1024) return n + ' B';
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1048576).toFixed(1) + ' MB';
    }
    function fmtDate(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    var root = {};
    var fileCount = 0, dirCount = 0;
    entries.forEach(function (e) {
      var parts = e.path.split('/').filter(function (p) { return p.length; });
      if (e.dir) dirCount++; else fileCount++;
      var node = root;
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        var isLast = (i === parts.length - 1);
        if (!node[part]) node[part] = { __children: {}, __isDir: true, __size: 0, __date: null };
        if (isLast) {
          if (!e.dir) { node[part].__isDir = false; node[part].__size = e.size; }
          node[part].__date = e.date || null;
        }
        node = node[part].__children;
      }
    });
    function renderLevel(obj, depth) {
      var ul = document.createElement('ul');
      ul.style.cssText = 'list-style:none;margin:0;padding-left:' + (depth === 0 ? 0 : 18) + 'px;';
      var keys = Object.keys(obj).sort(function (a, b) {
        if (obj[a].__isDir !== obj[b].__isDir) return obj[a].__isDir ? -1 : 1;
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
      keys.forEach(function (key) {
        var entry = obj[key];
        var li = document.createElement('li');
        li.style.cssText = 'padding:2px 0;line-height:1.6;';
        var label = document.createElement('span');
        var dateStr = fmtDate(entry.__date);
        var dateHtml = dateStr ? '<span style="color:#999;font-size:11px;margin-left:8px;">' + escapeHtml(dateStr) + '</span>' : '';
        if (entry.__isDir) {
          label.style.cssText = 'font-weight:600;color:#566873;';
          label.innerHTML = '<span style="margin-right:6px;">\uD83D\uDCC1</span>' + escapeHtml(key) + '/' + dateHtml;
        } else {
          label.innerHTML = '<span style="margin-right:6px;">\uD83D\uDCC4</span>' + escapeHtml(key) +
            '<span style="color:#999;font-size:11px;margin-left:8px;">' + fmtSize(entry.__size) + '</span>' + dateHtml;
        }
        li.appendChild(label);
        if (Object.keys(entry.__children).length) li.appendChild(renderLevel(entry.__children, depth + 1));
        ul.appendChild(li);
      });
      return ul;
    }
    var wrap = document.createElement('div');
    wrap.style.cssText = 'padding:16px 20px;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;font-size:13px;color:#222;';
    var head = document.createElement('div');
    head.style.cssText = 'margin-bottom:12px;font-weight:600;border-bottom:1px solid #e0e0e0;padding-bottom:8px;';
    head.textContent = 'Archive contents \u2014 ' + fileCount + ' file' + (fileCount !== 1 ? 's' : '') +
      ', ' + dirCount + ' folder' + (dirCount !== 1 ? 's' : '');
    wrap.appendChild(head);
    wrap.appendChild(renderLevel(root, 0));
    return wrap;
  }

  // --- JSON syntax highlighter (self-contained, no external deps) ---
  function highlightJson(jsonText) {
    var escaped = jsonText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (match) {
        var cls = 'jh-num';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'jh-key' : 'jh-str';
        } else if (/true|false/.test(match)) {
          cls = 'jh-bool';
        } else if (/null/.test(match)) {
          cls = 'jh-null';
        }
        var color = {
          'jh-key': '#0451a5',
          'jh-str': '#a31515',
          'jh-num': '#098658',
          'jh-bool': '#0000ff',
          'jh-null': '#0000ff'
        }[cls];
        return '<span style="color:' + color + ';">' + match + '</span>';
      }
    );
  }

  // --- STL 3D viewer (self-contained, raw WebGL, no external deps) ---
  function buildStlViewer(mountEl, base64) {
    var binaryStr = atob(base64);
    var bytes = new Uint8Array(binaryStr.length);
    for (var i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    var buffer = bytes.buffer;

    function fail(msg) {
      mountEl.innerHTML = '<div style="padding:40px;font-family:\'Segoe UI\',sans-serif;font-size:14px;color:#666;">' + msg + '</div>';
    }
    function computeNormal(a, b, c) {
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      return [nx / len, ny / len, nz / len];
    }
    function parseBinaryStl(dv) {
      var tri = dv.getUint32(80, true);
      var positions = new Float32Array(tri * 9);
      var normals = new Float32Array(tri * 9);
      var offset = 84;
      for (var t = 0; t < tri; t++) {
        var nx = dv.getFloat32(offset, true), ny = dv.getFloat32(offset + 4, true), nz = dv.getFloat32(offset + 8, true);
        offset += 12;
        var p = t * 9;
        var v0 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)]; offset += 12;
        var v1 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)]; offset += 12;
        var v2 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)]; offset += 12;
        offset += 2;
        if (nx === 0 && ny === 0 && nz === 0) { var n = computeNormal(v0, v1, v2); nx = n[0]; ny = n[1]; nz = n[2]; }
        positions[p] = v0[0]; positions[p + 1] = v0[1]; positions[p + 2] = v0[2];
        positions[p + 3] = v1[0]; positions[p + 4] = v1[1]; positions[p + 5] = v1[2];
        positions[p + 6] = v2[0]; positions[p + 7] = v2[1]; positions[p + 8] = v2[2];
        for (var k = 0; k < 3; k++) { normals[p + k * 3] = nx; normals[p + k * 3 + 1] = ny; normals[p + k * 3 + 2] = nz; }
      }
      return { positions: positions, normals: normals, count: tri };
    }
    function parseAsciiStl(buf) {
      var text = new TextDecoder().decode(buf);
      var positions = [], normals = [];
      var re = /facet\s+normal\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+outer\s+loop\s+vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+endloop\s+endfacet/gi;
      var m;
      while ((m = re.exec(text)) !== null) {
        var nx = +m[1], ny = +m[2], nz = +m[3];
        var v0 = [+m[4], +m[5], +m[6]], v1 = [+m[7], +m[8], +m[9]], v2 = [+m[10], +m[11], +m[12]];
        if (nx === 0 && ny === 0 && nz === 0) { var n = computeNormal(v0, v1, v2); nx = n[0]; ny = n[1]; nz = n[2]; }
        positions.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      }
      return { positions: new Float32Array(positions), normals: new Float32Array(normals), count: positions.length / 9 };
    }
    function parseStl(buf) {
      var dv = new DataView(buf);
      if (buf.byteLength >= 84) {
        var tri = dv.getUint32(80, true);
        if (84 + tri * 50 === buf.byteLength) return parseBinaryStl(dv);
      }
      var header = '';
      for (var i = 0; i < 5 && i < buf.byteLength; i++) header += String.fromCharCode(dv.getUint8(i));
      if (header.toLowerCase() === 'solid') {
        var asc = parseAsciiStl(buf);
        if (asc.count > 0) return asc;
      }
      if (buf.byteLength >= 84) return parseBinaryStl(dv);
      return { positions: new Float32Array(0), normals: new Float32Array(0), count: 0 };
    }

    var geo;
    try { geo = parseStl(buffer); } catch (e) { fail('Could not parse STL file: ' + (e && e.message ? e.message : e)); return; }
    if (!geo || !geo.count) { fail('No triangles found in this STL file.'); return; }

    var pos = geo.positions;
    var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (var a = 0; a < pos.length; a += 3) {
      var x = pos[a], y = pos[a + 1], z = pos[a + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    var sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    var maxDim = Math.max(sizeX, sizeY, sizeZ) || 1;
    var scl = 2 / maxDim;
    for (var b = 0; b < pos.length; b += 3) {
      pos[b] = (pos[b] - cx) * scl;
      pos[b + 1] = (pos[b + 1] - cy) * scl;
      pos[b + 2] = (pos[b + 2] - cz) * scl;
    }
    var dimText = sizeX.toFixed(2) + ' \u00D7 ' + sizeY.toFixed(2) + ' \u00D7 ' + sizeZ.toFixed(2);

    mountEl.innerHTML = '';
    var boxEl = document.createElement('div');
    boxEl.style.cssText = 'position:relative;width:100%;height:100%;min-height:340px;background:#eef2f6;overflow:hidden;';
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:grab;touch-action:none;';
    boxEl.appendChild(canvas);
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:12px;bottom:10px;font-family:"Segoe UI",sans-serif;font-size:11px;color:#445;background:rgba(255,255,255,0.78);padding:4px 8px;border-radius:4px;pointer-events:none;';
    overlay.textContent = geo.count.toLocaleString() + ' triangles \u00B7 ' + dimText + ' \u00B7 drag to rotate, scroll to zoom';
    boxEl.appendChild(overlay);
    mountEl.appendChild(boxEl);

    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) { fail('WebGL is not available, so this STL file cannot be rendered.'); return; }

    var vsSrc = 'attribute vec3 aPos;attribute vec3 aNormal;uniform mat4 uMVP;uniform mat3 uNormal;varying vec3 vN;void main(){vN=normalize(uNormal*aNormal);gl_Position=uMVP*vec4(aPos,1.0);}';
    var fsSrc = 'precision mediump float;varying vec3 vN;uniform vec3 uColor;void main(){vec3 N=normalize(vN);vec3 L=normalize(vec3(0.4,0.55,1.0));float d=max(dot(N,L),0.0);d=max(d,max(dot(-N,L),0.0)*0.5);vec3 c=uColor*(0.35+0.75*d);gl_FragColor=vec4(c,1.0);}';
    function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var prog = gl.createProgram();
    try {
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(prog);
    } catch (e2) { fail('WebGL shader error: ' + (e2 && e2.message ? e2.message : e2)); return; }
    gl.useProgram(prog);

    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    var nrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);
    var aNormal = gl.getAttribLocation(prog, 'aNormal');
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    var uMVP = gl.getUniformLocation(prog, 'uMVP');
    var uNormal = gl.getUniformLocation(prog, 'uNormal');
    var uColor = gl.getUniformLocation(prog, 'uColor');
    gl.uniform3f(uColor, 0.55, 0.63, 0.72);
    gl.enable(gl.DEPTH_TEST);

    function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    function mul(a, b) { var o = new Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3]; return o; }
    function translate(m, x, y, z) { return mul(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }
    function rotX(r) { var c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
    function rotY(r) { var c = Math.cos(r), s = Math.sin(r); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
    function perspective(fovy, aspect, near, far) { var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; }
    function mat3(m) { return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; }

    var yaw = -0.6, pitch = -0.4, dist = 4.0;
    var dragging = false, lastX = 0, lastY = 0;
    function draw() {
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.clientWidth || boxEl.clientWidth || 340;
      var h = canvas.clientHeight || boxEl.clientHeight || 340;
      var bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.93, 0.95, 0.97, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var proj = perspective(45 * Math.PI / 180, w / h || 1, 0.1, 100);
      var view = translate(identity(), 0, 0, -dist);
      var model = mul(rotY(yaw), rotX(pitch));
      var mvp = mul(proj, mul(view, model));
      gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
      gl.uniformMatrix3fv(uNormal, false, new Float32Array(mat3(model)));
      gl.drawArrays(gl.TRIANGLES, 0, geo.count * 3);
    }
    var rafPending = false;
    function requestDraw() { if (!rafPending) { rafPending = true; requestAnimationFrame(function () { rafPending = false; draw(); }); } }

    canvas.addEventListener('mousedown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', function () { if (dragging) { dragging = false; canvas.style.cursor = 'grab'; } });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.01;
      pitch += (e.clientY - lastY) * 0.01;
      var lim = Math.PI / 2 - 0.01;
      if (pitch > lim) pitch = lim; if (pitch < -lim) pitch = -lim;
      lastX = e.clientX; lastY = e.clientY;
      requestDraw();
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      dist *= (e.deltaY > 0 ? 1.1 : 0.9);
      if (dist < 1.5) dist = 1.5; if (dist > 30) dist = 30;
      requestDraw();
    }, { passive: false });
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { requestDraw(); }); ro.observe(boxEl); }
    else { window.addEventListener('resize', requestDraw); }
    requestDraw();
  }

  // --- CAD (STEP/IGES) tessellation via a sandboxed page ------------------
  // occt-import-js uses new Function() (Emscripten embind), which the MV3
  // extension CSP forbids in the service worker. MV3 sandboxed pages ARE exempt
  // from that CSP, so we host occt-sandbox.html as a hidden iframe, hand it the
  // CAD bytes + the wasm bytes, and get the triangle mesh back. The mesh is then
  // rendered locally by renderTriangleGeometry (shared with STL).
  function tessellateViaSandbox(base64, fileType) {
    return new Promise(function (resolve, reject) {
      var rt = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime
        : (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime : null;
      if (!rt || !rt.getURL) { reject(new Error('Extension runtime unavailable.')); return; }

      // Decode the CAD bytes to a transferable ArrayBuffer.
      var bin = atob(base64);
      var fileBytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) fileBytes[i] = bin.charCodeAt(i);
      var fileBuf = fileBytes.buffer;

      fetch(rt.getURL('occt-import-js.wasm')).then(function (r) {
        if (!r.ok) throw new Error('Failed to load CAD engine (HTTP ' + r.status + ').');
        return r.arrayBuffer();
      }).then(function (wasmBuf) {
        var id = 'cad_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        var iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px;top:0;';
        var done = false;

        function cleanup() {
          window.removeEventListener('message', onMsg);
          try { iframe.remove(); } catch (e) { /* ignore */ }
        }
        function onMsg(e) {
          var m = e.data;
          if (!m) return;
          if (m.occtSandboxReady && e.source === iframe.contentWindow) {
            iframe.contentWindow.postMessage(
              { cmd: 'tessellate', id: id, format: (fileType === 'iges' ? 'IGES' : 'STEP'), fileBuf: fileBuf, wasmBuf: wasmBuf },
              '*', [fileBuf, wasmBuf]);
            return;
          }
          if (m.id !== id) return;
          done = true; cleanup();
          if (m.error) { reject(new Error(m.error)); return; }
          resolve({
            positions: (m.positions instanceof Float32Array) ? m.positions : new Float32Array(m.positions),
            normals: (m.normals instanceof Float32Array) ? m.normals : new Float32Array(m.normals),
            count: m.count
          });
        }
        window.addEventListener('message', onMsg);
        iframe.src = rt.getURL('occt-sandbox.html');
        document.body.appendChild(iframe);
        setTimeout(function () {
          if (!done) { cleanup(); reject(new Error('CAD tessellation timed out.')); }
        }, 40000);
      }).catch(reject);
    });
  }

  // Shared WebGL renderer: takes flat positions/normals (count*9 floats each)
  // and draws an interactive, auto-framed 3D view. Used by the CAD viewer.
  function renderTriangleGeometry(mountEl, geo, infoText) {
    function fail(msg) {
      mountEl.innerHTML = '<div style="padding:40px;font-family:\'Segoe UI\',sans-serif;font-size:14px;color:#666;">' + msg + '</div>';
    }
    var pos = geo.positions;
    var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (var a = 0; a < pos.length; a += 3) {
      var x = pos[a], y = pos[a + 1], z = pos[a + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    var sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    var maxDim = Math.max(sizeX, sizeY, sizeZ) || 1;
    var scl = 2 / maxDim;
    for (var b = 0; b < pos.length; b += 3) {
      pos[b] = (pos[b] - cx) * scl;
      pos[b + 1] = (pos[b + 1] - cy) * scl;
      pos[b + 2] = (pos[b + 2] - cz) * scl;
    }
    var dimText = sizeX.toFixed(2) + ' \u00D7 ' + sizeY.toFixed(2) + ' \u00D7 ' + sizeZ.toFixed(2);

    mountEl.innerHTML = '';
    var boxEl = document.createElement('div');
    boxEl.style.cssText = 'position:relative;width:100%;height:100%;min-height:340px;background:#eef2f6;overflow:hidden;';
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:grab;touch-action:none;';
    boxEl.appendChild(canvas);
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:12px;bottom:10px;font-family:"Segoe UI",sans-serif;font-size:11px;color:#445;background:rgba(255,255,255,0.78);padding:4px 8px;border-radius:4px;pointer-events:none;';
    overlay.textContent = (infoText || (geo.count.toLocaleString() + ' triangles')) + ' \u00B7 ' + dimText + ' \u00B7 drag to rotate, scroll to zoom';
    boxEl.appendChild(overlay);
    mountEl.appendChild(boxEl);

    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) { fail('WebGL is not available, so this CAD file cannot be rendered.'); return; }

    var vsSrc = 'attribute vec3 aPos;attribute vec3 aNormal;uniform mat4 uMVP;uniform mat3 uNormal;varying vec3 vN;void main(){vN=normalize(uNormal*aNormal);gl_Position=uMVP*vec4(aPos,1.0);}';
    var fsSrc = 'precision mediump float;varying vec3 vN;uniform vec3 uColor;void main(){vec3 N=normalize(vN);vec3 L=normalize(vec3(0.4,0.55,1.0));float d=max(dot(N,L),0.0);d=max(d,max(dot(-N,L),0.0)*0.5);vec3 c=uColor*(0.35+0.75*d);gl_FragColor=vec4(c,1.0);}';
    function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var prog = gl.createProgram();
    try {
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(prog);
    } catch (e2) { fail('WebGL shader error: ' + (e2 && e2.message ? e2.message : e2)); return; }
    gl.useProgram(prog);

    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    var nrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);
    var aNormal = gl.getAttribLocation(prog, 'aNormal');
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    var uMVP = gl.getUniformLocation(prog, 'uMVP');
    var uNormal = gl.getUniformLocation(prog, 'uNormal');
    var uColor = gl.getUniformLocation(prog, 'uColor');
    gl.uniform3f(uColor, 0.55, 0.63, 0.72);
    gl.enable(gl.DEPTH_TEST);

    function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    function mul(a, b) { var o = new Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3]; return o; }
    function translate(m, x, y, z) { return mul(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }
    function rotX(r) { var c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
    function rotY(r) { var c = Math.cos(r), s = Math.sin(r); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
    function perspective(fovy, aspect, near, far) { var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; }
    function mat3(m) { return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; }

    var yaw = -0.6, pitch = -0.4, dist = 4.0;
    var dragging = false, lastX = 0, lastY = 0;
    function draw() {
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.clientWidth || boxEl.clientWidth || 340;
      var h = canvas.clientHeight || boxEl.clientHeight || 340;
      var bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.93, 0.95, 0.97, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var proj = perspective(45 * Math.PI / 180, w / h || 1, 0.1, 100);
      var view = translate(identity(), 0, 0, -dist);
      var model = mul(rotY(yaw), rotX(pitch));
      var mvp = mul(proj, mul(view, model));
      gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
      gl.uniformMatrix3fv(uNormal, false, new Float32Array(mat3(model)));
      gl.drawArrays(gl.TRIANGLES, 0, geo.count * 3);
    }
    var rafPending = false;
    function requestDraw() { if (!rafPending) { rafPending = true; requestAnimationFrame(function () { rafPending = false; draw(); }); } }

    canvas.addEventListener('mousedown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', function () { if (dragging) { dragging = false; canvas.style.cursor = 'grab'; } });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.01;
      pitch += (e.clientY - lastY) * 0.01;
      var lim = Math.PI / 2 - 0.01;
      if (pitch > lim) pitch = lim; if (pitch < -lim) pitch = -lim;
      lastX = e.clientX; lastY = e.clientY;
      requestDraw();
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      dist *= (e.deltaY > 0 ? 1.1 : 0.9);
      if (dist < 1.5) dist = 1.5; if (dist > 30) dist = 30;
      requestDraw();
    }, { passive: false });
    if (window.ResizeObserver) { var roCad = new ResizeObserver(function () { requestDraw(); }); roCad.observe(boxEl); }
    else { window.addEventListener('resize', requestDraw); }
    requestDraw();
  }

  // --- Gerber (RS-274X) 2D viewer (self-contained, no external deps) ---
  function parseGerber(text) {
    var fmt = { xInt: 3, xDec: 4, yInt: 3, yDec: 4, zero: 'L' };
    var unit = 'mm';
    var apertures = {};
    var curAp = null;
    var x = 0, y = 0;
    var interp = 1;
    var polarity = 'D';
    var regionMode = false;
    var regionContours = [];
    var curContour = [];
    var prims = [];

    function parseCoord(str, isX) {
      var neg = false;
      if (str.charAt(0) === '+') str = str.slice(1);
      if (str.charAt(0) === '-') { neg = true; str = str.slice(1); }
      var dec = isX ? fmt.xDec : fmt.yDec;
      var intg = isX ? fmt.xInt : fmt.yInt;
      var total = dec + intg;
      if (fmt.zero === 'T') { while (str.length < total) str += '0'; }
      var v = parseInt(str, 10) / Math.pow(10, dec);
      if (isNaN(v)) v = 0;
      return neg ? -v : v;
    }
    function arcPoints(sx, sy, ex, ey, i, j, cw) {
      var ccx = sx + i, ccy = sy + j;
      var r = Math.sqrt((sx - ccx) * (sx - ccx) + (sy - ccy) * (sy - ccy));
      var a0 = Math.atan2(sy - ccy, sx - ccx);
      var a1 = Math.atan2(ey - ccy, ex - ccx);
      var full = (Math.abs(sx - ex) < 1e-9 && Math.abs(sy - ey) < 1e-9);
      if (cw) { if (a1 >= a0) a1 -= 2 * Math.PI; if (full) a1 = a0 - 2 * Math.PI; }
      else { if (a1 <= a0) a1 += 2 * Math.PI; if (full) a1 = a0 + 2 * Math.PI; }
      var segs = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 32)));
      var pts = [];
      for (var s = 1; s <= segs; s++) { var a = a0 + (a1 - a0) * s / segs; pts.push([ccx + r * Math.cos(a), ccy + r * Math.sin(a)]); }
      return pts;
    }
    function defineAperture(body) {
      var m = body.match(/^D(\d+)([A-Za-z][A-Za-z0-9_$.\-]*)?(?:,(.*))?$/);
      if (!m) return;
      var code = 'D' + m[1];
      var shape = m[2] || '';
      var params = (m[3] || '').split('X').map(function (p) { return parseFloat(p); });
      apertures[code] = { shape: shape, params: params };
    }
    function setFormat(body) {
      var zm = body.match(/FS([LT])?([AI])?/);
      if (zm && zm[1]) fmt.zero = zm[1];
      var xm = body.match(/X(\d)(\d)/);
      var ym = body.match(/Y(\d)(\d)/);
      if (xm) { fmt.xInt = +xm[1]; fmt.xDec = +xm[2]; }
      if (ym) { fmt.yInt = +ym[1]; fmt.yDec = +ym[2]; }
    }
    function flushContour() { if (curContour.length) { regionContours.push(curContour); curContour = []; } }
    function endRegion() {
      flushContour();
      if (regionContours.length) prims.push({ kind: 'region', contours: regionContours, pol: polarity });
      regionContours = [];
    }
    function handleExtended(body) {
      if (/^FS/.test(body)) { setFormat(body); return; }
      if (/^MO/.test(body)) { unit = /IN/.test(body) ? 'inch' : 'mm'; return; }
      if (/^ADD/.test(body)) { defineAperture(body.slice(2)); return; }
      if (/^LP/.test(body)) { polarity = /LPC/.test(body) ? 'C' : 'D'; return; }
    }
    function handleData(cmd) {
      var gmatches = cmd.match(/G\d+/g);
      if (gmatches) {
        for (var gi = 0; gi < gmatches.length; gi++) {
          var gc = parseInt(gmatches[gi].slice(1), 10);
          if (gc === 1) interp = 1;
          else if (gc === 2) interp = 2;
          else if (gc === 3) interp = 3;
          else if (gc === 36) { regionMode = true; regionContours = []; curContour = []; }
          else if (gc === 37) { regionMode = false; endRegion(); }
          else if (gc === 70) unit = 'inch';
          else if (gc === 71) unit = 'mm';
        }
      }
      var xm = cmd.match(/X([+-]?\d+)/);
      var ym = cmd.match(/Y([+-]?\d+)/);
      var im = cmd.match(/I([+-]?\d+)/);
      var jm = cmd.match(/J([+-]?\d+)/);
      var dm = cmd.match(/D0*([0-9]+)\*?$/);
      var nx = xm ? parseCoord(xm[1], true) : x;
      var ny = ym ? parseCoord(ym[1], false) : y;
      var iv = im ? parseCoord(im[1], true) : 0;
      var jv = jm ? parseCoord(jm[1], false) : 0;
      if (!dm) { x = nx; y = ny; return; }
      var d = parseInt(dm[1], 10);
      if (d >= 10) { curAp = 'D' + d; x = nx; y = ny; return; }
      if (d === 1) {
        if (regionMode) {
          if (!curContour.length) curContour.push([x, y]);
          if (interp === 1) curContour.push([nx, ny]);
          else { var ap1 = arcPoints(x, y, nx, ny, iv, jv, interp === 2); for (var q = 0; q < ap1.length; q++) curContour.push(ap1[q]); }
        } else {
          if (interp === 1) prims.push({ kind: 'line', x1: x, y1: y, x2: nx, y2: ny, ap: curAp, pol: polarity });
          else { var ap2 = arcPoints(x, y, nx, ny, iv, jv, interp === 2); var px = x, py = y; for (var w2 = 0; w2 < ap2.length; w2++) { prims.push({ kind: 'line', x1: px, y1: py, x2: ap2[w2][0], y2: ap2[w2][1], ap: curAp, pol: polarity }); px = ap2[w2][0]; py = ap2[w2][1]; } }
        }
      } else if (d === 2) {
        if (regionMode) { flushContour(); curContour.push([nx, ny]); }
      } else if (d === 3) {
        prims.push({ kind: 'flash', x: nx, y: ny, ap: curAp, pol: polarity });
      }
      x = nx; y = ny;
    }
    var i2 = 0, n = text.length;
    while (i2 < n) {
      var ch = text.charAt(i2);
      if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') { i2++; continue; }
      if (ch === '%') {
        var end = text.indexOf('%', i2 + 1);
        if (end < 0) break;
        var inner = text.slice(i2 + 1, end);
        inner.split('*').forEach(function (b) { b = b.trim(); if (b) handleExtended(b); });
        i2 = end + 1;
      } else if (ch === '*') {
        i2++;
      } else {
        var star = text.indexOf('*', i2);
        if (star < 0) star = n;
        var cmd = text.slice(i2, star).replace(/[\r\n]/g, '').trim();
        if (cmd && !/^G0*4/.test(cmd) && cmd !== 'M02' && cmd !== 'M00') handleData(cmd);
        i2 = star + 1;
      }
    }
    return { prims: prims, apertures: apertures, unit: unit };
  }

  function buildGerberViewer(mountEl, text) {
    var parsed;
    try { parsed = parseGerber(text); } catch (e) {
      mountEl.innerHTML = '<div style="padding:40px;font-family:\'Segoe UI\',sans-serif;font-size:14px;color:#666;">Could not parse Gerber file: ' + (e && e.message ? e.message : e) + '</div>';
      return;
    }
    var prims = parsed.prims, apertures = parsed.apertures;
    if (!prims.length) {
      mountEl.innerHTML = '<div style="padding:40px;font-family:\'Segoe UI\',sans-serif;font-size:14px;color:#666;">No drawable geometry found in this Gerber file.</div>';
      return;
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function apSize(code) { var a = apertures[code]; if (!a || !a.params) return 0.1; return a.params[0] || 0.1; }
    function ext(px, py, pad) { if (px - pad < minX) minX = px - pad; if (px + pad > maxX) maxX = px + pad; if (py - pad < minY) minY = py - pad; if (py + pad > maxY) maxY = py + pad; }
    prims.forEach(function (p) {
      if (p.kind === 'line') { var r = apSize(p.ap) / 2; ext(p.x1, p.y1, r); ext(p.x2, p.y2, r); }
      else if (p.kind === 'flash') { var a = apertures[p.ap]; var r2 = a && a.params ? Math.max(a.params[0] || 0, a.params[1] || 0) / 2 : 0.1; ext(p.x, p.y, r2); }
      else if (p.kind === 'region') { p.contours.forEach(function (c) { c.forEach(function (pt) { ext(pt[0], pt[1], 0); }); }); }
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
    var gw = (maxX - minX) || 1, gh = (maxY - minY) || 1;
    var cxw = (minX + maxX) / 2, cyw = (minY + maxY) / 2;

    mountEl.innerHTML = '';
    var boxEl = document.createElement('div');
    boxEl.style.cssText = 'position:relative;width:100%;height:100%;min-height:340px;background:#0d1117;overflow:hidden;';
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:grab;touch-action:none;';
    boxEl.appendChild(canvas);
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:12px;bottom:10px;font-family:"Segoe UI",sans-serif;font-size:11px;color:#cdd6e0;background:rgba(0,0,0,0.45);padding:4px 8px;border-radius:4px;pointer-events:none;';
    overlay.textContent = prims.length.toLocaleString() + ' features \u00B7 ' + gw.toFixed(2) + ' \u00D7 ' + gh.toFixed(2) + ' ' + parsed.unit + ' \u00B7 drag to pan, scroll to zoom';
    boxEl.appendChild(overlay);
    mountEl.appendChild(boxEl);

    var ctx = canvas.getContext('2d');
    var BG = '#0d1117', DARK = '#3fb950';
    var scale = 1, offX = 0, offY = 0, inited = false;
    function fit() {
      var w = canvas.width, h = canvas.height;
      scale = Math.min(w / gw, h / gh) * 0.9;
      offX = w / 2 - cxw * scale;
      offY = h / 2 + cyw * scale;
      inited = true;
    }
    function drawFlash(p) {
      var a = apertures[p.ap]; if (!a) return;
      var s = a.shape, pr = a.params || [];
      function obround(ox, oy, w2, h2) { var r = Math.min(w2, h2) / 2; var x0 = ox - w2 / 2, y0 = oy - h2 / 2; ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w2, y0, x0 + w2, y0 + h2, r); ctx.arcTo(x0 + w2, y0 + h2, x0, y0 + h2, r); ctx.arcTo(x0, y0 + h2, x0, y0, r); ctx.arcTo(x0, y0, x0 + w2, y0, r); ctx.closePath(); ctx.fill(); }
      if (s === 'C') { ctx.beginPath(); ctx.arc(p.x, p.y, (pr[0] || 0) / 2, 0, 2 * Math.PI); ctx.fill(); }
      else if (s === 'R') { ctx.fillRect(p.x - (pr[0] || 0) / 2, p.y - (pr[1] || 0) / 2, pr[0] || 0, pr[1] || 0); }
      else if (s === 'O') { obround(p.x, p.y, pr[0] || 0, pr[1] || 0); }
      else if (s === 'P') { var dia = pr[0] || 0, verts = pr[1] || 6, rot = (pr[2] || 0) * Math.PI / 180; ctx.beginPath(); ctx.moveTo(p.x + (dia / 2) * Math.cos(rot), p.y + (dia / 2) * Math.sin(rot)); for (var v = 1; v <= verts; v++) { var ang = rot + v * 2 * Math.PI / verts; ctx.lineTo(p.x + (dia / 2) * Math.cos(ang), p.y + (dia / 2) * Math.sin(ang)); } ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, (pr[0] || 0.1) / 2, 0, 2 * Math.PI); ctx.fill(); }
    }
    function render() {
      if (!canvas.width || !canvas.height) return;
      if (!inited) fit();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, -scale, offX, offY);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (var k = 0; k < prims.length; k++) {
        var p = prims[k];
        var color = (p.pol === 'C') ? BG : DARK;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        if (p.kind === 'line') {
          var a = apertures[p.ap];
          var lw = a && a.params ? (a.params[0] || 0.05) : 0.05;
          ctx.lineWidth = lw > 0 ? lw : 0.05;
          ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
        } else if (p.kind === 'flash') {
          drawFlash(p);
        } else if (p.kind === 'region') {
          ctx.beginPath();
          p.contours.forEach(function (c) {
            if (!c.length) return;
            ctx.moveTo(c[0][0], c[0][1]);
            for (var z = 1; z < c.length; z++) ctx.lineTo(c[z][0], c[z][1]);
            ctx.closePath();
          });
          ctx.fill('evenodd');
        }
      }
    }
    var rafPending = false;
    function requestDraw() { if (!rafPending) { rafPending = true; requestAnimationFrame(function () { rafPending = false; resize(); render(); }); } }
    function resize() {
      var dpr = window.devicePixelRatio || 1;
      var w = boxEl.clientWidth || 340, h = boxEl.clientHeight || 340;
      var bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; inited = false; }
    }
    var dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener('mousedown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', function () { if (dragging) { dragging = false; canvas.style.cursor = 'grab'; } });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dpr = window.devicePixelRatio || 1;
      offX += (e.clientX - lastX) * dpr;
      offY += (e.clientY - lastY) * dpr;
      lastX = e.clientX; lastY = e.clientY;
      requestDraw();
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dpr = window.devicePixelRatio || 1;
      var rect = canvas.getBoundingClientRect();
      var mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
      var wx = (mx - offX) / scale, wy = (offY - my) / scale;
      var f = e.deltaY > 0 ? 0.9 : 1.1;
      scale *= f;
      offX = mx - wx * scale;
      offY = my + wy * scale;
      requestDraw();
    }, { passive: false });
    if (window.ResizeObserver) { var ro2 = new ResizeObserver(function () { requestDraw(); }); ro2.observe(boxEl); }
    else { window.addEventListener('resize', requestDraw); }
    requestDraw();
  }

  // Normalize mammoth-generated procedure tables. Prefer checkbox+label pair
  // conversion into a compact checklist layout similar to source procedures.
  function normalizeDocxProcedureTables(rootEl, checkedLabelMap) {
    if (!rootEl) return;
    checkedLabelMap = checkedLabelMap || {};

    function getLogicalCell(row, logicalCol) {
      if (!row || !row.cells) return null;
      var cursor = 0;
      for (var i = 0; i < row.cells.length; i++) {
        var cell = row.cells[i];
        var span = parseInt(cell.getAttribute('colspan') || '1', 10);
        if (logicalCol >= cursor && logicalCol < cursor + span) return cell;
        cursor += span;
      }
      return null;
    }

    function getRowLogicalColCount(row) {
      if (!row || !row.cells) return 0;
      var total = 0;
      for (var i = 0; i < row.cells.length; i++) {
        total += parseInt(row.cells[i].getAttribute('colspan') || '1', 10);
      }
      return total;
    }

    function getCellText(cell) {
      return ((cell && cell.textContent) || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function getCellMarkerToken(cell) {
      if (!cell) return '';
      return ((cell.textContent || '') + '').replace(/\u00a0/g, ' ').trim();
    }

    function getCellMarkerSignature(cell) {
      if (!cell) return '';
      var token = getCellMarkerToken(cell);
      // Keep enough structure to distinguish symbol-font variants that render similarly.
      var htmlSig = String(cell.innerHTML || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      return token + '||' + htmlSig;
    }

    function isCheckLike(text) {
      if (!text) return true;
      var normalized = String(text).replace(/\u00a0/g, ' ').replace(/\s+/g, '').trim();
      if (!normalized) return true;
      if (/^(\[?x\]?|\[?X\]?|\[?1\]?|\u2713|\u2714|\u2716|\u00d7|\u2611|\u2612|\u25a0|\u25fc|\u25cf|\u25c9|\u221a|\u2717|\u2718|\u00fe|\u00fd|\u00fc)$/.test(normalized)) return true;
      if (/^(\u2610|\u25a1|\u25fb|\u25a2|\[\]|\u00a8)$/.test(normalized)) return true;
      // Mammoth can output symbol-font/private-use glyphs for checkboxes.
      if (normalized.length <= 2 && /[\u2460-\u27ff\ue000-\uf8ff]/.test(normalized)) return true;
      return normalized.length <= 2;
    }

    function isChecked(text) {
      if (!text) return false;
      var normalized = String(text).replace(/\u00a0/g, ' ').replace(/\s+/g, '').trim();
      if (!normalized) return false;

      // Common unchecked tokens from DOCX symbol fonts and plain text.
      if (/^(\u2610|\u25a1|\u25fb|\u25a2|\[\]|\u00a8)$/.test(normalized)) return false;

      // Checked markers (including symbol-font fallbacks often produced by DOCX conversion).
      if (/^(\[?x\]?|\[?X\]?|\[?1\]?|\u2713|\u2714|\u2716|\u00d7|\u2611|\u2612|\u25a0|\u25fc|\u25cf|\u25c9|\u221a|\u2717|\u2718|\u00fe|\u00fd|\u00fc)$/.test(normalized)) {
        return true;
      }

      // Fallback for mixed wrappers like "[x]" or stray punctuation around check symbols.
      var loose = normalized.replace(/[\[\](){}<>._-]/g, '');
      if (/^(x|X|1|\u2713|\u2714|\u2716|\u00d7|\u2611|\u2612|\u25a0|\u25fc|\u25cf|\u25c9|\u221a|\u2717|\u2718|\u00fe|\u00fd|\u00fc)$/.test(loose)) {
        return true;
      }

      // Heuristic: if it's a short check-like token and not explicitly unchecked, treat as checked.
      if (isCheckLike(loose) && !/^(\u2610|\u25a1|\u25fb|\u25a2|\[\]|\u00a8)$/.test(loose) && loose !== '') {
        return true;
      }

      return false;
    }

    function cellHasInlineStyle(cell, regex) {
      if (!cell) return false;
      var own = (cell.getAttribute('style') || '').toLowerCase();
      if (regex.test(own)) return true;
      var nodes = cell.querySelectorAll('*');
      for (var i = 0; i < nodes.length; i++) {
        var st = (nodes[i].getAttribute('style') || '').toLowerCase();
        if (regex.test(st)) return true;
      }
      return false;
    }

    function stripLeadingCheckboxToken(text) {
      return String(text || '').replace(/^(?:\u2610|\u2611|\u2612|\u25a1|\u25fb|\u25a2|\u2713|\u2714|\u2716|\u00d7)\s*/, '').trim();
    }

    function normalizeLabelKey(text) {
      return String(text || '').replace(/\s+/g, ' ').trim().toUpperCase();
    }

    function isCheckedFromLabelCell(labelCell) {
      if (!labelCell) return false;
      var text = getCellText(labelCell);

      if (/^(?:\u2611|\u2612|\u2713|\u2714|\u2716|\u00d7|\u25a0|\u25fc|\u25cf)\s*/.test(text)) {
        return true;
      }

      if (labelCell.querySelector('strong,b,u')) {
        return true;
      }

      if (cellHasInlineStyle(labelCell, /font-weight\s*:\s*(?:bold|[6-9]00)/)) {
        return true;
      }

      if (cellHasInlineStyle(labelCell, /text-decoration[^;]*underline/)) {
        return true;
      }

      return false;
    }

    function getDominantTokenMap(rows, pairStarts) {
      var map = {};
      pairStarts.forEach(function (startCol) {
        var counts = {};
        var total = 0;
        rows.forEach(function (row) {
          var labelCell = getLogicalCell(row, startCol + 1);
          var labelText = stripLeadingCheckboxToken(getCellText(labelCell));
          if (!labelText) return;
          var markCell = getLogicalCell(row, startCol);
          var signature = getCellMarkerSignature(markCell);
          if (!signature) return;
          counts[signature] = (counts[signature] || 0) + 1;
          total++;
        });

        var dominantSignature = '';
        var dominantCount = 0;
        Object.keys(counts).forEach(function (k) {
          if (counts[k] > dominantCount) {
            dominantCount = counts[k];
            dominantSignature = k;
          }
        });

        // Require a stable baseline token to avoid overfitting sparse columns.
        if (dominantSignature && dominantCount >= 2 && (dominantCount / Math.max(total, 1)) >= 0.45) {
          map[startCol] = dominantSignature;
        }
      });
      return map;
    }

    function convertTableToChecklist(table, rows, pairStarts) {
      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'margin:8px 0 14px;';
      var dominantTokenByCol = getDominantTokenMap(rows, pairStarts);

      rows.forEach(function (row) {
        var rowGrid = document.createElement('div');
        rowGrid.style.cssText = 'display:grid;grid-template-columns:repeat(' + pairStarts.length + ', minmax(0, 1fr));column-gap:18px;row-gap:2px;margin:0 0 2px 0;';
        var hasContent = false;

        pairStarts.forEach(function (startCol) {
          var markCell = getLogicalCell(row, startCol);
          var labelCell = getLogicalCell(row, startCol + 1);
          var labelText = stripLeadingCheckboxToken(getCellText(labelCell));
          var markText = getCellMarkerToken(markCell);
          var markSignature = getCellMarkerSignature(markCell);
          var baselineToken = dominantTokenByCol[startCol] || '';
          var checkedByTokenDiff = !!(labelText && markSignature && baselineToken && markSignature !== baselineToken);
          var checkedByMap = !!checkedLabelMap[normalizeLabelKey(labelText)];
          var checked = checkedByMap || isChecked(markText) || isCheckedFromLabelCell(labelCell) || checkedByTokenDiff;

          var item = document.createElement('div');
          item.style.cssText = 'display:flex;align-items:flex-start;min-height:18px;line-height:1.2;';

          if (labelText) {
            hasContent = true;
            var box = document.createElement('span');
            box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;border:1px solid #666;margin:2px 8px 0 0;font-size:10px;line-height:1;flex:0 0 auto;';
            box.innerHTML = checked ? '&#10005;' : '';
            item.appendChild(box);

            var label = document.createElement('span');
            label.style.cssText = 'font-size:13px;color:#222;';
            if (checked) label.style.fontWeight = '700';
            if (checked && (labelCell && (labelCell.querySelector('u') || cellHasInlineStyle(labelCell, /text-decoration[^;]*underline/)))) {
              label.style.textDecoration = 'underline';
            }
            label.textContent = labelText;
            item.appendChild(label);
          }

          rowGrid.appendChild(item);
        });

        if (hasContent) wrapper.appendChild(rowGrid);
      });

      if (wrapper.children.length > 0) {
        table.replaceWith(wrapper);
        return true;
      }
      return false;
    }

    var tables = rootEl.querySelectorAll('table');
    tables.forEach(function (table) {
      var rows = Array.prototype.slice.call(table.rows || []);
      if (rows.length === 0) return;

      var maxCols = 0;
      rows.forEach(function (r) {
        var logicalCols = getRowLogicalColCount(r);
        if (logicalCols > maxCols) maxCols = logicalCols;
      });
      if (maxCols < 4) return;

      var pairStarts = [];
      for (var c = 0; c + 1 < maxCols; c += 2) {
        var present = 0;
        var labelCount = 0;
        var checkLikeCount = 0;
        rows.forEach(function (r) {
          var labelCell = getLogicalCell(r, c + 1);
          if (labelCell) {
            present++;
            var markText = getCellText(getLogicalCell(r, c));
            var labelText = getCellText(labelCell);
            if (labelText.length > 0) labelCount++;
            if (isCheckLike(markText)) checkLikeCount++;
          }
        });
        if (present > 0) {
          var labelRatio = labelCount / present;
          var checkRatio = checkLikeCount / present;
          if (labelRatio >= 0.55 && checkRatio >= 0.8) {
            pairStarts.push(c);
          }
        }
      }

      if (pairStarts.length >= 2) {
        if (convertTableToChecklist(table, rows, pairStarts)) return;
      }

      table.style.borderCollapse = 'collapse';
      table.style.width = '100%';
      table.style.margin = '10px 0';
      table.style.tableLayout = 'auto';
      rows.forEach(function (row) {
        Array.prototype.forEach.call(row.cells || [], function (cell) {
          cell.style.border = '1px solid #c7c7c7';
          cell.style.padding = '6px 8px';
          cell.style.verticalAlign = 'top';
          cell.style.lineHeight = '1.3';
          cell.style.fontSize = '13px';
          var ps = cell.querySelectorAll('p');
          ps.forEach(function (p) { p.style.margin = '0'; });
        });
      });
    });
  }

  function renderMarkdown(markdownText) {
    function escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function applyInlineFormatting(text) {
      var escaped = escapeHtml(text);
      escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
      escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      return escaped;
    }

    var lines = markdownText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var html = [];
    var inCodeBlock = false;
    var inUl = false;
    var inOl = false;

    function closeLists() {
      if (inUl) {
        html.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        html.push('</ol>');
        inOl = false;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (/^```/.test(line)) {
        closeLists();
        if (!inCodeBlock) {
          html.push('<pre><code>');
          inCodeBlock = true;
        } else {
          html.push('</code></pre>');
          inCodeBlock = false;
        }
        continue;
      }

      if (inCodeBlock) {
        html.push(escapeHtml(line) + '\n');
        continue;
      }

      if (/^\s*$/.test(line)) {
        closeLists();
        html.push('<p></p>');
        continue;
      }

      var heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeLists();
        var level = heading[1].length;
        html.push('<h' + level + '>' + applyInlineFormatting(heading[2]) + '</h' + level + '>');
        continue;
      }

      var orderedItem = line.match(/^\s*\d+\.\s+(.*)$/);
      if (orderedItem) {
        if (inUl) {
          html.push('</ul>');
          inUl = false;
        }
        if (!inOl) {
          html.push('<ol>');
          inOl = true;
        }
        html.push('<li>' + applyInlineFormatting(orderedItem[1]) + '</li>');
        continue;
      }

      var unorderedItem = line.match(/^\s*[-*]\s+(.*)$/);
      if (unorderedItem) {
        if (inOl) {
          html.push('</ol>');
          inOl = false;
        }
        if (!inUl) {
          html.push('<ul>');
          inUl = true;
        }
        html.push('<li>' + applyInlineFormatting(unorderedItem[1]) + '</li>');
        continue;
      }

      closeLists();
      html.push('<p>' + applyInlineFormatting(line) + '</p>');
    }

    closeLists();
    if (inCodeBlock) {
      html.push('</code></pre>');
    }

    document.head.innerHTML = '<style>' +
      'body{margin:0;padding:32px 44px;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;font-size:14px;line-height:1.6;color:#222;background:#fff;}' +
      'h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.1em 0 0.5em;}' +
      'p{margin:0.6em 0;}' +
      'ul,ol{margin:0.6em 0 0.8em 1.4em;}' +
      'li{margin:0.2em 0;}' +
      'code{font-family:"Consolas","Courier New",monospace;background:#f2f2f2;border-radius:3px;padding:0 4px;}' +
      'pre{background:#f7f7f7;border:1px solid #ddd;border-radius:6px;padding:12px;overflow:auto;}' +
      'pre code{background:transparent;padding:0;}' +
      'a{color:#0078d4;text-decoration:none;}' +
      'a:hover{text-decoration:underline;}' +
      '</style>';
    document.body.innerHTML = html.join('');
  }

  function handleInterceptDetail(detail) {
    if (!detail || !detail.url) return;
    var fields = detail.fields || {};
    var method = detail.method || 'POST';
    console.log('[Agile PLM Ext CS] Got intercepted preview handoff. Action:', detail.url, 'Method:', method, 'Fields:', Object.keys(fields).length, 'Source:', detail.source || 'form');

    // Send to background script to fetch the actual file bytes
    browser.runtime.sendMessage({
      type: 'fetch_file',
      url: detail.url,
      method: method,
      fields: fields,
      fileType: fileType
    }).then(function (response) {
      if (!response || !response.success) {
        console.error('[Agile PLM Ext CS] Background fetch failed:', response ? response.error : 'no response');
        document.body.innerHTML = '<div style="padding:40px;color:red;font-size:14px;text-align:center;">Failed to fetch file: ' + (response ? response.error : 'no response from extension') + '</div>';
        return;
      }

      console.log('[Agile PLM Ext CS] Got response. fileType:', response.fileType);

      if (response.fileType === 'docx') {
        // DOCX: mammoth already converted to HTML in background script
        console.log('[Agile PLM Ext CS] Rendering DOCX HTML, length:', response.html.length);
        document.head.innerHTML = '<style>' +
          'body{margin:0;padding:0;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;font-size:14px;line-height:1.6;color:#222;}' +
          '.docx-header{background:#f8f8f8;border-bottom:2px solid #0078d4;padding:12px 60px;font-size:12px;color:#444;}' +
          '.docx-header p{margin:2px 0;}' +
          '.docx-header table{border-collapse:collapse;width:100%;margin:4px 0;font-size:12px;background:#fff;}' +
          '.docx-header td,.docx-header th{border:1px solid #999;padding:4px 8px;vertical-align:top;}' +
          '.docx-header img{max-width:100%;max-height:48px;object-fit:contain;}' +
          '.docx-body{padding:40px 60px;}' +
          '.docx-body img{max-width:100%;}' +
          '.docx-body table{border-collapse:collapse;width:100%;margin:12px 0;}' +
          '.docx-body td,.docx-body th{border:1px solid #ccc;padding:6px 10px;}' +
          '.docx-body p{margin:0.5em 0;}' +
          '.docx-footer{background:#f8f8f8;border-top:2px solid #0078d4;padding:12px 60px;font-size:11px;color:#666;}' +
          '.docx-footer p{margin:2px 0;}' +
          '.docx-footer table{border-collapse:collapse;width:100%;margin:4px 0;font-size:11px;background:#fff;}' +
          '.docx-footer td,.docx-footer th{border:1px solid #999;padding:4px 8px;vertical-align:top;}' +
          '.docx-footer img{max-width:100%;max-height:40px;object-fit:contain;}' +
          '.docx-notice{background:#fff3cd;border:1px solid #ffc107;padding:8px 16px;margin:0;font-size:11px;color:#664d03;}' +
          '</style>';
        var bodyHtml = '<div class="docx-notice">\u26A0 Quick Preview \u2014 Some minor content or formatting may be missing from this preview.' +
          '<div style="margin-top:6px;font-size:11px;font-weight:600;color:#7a5b00;">Note: Routing information may not be correct. Please verify routing selections against the original document.</div></div>';
        if (response.headerHtml) {
          bodyHtml += '<div class="docx-header">' + response.headerHtml + '</div>';
        }
        bodyHtml += '<div class="docx-body">' + response.html + '</div>';
        if (response.footerHtml) {
          bodyHtml += '<div class="docx-footer">' + response.footerHtml + '</div>';
        }
        document.body.style.cssText = 'margin:0;padding:0;';
        document.body.innerHTML = bodyHtml;
        normalizeDocxProcedureTables(document.querySelector('.docx-body'), response.checkedLabels || {});
      } else if (response.fileType === 'doc') {
        // DOC: render with blob URL via direct DOM manipulation
        console.log('[Agile PLM Ext CS] Rendering DOC via blob URL');
        var docBinaryStr = atob(response.base64);
        var docBytes = new Uint8Array(docBinaryStr.length);
        for (var d = 0; d < docBinaryStr.length; d++) {
          docBytes[d] = docBinaryStr.charCodeAt(d);
        }
        var docBlob = new Blob([docBytes], { type: response.mime || 'application/msword' });
        var docBlobUrl = URL.createObjectURL(docBlob);

        document.head.innerHTML = '<style>' +
          'body{margin:0;padding:16px;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;background:#f5f5f5;color:#222;}' +
          '.doc-wrap{height:calc(100vh - 120px);background:#fff;border:1px solid #ddd;border-radius:4px;overflow:hidden;}' +
          '.doc-viewer{width:100%;height:100%;border:none;}' +
          '.doc-fallback{padding:18px;font-size:14px;line-height:1.5;}' +
          '.doc-fallback a{color:#0078d4;text-decoration:none;}' +
          '</style>';

        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;padding:16px;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;background:#f5f5f5;color:#222;';

        var docNotice = document.createElement('div');
        docNotice.style.cssText = 'background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#664d03;';
        docNotice.textContent = '\u26A0 Quick Preview \u2014 Some minor content or formatting may be missing from this preview.';
        var docRoutingNote = document.createElement('div');
        docRoutingNote.style.cssText = 'margin-top:6px;font-size:11px;font-weight:600;color:#7a5b00;';
        docRoutingNote.textContent = 'Note: Routing information may not be correct. Please verify routing selections against the original document.';
        docNotice.appendChild(docRoutingNote);
        document.body.appendChild(docNotice);

        var wrap = document.createElement('div');
        wrap.className = 'doc-wrap';

        var obj = document.createElement('object');
        obj.className = 'doc-viewer';
        obj.type = response.mime || 'application/msword';
        obj.data = docBlobUrl;

        var fallback = document.createElement('div');
        fallback.className = 'doc-fallback';
        fallback.textContent = 'Inline .doc preview is not supported by this browser viewer. ';

        var link = document.createElement('a');
        link.href = docBlobUrl;
        link.textContent = 'Open or download the file';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        fallback.appendChild(link);
        obj.appendChild(fallback);
        wrap.appendChild(obj);
        document.body.appendChild(wrap);
      } else if (response.fileType === 'txt') {
        // TXT: render as preformatted plain text using DOM manipulation
        console.log('[Agile PLM Ext CS] Rendering TXT, length:', response.text.length);
        document.head.innerHTML = '<style>body{margin:0;padding:40px 60px;font-family:"Consolas","Courier New",monospace;font-size:13px;line-height:1.5;color:#222;white-space:pre-wrap;word-wrap:break-word;}</style>';
        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;padding:40px 60px;font-family:"Consolas","Courier New",monospace;font-size:13px;line-height:1.5;color:#222;white-space:pre-wrap;word-wrap:break-word;';
        document.body.textContent = response.text;
      } else if (response.fileType === 'json') {
        // JSON: pretty-print if valid, otherwise show raw content.
        var rawJson = response.text || '';
        var prettyJson = rawJson;
        try {
          prettyJson = JSON.stringify(JSON.parse(rawJson), null, 2);
        } catch (_) {}
        console.log('[Agile PLM Ext CS] Rendering JSON, length:', prettyJson.length);
        document.head.innerHTML = '<style>html,body{margin:0;height:100%;}body{display:flex;flex-direction:column;background:#f8fafc;}#jh-bar{flex:0 0 auto;padding:8px 60px;border-bottom:1px solid #e2e8f0;background:#fff;font-family:"Segoe UI",sans-serif;}#jh-toggle{font-size:12px;font-weight:600;padding:4px 10px;border:1px solid #cbd5e1;border-radius:4px;background:#f1f5f9;color:#0f172a;cursor:pointer;}#jh-pre{flex:1 1 auto;margin:0;padding:24px 60px 40px;font-family:"Consolas","Courier New",monospace;font-size:13px;line-height:1.5;color:#222;white-space:pre-wrap;word-wrap:break-word;overflow:auto;}</style>';
        document.body.innerHTML = '';
        document.body.style.cssText = '';

        var jhBar = document.createElement('div');
        jhBar.id = 'jh-bar';
        var jhToggle = document.createElement('button');
        jhToggle.id = 'jh-toggle';
        jhToggle.type = 'button';
        jhBar.appendChild(jhToggle);

        var jhPre = document.createElement('pre');
        jhPre.id = 'jh-pre';

        var jhHighlighted = true;
        var applyJsonView = function () {
          if (jhHighlighted) {
            jhPre.innerHTML = highlightJson(prettyJson);
            jhToggle.textContent = 'Syntax highlighting: On';
          } else {
            jhPre.textContent = prettyJson;
            jhToggle.textContent = 'Syntax highlighting: Off';
          }
        };
        jhToggle.addEventListener('click', function () {
          jhHighlighted = !jhHighlighted;
          applyJsonView();
        });
        applyJsonView();

        document.body.appendChild(jhBar);
        document.body.appendChild(jhPre);
      } else if (response.fileType === 'md') {
        // Markdown: render using a lightweight, sanitized formatter.
        console.log('[Agile PLM Ext CS] Rendering Markdown, length:', response.text.length);
        renderMarkdown(response.text || '');
      } else if (response.fileType === 'html') {
        // HTML: render via blob URL navigation (same approach as PDF)
        console.log('[Agile PLM Ext CS] Rendering HTML, length:', response.text.length);
        var blob = new Blob([response.text], { type: 'text/html' });
        var blobUrl = URL.createObjectURL(blob);
        window.location.href = blobUrl;
      } else if (response.fileType === 'xlsm') {
        // XLSM/XLSX: render as HTML table using SheetJS
        console.log('[Agile PLM Ext CS] Rendering XLSM');
        // Build a self-contained HTML page with SheetJS that processes the data
        var xlsHtml = '<!DOCTYPE html><html><head>' +
          '<style>' +
          'body{margin:0;padding:20px;font-family:"Segoe UI",sans-serif;font-size:13px;}' +
          '.sheet-tabs{margin-bottom:10px;display:flex;gap:4px;flex-wrap:wrap;}' +
          '.sheet-tabs button{padding:4px 12px;font-size:12px;border:1px solid #ccc;border-radius:3px;cursor:pointer;background:#f5f5f5;}' +
          '.sheet-tabs button.active{background:#566873;color:#fff;border-color:#566873;}' +
          'table{border-collapse:collapse;width:100%;margin-top:8px;}' +
          'td,th{border:1px solid #ddd;padding:4px 8px;text-align:left;white-space:nowrap;font-size:12px;}' +
          'th{background:#f0f0f0;font-weight:600;}' +
          'tr:nth-child(even){background:#fafafa;}' +
          '</style>' +
          '</head><body>' +
          '<div id="sheet-container"><p>Loading spreadsheet...</p></div>' +
          '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"><\/script>' +
          '<script>' +
          'var b64 = "' + response.base64 + '";' +
          'try {' +
          '  var workbook = XLSX.read(b64, {type:"base64"});' +
          '  var container = document.getElementById("sheet-container");' +
          '  container.innerHTML = "";' +
          '  var tabs = document.createElement("div");' +
          '  tabs.className = "sheet-tabs";' +
          '  container.appendChild(tabs);' +
          '  var tableDiv = document.createElement("div");' +
          '  tableDiv.style.overflow = "auto";' +
          '  container.appendChild(tableDiv);' +
          '  function showSheet(name) {' +
          '    var sheet = workbook.Sheets[name];' +
          '    tableDiv.innerHTML = XLSX.utils.sheet_to_html(sheet);' +
          '    Array.from(tabs.children).forEach(function(b){b.classList.toggle("active",b.textContent===name);});' +
          '  }' +
          '  workbook.SheetNames.forEach(function(name){' +
          '    var btn = document.createElement("button");' +
          '    btn.textContent = name;' +
          '    btn.addEventListener("click",function(){showSheet(name);});' +
          '    tabs.appendChild(btn);' +
          '  });' +
          '  showSheet(workbook.SheetNames[0]);' +
          '} catch(e) {' +
          '  document.getElementById("sheet-container").innerHTML = "<p style=color:red>Error: "+e.message+"</p>";' +
          '}' +
          '<\/script></body></html>';
        var blob = new Blob([xlsHtml], { type: 'text/html' });
        var blobUrl = URL.createObjectURL(blob);
        window.location.href = blobUrl;
      } else if (response.fileType === 'pptx') {
        // PPTX: render extracted slides (text/tables/images) as cards
        console.log('[Agile PLM Ext CS] Rendering PPTX, slides:', (response.slides || []).length);
        document.head.innerHTML = '<style>' +
          'body{margin:0;padding:20px;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;font-size:14px;background:#f5f5f5;color:#222;}' +
          '.pptx-notice{background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:10px 16px;margin-bottom:16px;font-size:12px;color:#664d03;}' +
          '.pptx-slide{background:#fff;border:1px solid #ddd;border-radius:6px;padding:32px 40px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,0.08);min-height:80px;position:relative;}' +
          '.pptx-slide .num{position:absolute;top:8px;right:12px;font-size:11px;color:#999;}' +
          '.pptx-slide p{margin:3px 0;color:#333;line-height:1.5;}' +
          '.pptx-slide table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px;}' +
          '.pptx-slide img{max-width:100%;height:auto;margin:8px 0;display:block;}' +
          '</style>';
        document.body.style.cssText = 'margin:0;padding:20px;background:#f5f5f5;';
        document.body.innerHTML = '';

        var slides = response.slides || [];
        if (slides.length === 0) {
          document.body.innerHTML = '<p style="color:#999;text-align:center;padding:40px;">No slides found in this file.</p>';
        } else {
          var notice = document.createElement('div');
          notice.className = 'pptx-notice';
          notice.textContent = '\u26A0 Quick Preview \u2014 This is a simplified text/image extraction and does not reflect the actual layout or formatting of the PowerPoint file.';
          document.body.appendChild(notice);

          slides.forEach(function (slideBlocks, idx) {
            var card = document.createElement('div');
            card.className = 'pptx-slide';
            var numSpan = document.createElement('span');
            numSpan.className = 'num';
            numSpan.textContent = 'Slide ' + (idx + 1);
            card.appendChild(numSpan);

            if (!slideBlocks || slideBlocks.length === 0) {
              var empty = document.createElement('p');
              empty.style.cssText = 'color:#999;font-style:italic;';
              empty.textContent = '(empty slide)';
              card.appendChild(empty);
            } else {
              var bulletIdx = 0;
              slideBlocks.forEach(function (block) {
                if (block.type === 'text') {
                  var html = block.html || '';
                  if (!html.trim()) return;
                  var p = document.createElement('p');
                  if (block.bullet) {
                    bulletIdx++;
                    var prefix = block.bullet === 'auto' ? (bulletIdx + '. ') : (block.bullet + ' ');
                    p.style.paddingLeft = '20px';
                    p.innerHTML = '<span style="margin-left:-16px;margin-right:4px;">' + prefix.replace(/</g, '&lt;') + '</span>' + html;
                  } else {
                    bulletIdx = 0;
                    p.innerHTML = html;
                  }
                  card.appendChild(p);
                } else if (block.type === 'table') {
                  var tbl = document.createElement('table');
                  block.rows.forEach(function (row, rowIdx) {
                    var tr = document.createElement('tr');
                    row.forEach(function (cellHtml) {
                      var td = document.createElement(rowIdx === 0 ? 'th' : 'td');
                      td.style.cssText = 'border:1px solid #bbb;padding:6px 10px;text-align:left;vertical-align:top;' + (rowIdx === 0 ? 'background:#e8e8e8;font-weight:bold;' : '');
                      td.innerHTML = cellHtml;
                      tr.appendChild(td);
                    });
                    tbl.appendChild(tr);
                  });
                  card.appendChild(tbl);
                } else if (block.type === 'image') {
                  var img = document.createElement('img');
                  img.src = block.data;
                  card.appendChild(img);
                }
              });
            }
            document.body.appendChild(card);
          });
        }
      } else if (response.fileType === 'ppt') {
        // Legacy PPT: cannot preview inline, offer download
        console.log('[Agile PLM Ext CS] Rendering legacy PPT');
        var pptBinaryStr = atob(response.base64);
        var pptBytes = new Uint8Array(pptBinaryStr.length);
        for (var pb = 0; pb < pptBinaryStr.length; pb++) {
          pptBytes[pb] = pptBinaryStr.charCodeAt(pb);
        }
        var pptBlob = new Blob([pptBytes], { type: 'application/vnd.ms-powerpoint' });
        var pptBlobUrl = URL.createObjectURL(pptBlob);
        document.head.innerHTML = '<style>body{margin:0;padding:16px;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;background:#f5f5f5;color:#222;}</style>';
        document.body.style.cssText = 'margin:0;padding:16px;background:#f5f5f5;';
        document.body.innerHTML = '<div style="padding:40px;text-align:center;font-size:14px;color:#555;background:#fff;border:1px solid #ddd;border-radius:4px;">' +
          'Legacy .ppt files cannot be previewed inline.<br><a href="' + pptBlobUrl + '" target="_blank" rel="noopener noreferrer" style="color:#566873;">Download the file</a> to view it.</div>';
      } else if (response.fileType === 'zip') {
        // ZIP: render folder structure as an indented tree
        console.log('[Agile PLM Ext CS] Rendering ZIP, entries:', (response.entries || []).length);
        document.head.innerHTML = '<style>body{margin:0;padding:0;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;font-size:13px;background:#fff;color:#222;}</style>';
        document.body.style.cssText = 'margin:0;padding:0;background:#fff;';
        document.body.innerHTML = '';
        document.body.appendChild(renderZipTree(response.entries || []));
      } else if (response.fileType === 'stl') {
        // STL: render an interactive 3D view using raw WebGL
        console.log('[Agile PLM Ext CS] Rendering STL');
        document.head.innerHTML = '<style>html,body{margin:0;padding:0;height:100%;background:#eef2f6;overflow:hidden;}</style>';
        document.body.style.cssText = 'margin:0;padding:0;height:100%;';
        document.body.innerHTML = '';
        var stlMount = document.createElement('div');
        stlMount.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        document.body.appendChild(stlMount);
        buildStlViewer(stlMount, response.base64);
      } else if (response.fileType === 'step' || response.fileType === 'iges') {
        // STEP/IGES: tessellate in the sandboxed page (occt uses new Function(),
        // forbidden in the SW), then render the mesh here with WebGL.
        console.log('[Agile PLM Ext CS] Rendering CAD (' + response.fileType + ')');
        document.head.innerHTML = '<style>html,body{margin:0;padding:0;height:100%;background:#eef2f6;overflow:hidden;}</style>';
        document.body.style.cssText = 'margin:0;padding:0;height:100%;';
        document.body.innerHTML = '';
        var cadMount = document.createElement('div');
        cadMount.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        document.body.appendChild(cadMount);
        cadMount.innerHTML = '<div style="padding:40px;font-family:\'Segoe UI\',sans-serif;font-size:14px;color:#666;">Tessellating 3D model\u2026</div>';
        var fmtLabel = response.fileType === 'iges' ? 'IGES' : 'STEP';
        tessellateViaSandbox(response.base64, response.fileType).then(function (geo) {
          renderTriangleGeometry(cadMount, geo, fmtLabel + ' \u00B7 ' + geo.count.toLocaleString() + ' triangles');
        }).catch(function (err) {
          cadMount.innerHTML = '<div style="padding:40px;font-family:\'Segoe UI\',sans-serif;font-size:14px;color:#b00;">' +
            'Could not render the ' + fmtLabel + ' file: ' + (err && err.message ? err.message : err) + '</div>';
        });
      } else if (response.fileType === 'gbx') {
        // Gerber (RS-274X): render an interactive 2D view on a canvas
        console.log('[Agile PLM Ext CS] Rendering Gerber');
        document.head.innerHTML = '<style>html,body{margin:0;padding:0;height:100%;background:#0d1117;overflow:hidden;}</style>';
        document.body.style.cssText = 'margin:0;padding:0;height:100%;';
        document.body.innerHTML = '';
        var gbxMount = document.createElement('div');
        gbxMount.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        document.body.appendChild(gbxMount);
        buildGerberViewer(gbxMount, response.text || '');
      } else if (response.fileType === 'image') {
        // Image: render as centered <img> using blob URL
        console.log('[Agile PLM Ext CS] Rendering image');
        var binaryStr = atob(response.base64);
        var bytes = new Uint8Array(binaryStr.length);
        for (var i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        var blob = new Blob([bytes], { type: response.mime });
        var blobUrl = URL.createObjectURL(blob);
        // Replace page content using DOM manipulation (avoids document.write security issue)
        document.head.innerHTML = '<style>body{margin:0;padding:20px;display:flex;justify-content:center;align-items:flex-start;min-height:100%;background:#f5f5f5;}img{max-width:100%;height:auto;box-shadow:0 2px 8px rgba(0,0,0,0.15);}</style>';
        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;padding:20px;display:flex;justify-content:center;align-items:flex-start;min-height:100%;background:#f5f5f5;';
        var img = document.createElement('img');
        img.src = blobUrl;
        img.style.cssText = 'max-width:100%;height:auto;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
        document.body.appendChild(img);
      } else if (response.fileType === 'xml') {
        // XML: render with syntax coloring and indentation
        console.log('[Agile PLM Ext CS] Rendering XML, length:', response.text.length);
        // Build the page via DOM manipulation (avoids document.write security issue)
        document.head.innerHTML = '<style>' +
          'body{margin:0;padding:40px 60px;font-family:"Consolas","Courier New",monospace;font-size:13px;line-height:1.5;color:#222;white-space:pre-wrap;word-wrap:break-word;}' +
          '.tag{color:#800000;}.attr{color:#ff0000;}.val{color:#0000ff;}.text{color:#333;}.comment{color:#008000;font-style:italic;}' +
          '</style>';
        document.body.innerHTML = '<pre id="xml-content"></pre>';
        // Syntax-highlight the XML
        var escaped = response.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="tag">$2</span>')
          .replace(/([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g, '<span class="attr">$1</span>$2<span class="val">$3</span>')
          .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="comment">$1</span>');
        document.getElementById('xml-content').innerHTML = escaped;
      } else {
        // PDF: navigate to blob URL (requires "Open in Firefox" for PDF in Firefox settings)
        console.log('[Agile PLM Ext CS] Rendering PDF, size:', response.size, 'bytes');
        var binaryStr = atob(response.base64);
        var bytes = new Uint8Array(binaryStr.length);
        for (var i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        var blob = new Blob([bytes], { type: 'application/pdf' });
        var blobUrl = URL.createObjectURL(blob);

        console.log('[Agile PLM Ext CS] Navigating iframe to blob URL:', blobUrl);
        window.location.href = blobUrl;
      }
    }).catch(function (err) {
      console.error('[Agile PLM Ext CS] Message error:', err);
      document.body.innerHTML = '<div style="padding:40px;color:red;font-size:14px;text-align:center;">Extension error: ' + err.message + '</div>';
    });
  }

  // Set up listener for the MAIN-world hook's intercepted form data.
  // page-iframe-hooks.js sends detail as a JSON string (cross-world safe).
  document.addEventListener('__agile_preview_form_intercepted', function (e) {
    var detail;
    try { detail = JSON.parse(e.detail); } catch (_) { return; }
    clearPendingIntercept();
    handleInterceptDetail(detail);
  });

  // Edge can dispatch the MAIN-world event before the isolated-world listener is
  // ready, so also consume any payload persisted on the DOM.
  var pendingInterceptJson = readPendingIntercept();
  if (pendingInterceptJson) {
    console.log('[Agile PLM Ext CS] Found persisted intercepted form payload on DOM.');
    clearPendingIntercept();
    try {
      handleInterceptDetail(JSON.parse(pendingInterceptJson));
    } catch (err) {
      console.error('[Agile PLM Ext CS] Failed to parse persisted intercept payload:', err);
    }
  }

  // The IFS form interception runs in the MAIN world (page-iframe-hooks.js),
  // because Chrome's page CSP blocks inline-script injection. That hook
  // dispatches '__agile_preview_form_intercepted', handled by the listener above.
})();
