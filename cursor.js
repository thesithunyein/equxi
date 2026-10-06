/*
 * Cursor glow — a soft blob of cool light that trails the pointer.
 *
 * Deliberately frugal: one fixed-position div whose transform is written from
 * a requestAnimationFrame loop that eases towards the pointer, so the glow
 * glides instead of snapping, and the loop stops whenever it has caught up.
 * Off entirely for touch pointers; hidden on small screens and for readers
 * who ask for reduced motion by theme.css, which owns the element's look.
 */
(function () {
  if (!window.matchMedia("(pointer: fine)").matches) return;

  var HALF = 180; // half of the glow's rendered size in theme.css
  var el = document.createElement("div");
  el.className = "cursor-glow";
  document.body.appendChild(el);

  var targetX = -2 * HALF, targetY = -2 * HALF; // parked off-screen until first move
  var x = targetX, y = targetY;
  var scale = 1, targetScale = 1;
  var raf = null;

  function tick() {
    raf = null;
    x += (targetX - x) * 0.14;
    y += (targetY - y) * 0.14;
    scale += (targetScale - scale) * 0.2;
    el.style.transform =
      "translate3d(" + (x - HALF) + "px," + (y - HALF) + "px,0) scale(" + scale + ")";
    var settled =
      Math.abs(targetX - x) < 0.3 &&
      Math.abs(targetY - y) < 0.3 &&
      Math.abs(targetScale - scale) < 0.001;
    if (!settled) raf = requestAnimationFrame(tick);
  }

  function wake() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  document.addEventListener("mousemove", function (e) {
    targetX = e.clientX;
    targetY = e.clientY;
    el.style.opacity = "1";
    wake();
  });
  document.addEventListener("mouseleave", function () {
    el.style.opacity = "0";
  });
  document.addEventListener("mousedown", function () {
    targetScale = 0.86;
    wake();
  });
  document.addEventListener("mouseup", function () {
    targetScale = 1;
    wake();
  });
})();
