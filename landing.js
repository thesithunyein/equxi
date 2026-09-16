/**
 * Landing page — fills the live network strip from `/api/trust`.
 *
 * Deliberately a plain script in an IIFE, matching `explorer.js` and `app.js`:
 * the site is served as static files with no bundler, so anything else would
 * need a build step that does not exist.
 *
 * Two rules this file exists to keep:
 *
 *   * **Nothing from the chain is trusted as HTML.** Agent names are attacker
 *     controlled — anyone can register an agent called `<img onerror=...>` —
 *     so every interpolation goes through `esc()`.
 *   * **A failed read is shown as a failure.** The tiles carry an em dash until
 *     real data arrives, and a failed fetch says so instead of rendering four
 *     zeroes, which would read as "the network is empty and healthy". An empty
 *     cluster and an unreachable API are different facts.
 */
(function () {
  "use strict";

  var API = "/api/trust";
  var MAX_ROWS = 3;

  var tiles = document.getElementById("liveTiles");
  var rows = document.getElementById("liveRows");
  var notice = document.getElementById("liveNotice");

  if (!tiles || !rows) return;

  /* ── helpers ────────────────────────────────────────────────────────── */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

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

  function bondLamports(agent) {
    return agent.profile && agent.profile.bond
      ? Number(agent.profile.bond.amountLamports)
      : 0;
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

  /**
   * Name, grade, collateral and slashes for the most-collateralised agents.
   * The product's claim is that collateral creates accountability, so the
   * board leads with the agents carrying the most of it.
   */
  function renderRows(payload) {
    var agents = (payload.agents || []).slice().sort(function (a, b) {
      return bondLamports(b) - bondLamports(a);
    });

    var bonded = agents.filter(function (agent) {
      return bondLamports(agent) > 0;
    });

    if (bonded.length === 0) {
      rows.innerHTML =
        '<div class="live-notice">No agent on this cluster has posted collateral yet. ' +
        'Register one from the <a href="app.html" style="color:var(--purple)">dashboard</a>.</div>';
      return;
    }

    rows.innerHTML = bonded
      .slice(0, MAX_ROWS)
      .map(function (agent) {
        var p = agent.profile || {};
        var grade = p.grade || "ungraded";
        var slashes = (p.stats && p.stats.slashCount) || 0;
        var open = (p.stats && p.stats.openSlashes) || 0;
        return (
          '<div class="live-row">' +
          '<div class="nm"><a href="explorer.html?agent=' +
          esc(agent.address) +
          '">' +
          esc(agent.name) +
          "</a><span>" +
          esc(agent.agentType || "agent") +
          (slashes
            ? " · " + esc(slashes) + " slash" + (slashes === 1 ? "" : "es")
            : " · never slashed") +
          (open > 0 ? ' · <span style="color:#ffb450">' + esc(open) + " unpaid</span>" : "") +
          "</span></div>" +
          '<div class="fig"><span class="grade-pill g-' +
          esc(grade) +
          '">' +
          esc(grade) +
          "</span></div>" +
          '<div class="fig">' +
          esc(sol(p.bond.amountLamports)) +
          " SOL<em>bonded</em></div>" +
          '<div class="fig hide-sm"><a href="explorer.html?agent=' +
          esc(agent.address) +
          '" style="color:var(--purple)">Inspect →</a></div>' +
          "</div>"
        );
      })
      .join("");

    if (bonded.length > MAX_ROWS) {
      rows.innerHTML +=
        '<div class="live-notice" style="padding-top:12px">' +
        esc(bonded.length - MAX_ROWS) +
        ' more with collateral — see the <a href="explorer.html" style="color:var(--purple)">full registry</a>.</div>';
    }
  }

  function renderFailure(message) {
    var fillKeys = ["agents", "bonded", "slashes", "escrow"];
    fillKeys.forEach(function (key) {
      set(key, "—");
    });
    rows.innerHTML =
      '<div class="live-notice bad">Could not read the program. ' +
      esc(message) +
      " This strip is live, so an outage here is reported rather than papered over with zeroes.</div>";
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
      .then(function (payload) {
        renderTiles(payload);
        renderRows(payload);
        if (notice && notice.parentNode === rows) rows.removeChild(notice);
      })
      .catch(function (error) {
        renderFailure(error && error.message ? error.message : String(error));
      });
  }

  load();
})();
