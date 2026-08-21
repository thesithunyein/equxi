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

  // Count-up animation
  function countUp(el, target, suffix, decimals, duration) {
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = (e * target).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Docs toggle
  function initDocs() {
    const toggle = document.getElementById("docsToggle");
    const docs = document.getElementById("docs");
    if (!toggle || !docs) return;
    toggle.addEventListener("click", e => {
      e.preventDefault();
      const isVisible = docs.style.display !== "none";
      docs.style.display = isVisible ? "none" : "block";
      if (!isVisible) docs.scrollIntoView({ behavior: "smooth" });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initDocs();
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
    if (stats) {
      animate(stats, { opacity: 1, translateY: 0 }, 600, 750);
      // Count-up stats
      setTimeout(() => {
        document.querySelectorAll(".stat-value").forEach((el, i) => {
          const target = parseFloat(el.dataset.target);
          const suffix = el.dataset.suffix || "";
          const decimals = parseInt(el.dataset.decimals) || 0;
          countUp(el, target, suffix, decimals, 1500 + i * 100);
        });
      }, 900);
    }
  });
})();
