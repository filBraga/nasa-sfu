// Orbital helix background: the Sun drifts toward the solar apex and every planet leaves a
// helical wake behind it (Kepler ellipse + straight drift). Vanilla-canvas port of the
// "orbital-hero-section" React component. Usage: const stop = createOrbitalHero(hostEl, opts).
// ponytail: dropped the React wrapper, showOrbits and prop hot-reload; options are read once.
(() => {
  const TAU = Math.PI * 2, RAD = Math.PI / 180;

  // Real orbital elements, J2000, referred to the ecliptic
  const SOLAR_SYSTEM = [
    { name: "Mercury", a: 0.38710, e: 0.20563, i: 7.005, node: 48.331, peri: 29.125, M0: 174.796, color: "#fff0d0", size: 2.2 },
    { name: "Venus",   a: 0.72333, e: 0.00677, i: 3.395, node: 76.680, peri: 54.853, M0: 50.115,  color: "#ffc65a", size: 3.4 },
    { name: "Earth",   a: 1.00000, e: 0.01671, i: 0.000, node: 348.739, peri: 114.208, M0: 357.517, color: "#5fd8ff", size: 3.8, glow: 1.1 },
    { name: "Mars",    a: 1.52371, e: 0.09339, i: 1.850, node: 49.558, peri: 286.483, M0: 19.373, color: "#ff4a32", size: 2.9 },
    { name: "Jupiter", a: 5.20290, e: 0.04839, i: 1.303, node: 100.464, peri: 273.867, M0: 20.020, color: "#ffa62e", size: 5.4 },
    { name: "Saturn",  a: 9.53700, e: 0.05386, i: 2.485, node: 113.665, peri: 339.392, M0: 317.020, color: "#ffd884", size: 4.8 },
    { name: "Uranus",  a: 19.1913, e: 0.04726, i: 0.773, node: 74.006, peri: 98.999, M0: 142.238, color: "#7fe6ff", size: 4.2 },
    { name: "Neptune", a: 30.0690, e: 0.00859, i: 1.770, node: 131.784, peri: 276.336, M0: 256.228, color: "#3f7dff", size: 4.4 },
  ];
  // fixed (not random) so the rosette is the same every load
  const PLANE_FAN = [[58, 35], [27, 145], [71, 250], [40, 80], [84, 190], [33, 310], [62, 120], [15, 20]];
  const ECC_FAN = [0.52, 0.34, 0.63, 0.44, 0.3, 0.58, 0.4, 0.68];

  const DEFAULTS = {
    planets: SOLAR_SYSTEM, yearSeconds: 16, trailYears: 2.6, compress: 0.42, maxTurns: 3,
    planeSpread: 1, eccentricity: 0.25, alignToCourse: 1, driftSpeed: 1.5, apex: [272, 53],
    viewRadius: 3.4, tilt: 45, spin: 252, roll: 13.5, lead: 0.12, focus: [0.5, 0.5],
    scrim: "none", scrimStrength: 0.88, starCount: 1500, glow: 1, showSunTrack: true,
    interactive: true, sunColor: "#FFF2CC",
  };

  // Kepler's equation M = E - e sin E, Newton's method
  function eccentricAnomaly(M, e) {
    let m = M % TAU;
    if (m < 0) m += TAU;
    let E = m + e * Math.sin(m) * (1 + e * Math.cos(m));
    for (let k = 0; k < 8; k++) {
      const step = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
      E -= step;
      if (Math.abs(step) < 1e-10) break;
    }
    return E;
  }

  function parseRGB(c) {
    const hex = c.trim().slice(1);
    const full = hex.length === 3 ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] : hex.slice(0, 6);
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createOrbitalHero(host, opts = {}) {
    const C = { ...DEFAULTS, ...opts };
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.prepend(canvas);
    const ctx = canvas.getContext("2d", { alpha: false });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0, height = 0, years = reduced ? 1.7 : 0, lastFrame = 0, running = true, visible = true, raf = 0;

    // ---- camera: x,y span the ecliptic, z = ecliptic north
    let pxPerAU = 1, cx = 0, cy = 0, camDist = 1;
    const RIGHT = { x: 1, y: 0, z: 0 }, UP = { x: 0, y: 1, z: 0 }, FWD = { x: 0, y: 0, z: 1 };
    function setCamera(yawDeg, pitchDeg, rollDeg) {
      const A = yawDeg * RAD, B = pitchDeg * RAD;
      const ca = Math.cos(A), sa = Math.sin(A), cb = Math.cos(B), sb = Math.sin(B);
      const rx = ca, ry = sa, rz = 0;
      const ux = -sa * cb, uy = ca * cb, uz = sb;
      FWD.x = sa * sb; FWD.y = -ca * sb; FWD.z = cb;
      const cr = Math.cos(rollDeg * RAD), sr = Math.sin(rollDeg * RAD);
      RIGHT.x = rx * cr + ux * sr; RIGHT.y = ry * cr + uy * sr; RIGHT.z = rz * cr + uz * sr;
      UP.x = -rx * sr + ux * cr; UP.y = -ry * sr + uy * cr; UP.z = -rz * sr + uz * cr;
    }
    const P = { x: 0, y: 0, depth: 0, s: 0, ok: false };
    function project(dx, dy, dz) {
      const vx = dx * RIGHT.x + dy * RIGHT.y + dz * RIGHT.z;
      const vy = dx * UP.x + dy * UP.y + dz * UP.z;
      const vz = dx * FWD.x + dy * FWD.y + dz * FWD.z;
      const depth = camDist - vz;
      if (depth < 0.6) { P.ok = false; return; }
      const s = camDist / depth;
      P.x = cx + vx * pxPerAU * s; P.y = cy - vy * pxPerAU * s; P.depth = depth; P.s = s; P.ok = true;
    }

    // ---- Sun's direction of travel
    const DIR = { x: 0, y: 0, z: 0 };
    const l = C.apex[0] * RAD, b = C.apex[1] * RAD;
    DIR.x = Math.cos(b) * Math.cos(l); DIR.y = Math.cos(b) * Math.sin(l); DIR.z = Math.sin(b);

    // rotation swinging an orbit plane's normal toward the course (Rodrigues)
    function swingToCourse(nx, ny, nz, align) {
      const s = nx * DIR.x + ny * DIR.y + nz * DIR.z >= 0 ? 1 : -1;
      let tx = nx + align * (s * DIR.x - nx), ty = ny + align * (s * DIR.y - ny), tz = nz + align * (s * DIR.z - nz);
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-9) return null;
      tx /= tl; ty /= tl; tz /= tl;
      let ax = ny * tz - nz * ty, ay = nz * tx - nx * tz, az = nx * ty - ny * tx;
      const al = Math.hypot(ax, ay, az);
      if (al < 1e-9) return null;
      ax /= al; ay /= al; az /= al;
      const c = Math.max(-1, Math.min(1, nx * tx + ny * ty + nz * tz));
      const sA = al > 1 ? 1 : al, k = 1 - c;
      return [
        c + ax * ax * k, ax * ay * k - az * sA, ax * az * k + ay * sA,
        ay * ax * k + az * sA, c + ay * ay * k, ay * az * k - ax * sA,
        az * ax * k - ay * sA, az * ay * k + ax * sA, c + az * az * k,
      ];
    }

    const elems = C.planets.map((p, idx) => {
      const aDraw = Math.pow(p.a, C.compress);
      const period = Math.pow(aDraw, 1.5); // Kepler's third law on the drawn spacing
      const fan = PLANE_FAN[idx % PLANE_FAN.length];
      const inc = (p.i + C.planeSpread * fan[0]) * RAD, node = (p.node + C.planeSpread * fan[1]) * RAD;
      const target = ECC_FAN[idx % ECC_FAN.length];
      const ci = Math.cos(inc), si = Math.sin(inc), cn = Math.cos(node), sn = Math.sin(node);
      return {
        p, rgb: parseRGB(p.color), e: Math.min(0.85, p.e + C.eccentricity * (target - p.e)),
        period, n: TAU / period, cw: Math.cos(p.peri * RAD), sw: Math.sin(p.peri * RAD),
        ci, si, cn, sn, M0: p.M0 * RAD,
        swing: C.alignToCourse > 0 ? swingToCourse(si * sn, -si * cn, ci, C.alignToCourse) : null,
      };
    });

    const R3 = { x: 0, y: 0, z: 0 };
    function helio(el, M) {
      const e = el.e, E = eccentricAnomaly(M, e);
      const xo = el.p.a * (Math.cos(E) - e), yo = el.p.a * Math.sqrt(1 - e * e) * Math.sin(E);
      const x1 = xo * el.cw - yo * el.sw, y1 = xo * el.sw + yo * el.cw;
      const y2 = y1 * el.ci, z2 = y1 * el.si;
      let x = x1 * el.cn - y2 * el.sn, y = x1 * el.sn + y2 * el.cn, z = z2;
      const S = el.swing;
      if (S) {
        const rx = S[0] * x + S[1] * y + S[2] * z, ry = S[3] * x + S[4] * y + S[5] * z, rz = S[6] * x + S[7] * y + S[8] * z;
        x = rx; y = ry; z = rz;
      }
      if (C.compress !== 1) { // radial squeeze, angles untouched
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > 1e-9) { const s = Math.pow(r, C.compress - 1); x *= s; y *= s; z *= s; }
      }
      R3.x = x; R3.y = y; R3.z = z;
    }

    // ---- background stars, in world coords so depth parallax is real
    let D_NEAR = 60, D_FAR = 1400, starN = 0, dist = 0;
    let sx, sy, sz, sMag, sPhase, sTint, rand = mulberry32(0xc0ffee);
    function seedStar(k, depth, edge) {
      const d = depth ?? D_NEAR * Math.pow(D_FAR / D_NEAR, Math.pow(rand(), 0.55));
      const halfW = width * 0.5 * 1.15, halfH = height * 0.5 * 1.15;
      let ox, oy;
      if (edge === 0) { ox = -halfW; oy = (rand() * 2 - 1) * halfH; }
      else if (edge === 1) { ox = halfW; oy = (rand() * 2 - 1) * halfH; }
      else if (edge === 2) { ox = (rand() * 2 - 1) * halfW; oy = -halfH; }
      else if (edge === 3) { ox = (rand() * 2 - 1) * halfW; oy = halfH; }
      else { ox = (rand() * 2 - 1) * halfW; oy = (rand() * 2 - 1) * halfH; }
      const scale = d / (camDist * pxPerAU);
      const vx = ox * scale, vy = -oy * scale, vz = camDist - d;
      sx[k] = vx * RIGHT.x + vy * UP.x + vz * FWD.x + DIR.x * dist;
      sy[k] = vx * RIGHT.y + vy * UP.y + vz * FWD.y + DIR.y * dist;
      sz[k] = vx * RIGHT.z + vy * UP.z + vz * FWD.z + DIR.z * dist;
      sMag[k] = Math.pow(rand(), 2.4);
      sPhase[k] = rand() * TAU;
      const t = rand();
      sTint[k] = t > 0.9 ? 1 : t < 0.08 ? 2 : 0;
    }
    function buildStars() {
      starN = Math.max(60, Math.round(C.starCount * Math.min(2, (width * height) / (1440 * 900))));
      sx = new Float64Array(starN); sy = new Float64Array(starN); sz = new Float64Array(starN);
      sMag = new Float64Array(starN); sPhase = new Float64Array(starN); sTint = new Uint8Array(starN);
      rand = mulberry32(0xc0ffee);
      for (let k = 0; k < starN; k++) seedStar(k);
    }

    const glowCache = new Map();
    function glowSprite(color) {
      if (glowCache.has(color)) return glowCache.get(color);
      const R = 64, c = document.createElement("canvas");
      c.width = c.height = R * 2;
      const g2 = c.getContext("2d"), [r, g, b] = parseRGB(color);
      const grad = g2.createRadialGradient(R, R, 0, R, R, R);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.15, `rgba(${r},${g},${b},0.95)`);
      grad.addColorStop(0.36, `rgba(${r},${g},${b},0.26)`);
      grad.addColorStop(0.66, `rgba(${r},${g},${b},0.05)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      g2.fillStyle = grad;
      g2.fillRect(0, 0, R * 2, R * 2);
      glowCache.set(color, c);
      return c;
    }

    function resize() {
      const rect = host.getBoundingClientRect();
      const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (w === width && h === height) return;
      width = w; height = h;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pxPerAU = (Math.min(width, height) * 0.5) / C.viewRadius;
      camDist = C.viewRadius * 3.1;
      D_NEAR = camDist * 5; D_FAR = camDist * 120;
      setCamera(C.spin, C.tilt, C.roll);
      buildStars();
    }

    let pointerX = 0, pointerY = 0, camX = 0, camY = 0;
    const onPointer = (ev) => {
      if (!C.interactive) return;
      const rect = host.getBoundingClientRect();
      pointerX = ((ev.clientX - rect.left) / rect.width - 0.5) * 2;
      pointerY = ((ev.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    const onLeave = () => { pointerX = 0; pointerY = 0; };

    function drawSun(k, t) {
      const [r, g, b] = parseRGB(C.sunColor);
      const R = Math.max(5, Math.min(width, height) * 0.013) * (1 + Math.sin(t * 2.1) * 0.02);
      const disc = (rad, stops) => {
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        for (const [o, c] of stops) gr.addColorStop(o, c);
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.fill();
      };
      disc(R * 14, [[0, `rgba(${r},${g},${b},${0.05 * k})`], [0.4, `rgba(255,190,110,${0.014 * k})`], [1, "rgba(255,160,80,0)"]]);
      disc(R * 4.6, [[0, `rgba(${r},${g},${b},${0.34 * k})`], [0.3, `rgba(255,222,160,${0.1 * k})`],
        [0.62, `rgba(255,196,110,${0.025 * k})`], [1, "rgba(255,180,90,0)"]]);
      disc(R * 2.3, [[0, `rgba(255,255,255,${k})`], [0.42, `rgba(255,252,240,${0.7 * k})`],
        [0.72, `rgba(${r},${g},${b},${0.22 * k})`], [1, "rgba(255,210,140,0)"]]);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    }

    function render(t) {
      const k = C.glow;
      camX += (pointerX - camX) * 0.04;
      camY += (pointerY - camY) * 0.04;
      setCamera(C.spin + camX * 7, C.tilt + camY * 5, C.roll);
      dist = C.driftSpeed * t;

      cx = width * C.focus[0]; cy = height * C.focus[1];
      project(DIR.x, DIR.y, DIR.z); // put the Sun a little ahead so the spirals have room behind it
      if (P.ok) {
        const dxs = P.x - cx, dys = P.y - cy, len = Math.hypot(dxs, dys) || 1, push = Math.min(width, height) * C.lead;
        cx += (dxs / len) * push; cy += (dys / len) * push;
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      // stars
      const dRef = D_NEAR * 3.3, left = -width * 0.12, right = width * 1.12, top = -height * 0.12, bottom = height * 1.12;
      for (let s = 0; s < starN; s++) {
        project(sx[s] - DIR.x * dist, sy[s] - DIR.y * dist, sz[s] - DIR.z * dist);
        if (!P.ok || P.depth > D_FAR * 1.25) { seedStar(s); continue; }
        if (P.x < left || P.x > right || P.y < top || P.y > bottom) {
          seedStar(s, undefined, P.x < left ? 1 : P.x > right ? 0 : P.y < top ? 3 : 2);
          continue;
        }
        if (P.depth < D_NEAR * 0.75) continue;
        const near = Math.min(1, (P.depth - D_NEAR * 0.75) / (D_NEAR * 0.6));
        const far = 1 - Math.max(0, (P.depth - D_FAR * 0.78) / (D_FAR * 0.32));
        let a = (0.2 + sMag[s] * 1.05) * Math.pow(dRef / P.depth, 0.8) * near * far;
        if (a <= 0.012) continue;
        a *= 0.82 + 0.18 * Math.sin(t * 9 + sPhase[s]);
        const col = sTint[s] === 1 ? "175,205,255" : sTint[s] === 2 ? "255,214,170" : "255,255,255";
        const size = Math.min(2.3, 0.55 + sMag[s] * 1.5 * Math.pow(dRef / P.depth, 0.5));
        ctx.fillStyle = `rgba(${col},${Math.min(1, a).toFixed(3)})`;
        if (size < 1.05) ctx.fillRect(P.x, P.y, size, size);
        else { ctx.beginPath(); ctx.arc(P.x, P.y, size * 0.5, 0, TAU); ctx.fill(); }
      }

      // the Sun's own straight track
      if (C.showSunTrack) {
        const back = C.driftSpeed * C.trailYears * 1.1;
        project(0, 0, 0);
        const hx = P.x, hy = P.y;
        project(-DIR.x * back, -DIR.y * back, -DIR.z * back);
        if (P.ok) {
          const grad = ctx.createLinearGradient(hx, hy, P.x, P.y);
          grad.addColorStop(0, `rgba(255,246,214,${k})`);
          grad.addColorStop(0.45, `rgba(255,206,110,${0.55 * k})`);
          grad.addColorStop(1, "rgba(255,180,80,0)");
          ctx.strokeStyle = grad;
          ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(P.x, P.y);
          for (const [w, al] of [[11, 0.16], [4, 0.3], [1.8, 1]]) { ctx.lineWidth = w; ctx.globalAlpha = al; ctx.stroke(); }
          ctx.globalAlpha = 1;
        }
      }

      // planets and their helical wakes
      const shots = [];
      for (const el of elems) {
        const [r, g, b] = el.rgb, bright = (el.p.glow ?? 1) * k;
        const span = Math.min(C.trailYears, C.maxTurns * el.period);
        const N = Math.max(48, Math.min(360, Math.ceil((span / el.period) * 46 * (1 + 2.2 * el.e)) + 48));
        const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1), okArr = new Uint8Array(N + 1);
        for (let q = 0; q <= N; q++) {
          const age = (1 - q / N) * span;
          helio(el, el.M0 + el.n * (t - age));
          const back = C.driftSpeed * age; // ellipse + drift = helix
          project(R3.x - DIR.x * back, R3.y - DIR.y * back, R3.z - DIR.z * back);
          xs[q] = P.x; ys[q] = P.y; okArr[q] = P.ok ? 1 : 0;
          if (q === N && P.ok) shots.push({ el, x: P.x, y: P.y, depth: P.depth, s: P.s });
        }
        const stroke = (from, alpha, wide) => {
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
          ctx.lineWidth = wide;
          ctx.beginPath();
          let started = false;
          for (let q = from; q <= N; q++) {
            if (!okArr[q]) { started = false; continue; }
            if (!started) { ctx.moveTo(xs[q], ys[q]); started = true; } else ctx.lineTo(xs[q], ys[q]);
          }
          ctx.stroke();
        };
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        stroke(Math.floor(N * 0.72), 0.05 * bright, 6.5);
        stroke(Math.floor(N * 0.86), 0.05 * bright, 3);
        // one segment at a time so the fade has hundreds of steps; butt ends avoid beads at joints
        ctx.lineCap = "butt"; ctx.lineWidth = 1.3;
        for (let q = 0; q < N; q++) {
          if (!okArr[q] || !okArr[q + 1]) continue;
          const a = Math.pow((q + 1) / N, 2.6) * 0.95 * bright;
          if (a < 0.005) continue;
          ctx.strokeStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(xs[q], ys[q]); ctx.lineTo(xs[q + 1], ys[q + 1]); ctx.stroke();
        }
      }

      // bodies, back to front around the Sun
      shots.sort((p, q) => q.depth - p.depth);
      const sizeScale = Math.min(width, height) / 660;
      const drawShot = (o) => {
        const size = o.el.p.size * Math.min(1.3, Math.max(0.5, o.s)) * sizeScale;
        const R = size * 3.3;
        ctx.globalAlpha = Math.min(1, 0.9 * (o.el.p.glow ?? 1) * k);
        ctx.drawImage(glowSprite(o.el.p.color), o.x - R, o.y - R, R * 2, R * 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath(); ctx.arc(o.x, o.y, size * 0.5, 0, TAU); ctx.fill();
      };
      let idx = 0;
      while (idx < shots.length && shots[idx].depth > camDist) drawShot(shots[idx++]);
      drawSun(k, t);
      while (idx < shots.length) drawShot(shots[idx++]);
      ctx.globalCompositeOperation = "source-over";

      // veil for text to sit on
      if (C.scrim !== "none") {
        const s = Math.max(0, Math.min(1, C.scrimStrength));
        const g = C.scrim === "left" ? ctx.createLinearGradient(0, 0, width, 0)
          : C.scrim === "right" ? ctx.createLinearGradient(width, 0, 0, 0)
          : C.scrim === "top" ? ctx.createLinearGradient(0, 0, 0, height)
          : ctx.createLinearGradient(0, height, 0, 0);
        for (let q = 0; q <= 12; q++) g.addColorStop(q / 12, `rgba(0,0,0,${(s * Math.pow(1 - q / 12, 2.4)).toFixed(4)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }
    }

    function tick(now) {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      if (!visible) { lastFrame = now; return; }
      const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      if (!reduced) years += dt / Math.max(0.1, C.yearSeconds);
      render(years);
    }

    resize();
    render(years);
    if (!reduced) raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => { resize(); if (reduced) render(years); });
    ro.observe(host);
    const onVisibility = () => { visible = !document.hidden; lastFrame = 0; };
    document.addEventListener("visibilitychange", onVisibility);
    host.addEventListener("pointermove", onPointer);
    host.addEventListener("pointerleave", onLeave);

    return function stop() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      host.removeEventListener("pointermove", onPointer);
      host.removeEventListener("pointerleave", onLeave);
      canvas.remove();
    };
  }

  window.createOrbitalHero = createOrbitalHero;
})();
