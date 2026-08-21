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
