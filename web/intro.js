// Intro: the orbital-helix hero (orbital-hero.js). It stays up until the user clicks
// (or presses Enter / Esc), then fades out to reveal Earth, Moon and Mars in the app.
// "Don't show intro again" is remembered in localStorage.
// Force it to play with ?intro in the URL, or call window.playIntro() / the "Play intro now" option.
(() => {
  const KEY = "analogExplorer.hideIntro";
  const store = {
    get() { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } },
    set(v) { try { v ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch {} },
  };

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
  if (!store.get() || new URLSearchParams(location.search).has("intro")) {
    if (document.body) play();
    else document.addEventListener("DOMContentLoaded", play);
  }

  function play() {
    if (active) return;
    active = true;

    // "ASTROLOG" big, "· ANALOG EXPLORER" as a smaller second line; letters staggered across both
    const lines = [["ASTROLOG", ""], ["· ANALOG EXPLORER", " sub"]];
    let i = 0;
    const letters = lines.map(([text, cls]) =>
      `<span class="w${cls}">${[...text].map((c) => `<span style="--i:${i++}">${c === " " ? "&nbsp;" : c}</span>`).join("")}</span>`).join("");
    const root = document.createElement("div");
    root.id = "intro";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Intro");
    root.innerHTML = `
      <div class="intro-copy">
        <div class="intro-kicker">NASA Space Apps Challenge · 2026</div>
        <h1 class="intro-name" aria-label="Astrolog · Analog Explorer">${letters}</h1>
        <p class="intro-tag">The Sun is running, and the planets chase it. Every track you see is a helix.
          Find the Canadian terrain that matches the Moon and Mars.</p>
        <button class="intro-enter" type="button">Explore the planets <span class="intro-arrow" aria-hidden="true">→</span></button>
      </div>
      <label class="intro-toggle">
        <input type="checkbox">
        <span class="track"><span class="knob"></span></span>
        Don't show intro again
      </label>`;
    document.body.appendChild(root);

    const narrow = matchMedia("(max-width: 767px)").matches;
    const stopHero = window.createOrbitalHero(root, {
      focus: narrow ? [0.5, 0.86] : [0.74, 0.42],
      scrim: narrow ? "top" : "left",
      scrimStrength: narrow ? 0.94 : 0.92,
      viewRadius: narrow ? 2.1 : 3.1,
      lead: narrow ? 0.05 : 0.12,
      glow: narrow ? 0.5 : 1,
    });

    const toggle = root.querySelector(".intro-toggle input");
    const enterBtn = root.querySelector(".intro-enter");
    toggle.checked = store.get();
    toggle.addEventListener("change", () => store.set(toggle.checked));
    enterBtn.focus({ preventScroll: true });
    requestAnimationFrame(() => root.classList.add("show"));

    // any click on the scene (not the toggle) enters the app
    root.addEventListener("click", (ev) => { if (!ev.target.closest(".intro-toggle")) finish(); });
    const onKey = (e) => {
      if (e.key === "Escape" || (e.key === "Enter" && e.target !== toggle)) { e.preventDefault(); finish(); }
    };
    addEventListener("keydown", onKey);

    let done = false;
    function finish() {
      if (done) return;
      done = true;
      removeEventListener("keydown", onKey);
      root.classList.add("closing");
      const remove = () => { if (!root.isConnected) return; stopHero(); root.remove(); active = false; };
      root.addEventListener("transitionend", remove, { once: true });
      setTimeout(remove, 1200);
    }
  }
})();
