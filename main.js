(function () {
  "use strict";

  /* --------------------------------------------------------
     Entrance Animations — JS-driven, no CSS class dependencies
     -------------------------------------------------------- */
  function animate(el, props, duration, delay, easing) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const start = performance.now();
        const from = {};
        const to = {};
        for (const [k, v] of Object.entries(props)) {
          from[k] = parseFloat(getComputedStyle(el)[k]) || 0;
          to[k] = v;
        }
        function tick(now) {
          const t = Math.min((now - start) / duration, 1);
          const e = easing(t);
          for (const [k] of Object.entries(props)) {
            if (k === "opacity") el.style.opacity = from[k] + (to[k] - from[k]) * e;
            else if (k === "clip-path") {
              const v = from[k] + (to[k] - from[k]) * e;
              el.style.clipPath = `inset(0 0 ${(1 - v) * 100}% 0)`;
            }
            else el.style[k] = `${from[k] + (to[k] - from[k]) * e}px`;
          }
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      }, delay);
    });
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

  async function runEntrance() {
    const header = document.querySelector(".header");
    const trust = document.querySelector(".trust");
    const lines = document.querySelectorAll(".hl-line");
    const subhead = document.querySelector(".subhead");
    const ctaRow = document.querySelector(".cta-row");
    const stats = document.querySelector(".stats");

    // Header slide down
    animate(header, { opacity: 1, translateY: 0 }, 700, 100, easeOutCubic);

    // Trust row
    animate(trust, { opacity: 1, translateY: 0 }, 700, 250, easeOutCubic);

    // Headline lines — clip reveal
    for (let i = 0; i < lines.length; i++) {
      animate(lines[i], { opacity: 1, clipPath: 1 }, 900, 400 + i * 180, easeOutQuart);
    }

    // Subhead
    animate(subhead, { opacity: 0.85, translateY: 0 }, 700, 800, easeOutCubic);

    // CTAs
    animate(ctaRow, { opacity: 1, translateY: 0, scale: 1 }, 700, 950, easeOutCubic);

    // Stats
    animate(stats, { opacity: 1, translateY: 0 }, 700, 1100, easeOutCubic);

    // Count-up stats after they appear
    setTimeout(() => startCountUp(), 1200);
  }

  /* --------------------------------------------------------
     Count-up
     -------------------------------------------------------- */
  function startCountUp() {
    const stats = document.querySelectorAll(".stat");
    stats.forEach((stat, i) => {
      const target = parseFloat(stat.dataset.target);
      const suffix = stat.dataset.suffix || "";
      const decimals = parseInt(stat.dataset.decimals, 10) || 0;
      const valueEl = stat.querySelector(".stat-value");
      const duration = 1500 + i * 80;
      const startTime = performance.now() + i * 90;

      function tick(now) {
        const elapsed = now - startTime;
        if (elapsed < 0) { requestAnimationFrame(tick); return; }
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        const current = eased * target;
        valueEl.textContent = current.toFixed(decimals) + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  /* --------------------------------------------------------
     Mobile Menu
     -------------------------------------------------------- */
  function initMobileMenu() {
    const burger = document.querySelector(".burger");
    const overlay = document.getElementById("mobile-menu");
    const sheetLinks = overlay ? overlay.querySelectorAll(".sheet-link, .sheet-signin") : [];
    const body = document.body;
    if (!burger || !overlay) return;

    function openMenu() {
      burger.setAttribute("aria-expanded", "true");
      overlay.setAttribute("aria-hidden", "false");
      overlay.classList.add("open");
      body.classList.add("menu-open");
    }

    function closeMenu() {
      burger.setAttribute("aria-expanded", "false");
      overlay.setAttribute("aria-hidden", "true");
      overlay.classList.remove("open");
      body.classList.remove("menu-open");
    }

    burger.addEventListener("click", () => overlay.classList.contains("open") ? closeMenu() : openMenu());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeMenu(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("open")) closeMenu(); });
    sheetLinks.forEach((link) => link.addEventListener("click", closeMenu));
    window.addEventListener("resize", () => { if (window.innerWidth > 720 && overlay.classList.contains("open")) closeMenu(); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMobileMenu();
    runEntrance();
  });
})();
