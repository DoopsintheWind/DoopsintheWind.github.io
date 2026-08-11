/* ---------------------------------------------------------------
   Plate I, live.

   The engraved streamline plate in the markup is a fallback. On load
   this script pulls the surface wind actually over the steppe from
   Open-Meteo (no key, CORS open), retraces the streamline field
   through it, sets the Astana barb from the station reading, and
   drifts particles along the field on a canvas laid over the plate.

   If the fetch fails, if the browser is old, or if the reader asked
   for reduced motion, the engraved plate stays exactly as it is.
   --------------------------------------------------------------- */
(function () {
  'use strict';

  var GRID = { lat0: 48.5, lat1: 53.5, lon0: 66, lon1: 77, nx: 10, ny: 6 };
  var STATION = { lat: 51.17, lon: 71.45 };
  var KT = 1.94384;          /* m/s to knots */
  var VMAX = 30;             /* top of the speed ramp, knots */
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                     'August', 'September', 'October', 'November', 'December'];
  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  /* the eight stops of the plate's speed ramp, as authored in the SVG */
  var RAMP = [[0, 51, 101, 127], [0.14, 26, 130, 137], [0.29, 41, 150, 116],
              [0.43, 97, 165, 77], [0.57, 195, 175, 38], [0.71, 225, 141, 48],
              [0.86, 209, 83, 85], [1, 143, 58, 134]];

  /* Each plate carries its own projection, taken from the graticule it
     was engraved with: x is linear in longitude, y linear in latitude. */
  var PLATES = [{
    q: 'svg.plate.plate-desktop', neat: [44, 26, 1330, 484],
    ax: 44, alon: 66, kx: 1330 / 11, ay: 5204.8, ky: 96.8,
    dsep: 13, step: 5, maxSteps: 190, minPts: 9, keep: 144,
    sw: 1.55, shaft: 26, blen: 10.6, bgap: 4.4, dot: 4.8,
    parts: 900, pw: 1.35, cart: 'PLATE I · SURFACE WIND', stn: [12, 9.5],
    leg: { x: 72, w: 200, fs: 9.5 }
  }, {
    q: 'svg.plate.plate-mobile', neat: [27, 13, 362, 397],
    ax: 27, alon: 68.5, kx: 362 / 6, ay: 5539.6579, ky: 397 / 3.8,
    dsep: 7, step: 4, maxSteps: 170, minPts: 8, keep: 83,
    sw: 1.25, shaft: 18, blen: 7.6, bgap: 3.2, dot: 3.6,
    parts: 380, pw: 1.15, cart: 'PLATE I · SURFACE WIND', stn: [8.5, 7],
    leg: { x: 45, w: 104, fs: 6.5 }
  }];

  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- small helpers ---------- */

  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name), k;
    for (k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }

  function rampAt(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (var i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        var a = RAMP[i - 1], b = RAMP[i];
        var f = (t - a[0]) / (b[0] - a[0]);
        return [Math.round(a[1] + (b[1] - a[1]) * f),
                Math.round(a[2] + (b[2] - a[2]) * f),
                Math.round(a[3] + (b[3] - a[3]) * f)];
      }
    }
    return [RAMP[7][1], RAMP[7][2], RAMP[7][3]];
  }

  function hex(t) {
    var c = rampAt(t);
    return '#' + ((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1);
  }

  /* deterministic shuffle, so the layout is stable between loads and
     only the weather changes */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function round(v) { return Math.round(v * 10) / 10; }

  /* ---------- the wind field ---------- */

  function buildField(rows) {
    var nx = GRID.nx, ny = GRID.ny;
    var dlon = (GRID.lon1 - GRID.lon0) / (nx - 1);
    var dlat = (GRID.lat1 - GRID.lat0) / (ny - 1);
    var U = new Float32Array(nx * ny), V = new Float32Array(nx * ny);

    for (var i = 0; i < nx * ny; i++) {
      var c = rows[i].current;
      var sp = c.wind_speed_10m, dir = c.wind_direction_10m * Math.PI / 180;
      /* meteorological direction is the bearing the wind comes FROM */
      U[i] = -sp * Math.sin(dir);          /* eastward  */
      V[i] = -sp * Math.cos(dir);          /* northward */
    }

    return function (lon, lat) {
      var fx = (lon - GRID.lon0) / dlon, fy = (lat - GRID.lat0) / dlat;
      fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx;
      fy = fy < 0 ? 0 : fy > ny - 1 ? ny - 1 : fy;
      var x0 = Math.floor(fx), y0 = Math.floor(fy);
      var x1 = x0 < nx - 1 ? x0 + 1 : x0, y1 = y0 < ny - 1 ? y0 + 1 : y0;
      var tx = fx - x0, ty = fy - y0;
      var a = y0 * nx + x0, b = y0 * nx + x1, c = y1 * nx + x0, d = y1 * nx + x1;
      var u = (U[a] * (1 - tx) + U[b] * tx) * (1 - ty) + (U[c] * (1 - tx) + U[d] * tx) * ty;
      var v = (V[a] * (1 - tx) + V[b] * tx) * (1 - ty) + (V[c] * (1 - tx) + V[d] * tx) * ty;
      return [u, v];
    };
  }

  /* ---------- streamlines ---------- */

  function tracer(p, field, dsep, minPts) {
    var n = p.neat, x0 = n[0], y0 = n[1], x1 = n[0] + n[2], y1 = n[1] + n[3];

    function vel(x, y) {
      var uv = field(p.alon + (x - p.ax) / p.kx, (p.ay - y) / p.ky);
      return [uv[0], -uv[1]];              /* north is up on the sheet */
    }

    /* spatial hash of every point already committed to a line */
    var cs = dsep, cols = Math.ceil(n[2] / cs) + 2, rows = Math.ceil(n[3] / cs) + 2;
    var bins = []; for (var i = 0; i < cols * rows; i++) bins.push([]);
    function key(x, y) {
      var c = Math.floor((x - x0) / cs) + 1, r = Math.floor((y - y0) / cs) + 1;
      c = c < 0 ? 0 : c > cols - 1 ? cols - 1 : c;
      r = r < 0 ? 0 : r > rows - 1 ? rows - 1 : r;
      return r * cols + c;
    }
    function near(x, y, d) {
      var c = Math.floor((x - x0) / cs) + 1, r = Math.floor((y - y0) / cs) + 1, dd = d * d;
      for (var rr = r - 1; rr <= r + 1; rr++) {
        if (rr < 0 || rr > rows - 1) continue;
        for (var cc = c - 1; cc <= c + 1; cc++) {
          if (cc < 0 || cc > cols - 1) continue;
          var b = bins[rr * cols + cc];
          for (var k = 0; k < b.length; k += 2) {
            var ex = b[k] - x, ey = b[k + 1] - y;
            if (ex * ex + ey * ey < dd) return true;
          }
        }
      }
      return false;
    }
    function commit(pts) {
      for (var k = 0; k < pts.length; k += 2) bins[key(pts[k], pts[k + 1])].push(pts[k], pts[k + 1]);
    }

    function walk(sx, sy, dir, stop) {
      var pts = [], cx = sx, cy = sy, i, sum = 0, cnt = 0;
      for (i = 0; i < p.maxSteps; i++) {
        var v1 = vel(cx, cy), m1 = Math.hypot(v1[0], v1[1]);
        if (m1 < 0.15) break;
        var hx = cx + dir * p.step * 0.5 * v1[0] / m1;
        var hy = cy + dir * p.step * 0.5 * v1[1] / m1;
        var v2 = vel(hx, hy), m2 = Math.hypot(v2[0], v2[1]);
        if (m2 < 0.15) break;
        var nx2 = cx + dir * p.step * v2[0] / m2;
        var ny2 = cy + dir * p.step * v2[1] / m2;
        if (nx2 < x0 || nx2 > x1 || ny2 < y0 || ny2 > y1) break;
        if (near(nx2, ny2, stop)) break;
        pts.push(nx2, ny2);
        sum += m2; cnt++;
        cx = nx2; cy = ny2;
      }
      return { pts: pts, sum: sum, cnt: cnt };
    }

    /* candidate seeds on a jittered lattice, walked in a fixed order */
    var rand = rng(20260811), seeds = [];
    var gap = dsep * 0.85;
    for (var gy = y0 + gap * 0.5; gy < y1; gy += gap)
      for (var gx = x0 + gap * 0.5; gx < x1; gx += gap)
        seeds.push([gx + (rand() - 0.5) * gap * 0.7, gy + (rand() - 0.5) * gap * 0.7]);
    for (var s = seeds.length - 1; s > 0; s--) {
      var j = Math.floor(rand() * (s + 1)), tmp = seeds[s]; seeds[s] = seeds[j]; seeds[j] = tmp;
    }

    var lines = [];
    for (var si = 0; si < seeds.length; si++) {
      var sx = seeds[si][0], sy = seeds[si][1];
      if (near(sx, sy, dsep)) continue;
      var fwd = walk(sx, sy, 1, dsep * 0.55), bwd = walk(sx, sy, -1, dsep * 0.55);
      var pts = [];
      for (var b = bwd.pts.length - 2; b >= 0; b -= 2) pts.push(bwd.pts[b], bwd.pts[b + 1]);
      pts.push(sx, sy);
      for (var f = 0; f < fwd.pts.length; f += 2) pts.push(fwd.pts[f], fwd.pts[f + 1]);
      if (pts.length / 2 < minPts) continue;
      var cnt = fwd.cnt + bwd.cnt;
      lines.push({ pts: pts, speed: cnt ? (fwd.sum + bwd.sum) / cnt : 0 });
      commit(pts);
    }
    return lines;
  }

  /* The count is part of the plate's description, so the spacing is
     adjusted to the weather until the field yields it. */
  function traceTo(p, field) {
    var d = p.dsep, lines = null, best = null, i, mp;
    for (i = 0; i < 8; i++) {
      /* a field of tight vortices cuts every line short, so late passes
         also accept shorter ones rather than leave the sheet bare */
      mp = i < 5 ? p.minPts : Math.max(4, p.minPts - 4);
      lines = tracer(p, field, d, mp);
      /* a pass that reaches the count always beats one that does not */
      if (!best || (lines.length >= p.keep) !== (best.length >= p.keep)
          ? lines.length >= p.keep
          : Math.abs(lines.length - p.keep) < Math.abs(best.length - p.keep)) best = lines;
      if (lines.length >= p.keep && lines.length <= p.keep * 1.3) break;
      d *= lines.length < p.keep ? 0.85 : 1.12;
    }
    lines = best;
    if (lines.length > p.keep) {
      lines.sort(function (a, b) { return b.pts.length - a.pts.length; });
      lines = lines.slice(0, p.keep);
    }
    return lines;
  }

  function pathOf(pts) {
    var d = 'M' + round(pts[0]) + ' ' + round(pts[1]);
    for (var i = 2; i < pts.length; i += 2) d += 'L' + round(pts[i]) + ' ' + round(pts[i + 1]);
    return d;
  }

  /* ---------- the engraved furniture: barb, cartouche, legend ---------- */

  function barbGroup(p, svg, obs) {
    var g = svg.querySelector('.p-station');
    if (!g) return;
    var cx = p.ax + (STATION.lon - p.alon) * p.kx, cy = p.ay - STATION.lat * p.ky;
    var kt = obs.speed * KT;
    var a = obs.dir * Math.PI / 180;
    var dx = Math.sin(a), dy = -Math.cos(a);        /* toward where it comes from */
    var px = -dy, py = dx;                          /* barbs to the left of the shaft */

    while (g.firstChild) g.removeChild(g.firstChild);
    g.appendChild(el('circle', { cx: round(cx), cy: round(cy), r: p.dot }));

    if (kt >= 2.5) {
      var tipx = cx + dx * (p.dot + p.shaft), tipy = cy + dy * (p.dot + p.shaft);
      g.appendChild(el('line', {
        x1: round(cx + dx * (p.dot * 0.8)), y1: round(cy + dy * (p.dot * 0.8)),
        x2: round(tipx), y2: round(tipy), 'class': 'p-barb'
      }));
      var left = Math.round(kt / 5) * 5, at = 0;
      var pen = Math.floor(left / 50); left -= pen * 50;
      var full = Math.floor(left / 10); left -= full * 10;
      var half = left >= 5 ? 1 : 0;
      var i;
      for (i = 0; i < pen; i++) {
        var b0x = tipx - dx * at, b0y = tipy - dy * at;
        var b1x = b0x - dx * p.bgap * 1.6, b1y = b0y - dy * p.bgap * 1.6;
        g.appendChild(el('path', {
          d: 'M' + round(b0x) + ' ' + round(b0y) + 'L' + round(b0x + px * p.blen) +
             ' ' + round(b0y + py * p.blen) + 'L' + round(b1x) + ' ' + round(b1y) + 'Z',
          'class': 'p-barb', style: 'fill:var(--ink)'
        }));
        at += p.bgap * 2;
      }
      for (i = 0; i < full; i++) {
        var fx = tipx - dx * at, fy = tipy - dy * at;
        g.appendChild(el('line', {
          x1: round(fx), y1: round(fy),
          x2: round(fx + px * p.blen - dx * p.blen * 0.42),
          y2: round(fy + py * p.blen - dy * p.blen * 0.42), 'class': 'p-barb'
        }));
        at += p.bgap;
      }
      if (half) {
        if (at === 0) at = p.bgap;                  /* a lone half sits off the tip */
        var hx = tipx - dx * at, hy = tipy - dy * at;
        g.appendChild(el('line', {
          x1: round(hx), y1: round(hy),
          x2: round(hx + px * p.blen * 0.5 - dx * p.blen * 0.21),
          y2: round(hy + py * p.blen * 0.5 - dy * p.blen * 0.21), 'class': 'p-barb'
        }));
      }
    } else {
      g.appendChild(el('circle', {
        cx: round(cx), cy: round(cy), r: p.dot * 1.9, fill: 'none', 'class': 'p-barb'
      }));
    }

    var t1 = el('text', { 'class': 'p-stn1', 'font-size': p.stn[0], x: round(cx + p.dot * 2.6), y: round(cy + p.dot * 0.9) });
    t1.textContent = 'ASTANA';
    var t2 = el('text', { 'class': 'p-stn2', 'font-size': p.stn[1], x: round(cx + p.dot * 2.6), y: round(cy + p.dot * 3.5) });
    t2.textContent = '51.17 N · 71.45 E';
    g.appendChild(t1); g.appendChild(t2);
  }

  function stamp(p, svg, obs) {
    var c = svg.querySelectorAll('.p-cart text');
    if (c.length === 2) {
      c[0].textContent = p.cart;
      c[1].textContent = 'ASTANA · ' + obs.day + ' ' + obs.mon + ' · ' + obs.hhmm;
    }
    /* the ramp now tops out at VMAX, so the legend has to say so */
    var leg = svg.querySelector('.p-leg'), i;
    if (leg) {
      var ticks = leg.querySelectorAll('.p-tick'), nums = leg.querySelectorAll('.p-leg-n');
      var n = Math.min(ticks.length, nums.length, VMAX / 10 + 1);
      for (i = n; i < ticks.length; i++) ticks[i].parentNode.removeChild(ticks[i]);
      for (i = n; i < nums.length; i++) nums[i].parentNode.removeChild(nums[i]);
      for (i = 0; i < n; i++) {
        var f = i / (n - 1), x = p.leg.x + p.leg.w * f;
        ticks[i].setAttribute('x1', round(x)); ticks[i].setAttribute('x2', round(x));
        nums[i].setAttribute('x', round(x));
        nums[i].textContent = String(Math.round(VMAX * f));
      }
    }
  }

  /* ---------- the moving air ---------- */

  function flow(p, svg, field) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.requestAnimationFrame) return;

    var holder = document.createElement('div');
    holder.className = 'plate-holder';
    svg.parentNode.insertBefore(holder, svg);
    holder.appendChild(svg);
    var cv = document.createElement('canvas');
    cv.className = 'plate-flow';
    cv.setAttribute('aria-hidden', 'true');
    holder.appendChild(cv);
    var ctx = cv.getContext('2d');
    if (!ctx) { holder.removeChild(cv); return; }

    var n = p.neat, vbw = svg.viewBox.baseVal.width;
    var scale = 1, dpr = 1, live = false, parts = [];
    /* px per second per m/s, matched to the plate's own scale so the
       drift reads the same on both sheets */
    var K = 7.2 * (p.kx / 120.909);

    function vel(x, y) {
      var uv = field(p.alon + (x - p.ax) / p.kx, (p.ay - y) / p.ky);
      return [uv[0], -uv[1]];
    }

    function seed(o) {
      o.x = n[0] + Math.random() * n[2];
      o.y = n[1] + Math.random() * n[3];
      o.age = Math.random() * 90;
      o.life = 90 + Math.random() * 150;
      return o;
    }
    for (var i = 0; i < p.parts; i++) parts.push(seed({}));

    function size() {
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) { live = false; return; }
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      scale = r.width / vbw;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = r.width + 'px';
      cv.style.height = r.height + 'px';
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.lineCap = 'round';
      live = true;
    }

    var last = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (!live || !vis) return;
      var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;

      ctx.save();
      ctx.beginPath(); ctx.rect(n[0], n[1], n[2], n[3]); ctx.clip();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - Math.pow(1 - 0.055, dt * 60)) + ')';
      ctx.fillRect(n[0], n[1], n[2], n[3]);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = p.pw;

      for (var i = 0; i < parts.length; i++) {
        var o = parts[i];
        var v = vel(o.x, o.y), m = Math.hypot(v[0], v[1]);
        if (m < 0.05) { seed(o); continue; }
        var nx = o.x + v[0] * K * dt, ny = o.y + v[1] * K * dt;
        o.age += dt * 60;
        if (nx < n[0] || nx > n[0] + n[2] || ny < n[1] || ny > n[1] + n[3] || o.age > o.life) {
          seed(o); continue;
        }
        var c = rampAt(m * KT / VMAX);
        var fade = Math.min(1, Math.min(o.age, o.life - o.age) / 30);
        ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (0.62 * fade).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(o.x, o.y); ctx.lineTo(nx, ny); ctx.stroke();
        o.x = nx; o.y = ny;
      }
      ctx.restore();
    }

    var vis = true;
    document.addEventListener('visibilitychange', function () { vis = !document.hidden; last = 0; });
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) {
        vis = es[0].isIntersecting && !document.hidden; last = 0;
      }, { threshold: 0 }).observe(holder);
    }
    if (window.ResizeObserver) new ResizeObserver(size).observe(svg);
    else window.addEventListener('resize', size);

    size();
    requestAnimationFrame(frame);
  }

  /* ---------- draw one plate ---------- */

  function draw(p, field, obs) {
    var svg = document.querySelector(p.q);
    if (!svg) return;
    var clip = svg.querySelector('g[clip-path]');
    if (!clip) return;
    var host = clip.querySelector('g');            /* the engraved line group */
    if (!host) return;

    var lines = traceTo(p, field);
    if (!lines || lines.length < 12) return;       /* nothing sensible to draw */

    /* clears the engraved streamlines and the old pulse paths with them:
       the drift now comes from the canvas */
    while (host.firstChild) host.removeChild(host.firstChild);

    var frag = document.createDocumentFragment(), i;
    for (i = 0; i < lines.length; i++) {
      var t = lines[i].speed * KT / VMAX;
      frag.appendChild(el('path', {
        d: pathOf(lines[i].pts), stroke: hex(t),
        'stroke-width': round(p.sw * (0.82 + 0.42 * Math.min(t, 1))),
        'stroke-opacity': (0.62 + 0.26 * Math.min(t, 1)).toFixed(2)
      }));
    }
    host.appendChild(frag);

    barbGroup(p, svg, obs);
    stamp(p, svg, obs);
    svg.setAttribute('aria-label',
      'Streamline chart of the surface wind over the Kazakh steppe at ' + obs.hhmm +
      ' local, ' + obs.day + ' ' + obs.monLong + '. Astana: wind from ' + obs.cardinal +
      ', ' + Math.round(obs.speed * KT) + ' knots.');
    flow(p, svg, field);
  }

  /* ---------- go ---------- */

  function request() {
    var la = [], lo = [], i, j;
    for (i = 0; i < GRID.ny; i++)
      for (j = 0; j < GRID.nx; j++) {
        la.push((GRID.lat0 + i * (GRID.lat1 - GRID.lat0) / (GRID.ny - 1)).toFixed(3));
        lo.push((GRID.lon0 + j * (GRID.lon1 - GRID.lon0) / (GRID.nx - 1)).toFixed(3));
      }
    la.push(STATION.lat); lo.push(STATION.lon);    /* the station itself, last */
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + la.join(',') +
           '&longitude=' + lo.join(',') +
           '&current=wind_speed_10m,wind_direction_10m' +
           '&wind_speed_unit=ms&timezone=Asia%2FAlmaty';
  }

  function observation(row) {
    var c = row.current, t = c.time.split('T');
    var d = t[0].split('-'), hhmm = t[1].slice(0, 5);
    return {
      speed: c.wind_speed_10m, dir: c.wind_direction_10m, hhmm: hhmm,
      day: String(parseInt(d[2], 10)), mon: MONTHS[parseInt(d[1], 10) - 1],
      monLong: MONTHS_LONG[parseInt(d[1], 10) - 1],
      cardinal: COMPASS[Math.round(c.wind_direction_10m / 22.5) % 16]
    };
  }

  function caption(obs) {
    var s = document.querySelector('.plate-caption span');
    if (s) {
      s.innerHTML = 'Fig. 1. Surface wind over the open steppe at ' + obs.hhmm +
        ' local, ' + obs.day + ' ' + obs.monLong + ', traced live through the model field ' +
        'and read at Astana station. Thought as a pattern of moving air, after Ted Chiang&rsquo;s <em>Exhalation</em>.';
    }
    var live = document.querySelector('.obs-live');
    if (live) {
      live.textContent = obs.cardinal + ' ' + Math.round(obs.speed * KT) + ' kt (' +
        Math.round(obs.dir) + '°, ' + obs.speed.toFixed(1) + ' m/s) at ' + obs.hhmm + ' local';
    }
  }

  function start() {
    if (!window.fetch || !document.querySelector('svg.plate')) return;
    fetch(request(), { mode: 'cors' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (rows) {
        if (!Array.isArray(rows) || rows.length !== GRID.nx * GRID.ny + 1) throw new Error('shape');
        var field = buildField(rows);
        var obs = observation(rows[rows.length - 1]);
        for (var i = 0; i < PLATES.length; i++) draw(PLATES[i], field, obs);
        caption(obs);
      })
      .catch(function () {
        var live = document.querySelector('.obs-live');
        if (live) live.textContent = 'not reachable just now';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
