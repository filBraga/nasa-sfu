// Cinematic intro: a star ignites into the Sun, Earth / Moon / Mars swing into orbit,
// the title reveals, then the camera dives into the Sun and the app appears.
// Skip: button, Esc or Enter. "Don't show intro again" is remembered in localStorage.
// Force it to play with ?intro in the URL, or call window.playIntro() / the "Replay intro" button.
(() => {
  const KEY = "analogExplorer.hideIntro";
  const TAU = Math.PI * 2;
  const EXIT_AT = 9.6;   // seconds: when the dive into the Sun starts
  const EXIT_LEN = 1.3;  // seconds: length of the dive
  const IGNITE = 2.4;    // seconds: when the star ignites

  const store = {
    get() { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } },
    set(v) { try { v ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch {} },
  };

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const outCubic = (p) => 1 - (1 - p) ** 3;
  const inCubic = (p) => p ** 3;
  const outBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2; };
  const inExpo = (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10));

  let active = false;
  window.playIntro = play;
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("replay-intro")?.addEventListener("click", play);

    // Options dialog: "Play intro on startup" toggle + "Play intro now"
    const dlg = document.getElementById("options-dialog");
    const openBtn = document.getElementById("open-options");
    if (!dlg || !openBtn) return;
    const chk = document.getElementById("opt-intro");
    openBtn.addEventListener("click", () => { chk.checked = !store.get(); dlg.showModal(); });
    chk.addEventListener("change", () => store.set(!chk.checked));
    document.getElementById("opt-play-intro").addEventListener("click", () => { dlg.close(); play(); });
    dlg.querySelector(".dlg-close").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
  });
  if (!store.get() || new URLSearchParams(location.search).has("intro")) play();

  function play() {
    if (active) return;
    active = true;

    const title = "ANALOG EXPLORER";
    const letters = [...title].map((c, i) => `<span style="--i:${i}">${c === " " ? "&nbsp;" : c}</span>`).join("");
    const root = document.createElement("div");
    root.id = "intro";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Intro animation");
    root.innerHTML = `
      <canvas aria-hidden="true"></canvas>
      <div class="intro-title">
        <div class="intro-kicker">NASA Space Apps Challenge · 2026</div>
        <h1 class="intro-name" aria-label="Analog Explorer">${letters}</h1>
        <div class="intro-rule"></div>
        <div class="intro-tag">Canadian terrain analogs for the Moon and Mars</div>
      </div>
      <div class="intro-bar">
        <label class="intro-toggle">
          <input type="checkbox">
          <span class="track"><span class="knob"></span></span>
          Don't show intro again
        </label>
        <button class="intro-skip" type="button">Skip intro <kbd>Esc</kbd></button>
      </div>
      <div class="intro-progress"><div></div></div>`;
    document.body.appendChild(root);

    const canvas = root.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const toggle = root.querySelector(".intro-toggle input");
    const skipBtn = root.querySelector(".intro-skip");
    const progress = root.querySelector(".intro-progress > div");
    toggle.checked = store.get();
    toggle.addEventListener("change", () => store.set(toggle.checked));

    let W = 0, H = 0;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    addEventListener("resize", resize);

    // ---------------------------------------------------------------- assets
    const img = (src) => { const i = new Image(); i.src = src; return i; };
    const tex = { earth: img("textures/earth.jpg"), moon: img("textures/moon.jpg"), mars: img("textures/mars.jpg") };
    const noise = makeNoise();

    const stars = Array.from({ length: 700 }, () => newStar(true));
    function newStar(init) {
      return { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: init ? 0.1 + Math.random() * 0.9 : 1,
               tw: Math.random() * TAU, hue: Math.random(), px: null, py: null };
    }
    const rays = Array.from({ length: 140 }, (_, i) => ({
      ang: (i / 140) * TAU + Math.random() * 0.05, w: 0.008 + Math.random() * 0.03,
      len: 0.4 + Math.random() * 1.6, f: 0.6 + Math.random() * 1.6, ph: Math.random() * TAU,
    }));
    const proms = [0.6, 2.3, 3.9, 5.2].map((a) => ({ a, d: 0.12 + Math.random() * 0.1, ph: Math.random() * TAU }));
    const wind = [];

    // ---------------------------------------------------------------- timeline
    let t = 0, last = performance.now(), exitAt = EXIT_AT, done = false, raf = 0;
    const flags = {};
    const once = (name, cond) => { if (cond && !flags[name]) { flags[name] = true; root.classList.add(name); } };

    function skip() {
      if (t >= exitAt) finish(true);
      else exitAt = t;
    }
    skipBtn.addEventListener("click", skip);
    const onKey = (e) => {
      if (e.key === "Escape" || (e.key === "Enter" && e.target !== toggle)) { e.preventDefault(); skip(); }
    };
    addEventListener("keydown", onKey);
    skipBtn.focus({ preventScroll: true });

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now; t += dt;
      draw(dt);
      once("show-bar", t > 0.4);
      once("show-kicker", t > 4.6);
      once("show-name", t > 5.0);
      once("show-tag", t > 6.1);
      once("out", t > exitAt);
      progress.style.transform = `scaleX(${clamp(t / exitAt)})`;
      if (t > exitAt + EXIT_LEN) return finish(false);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function finish(instant) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      removeEventListener("keydown", onKey);
      removeEventListener("resize", resize);
      root.classList.add("closing");
      const remove = () => { root.remove(); active = false; };
      if (instant) return remove();
      root.addEventListener("transitionend", remove, { once: true });
      setTimeout(remove, 1500);
    }

    // ---------------------------------------------------------------- drawing
    function draw(dt) {
      const pe = seg(t, exitAt, exitAt + EXIT_LEN);           // exit progress
      const R = Math.min(W * 0.1, H * 0.14);                    // Sun base radius
      const ts = t - IGNITE - 0.15;                              // time since ignition shock
      const shake = ts > 0 ? 9 * Math.exp(-ts * 6) : 0;
      const cx = W / 2 + (Math.random() - 0.5) * shake;
      const cy = H * 0.37 + (Math.random() - 0.5) * shake;

      // background
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#02030a";
      ctx.fillRect(0, 0, W, H);
      const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.8);
      neb.addColorStop(0, "rgba(60,30,80,0.22)");
      neb.addColorStop(0.5, "rgba(15,20,55,0.25)");
      neb.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = seg(t, 0.5, 3);
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;

      drawStars(dt, cx, cy, pe);

      // Sun radius: a charging point of light, then an ignition pop with overshoot
      const charge = inCubic(seg(t, 0.4, IGNITE));
      const pop = outBack(seg(t, IGNITE, IGNITE + 0.9));
      const ign = seg(t, IGNITE, IGNITE + 1.0);
      let rs = R * (0.02 + 0.18 * charge) + R * 0.8 * pop;
      rs *= 1 + inExpo(pe) * 16;

      // planets
      const pa = outCubic(seg(t, 3.3, 5.2));
      const fade = pa * (1 - seg(pe, 0, 0.5));
      const planets = fade > 0 ? layoutPlanets(cx, cy, R, pa) : [];
      if (fade > 0) drawOrbits(cx, cy, R, pa, fade);
      for (const p of planets) if (p.depth < 0) drawPlanet(p, cx, cy, fade);

      drawSun(cx, cy, rs, ign, charge);
      drawWind(dt, cx, cy, rs, ign, pe);
      for (const p of planets) if (p.depth >= 0) drawPlanet(p, cx, cy, fade);

      drawFlare(cx, cy, charge, ign, pe);

      // ignition shockwave + flash
      if (ts > 0 && ts < 1.8) {
        const p = ts / 1.8;
        ctx.globalCompositeOperation = "lighter";
        const rr = rs + outCubic(p) * Math.hypot(W, H), th = 70 * (1 - p) + 6, a = 0.7 * (1 - p) ** 2;
        const sg = ctx.createRadialGradient(cx, cy, Math.max(0, rr - th), cx, cy, rr + th);
        sg.addColorStop(0, "rgba(255,120,40,0)");
        sg.addColorStop(0.45, `rgba(255,170,80,${a * 0.5})`);
        sg.addColorStop(0.5, `rgba(255,240,210,${a})`);
        sg.addColorStop(0.55, `rgba(140,180,255,${a * 0.4})`);
        sg.addColorStop(1, "rgba(120,160,255,0)");
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(cx, cy, rr + th, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(255,248,235,${0.85 * Math.exp(-ts * 5)})`;
        ctx.fillRect(0, 0, W, H);
      }

      // white-out at the end of the dive
      const white = inCubic(seg(pe, 0.5, 1));
      if (white > 0) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(255,250,240,${white})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    function drawStars(dt, cx, cy, pe) {
      const speed = 0.012 + inExpo(pe) * 3.2;
      const f = Math.max(W, H) * 0.5;
      const vis = seg(t, 0, 1.6);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.z -= speed * dt;
        const sx = cx + (s.x / s.z) * f, sy = cy + (s.y / s.z) * f;
        if (s.z <= 0.02 || sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) { stars[i] = newStar(false); continue; }
        const size = ((1 - s.z) * 2.2 + 0.3) * (1 + pe * 1.5);
        const a = vis * clamp((1 - s.z) * 1.5 + pe * 1.5) * (0.65 + 0.35 * Math.sin(s.tw + t * 2.5));
        const col = s.hue < 0.15 ? "255,210,170" : s.hue > 0.85 ? "170,200,255" : "255,255,255";
        if (pe > 0 && s.px !== null) {
          ctx.strokeStyle = `rgba(${col},${a})`;
          ctx.lineWidth = size;
          ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(sx, sy); ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${col},${a})`;
          ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
        }
        s.px = sx; s.py = sy;
      }
    }

    function drawSun(cx, cy, rs, ign, charge) {
      // outer glow
      ctx.globalCompositeOperation = "lighter";
      const glowR = rs * (2.5 + 2.5 * ign) + 30 * charge;
      let g = ctx.createRadialGradient(cx, cy, rs * 0.3, cx, cy, glowR);
      g.addColorStop(0, `rgba(255,170,70,${0.55 + 0.2 * charge})`);
      g.addColorStop(0.25, "rgba(255,110,30,0.18)");
      g.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, TAU); ctx.fill();

      // corona rays: one gradient, one path
      if (ign > 0) {
        const rot = t * 0.035;
        for (const [scale, alpha] of [[1, 0.45], [0.45, 0.6]]) {
          g = ctx.createRadialGradient(cx, cy, rs * 0.9, cx, cy, rs * (1 + 2.2 * scale));
          g.addColorStop(0, `rgba(255,190,100,${alpha * ign})`);
          g.addColorStop(1, "rgba(255,120,40,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          for (const r of rays) {
            const a = r.ang + rot * (scale === 1 ? 1 : -1.3);
            const L = rs * (1.05 + scale * r.len * (0.55 + 0.45 * Math.sin(t * r.f + r.ph)));
            const b = rs * 0.95;
            ctx.moveTo(cx + Math.cos(a - r.w) * b, cy + Math.sin(a - r.w) * b);
            ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
            ctx.lineTo(cx + Math.cos(a + r.w) * b, cy + Math.sin(a + r.w) * b);
          }
          ctx.fill();
        }

        // prominences
        ctx.lineCap = "round";
        for (const p of proms) {
          const h = rs * (0.18 + 0.12 * Math.sin(t * 0.8 + p.ph)) * ign;
          const a0 = p.a - p.d + t * 0.035, a1 = p.a + p.d + t * 0.035;
          const pt = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
          const [x0, y0] = pt(a0, rs * 0.97), [x1, y1] = pt(a1, rs * 0.97);
          const [c0x, c0y] = pt(a0 + p.d * 0.3, rs + h * 2), [c1x, c1y] = pt(a1 - p.d * 0.3, rs + h * 2);
          for (const [w, a] of [[rs * 0.09, 0.12], [rs * 0.035, 0.5]]) {
            ctx.strokeStyle = `rgba(255,110,40,${a * ign})`;
            ctx.lineWidth = w;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(c0x, c0y, c1x, c1y, x1, y1); ctx.stroke();
          }
        }
      }

      // photosphere
      ctx.globalCompositeOperation = "source-over";
      g = ctx.createRadialGradient(cx - rs * 0.15, cy - rs * 0.15, 0, cx, cy, rs);
      g.addColorStop(0, "#fffbe8");
      g.addColorStop(0.3, "#ffe08a");
      g.addColorStop(0.65, "#ffa53a");
      g.addColorStop(0.9, "#f2661f");
      g.addColorStop(1, "#c83c12");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rs, 0, TAU); ctx.fill();

      // boiling granulation (two counter-rotating noise layers) + limb darkening
      if (rs > 4) {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, rs, 0, TAU); ctx.clip();
        ctx.globalCompositeOperation = "overlay";
        for (const [spin, k, a] of [[0.05, 1.6, 0.55], [-0.08, 2.3, 0.35]]) {
          ctx.save();
          ctx.globalAlpha = a;
          ctx.translate(cx, cy); ctx.rotate(t * spin);
          ctx.drawImage(noise, -rs * k, -rs * k, rs * k * 2, rs * k * 2);
          ctx.restore();
        }
        ctx.globalCompositeOperation = "source-over";
        g = ctx.createRadialGradient(cx, cy, rs * 0.65, cx, cy, rs);
        g.addColorStop(0, "rgba(255,80,0,0)");
        g.addColorStop(1, "rgba(140,25,0,0.5)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - rs, cy - rs, rs * 2, rs * 2);
        ctx.restore();
      }
    }

    function drawWind(dt, cx, cy, rs, ign, pe) {
      if (ign > 0 && pe === 0) {
        for (let i = 0; i < 4; i++) wind.push({ a: Math.random() * TAU, r: rs, v: 30 + Math.random() * 90, life: 1 });
      }
      ctx.globalCompositeOperation = "lighter";
      for (let i = wind.length - 1; i >= 0; i--) {
        const p = wind[i];
        p.r += p.v * dt; p.life -= dt * 0.45; p.a += dt * 0.05;
        if (p.life <= 0) { wind.splice(i, 1); continue; }
        ctx.fillStyle = `rgba(255,180,90,${p.life * 0.7})`;
        const s = 1 + p.life * 1.5;
        ctx.fillRect(cx + Math.cos(p.a) * p.r - s / 2, cy + Math.sin(p.a) * p.r - s / 2, s, s);
      }
    }

    function drawFlare(cx, cy, charge, ign, pe) {
      const k = t < IGNITE ? 0.15 + 0.85 * charge : 0.35 + 0.65 * Math.exp(-(t - IGNITE) * 1.4);
      const amt = Math.min(1, k + pe);
      ctx.globalCompositeOperation = "lighter";
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.012);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.6);
      g.addColorStop(0, `rgba(255,245,230,${amt})`);
      g.addColorStop(0.35, `rgba(140,180,255,${amt * 0.35})`);
      g.addColorStop(1, "rgba(100,150,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, W * 0.6, 0, TAU); ctx.fill();
      ctx.restore();

      // a few lens ghosts trailing below the Sun
      for (const [d, r, col] of [[0.6, 18, "120,200,255"], [1.1, 40, "255,160,90"], [1.6, 10, "180,255,200"]]) {
        const x = cx + (W / 2 - cx) * d * 2, y = cy + H * 0.5 * d * 0.35;
        const a = 0.12 * ign * (1 - pe);
        const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
        gg.addColorStop(0, `rgba(${col},${a})`);
        gg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    }

    // ---------------------------------------------------------------- planets
    const ORB_Y = 0.26;
    const PLANETS = [
      { key: "earth", label: "EARTH", orbit: 2.7, size: 0.3, speed: 0.16, phase: 1.9, spin: 0.03, atmo: "110,170,255" },
      { key: "mars", label: "MARS", orbit: 3.9, size: 0.21, speed: 0.11, phase: -0.2, spin: 0.025, atmo: "255,150,100" },
    ];

    function layoutPlanets(cx, cy, R, pa) {
      const out = [];
      for (const p of PLANETS) {
        const ang = p.phase + p.speed * t - (1 - pa) * 2.2;
        const orb = p.orbit * R * (1 + (1 - pa) * 0.8);
        const depth = Math.sin(ang);
        const s = 1 + depth * 0.14;
        const x = cx + Math.cos(ang) * orb, y = cy + Math.sin(ang) * orb * ORB_Y;
        out.push({ ...p, x, y, r: p.size * R * s, depth });
        if (p.key === "earth") {
          const ma = t * 0.9 + 1.0;
          const md = Math.sin(ma);
          out.push({ key: "moon", label: "MOON", spin: 0.02, atmo: null,
                     x: x + Math.cos(ma) * R * 0.7 * s, y: y + Math.sin(ma) * R * 0.7 * s * 0.45, above: true,
                     r: 0.1 * R * s * (1 + md * 0.08), depth: depth + md * 0.01 });
        }
      }
      return out.sort((a, b) => a.depth - b.depth);
    }

    function drawOrbits(cx, cy, R, pa, fade) {
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1;
      for (const p of PLANETS) {
        const orb = p.orbit * R * (1 + (1 - pa) * 0.8);
        ctx.strokeStyle = `rgba(255,200,150,${0.12 * fade})`;
        ctx.beginPath(); ctx.ellipse(cx, cy, orb, orb * ORB_Y, 0, 0, TAU); ctx.stroke();
      }
    }

    function drawPlanet(p, cx, cy, fade) {
      const { x, y, r } = p;
      const im = tex[p.key];
      let dx = cx - x, dy = cy - y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = fade;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
      if (im.complete && im.naturalWidth) {
        const iw = im.naturalWidth, ih = im.naturalHeight, sw = ih;  // one hemisphere of an equirectangular map
        const sx = (((t * p.spin) % 1) * iw + iw) % iw;
        const first = Math.min(sw, iw - sx);
        ctx.drawImage(im, sx, 0, first, ih, x - r, y - r, (2 * r * first) / sw, 2 * r);
        if (first < sw) ctx.drawImage(im, 0, 0, sw - first, ih, x - r + (2 * r * first) / sw, y - r, (2 * r * (sw - first)) / sw, 2 * r);
      } else {
        ctx.fillStyle = p.key === "mars" ? "#b5562f" : p.key === "moon" ? "#9a9a9a" : "#3a6ea5";
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      const night = Math.max(0, p.depth);   // in front of the Sun we see more of the night side
      const g = ctx.createRadialGradient(x + dx * r * 0.75, y + dy * r * 0.75, r * 0.1, x, y, r * (1.9 - 0.7 * night));
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, "rgba(0,0,0,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0.96)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.restore();

      ctx.globalCompositeOperation = "lighter";
      if (p.atmo) {
        const ag = ctx.createRadialGradient(x, y, r * 0.92, x, y, r * 1.18);
        ag.addColorStop(0, `rgba(${p.atmo},0)`);
        ag.addColorStop(0.3, `rgba(${p.atmo},${0.45 * fade})`);
        ag.addColorStop(1, `rgba(${p.atmo},0)`);
        ctx.fillStyle = ag;
        ctx.beginPath(); ctx.arc(x, y, r * 1.18, 0, TAU); ctx.fill();
      }
      // sunlit rim
      ctx.strokeStyle = `rgba(255,220,180,${0.35 * fade})`;
      ctx.lineWidth = Math.max(1, r * 0.06);
      const a = Math.atan2(dy, dx);
      ctx.beginPath(); ctx.arc(x, y, r * 0.98, a - 1.1, a + 1.1); ctx.stroke();

      // label
      const la = seg(t, 4.4, 5.3) * fade;
      if (la > 0) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(230,235,245,${0.75 * la})`;
        ctx.font = `600 ${Math.max(9, Math.min(12, r * 0.5))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.letterSpacing = "3px";
        ctx.fillText(p.label, x, p.above ? y - r - 7 : y + r + 16);
        ctx.letterSpacing = "0px";
      }
    }
  }

  function makeNoise() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1100; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = 2 + Math.random() * 11;
      const col = Math.random() < 0.5 ? "255,255,255" : "0,0,0";
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${col},0.35)`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return c;
  }
})();
