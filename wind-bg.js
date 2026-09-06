/* Live surface wind over the Kazakh steppe, as a page background.
   Field, grid, speed ramp and particle drift are lifted from wind.js on
   DoopsintheWind.github.io; the engraved plate furniture is dropped and the
   canvas is fixed behind the page instead. Self-mounting: no markup needed.
   Fires a 'windobs' CustomEvent on window with the Astana station reading. */
(function () {
  'use strict';
  /* A page may set window.WINDBG before this file loads to tune how present
     the field is. Defaults are the values the KZ site was built against, so
     a page that sets nothing renders exactly as before.
       area   px of viewport per particle, lower is denser
       trail  share of the trail erased each frame, lower is longer streaks
       width  stroke width
       alpha  peak stroke alpha
       max    particle ceiling on a large screen */
  var CFG = window.WINDBG || {};
  var AREA  = CFG.area  || 620;
  var TRAIL = CFG.trail || 0.028;
  var WIDTH = CFG.width || 1.15;
  var ALPHA = CFG.alpha || 0.5;
  var MAXN  = CFG.max   || 2600;
  var SPEED = CFG.speed || 1;        /* drift multiplier, 1 = as built */
  var PENCIL = CFG.pencil || 0;      /* 0..1, how far the ramp is pulled toward graphite */
  var GRAPHITE = [58, 54, 50];
  var DENSITY = typeof CFG.density === 'number' ? CFG.density : 1;  /* share of particles drawn, 0..1 */
  /* live retune: window.WINDBG_SET({speed, pencil, alpha}) */
  window.WINDBG_SET = function (o) {
    if (!o) return;
    if (typeof o.speed === 'number') SPEED = o.speed;
    if (typeof o.pencil === 'number') PENCIL = o.pencil;
    if (typeof o.alpha === 'number') ALPHA = o.alpha;
    if (typeof o.density === 'number') DENSITY = Math.max(0, Math.min(1, o.density));
  };

  var GRID = { lat0: 46.0, lat1: 55.5, lon0: 47.0, lon1: 87.0, nx: 12, ny: 7 };
  var STATION = { lat: 51.17, lon: 71.45 };
  var KT = 1.94384, VMAX = 30;
  var MONTHS = ['January','February','March','April','May','June','July',
                'August','September','October','November','December'];
  var COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                 'S','SSW','SW','WSW','W','WNW','NW','NNW'];
  var RAMP = [[0,51,101,127],[0.14,26,130,137],[0.29,41,150,116],[0.43,97,165,77],
              [0.57,195,175,38],[0.71,225,141,48],[0.86,209,83,85],[1,143,58,134]];

  function rampAt(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (var i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        var a = RAMP[i-1], b = RAMP[i], f = (t - a[0]) / (b[0] - a[0]);
        return [Math.round(a[1]+(b[1]-a[1])*f), Math.round(a[2]+(b[2]-a[2])*f),
                Math.round(a[3]+(b[3]-a[3])*f)];
      }
    }
    return [143,58,134];
  }
  function ink(t) {
    var c = rampAt(t);
    if (!PENCIL) return c;
    return [Math.round(c[0]+(GRAPHITE[0]-c[0])*PENCIL), Math.round(c[1]+(GRAPHITE[1]-c[1])*PENCIL), Math.round(c[2]+(GRAPHITE[2]-c[2])*PENCIL)];
  }

  function buildField(rows) {
    var nx = GRID.nx, ny = GRID.ny;
    var dlon = (GRID.lon1-GRID.lon0)/(nx-1), dlat = (GRID.lat1-GRID.lat0)/(ny-1);
    var U = new Float32Array(nx*ny), V = new Float32Array(nx*ny);
    for (var i = 0; i < nx*ny; i++) {
      var c = rows[i].current;
      var sp = c.wind_speed_10m, dir = c.wind_direction_10m * Math.PI/180;
      U[i] = -sp * Math.sin(dir);
      V[i] = -sp * Math.cos(dir);
    }
    return function (lon, lat) {
      var fx = (lon-GRID.lon0)/dlon, fy = (lat-GRID.lat0)/dlat;
      fx = fx < 0 ? 0 : fx > nx-1 ? nx-1 : fx;
      fy = fy < 0 ? 0 : fy > ny-1 ? ny-1 : fy;
      var x0 = Math.floor(fx), y0 = Math.floor(fy);
      var x1 = x0 < nx-1 ? x0+1 : x0, y1 = y0 < ny-1 ? y0+1 : y0;
      var tx = fx-x0, ty = fy-y0;
      var a = y0*nx+x0, b = y0*nx+x1, c = y1*nx+x0, d = y1*nx+x1;
      return [(U[a]*(1-tx)+U[b]*tx)*(1-ty) + (U[c]*(1-tx)+U[d]*tx)*ty,
              (V[a]*(1-tx)+V[b]*tx)*(1-ty) + (V[c]*(1-tx)+V[d]*tx)*ty];
    };
  }

  function request() {
    var la = [], lo = [], i, j;
    for (i = 0; i < GRID.ny; i++)
      for (j = 0; j < GRID.nx; j++) {
        la.push((GRID.lat0 + i*(GRID.lat1-GRID.lat0)/(GRID.ny-1)).toFixed(3));
        lo.push((GRID.lon0 + j*(GRID.lon1-GRID.lon0)/(GRID.nx-1)).toFixed(3));
      }
    la.push(STATION.lat); lo.push(STATION.lon);
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + la.join(',') +
           '&longitude=' + lo.join(',') +
           '&current=wind_speed_10m,wind_direction_10m' +
           '&wind_speed_unit=ms&timezone=Asia%2FAlmaty';
  }

  function observation(row) {
    var c = row.current, t = c.time.split('T'), d = t[0].split('-');
    return {
      speed: c.wind_speed_10m, dir: c.wind_direction_10m, hhmm: t[1].slice(0,5),
      day: String(parseInt(d[2],10)), month: MONTHS[parseInt(d[1],10)-1],
      knots: Math.round(c.wind_speed_10m * KT),
      cardinal: COMPASS[Math.round(c.wind_direction_10m/22.5)%16]
    };
  }

  function mount(field) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { mount(field); }); return; }
    if (document.getElementById('wind-bg')) return;
    var cv = document.createElement('canvas');
    cv.id = 'wind-bg';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;' +
      'z-index:0;pointer-events:none;opacity:0;transition:opacity 1.4s ease';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    if (!ctx) { cv.remove(); return; }

    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = 0, H = 0, dpr = 1, parts = [], N = 0;

    function vel(x, y) {
      var lon = GRID.lon0 + (x / W) * (GRID.lon1 - GRID.lon0);
      var lat = GRID.lat1 - (y / H) * (GRID.lat1 - GRID.lat0);
      var uv = field(lon, lat);
      return [uv[0], -uv[1]];
    }
    function seed(o) {
      o.x = Math.random()*W; o.y = Math.random()*H; o.px = undefined; o.py = undefined;
      o.age = Math.random()*120; o.life = 110 + Math.random()*190;
      return o;
    }
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.imageSmoothingEnabled = true;
      N = Math.round(Math.min(MAXN, Math.max(700, W*H/AREA)));
      parts = []; for (var i = 0; i < N; i++) parts.push(seed({}));
      ctx.clearRect(0, 0, W, H);
    }

    var K = W ? 0 : 0, last = 0, vis = true;
    function frame(now) {
      requestAnimationFrame(frame);
      if (!vis || !W) return;
      var dt = last ? Math.min((now-last)/1000, 0.05) : 0.016;
      last = now;
      var scale = (W / (GRID.lon1 - GRID.lon0)) * 0.115 * SPEED;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - Math.pow(1-TRAIL, dt*60)).toFixed(4) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = WIDTH;
      var live = Math.min(parts.length, Math.max(40, Math.round(parts.length * DENSITY)));
      for (var i = 0; i < live; i++) {
        var o = parts[i], v = vel(o.x, o.y), m = Math.hypot(v[0], v[1]);
        if (m < 0.05) { seed(o); continue; }
        var nx = o.x + v[0]*scale*dt*60, ny = o.y + v[1]*scale*dt*60;
        o.age += dt*60;
        if (nx < 0 || nx > W || ny < 0 || ny > H || o.age > o.life) { seed(o); continue; }
        var c = ink(m*KT/VMAX);
        var fade = Math.min(1, Math.min(o.age, o.life-o.age)/34);
        /* pencil: pressure varies along the stroke */
        var press = PENCIL ? (0.55 + 0.45*Math.abs(Math.sin(o.age*0.21 + i))) : 1;
        ctx.lineWidth = PENCIL ? WIDTH * (0.7 + 0.6*press) : WIDTH;
        ctx.strokeStyle = 'rgba('+c[0]+','+c[1]+','+c[2]+','+(ALPHA*fade*press).toFixed(3)+')';
        /* overdraw the previous segment tail so frames join without gaps */
        ctx.beginPath(); ctx.moveTo(o.px !== undefined ? o.px : o.x, o.py !== undefined ? o.py : o.y); ctx.lineTo(o.x, o.y); ctx.lineTo(nx, ny); ctx.stroke();
        o.px = o.x; o.py = o.y; o.x = nx; o.y = ny;
      }
    }

    function still() {
      // reduced motion: one static pass of short streaks, no animation
      var scale = (W / (GRID.lon1 - GRID.lon0)) * 0.115;
      ctx.lineWidth = WIDTH - 0.05;
      for (var i = 0; i < parts.length; i++) {
        var o = parts[i], x = o.x, y = o.y;
        for (var s = 0; s < 14; s++) {
          var v = vel(x, y), m = Math.hypot(v[0], v[1]);
          if (m < 0.05) break;
          var nx = x + v[0]*scale*0.5, ny = y + v[1]*scale*0.5;
          if (nx < 0 || nx > W || ny < 0 || ny > H) break;
          var c = ink(m*KT/VMAX);
          ctx.strokeStyle = 'rgba('+c[0]+','+c[1]+','+c[2]+',0.34)';
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
          x = nx; y = ny;
        }
      }
    }

    document.addEventListener('visibilitychange', function () {
      vis = !document.hidden; last = 0;
    });
    window.addEventListener('resize', function () {
      size(); if (reduce) still();
    });
    size();
    requestAnimationFrame(function () { cv.style.opacity = '1'; });
    if (reduce) still(); else requestAnimationFrame(frame);
  }

  /* typical late-summer steppe pattern when the station is unreachable: westerly with a gentle curl */
  function fallbackField() {
    return function (lon, lat) {
      var x = (lon - GRID.lon0) / (GRID.lon1 - GRID.lon0), y = (lat - GRID.lat0) / (GRID.lat1 - GRID.lat0);
      var u = 4.5 + 2.2*Math.sin(y*6.3 + x*2.1) + 1.2*Math.cos(x*9.4);
      var v = 1.6*Math.sin(x*7.1 + y*3.3) + 0.9*Math.cos(y*11.0 + x*1.7);
      return [u, v];
    };
  }

  function start() {
    if (!window.fetch || !window.requestAnimationFrame) return;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 6000) : 0;
    fetch(request(), { mode: 'cors', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (rows) {
        if (!Array.isArray(rows) || rows.length !== GRID.nx*GRID.ny + 1) throw new Error('shape');
        var obs = observation(rows[rows.length-1]);
        window.__windobs = obs;
        window.dispatchEvent(new CustomEvent('windobs', { detail: obs }));
        mount(buildField(rows));
      })
      .catch(function (e) {
        clearTimeout(timer);
        window.__winderr = String(e && e.message || e);
        window.dispatchEvent(new CustomEvent('windobs', { detail: null }));
        mount(fallbackField());
      });
  }
  if (window.WINDBG && window.WINDBG.off) return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
