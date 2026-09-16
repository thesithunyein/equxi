/**
 * Landing page — fills the live network strip from `/api/trust`.
 *
 * Deliberately a plain script in an IIFE, matching `explorer.js` and `app.js`:
 * the site is served as static files with no bundler, so anything else would
 * need a build step that does not exist.
 *
 * Two rules this file exists to keep:
 *
 *   * **Nothing from the chain is trusted as HTML.** Every value goes in through
 *     `textContent`, so an agent registered as `<img onerror=...>` cannot become
 *     markup on this page — there is no `innerHTML` here at all.
 *   * **A failed read is shown as a failure.** The tiles carry an em dash until
 *     real data arrives, and a failed fetch says so instead of rendering four
 *     zeroes, which would read as "the network is empty and healthy". An empty
 *     cluster and an unreachable API are different facts.
 *
 * This used to render a per-agent table too. It was removed: the numbers above
 * it already carry the claim, and a table of one row duplicated the Explorer
 * while pushing the page's actual argument further down.
 */
(function () {
  "use strict";

  var API = "/api/trust";

  var tiles = document.getElementById("liveTiles");
  var notice = document.getElementById("liveNotice");

  /**
   * The builder strip is static markup, but the command is the one thing a
   * reader has to reproduce by hand — selecting a nowrap code line on a phone is
   * fiddly, so give them a button. Wired before the guard below, because this
   * half of the page does not depend on the read succeeding.
   */
  function wireCopy() {
    var code = document.getElementById("devCode");
    var button = document.getElementById("devCopy");
    if (!code || !button) return;

    var idle = button.textContent;
    var reset;

    button.addEventListener("click", function () {
      var command = code.textContent;
      var done = function () {
        button.textContent = "Copied";
        clearTimeout(reset);
        reset = setTimeout(function () {
          button.textContent = idle;
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(command).then(done, function () {
          // Clipboard access needs a secure context. Falling back to a prompt
          // keeps the command copyable rather than silently doing nothing.
          window.prompt("Copy this:", command);
        });
        return;
      }
      window.prompt("Copy this:", command);
    });
  }

  wireCopy();

  if (!tiles) return;

  /* ── helpers ────────────────────────────────────────────────────────── */

  function sol(lamports) {
    var n = Number(lamports) / 1e9;
    if (!isFinite(n)) return "0";
    if (n === 0) return "0";
    return n >= 1
      ? n.toLocaleString(undefined, { maximumFractionDigits: 3 })
      : n.toFixed(4);
  }

  function set(fill, text) {
    var node = tiles.querySelector('[data-fill="' + fill + '"]');
    if (node) node.textContent = text;
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  function renderTiles(payload) {
    var counts = payload.counts || {};
    var totals = payload.totals || {};
    var vault = payload.vault;

    set("agents", counts.agents);
    set("bonded", sol(totals.bondedLamports) + " SOL");
    set("slashes", totals.slashCount);
    set("slashesSub", totals.openSlashes + " still owed");
    set("escrow", vault ? sol(vault.availableLamports) + " SOL" : "—");
  }

  function renderFailure(message) {
    ["agents", "bonded", "slashes", "escrow"].forEach(function (key) {
      set(key, "—");
    });
    if (notice) {
      notice.className = "live-notice bad";
      notice.textContent =
        "Could not read the program. " +
        message +
        " This strip is live, so an outage here is reported rather than papered over with zeroes.";
    }
  }

  function load() {
    fetch(API, { headers: { accept: "application/json" } })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (body) {
            if (!response.ok || !body || !body.ok) {
              throw new Error(body && body.error ? body.error : "HTTP " + response.status);
            }
            return body;
          });
      })
      .then(renderTiles)
      .catch(function (error) {
        renderFailure(error && error.message ? error.message : String(error));
      });
  }

  load();
})();
