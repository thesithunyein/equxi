/**
 * Trust Explorer — reads `/api/trust` and renders it.
 *
 * Deliberately a plain script in an IIFE, matching `app.js` and `main.js`: this
 * site is served as static files on Vercel with no bundler, so anything fancier
 * would need a build step that does not exist.
 *
 * The rendering rules that matter:
 *
 *   * **Nothing from the chain is trusted as HTML.** Agent names are attacker
 *     controlled — anyone can register an agent called `<img onerror=...>` — so
 *     every interpolation goes through `esc()`.
 *   * **Absence is shown as absence.** An agent with no bond renders as
 *     `ungraded`, never as a passing grade. A failure to reach the API renders as
 *     an error, never as "no agents found".
 */
(function () {
  "use strict";

  var API = "/api/trust";
  var EXPLORER = "https://explorer.solana.com";

  var el = {
    form: document.getElementById("searchForm"),
    input: document.getElementById("agentInput"),
    lookup: document.getElementById("lookupBtn"),
    all: document.getElementById("allBtn"),
    status: document.getElementById("status"),
    summary: document.getElementById("summary"),
    detail: document.getElementById("detail"),
    registry: document.getElementById("registry"),
    cluster: document.getElementById("clusterName"),
  };

  var state = {
    payload: null,
    error: null,
    /** True when the failure was the network, not a reply from our own API. */
    errorIsNetwork: false,
    loading: false,
    selected: null,
  };

  /* ── helpers ────────────────────────────────────────────────────────── */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function short(value) {
    var s = String(value || "");
    return s.length > 12 ? s.slice(0, 5) + "…" + s.slice(-4) : s;
  }

  function sol(lamports) {
    var n = Number(lamports) / 1e9;
    if (!isFinite(n)) return "0";
    if (n === 0) return "0";
    return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : n.toFixed(4);
  }

  function addrLink(address) {
    return (
      '<a class="x-link x-mono" href="' +
      EXPLORER +
      "/address/" +
      esc(address) +
      '?cluster=devnet" target="_blank" rel="noopener">' +
      esc(short(address)) +
      " \u2197</a>"
    );
  }

  function when(unixSeconds) {
    if (!unixSeconds) return "—";
    try {
      return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
    } catch (e) {
      return "—";
    }
  }

  function gradeBadge(grade) {
    var g = grade || "ungraded";
    return '<span class="x-grade g-' + esc(g) + '">' + esc(g) + "</span>";
  }

  /* ── loading ────────────────────────────────────────────────────────── */

  function load(agentAddress) {
    state.loading = true;
    state.error = null;
    render();

    var url = API + (agentAddress ? "?agent=" + encodeURIComponent(agentAddress) : "");

    fetch(url, { headers: { accept: "application/json" } })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (body) {
            if (!response.ok || !body || !body.ok) {
              var failure = new Error(
                body && body.error ? body.error : "HTTP " + response.status
              );
              // The API answered and told us why. Do not blame the deployment.
              failure.fromApi = true;
              throw failure;
            }
            return body;
          });
      })
      .then(function (body) {
        state.payload = body;
        state.selected = body.agents.length === 1 ? body.agents[0].address : null;
        state.errorIsNetwork = false;
        state.loading = false;
        render();
      })
      .catch(function (error) {
        state.loading = false;
        state.payload = null;
        state.error = error && error.message ? error.message : String(error);
        state.errorIsNetwork = !(error && error.fromApi);
        render();
      });
  }

  function selectAgent(address) {
    state.selected = state.selected === address ? null : address;
    render();
  }

  /* ── rendering ──────────────────────────────────────────────────────── */

  function renderStatus() {
    if (state.loading) {
      el.status.innerHTML =
        '<div class="x-card"><span class="x-spinner"></span>Reading the program…</div>';
      return;
    }
    if (state.error) {
      // A malformed address is the reader's mistake and explains itself. Only a
      // network-level failure gets the "the function is not deployed" hint.
      var hint = state.errorIsNetwork
        ? '<div class="x-sub">This page calls <code>' +
          esc(API) +
          "</code>, which is a Vercel serverless function. If you are serving the site as " +
          "static files, that function is not served — deploy it, or run " +
          "<code>node dev-server.js</code>. A failure here is reported as a failure, never " +
          "as \u201Cno agents found\u201D.</div>"
        : "";
      el.status.innerHTML =
        '<div class="x-card x-warn x-error">' +
        "<strong>Could not read the program.</strong> " +
        esc(state.error) +
        "." +
        hint +
        "</div>";
      return;
    }
    el.status.innerHTML = "";
  }

  function renderSummary() {
    if (!state.payload) {
      el.summary.innerHTML = "";
      return;
    }
    var t = state.payload.totals;
    var counts = state.payload.counts;
    var vault = state.payload.vault;

    var tiles = [
      { k: "Agents", v: counts.agents, s: counts.bonds + " bonds posted" },
      {
        k: "Collateral at risk",
        v: sol(t.bondedLamports) + " SOL",
        s: "across all bonds",
      },
      { k: "Slashes recorded", v: t.slashCount, s: t.openSlashes + " still owed" },
      {
        k: "Escrow balance",
        v: vault ? sol(vault.availableLamports) + " SOL" : "—",
        s: vault ? "awaiting victims" : "vault not initialised",
      },
    ];

    el.summary.innerHTML =
      '<div class="x-tiles">' +
      tiles
        .map(function (tile) {
          return (
            '<div class="x-tile"><div class="k">' +
            esc(tile.k) +
            '</div><div class="v">' +
            esc(tile.v) +
            '</div><div class="s">' +
            esc(tile.s) +
            "</div></div>"
          );
        })
        .join("") +
      "</div>";
  }

  function renderRegistry() {
    if (!state.payload || state.payload.agents.length === 0) {
      el.registry.innerHTML = state.payload
        ? '<div class="x-card"><div class="x-empty">No agents are registered on this cluster yet.</div></div>'
        : "";
      return;
    }

    var rows = state.payload.agents
      .map(function (agent) {
        var p = agent.profile;
        return (
          "<tr data-address=\"" +
          esc(agent.address) +
          '">' +
          "<td><strong>" +
          esc(agent.name) +
          "</strong><div>" +
          addrLink(agent.address) +
          "</div></td>" +
          "<td>" +
          gradeBadge(p.grade) +
          ' <span class="x-mono">' +
          esc(p.score) +
          "</span></td>" +
          "<td>" +
          (p.bond ? esc(sol(p.bond.amountLamports)) + " SOL" : '<span class="x-mono">none</span>') +
          "</td>" +
          "<td>" +
          esc(p.stats.slashCount) +
          (p.stats.openSlashes > 0
            ? ' <span class="x-pill owed">' + esc(p.stats.openSlashes) + " owed</span>"
            : "") +
          "</td>" +
          "<td>" +
          esc(agent.status) +
          "</td>" +
          "<td>" +
          esc(agent.constraintCount) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    el.registry.innerHTML =
      '<div class="x-card"><div class="x-row"><h2>Agents on this cluster</h2>' +
      '<span class="x-sub">' +
      esc(state.payload.agents.length) +
      " registered · generated " +
      esc(when(state.payload.generatedAt)) +
      "</span></div>" +
      '<div style="overflow-x:auto;margin-top:14px;">' +
      '<table class="x-table"><thead><tr>' +
      "<th>Agent</th><th>Grade</th><th>Bond</th><th>Slashes</th><th>Status</th><th>Rules</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      '<div class="x-sub" style="margin-top:14px;">Select a row to see its bond and slash history.</div>' +
      "</div>";

    Array.prototype.forEach.call(el.registry.querySelectorAll("tr[data-address]"), function (row) {
      row.addEventListener("click", function () {
        selectAgent(row.getAttribute("data-address"));
      });
    });
  }

  function findAgent(address) {
    if (!state.payload || !address) return null;
    for (var i = 0; i < state.payload.agents.length; i++) {
      if (state.payload.agents[i].address === address) return state.payload.agents[i];
    }
    return null;
  }

  function renderDetail() {
    var agent = findAgent(state.selected);
    if (!agent) {
      el.detail.innerHTML = "";
      return;
    }

    var p = agent.profile;
    var warnings = p.warnings
      .map(function (w) {
        return '<div class="x-warn">' + esc(w) + "</div>";
      })
      .join("");

    var bond = p.bond
      ? "<div class=\"x-slash-row\"><span>Collateral</span><span>" +
        esc(sol(p.bond.amountLamports)) +
        ' SOL <span class="x-mono">(' +
        esc(p.bond.amountLamports) +
        " lamports)</span></span></div>" +
        "<div class=\"x-slash-row\"><span>Locked until</span><span>" +
        esc(when(p.bond.expiresAt)) +
        (p.bond.expired ? " · <span class=\"x-pill paid\">withdrawable</span>" : " · <span class=\"x-pill owed\">locked</span>") +
        "</span></div>" +
        "<div class=\"x-slash-row\"><span>Active</span><span>" +
        esc(p.bond.isActive ? "yes" : "no") +
        "</span></div>"
      : '<div class="x-warn">No bond account exists for this agent. Nothing is at stake, so no counterparty should treat it as accountable.</div>';

    var slashes =
      p.slashes.length === 0
        ? '<div class="x-slash-row"><span class="x-mono">No violations recorded.</span><span class="x-pill paid">clean</span></div>'
        : p.slashes
            .map(function (s) {
              return (
                '<div class="x-slash-row"><div><div>' +
                esc(s.reason || "(no reason given)") +
                '</div><div class="x-mono">' +
                esc(when(s.timestamp)) +
                " · nonce " +
                esc(s.nonce) +
                (s.victim ? " · victim " + addrLink(s.victim) : "") +
                "</div></div><div>" +
                "<strong>" +
                esc(sol(s.amountLamports)) +
                " SOL</strong> " +
                (s.compensated
                  ? '<span class="x-pill paid">compensated</span>'
                  : '<span class="x-pill owed">owed</span>') +
                "</div></div>"
              );
            })
            .join("");

    var constraints =
      agent.constraints.length === 0
        ? '<span class="x-mono">none attached</span>'
        : agent.constraints
            .map(function (c) {
              return (
                '<span class="x-pill ' +
                (c.isEnforced ? "paid" : "owed") +
                '">' +
                esc(c.type) +
                "</span>"
              );
            })
            .join(" ");

    el.detail.innerHTML =
      '<div class="x-card">' +
      '<div class="x-row"><div><h2>' +
      esc(agent.name) +
      "</h2><div class=\"x-sub\">" +
      addrLink(agent.address) +
      " · owner " +
      addrLink(agent.owner) +
      " · registered " +
      esc(when(agent.createdAt)) +
      "</div></div><div>" +
      gradeBadge(p.grade) +
      ' <span class="x-mono">derived ' +
      esc(p.score) +
      " / on-chain " +
      esc(p.onChainTrustScore) +
      "</span></div></div>" +
      '<div class="x-sub" style="margin-top:14px;">Constraints: ' +
      constraints +
      "</div>" +
      warnings +
      '<h2 style="margin-top:22px;font-size:15px;">Bond</h2>' +
      bond +
      '<h2 style="margin-top:22px;font-size:15px;">Slash history</h2>' +
      '<div class="x-slashes">' +
      slashes +
      "</div>" +
      '<div class="x-note">Totals: ' +
      esc(sol(p.stats.totalSlashedLamports)) +
      " SOL slashed, " +
      esc(sol(p.stats.compensationPaidLamports)) +
      " SOL paid to victims, " +
      esc(sol(p.stats.uncompensatedLamports)) +
      " SOL still owed.</div>" +
      '<div class="x-actions" style="margin-top:18px;">' +
      '<a href="' +
      EXPLORER +
      "/address/" +
      esc(agent.address) +
      '?cluster=devnet" target="_blank" rel="noopener">View on Solana Explorer</a>' +
      "<a href=\"" +
      API +
      "?agent=" +
      esc(agent.address) +
      '" target="_blank" rel="noopener">Raw JSON</a>' +
      '<button type="button" id="closeDetail">Close</button>' +
      "</div>" +
      "</div>";

    var close = document.getElementById("closeDetail");
    if (close) {
      close.addEventListener("click", function () {
        state.selected = null;
        render();
      });
    }
  }

  function render() {
    if (state.payload) {
      el.cluster.textContent = state.payload.cluster;
    }
    renderStatus();
    renderSummary();
    renderRegistry();
    renderDetail();
    el.lookup.disabled = state.loading;
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */

  el.form.addEventListener("submit", function (event) {
    event.preventDefault();
    var address = el.input.value.trim();
    if (!address) {
      load(null);
      return;
    }
    history.replaceState(null, "", "?agent=" + encodeURIComponent(address));
    load(address);
  });

  el.all.addEventListener("click", function () {
    el.input.value = "";
    history.replaceState(null, "", location.pathname);
    load(null);
  });

  // Deep links: `explorer.html?agent=<pubkey>` loads that agent directly, which
  // is the link a pitch or a README can hand to a judge.
  var initial = new URLSearchParams(location.search).get("agent");
  if (initial) {
    el.input.value = initial;
    load(initial);
  } else {
    load(null);
  }
})();
