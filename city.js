/* =========================================================
   city.js — hero drawing: one house grows into a city.

   Decorative only (the .city host is aria-hidden). Delete this file, its
   <script>, and the .city element to get a plain hero back — nothing else
   depends on it.

   The story is the growth order, not randomness:
   - The first house (accent colour) is drafted alone, close up.
   - Development spreads outward from it street by street — build order is
     Manhattan distance along the grid, the way a city actually grows.
   - Zoning follows distance to a downtown core: houses → low blocks →
     mid-rises → towers with setbacks. Every building rises floor by floor.
   - The camera pulls back as it grows, revealing scale.

   Performance model:
   - Procedural + deterministic (seeded PRNG): no image assets.
   - Canvas 2D, one shot: builds for ~5.5s, then STOPS. Zero CPU at idle.
   - Lines batch into five Path2D strokes by depth band — not one draw
     call per building.
   - The camera only moves while the city is still small. Once it settles,
     finished buildings are rasterised once into an offscreen cache and
     each frame redraws only buildings still rising. The cache is freed
     when the build ends.
   - Floor lines are level-of-detail culled so they never sit closer than
     ~5 device px: distant towers don't become moiré or thousands of
     sub-pixel strokes.
   - Pauses while the hero is off-screen. Renders the final frame at once
     under prefers-reduced-motion. Redraws once on resize / theme change.
   ========================================================= */
(function () {
  'use strict';

  var host = document.querySelector('.city');
  if (!host || typeof Path2D === 'undefined') return;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  host.appendChild(canvas);

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var sparse = window.innerWidth < 700;   // fewer buildings on phones

  /* ---------- deterministic PRNG (mulberry32) ---------- */
  var seed = 20260916;
  function rand() {
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(v) { v = 1 - v; return 1 - v * v * v; }
  function easeInOut(v) { return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; }

  /* ---------- fixed camera orientation: three-quarter aerial ---------- */
  var YAW = -0.62, PITCH = 0.34, NEAR = 0.6;
  var fx = Math.sin(YAW) * Math.cos(PITCH), fy = -Math.sin(PITCH), fz = Math.cos(YAW) * Math.cos(PITCH);
  var rx = Math.cos(YAW), rz = -Math.sin(YAW);          // right (horizontal)
  var ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx; // up = forward × right
  var fhx = Math.sin(YAW), fhz = Math.cos(YAW);         // forward along the ground

  /* ---------- the plan ---------- */
  var FLOOR = 3.3, BLOCK = 30, LOT = 6, STREET = 3.8;
  var HX = LOT, HZ = -LOT;                              // the first house's lot
  // downtown core sits to the camera's right, so growth reads left → right on screen
  var CX = HX + fhx * 55 + rx * 120, CZ = HZ + fhz * 55 + rz * 120;
  var AXX = CX - HX, AXZ = CZ - HZ, AXL = Math.sqrt(AXX * AXX + AXZ * AXZ);
  var X_MIN = -135, X_MAX = 195, Z_MIN = -105, Z_MAX = 225;

  var HERO = { x: HX, z: HZ, w: 3.6, d: 3.0, wall: 4.2, rise: 3.0, t0: 0.15, dur: 1.15 };
  var RIPPLE_START = 1.35, RIPPLE = 0.0085;  // s, s per grid unit of Manhattan distance
  var CAM_HOLD = 0.9;                        // camera holds on the house before pulling back
  var list = [], maxMan = 0;

  for (var bi = -4; bi <= 6; bi++) {
    for (var bj = -3; bj <= 7; bj++) {
      for (var sa = -1; sa <= 1; sa += 2) {
        for (var sc = -1; sc <= 1; sc += 2) {
          var x = bi * BLOCK + sa * LOT, z = bj * BLOCK + sc * LOT;
          var r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand(), r5 = rand();
          if (x === HX && z === HZ) continue;
          var dx = x - HX, dz = z - HZ;
          var along = dx * fhx + dz * fhz;
          if (along < -9) continue;                     // nothing between camera and house
          if (dx * rx + dz * rz < -26) continue;         // the house is the city's left edge
          var dHouse = Math.sqrt(dx * dx + dz * dz);
          var dCore = Math.sqrt((x - CX) * (x - CX) + (z - CZ) * (z - CZ));
          var lateral = Math.abs(dx * AXZ - dz * AXX) / AXL;
          if (dHouse > 70 && dCore > 88 && lateral > 58) continue; // keep the plan elongated
          if (dHouse > 18 && r1 < 0.09) continue;                   // plazas and parks
          if (sparse && dHouse > 40 && r1 < 0.36) continue;

          var zone = dCore + (r2 - 0.5) * 20;
          var b = { x: x, z: z };
          if (zone < 42) {                       // towers
            b.type = 3;
            b.floors = Math.max(16, Math.min(46, Math.round(44 - zone * 0.6 + (r3 - 0.5) * 12)));
            b.w = 4.0 + r4 * 1.2; b.d = 4.0 + r5 * 1.2;
            // setbacks: [scale, fromFraction, toFraction] per tier
            b.tiers = b.floors > 30 ? [1, 0, 0.56, 0.76, 0.56, 0.84, 0.5, 0.84, 1]
              : b.floors > 20 ? [1, 0, 0.7, 0.7, 0.7, 1] : [1, 0, 1];
          } else if (zone < 84) {                // mid-rises
            b.type = 2;
            b.floors = Math.max(4, Math.min(13, Math.round(13 - (zone - 42) * 0.2 + (r3 - 0.5) * 4)));
            b.w = 4.3 + r4 * 1.0; b.d = 4.3 + r5 * 1.0;
            b.pent = r3 > 0.55;
          } else if (zone < 104 && r3 < 0.5) {   // low blocks
            b.type = 1;
            b.floors = r4 < 0.4 ? 3 : 2;
            b.w = 3.8 + r5 * 1.2; b.d = 3.4 + r4 * 1.2;
          } else {                               // houses
            b.type = 0;
            b.wall = 3.4 + r4 * 0.9; b.rise = 2.0 + r5 * 0.9;
            b.w = 2.7 + r3 * 1.0; b.d = 2.5 + r5 * 0.8;
            b.ridgeX = r2 < 0.5;
          }
          b.h = b.type === 0 ? b.wall + b.rise : b.floors * FLOOR;
          b.ant = b.type === 3 && b.floors > 38 ? b.h * 0.13 : 0;
          var man = Math.abs(dx) + Math.abs(dz);
          if (man > maxMan) maxMan = man;
          b.t0 = RIPPLE_START + man * RIPPLE + r4 * 0.2;   // neighbours wait for the first house
          b.dur = [0.5, 0.55, 0.65, 0.8][b.type] + (b.type === 3 ? b.floors * 0.005 : 0);
          b.band = along < 30 ? 0 : along < 60 ? 1 : along < 95 ? 2 : 3;       // aerial perspective
          list.push(b);
        }
      }
    }
  }
  var N = list.length, T_END = HERO.t0 + HERO.dur, CAM_DUR = 3.2;
  for (var li = 0; li < N; li++) T_END = Math.max(T_END, list[li].t0 + list[li].dur);
  T_END += 0.05;

  /* ---------- camera + projection ---------- */
  var cw = 0, ch = 0, dpr = 1, ox = 0, oy = 0, F = 1, OX0 = 0, OY0 = 0, OX1 = 0, OY1 = 0;
  var fitL = 0, fitR = 0, fitT = 0, fitB = 0;
  var camX = 0, camY = 0, camZ = 0;
  var D0 = 34, D1 = 300;
  var T0X = HX, T0Y = 3.2, T0Z = HZ;
  var T1X = HX + AXX * 0.5, T1Y = 14, T1Z = HZ + AXZ * 0.5;

  function setCamera(e) {
    var D = D0 * Math.pow(D1 / D0, e);          // exponential dolly = even perceived zoom
    ox = OX0 + (OX1 - OX0) * e;
    oy = OY0 + (OY1 - OY0) * e;
    camX = T0X + (T1X - T0X) * e - fx * D;
    camY = T0Y + (T1Y - T0Y) * e - fy * D;
    camZ = T0Z + (T1Z - T0Z) * e - fz * D;
  }

  var px = 0, py = 0, pz = 0;
  function proj(x, y, z) {
    var vx = x - camX, vy = y - camY, vz = z - camZ;
    pz = vx * fx + vy * fy + vz * fz;
    if (pz > NEAR) {
      px = ox + F * (vx * rx + vz * rz) / pz;
      py = oy - F * (vx * ux + vy * uy + vz * uz) / pz;
    }
  }

  // Segment with near-plane clipping, appended to a Path2D.
  function seg(p, x1, y1, z1, x2, y2, z2) {
    var ax = x1 - camX, ay = y1 - camY, az = z1 - camZ;
    var bx = x2 - camX, by = y2 - camY, bz = z2 - camZ;
    var axc = ax * rx + az * rz, ayc = ax * ux + ay * uy + az * uz, azc = ax * fx + ay * fy + az * fz;
    var bxc = bx * rx + bz * rz, byc = bx * ux + by * uy + bz * uz, bzc = bx * fx + by * fy + bz * fz;
    if (azc < NEAR) {
      if (bzc < NEAR) return;
      var k = (NEAR - azc) / (bzc - azc);
      axc += (bxc - axc) * k; ayc += (byc - ayc) * k; azc = NEAR;
    } else if (bzc < NEAR) {
      var k2 = (NEAR - bzc) / (azc - bzc);
      bxc += (axc - bxc) * k2; byc += (ayc - byc) * k2; bzc = NEAR;
    }
    p.moveTo(ox + F * axc / azc, oy - F * ayc / azc);
    p.lineTo(ox + F * bxc / bzc, oy - F * byc / bzc);
  }

  // Largest camera distance at which the finished city still fits the frame.
  function fits(D) {
    var cx = T1X - fx * D, cy = T1Y - fy * D, cz = T1Z - fz * D;
    for (var i = -1; i < N; i++) {
      var b = i < 0 ? HERO : list[i];
      var top = i < 0 ? HERO.wall + HERO.rise + 1 : b.h + b.ant;
      for (var k = 0; k < 8; k++) {
        var vx = b.x + (k & 1 ? b.w : -b.w) - cx, vy = (k & 4 ? top : 0) - cy;
        var vz = b.z + (k & 2 ? b.d : -b.d) - cz;
        var zc = vx * fx + vy * fy + vz * fz;
        if (zc < NEAR) return false;
        var sx = ox + F * (vx * rx + vz * rz) / zc, sy = oy - F * (vx * ux + vy * uy + vz * uz) / zc;
        if (sx < fitL || sx > fitR || sy < fitT || sy > fitB) return false;
      }
    }
    return true;
  }

  function layout() {
    var wide = cw / ch > 1.05;
    F = Math.min(cw, ch) * 1.15;          // short side: a tall phone canvas mustn't blow the house up
    if (wide) {
      // desktop: open under the portrait, grow rightward; skyline may bleed off the top
      OX0 = cw * 0.47; OY0 = ch * 0.75;
      OX1 = cw * 0.66; OY1 = ch * 0.8;
      fitL = cw * 0.3; fitR = cw * 1.1; fitT = ch * -0.45; fitB = ch * 0.985;
    } else {
      // phone: the empty space is top-right, beside the portrait and above the text
      OX0 = cw * 0.74; OY0 = ch * 0.2;
      OX1 = cw * 0.72; OY1 = ch * 0.245;
      fitL = cw * 0.42; fitR = cw * 1.08; fitT = ch * -0.05; fitB = ch * 0.3;
    }
    ox = OX1; oy = OY1;
    var lo = 40, hi = 1400;
    if (!fits(hi)) { D1 = hi; return; }
    for (var it = 0; it < 22; it++) { var mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    D1 = hi;
  }

  /* ---------- geometry emitters ---------- */
  function ring(p, x0, z0, x1, z1, y) {
    seg(p, x0, y, z0, x1, y, z0); seg(p, x1, y, z0, x1, y, z1);
    seg(p, x1, y, z1, x0, y, z1); seg(p, x0, y, z1, x0, y, z0);
  }
  function box(p, x0, z0, x1, z1, y0, y1) {
    ring(p, x0, z0, x1, z1, y0); ring(p, x0, z0, x1, z1, y1);
    seg(p, x0, y0, z0, x0, y1, z0); seg(p, x1, y0, z0, x1, y1, z0);
    seg(p, x1, y0, z1, x1, y1, z1); seg(p, x0, y0, z1, x0, y1, z1);
  }

  var MIN_SPACING = 5; // device px between drawn floor lines
  function floors(p, bx, bz, x0, z0, x1, z1, y0, y1) {
    proj(bx, y0, bz); var a = pz > NEAR ? py : NaN;
    proj(bx, y0 + FLOOR, bz); var sp = pz > NEAR ? a - py : NaN;
    var step = sp > 0 && sp < MIN_SPACING ? Math.ceil(MIN_SPACING / sp) : 1;
    for (var k = Math.floor(y0 / FLOOR + 1e-6) + 1; k * FLOOR < y1 - 1e-3; k++) {
      if (k % step === 0) ring(p, x0, z0, x1, z1, k * FLOOR);
    }
  }

  function mullions(p, x0, z0, x1, z1, y0, y1) {
    proj(x0, y0, z0); var sx = px, ok = pz > NEAR;
    proj(x1, y0, z0);
    if (!ok || !(pz > NEAR) || Math.abs(px - sx) < 70) return;
    for (var q = 1; q <= 2; q++) {
      var mx = x0 + (x1 - x0) * q / 3, mz = z0 + (z1 - z0) * q / 3;
      seg(p, mx, y0, z0, mx, y1, z0); seg(p, mx, y0, z1, mx, y1, z1);
      seg(p, x0, y0, mz, x0, y1, mz); seg(p, x1, y0, mz, x1, y1, mz);
    }
  }

  function emitHouse(p, b, g) {
    var x0 = b.x - b.w, x1 = b.x + b.w, z0 = b.z - b.d, z1 = b.z + b.d;
    var hw = b.wall * easeOut(clamp01(g / 0.7));
    if (hw < 0.05) { ring(p, x0, z0, x1, z1, 0); return; }
    box(p, x0, z0, x1, z1, 0, hw);
    var e2 = easeOut(clamp01((g - 0.7) / 0.3));
    if (e2 <= 0) return;
    var rt = hw + b.rise * e2;
    if (b.ridgeX) {
      seg(p, x0, rt, b.z, x1, rt, b.z);
      seg(p, x0, hw, z0, x0, rt, b.z); seg(p, x0, hw, z1, x0, rt, b.z);
      seg(p, x1, hw, z0, x1, rt, b.z); seg(p, x1, hw, z1, x1, rt, b.z);
    } else {
      seg(p, b.x, rt, z0, b.x, rt, z1);
      seg(p, x0, hw, z0, b.x, rt, z0); seg(p, x1, hw, z0, b.x, rt, z0);
      seg(p, x0, hw, z1, b.x, rt, z1); seg(p, x1, hw, z1, b.x, rt, z1);
    }
  }

  function emit(p, b, g) {
    if (b.type === 0) { emitHouse(p, b, g); return; }
    var H = b.h * easeOut(g);
    if (H < 0.05) { ring(p, b.x - b.w, b.z - b.d, b.x + b.w, b.z + b.d, 0); return; }
    if (b.type === 3) {
      var tr = b.tiers;
      for (var i = 0; i < tr.length; i += 3) {
        var y0 = tr[i + 1] * b.h;
        if (H <= y0) break;
        var y1 = Math.min(tr[i + 2] * b.h, H), s = tr[i];
        var x0 = b.x - b.w * s, x1 = b.x + b.w * s, z0 = b.z - b.d * s, z1 = b.z + b.d * s;
        box(p, x0, z0, x1, z1, y0, y1);
        floors(p, b.x, b.z, x0, z0, x1, z1, y0, y1);
        mullions(p, x0, z0, x1, z1, y0, y1);
      }
      if (b.ant && g >= 1) seg(p, b.x, b.h, b.z, b.x, b.h + b.ant, b.z);
      return;
    }
    var bx0 = b.x - b.w, bx1 = b.x + b.w, bz0 = b.z - b.d, bz1 = b.z + b.d;
    box(p, bx0, bz0, bx1, bz1, 0, H);
    floors(p, b.x, b.z, bx0, bz0, bx1, bz1, 0, H);
    if (b.pent && g >= 1) {
      var pw = b.w * 0.42, pd = b.d * 0.42;
      box(p, b.x - pw, b.z - pd, b.x + pw, b.z + pd, b.h, b.h + FLOOR * 1.1);
    }
  }

  // Street edges, revealed in a diamond that tracks the build front.
  function emitGrid(p) {
    var R = done ? maxMan + 45 : Math.min(maxMan + 45, (t - RIPPLE_START + 0.25) / RIPPLE + 12);
    if (!(R > 0)) return;
    var s, half;
    for (var i = -5; i <= 6; i++) {
      for (s = -1; s <= 1; s += 2) {
        var X = (i + 0.5) * BLOCK + s * STREET;
        half = R - Math.abs(X - HX);
        if (half <= 0) continue;
        var za = Math.max(Z_MIN, HZ - half), zb = Math.min(Z_MAX, HZ + half);
        if (zb > za) seg(p, X, 0, za, X, 0, zb);
      }
    }
    for (var j = -4; j <= 7; j++) {
      for (s = -1; s <= 1; s += 2) {
        var Z = (j + 0.5) * BLOCK + s * STREET;
        half = R - Math.abs(Z - HZ);
        if (half <= 0) continue;
        var xa = Math.max(X_MIN, HX - half), xb = Math.min(X_MAX, HX + half);
        if (xb > xa) seg(p, xa, 0, Z, xb, 0, Z);
      }
    }
  }

  /* ---------- the first house: hidden-line, accent colour ---------- */
  var fills = [];
  function face(edges, nx, ny, nz, pts) {
    var n = pts.length / 3, mx = 0, my = 0, mz = 0, i;
    for (i = 0; i < pts.length; i += 3) { mx += pts[i]; my += pts[i + 1]; mz += pts[i + 2]; }
    mx /= n; my /= n; mz /= n;
    if (nx * (mx - camX) + ny * (my - camY) + nz * (mz - camZ) >= 0) return false; // back face
    var poly = new Path2D(), ok = true;
    for (i = 0; i < pts.length; i += 3) {
      proj(pts[i], pts[i + 1], pts[i + 2]);
      if (!(pz > NEAR)) { ok = false; break; }
      if (i) poly.lineTo(px, py); else poly.moveTo(px, py);
    }
    if (ok) { poly.closePath(); fills.push(poly); }
    for (i = 0; i < pts.length; i += 3) {
      var j = (i + 3) % pts.length;
      seg(edges, pts[i], pts[i + 1], pts[i + 2], pts[j], pts[j + 1], pts[j + 2]);
    }
    return true;
  }

  function drawHero(c, g) {
    var h = HERO, edges = new Path2D();
    var x0 = h.x - h.w, x1 = h.x + h.w, z0 = h.z - h.d, z1 = h.z + h.d;
    var hw = h.wall * easeOut(clamp01(g / 0.62));
    var rise = h.rise * easeOut(clamp01((g - 0.62) / 0.28)), rt = hw + rise;
    c.globalAlpha = 1;
    c.lineWidth = LW_HERO;
    c.strokeStyle = accent;
    if (hw < 0.05) { ring(edges, x0, z0, x1, z1, 0); c.stroke(edges); return; }
    fills.length = 0;
    var front = face(edges, 0, 0, -1, [x0, 0, z0, x1, 0, z0, x1, hw, z0, x0, hw, z0]);
    face(edges, 0, 0, 1, [x1, 0, z1, x0, 0, z1, x0, hw, z1, x1, hw, z1]);
    var side = face(edges, 1, 0, 0, rise > 0
      ? [x1, 0, z0, x1, 0, z1, x1, hw, z1, x1, rt, h.z, x1, hw, z0]
      : [x1, 0, z0, x1, 0, z1, x1, hw, z1, x1, hw, z0]);
    face(edges, -1, 0, 0, rise > 0
      ? [x0, 0, z1, x0, 0, z0, x0, hw, z0, x0, rt, h.z, x0, hw, z1]
      : [x0, 0, z1, x0, 0, z0, x0, hw, z0, x0, hw, z1]);
    if (rise > 0) {
      face(edges, 0, h.d, -rise, [x0, hw, z0, x1, hw, z0, x1, rt, h.z, x0, rt, h.z]);
      face(edges, 0, h.d, rise, [x1, hw, z1, x0, hw, z1, x0, rt, h.z, x1, rt, h.z]);
    } else {
      face(edges, 0, 1, 0, [x0, hw, z0, x1, hw, z0, x1, hw, z1, x0, hw, z1]);
    }
    if (hw >= 3.0) {
      if (front) {
        seg(edges, h.x - 0.55, 0, z0, h.x - 0.55, 2.2, z0);            // door
        seg(edges, h.x - 0.55, 2.2, z0, h.x + 0.55, 2.2, z0);
        seg(edges, h.x + 0.55, 2.2, z0, h.x + 0.55, 0, z0);
        for (var wi = -1; wi <= 1; wi += 2) {                          // windows
          var wx = h.x + wi * 2.2;
          seg(edges, wx - 0.55, 1.3, z0, wx + 0.55, 1.3, z0); seg(edges, wx + 0.55, 1.3, z0, wx + 0.55, 2.7, z0);
          seg(edges, wx + 0.55, 2.7, z0, wx - 0.55, 2.7, z0); seg(edges, wx - 0.55, 2.7, z0, wx - 0.55, 1.3, z0);
          seg(edges, wx, 1.3, z0, wx, 2.7, z0);
        }
      }
      if (side) {
        seg(edges, x1, 1.3, h.z - 0.7, x1, 1.3, h.z + 0.7); seg(edges, x1, 1.3, h.z + 0.7, x1, 2.7, h.z + 0.7);
        seg(edges, x1, 2.7, h.z + 0.7, x1, 2.7, h.z - 0.7); seg(edges, x1, 2.7, h.z - 0.7, x1, 1.3, h.z - 0.7);
      }
    }
    var e3 = clamp01((g - 0.9) / 0.1);
    if (e3 > 0 && rise > 0) {                                          // chimney, on the front slope
      var chx = h.x + 1.9, chz = h.z - 1.0, s = 0.34;
      var cb = hw + rise * (1 - 1.0 / h.d) - 0.2, ct = cb + (rt + 0.85 - cb) * e3;
      face(edges, 0, 0, -1, [chx - s, cb, chz - s, chx + s, cb, chz - s, chx + s, ct, chz - s, chx - s, ct, chz - s]);
      face(edges, 1, 0, 0, [chx + s, cb, chz - s, chx + s, cb, chz + s, chx + s, ct, chz + s, chx + s, ct, chz - s]);
      face(edges, 0, 1, 0, [chx - s, ct, chz - s, chx + s, ct, chz - s, chx + s, ct, chz + s, chx - s, ct, chz + s]);
    }
    c.fillStyle = bg;
    for (var fi = 0; fi < fills.length; fi++) c.fill(fills[fi]);
    c.stroke(edges);
  }

  /* ---------- colour ---------- */
  var ink = '#1a1a1a', bg = '#fafafa', accent = '#1f5d4e';
  var ALPHA = [0.46, 0.34, 0.24, 0.16, 0.1], LW = 1, LW_HERO = 1.5;
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ink = cs.getPropertyValue('--text').trim() || ink;
    bg = cs.getPropertyValue('--bg').trim() || bg;
    accent = cs.getPropertyValue('--accent').trim() || accent;
    ALPHA = document.documentElement.dataset.theme === 'dark'
      ? [0.5, 0.36, 0.26, 0.17, 0.11] : [0.46, 0.34, 0.24, 0.16, 0.1];
  }

  function bands() { return [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()]; }
  function strokeBands(c, p) {
    c.lineWidth = LW;
    c.strokeStyle = ink;
    for (var i = 0; i < 5; i++) { c.globalAlpha = ALPHA[i]; c.stroke(p[i]); }
    c.globalAlpha = 1;
  }

  /* ---------- animation ---------- */
  var t = 0, last = 0, raf = 0, running = false, done = false, visible = true;
  var cache = null, cctx = null, cacheOk = false, baked = new Uint8Array(N);

  function grow(b) { return clamp01((t - b.t0) / b.dur); }

  // Rasterise newly finished buildings into the cache (camera is settled).
  function bake() {
    if (!cache) { cache = document.createElement('canvas'); cctx = cache.getContext('2d'); }
    if (!cacheOk) { cache.width = cw; cache.height = ch; baked.fill(0); cacheOk = true; }
    var p = null;
    for (var i = 0; i < N; i++) {
      if (baked[i] || grow(list[i]) < 1) continue;
      if (!p) p = bands();
      emit(p[list[i].band], list[i], 1);
      baked[i] = 1;
    }
    if (p) strokeBands(cctx, p);
  }

  function frame(ts) {
    raf = 0;
    if (last) t += Math.min(ts - last, 50) / 1000;  // clamp: a backgrounded tab resumes, not jumps
    last = ts;
    if (t >= T_END) { finish(); return; }
    var settled = t >= CAM_DUR, p, i, g;
    setCamera(settled ? 1 : easeInOut(clamp01((t - CAM_HOLD) / (CAM_DUR - CAM_HOLD))));
    ctx.clearRect(0, 0, cw, ch);
    if (settled) { bake(); ctx.drawImage(cache, 0, 0); }
    p = bands();
    emitGrid(p[4]);
    for (i = 0; i < N; i++) {
      if (settled && baked[i]) continue;
      g = grow(list[i]);
      if (g > 0) emit(p[list[i].band], list[i], g);
    }
    strokeBands(ctx, p);
    drawHero(ctx, grow(HERO));
    raf = requestAnimationFrame(frame);
  }

  function renderFinal() {
    if (!cw || !ch) return;
    setCamera(1);
    ctx.clearRect(0, 0, cw, ch);
    var p = bands();
    emitGrid(p[4]);
    for (var i = 0; i < N; i++) emit(p[list[i].band], list[i], 1);
    strokeBands(ctx, p);
    drawHero(ctx, 1);
  }

  function finish() {
    done = true; running = false; t = T_END;
    renderFinal();
    if (cache) { cache.width = cache.height = 0; cache = cctx = null; } // free the offscreen bitmap
  }

  function start() {
    if (done || running || !visible || !cw) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; running = false;
  }

  function resize() {
    var r = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (!w || !h || (w === cw && h === ch)) return;
    cw = canvas.width = w;
    ch = canvas.height = h;
    LW = 1;
    LW_HERO = Math.max(1.4, dpr * 1.05);
    layout();
    cacheOk = false;
    if (done) renderFinal();
  }

  /* ---------- boot ---------- */
  readColors();
  resize();
  if (reduceMotion) { done = true; renderFinal(); } else start();

  if ('ResizeObserver' in window) {
    var pending = 0;
    new ResizeObserver(function () {
      if (!pending) pending = requestAnimationFrame(function () { pending = 0; resize(); start(); });
    }).observe(host);
  } else {
    window.addEventListener('resize', resize, { passive: true });
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) start(); else stop();
    }).observe(host);
  }

  new MutationObserver(function () {
    readColors();
    cacheOk = false;
    if (done) renderFinal();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
