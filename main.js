(function () {
  "use strict";

  function initReveal() {
    const animEls = document.querySelectorAll(".anim");
    if (!animEls.length) return;

    const headline = document.querySelector(".headline.anim");
    if (headline) {
      const hlIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const lines = entry.target.querySelectorAll(".hl-line");
              lines.forEach((line) => line.classList.add("revealed"));
              hlIO.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15 }
      );
      hlIO.observe(headline);
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    animEls.forEach((el) => {
      if (!el.classList.contains("headline")) io.observe(el);
    });
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateCountUp(statEl, index) {
    const target = parseFloat(statEl.dataset.target);
    const suffix = statEl.dataset.suffix || "";
    const decimals = parseInt(statEl.dataset.decimals, 10) || 0;
    const valueEl = statEl.querySelector(".stat-value");
    const duration = 1500 + index * 80;
    const startOffset = 480 + index * 90;
    let started = false;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !started) {
            started = true;
            io.unobserve(entry.target);
            setTimeout(() => {
              const startTime = performance.now();
              function tick(now) {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = easeOutCubic(progress);
                const current = eased * target;
                valueEl.textContent = current.toFixed(decimals) + suffix;
                if (progress < 1) requestAnimationFrame(tick);
              }
              requestAnimationFrame(tick);
            }, startOffset);
          }
        });
      },
      { threshold: 0.25 }
    );
    io.observe(statEl);
  }

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
    initReveal();
    initMobileMenu();
    document.querySelectorAll(".stat").forEach((stat, i) => animateCountUp(stat, i));
  });
})();
