/* ============================================================
   Equxi Landing Page – main.js
   ============================================================ */

(function () {
  "use strict";

  /* --------------------------------------------------------
     Entrance animations (IntersectionObserver)
     -------------------------------------------------------- */
  function initReveal() {
    const animEls = document.querySelectorAll(".anim");
    if (!animEls.length) return;

    // Headline lines get special treatment — reveal inside the parent
    const headline = document.querySelector(".headline.anim");
    if (headline) {
      const lines = headline.querySelectorAll(".hl-line");
      // Remove anim class from headline itself so it doesn't get the generic reveal
      // Instead we observe it and reveal children
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
      // Headline: reveal children, not parent
      if (el.classList.contains("headline")) {
        const lines = el.querySelectorAll(".hl-line");
        // Observe the headline parent
        io.observe(el);
        // Store lines reference
        el._lines = lines;
      } else {
        io.observe(el);
      }
    });

    // Override: when headline anim.revealed fires, reveal lines with stagger
    const origCallback = io;
    // We'll use a MutationObserver-like approach via a custom handler
    // Actually simpler: override with a second observer for headline
    if (headline) {
      const hlIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const lines = entry.target.querySelectorAll(".hl-line");
              lines.forEach((line, i) => {
                setTimeout(() => {
                  line.classList.add("revealed");
                }, 0);
              });
              hlIO.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15 }
      );
      hlIO.observe(headline);
    }
  }

  /* --------------------------------------------------------
     Count-up stat animation
     -------------------------------------------------------- */
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

                valueEl.textContent =
                  current.toFixed(decimals) + suffix;

                if (progress < 1) {
                  requestAnimationFrame(tick);
                }
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

  /* --------------------------------------------------------
     Mobile menu
     -------------------------------------------------------- */
  function initMobileMenu() {
    const burger = document.querySelector(".burger");
    const overlay = document.getElementById("mobile-menu");
    const sheetLinks = overlay
      ? overlay.querySelectorAll(".sheet-link, .sheet-signin")
      : [];
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

    function toggleMenu() {
      if (overlay.classList.contains("open")) {
        closeMenu();
      } else {
        openMenu();
      }
    }

    burger.addEventListener("click", toggleMenu);

    // Close on overlay click (not sheet)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closeMenu();
      }
    });

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay.classList.contains("open")) {
        closeMenu();
      }
    });

    // Close on link click
    sheetLinks.forEach((link) => {
      link.addEventListener("click", () => {
        closeMenu();
      });
    });

    // Close on resize >720
    window.addEventListener("resize", () => {
      if (window.innerWidth > 720 && overlay.classList.contains("open")) {
        closeMenu();
      }
    });
  }

  /* --------------------------------------------------------
     Init
     -------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    initReveal();
    initMobileMenu();

    // Count-up stats
    const stats = document.querySelectorAll(".stat");
    stats.forEach((stat, i) => {
      animateCountUp(stat, i);
    });
  });
})();
