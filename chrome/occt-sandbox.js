// Sandboxed OpenCascade tessellation worker (Chrome/Edge MV3).
//
// Runs inside occt-sandbox.html, a manifest-declared sandboxed page. Sandboxed
// pages are exempt from the MV3 extension CSP, so occt-import-js's embind layer
// (which uses new Function()) is allowed here — it is NOT allowed in the service
// worker, which is why STEP/IGES tessellation lives here instead of background.js.
//
// Protocol (postMessage with the preview iframe as the other end):
//   in  : { cmd:'tessellate', id, format:'STEP'|'IGES', fileBuf:ArrayBuffer, wasmBuf:ArrayBuffer }
//   out : { id, ok:true, count, positions:Float32Array, normals:Float32Array }  (buffers transferred)
//       | { id, error:'...' }
// On load we post { occtSandboxReady:true } to the parent so it knows to send.
(function () {
  'use strict';

  var occtPromise = null;
  function getOcct(wasmBinary) {
    if (!occtPromise) {
      // wasmBinary set -> the loader instantiates straight from the buffer and
      // never fetches (sandboxed/opaque-origin fetch of the .wasm is unreliable).
      occtPromise = occtimportjs({ wasmBinary: wasmBinary });
    }
    return occtPromise;
  }

  function cadFaceNormal(a, b, c) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  // Convert occt-import-js meshes into flat (non-indexed) position + normal
  // Float32Arrays of length triCount*9, matching the WebGL viewer's expectation.
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

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || msg.cmd !== 'tessellate') return;
    var src = e.source;
    function reply(payload, transfer) {
      try { src.postMessage(payload, '*', transfer || []); } catch (err) { /* ignore */ }
    }
    Promise.resolve().then(function () {
      return getOcct(msg.wasmBuf);
    }).then(function (occt) {
      var bytes = new Uint8Array(msg.fileBuf);
      var result = (msg.format === 'IGES')
        ? occt.ReadIgesFile(bytes, null)
        : occt.ReadStepFile(bytes, null);
      if (!result || !result.success || !result.meshes || !result.meshes.length) {
        reply({ id: msg.id, error: 'Could not read the ' + (msg.format || 'CAD') + ' file (no geometry found).' });
        return;
      }
      var geo = cadMeshesToTriangles(result.meshes);
      if (!geo.count) {
        reply({ id: msg.id, error: 'The ' + (msg.format || 'CAD') + ' file produced no triangles.' });
        return;
      }
      reply({ id: msg.id, ok: true, count: geo.count, positions: geo.positions, normals: geo.normals },
        [geo.positions.buffer, geo.normals.buffer]);
    }).catch(function (err) {
      reply({ id: msg.id, error: 'CAD tessellation failed: ' + (err && err.message ? err.message : err) });
    });
  });

  try { (window.parent || window).postMessage({ occtSandboxReady: true }, '*'); } catch (e) { /* ignore */ }
})();
