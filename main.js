(function () {
  "use strict";

  // Entrance animation
  function animate(el, props, duration, delay) {
    return new Promise(resolve => {
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
          const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
          for (const [k] of Object.entries(props)) {
            if (k === "opacity") el.style.opacity = from[k] + (to[k] - from[k]) * e;
            else el.style[k] = `${from[k] + (to[k] - from[k]) * e}px`;
          }
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      }, delay);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Hamburger menu. State lives in one place so the button's aria-expanded,
    // the overlay and body scroll can never disagree — a screen reader asking
    // "is it open?" gets the same answer as the pixels.
    var menuBtn = document.getElementById("menuToggle");
    var mobileNav = document.getElementById("mobileNav");
    if (menuBtn && mobileNav) {
      var setMenu = function (open) {
        menuBtn.classList.toggle("active", open);
        mobileNav.classList.toggle("open", open);
        menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.style.overflow = open ? "hidden" : "";
      };
      menuBtn.addEventListener("click", function () {
        setMenu(!mobileNav.classList.contains("open"));
      });
      mobileNav.querySelectorAll(".mobile-nav-link").forEach(function (link) {
        link.addEventListener("click", function () { setMenu(false); });
      });
      // Escape closes it, like every other overlay on the web.
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && mobileNav.classList.contains("open")) setMenu(false);
      });
    }

    // Entrance animations are decoration. When the system asks for reduced
    // motion, the CSS already collapses them; skip the JavaScript timers too.
    var reduceMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    // Animate elements in
    const header = document.querySelector(".header");
    const badge = document.querySelector(".badge");
    const headline = document.querySelector(".headline");
    const subhead = document.querySelector(".subhead");
    const ctaRow = document.querySelector(".cta-row");
    const stats = document.querySelector(".stats");

    if (header) animate(header, { opacity: 1, translateY: 0 }, 600, 100);
    if (badge) animate(badge, { opacity: 1, translateY: 0 }, 600, 250);
    if (headline) animate(headline, { opacity: 1, translateY: 0 }, 700, 350);
    if (subhead) animate(subhead, { opacity: 1, translateY: 0 }, 600, 500);
    if (ctaRow) animate(ctaRow, { opacity: 1, translateY: 0 }, 600, 600);
    if (stats) animate(stats, { opacity: 1, translateY: 0 }, 600, 750);
  });
})();
