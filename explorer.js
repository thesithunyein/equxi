/**
 * Trust Explorer — reads `/api/trust` and renders it.
 *
 * Deliberately a plain script in an IIFE, matching `app.js` and `main.js`: this
 * site is served as static files on Vercel with no bundler, so anything fancier
 * would need a build step that does not exist.
 *
 * The rendering rules that matter:
 *
 *   * **Nothing from the chain is trusted as HTML.** Agent names and slash
 *     reasons are attacker controlled — anyone can register an agent called
 *     `<img onerror=...>` — so every interpolation goes through `esc()`.
 *   * **Absence is shown as absence.** An agent with no bond renders as
 *     `ungraded`, never as a passing grade. A failure to reach the API renders as
 *     an error, never as "no agents found".
 *   * **The score is an audit, not an assertion.** Every point of the grade is
 *     rendered from `profile.breakdown`, which sums exactly to the score, so a
 *     reader can check the arithmetic instead of trusting a single number.
 *   * **Found is not the same as counted.** On a v0.1 account the on-chain
 *     constraint *counter* does not exist, so the rules shown come from the
 *     Constraint accounts themselves and the UI says which one it is showing
 *     rather than printing a confident `0`.
 */
(function () {
  "use strict";

  var API = "/api/trust";
  var BADGE = "/api/badge";
  var EXPLORER = "https://explorer.solana.com";
  var SITE = "https://equxi.sithunyein.com";

  var el = {
    form: document.getElementById("searchForm"),
    input: document.getElementById("agentInput"),
    lookup: document.getElementById("lookupBtn"),
    all: document.getElementById("allBtn"),
    refresh: document.getElementById("refreshBtn"),
    status: document.getElementById("status"),
    summary: document.getElementById("summary"),
    detail: document.getElementById("detail"),
    registry: document.getElementById("registry"),
    controls: document.getElementById("controls"),
    cluster: document.getElementById("clusterName"),
  };

  /** Default sort. The product's claim is that collateral creates
   *  accountability, so the registry leads with the most accountable agents. */
  var DEFAULT_SORT = "bond";

  var SORTS = [
    { key: "bond", label: "Collateral", hint: "Most collateral at stake first" },
    { key: "score", label: "Lowest score", hint: "Weakest accountability first" },
    { key: "slashes", label: "Slashes", hint: "Most recorded violations first" },
    { key: "newest", label: "Newest", hint: "Most recently registered first" },
    { key: "name", label: "Name", hint: "Alphabetical" },
  ];

  var GRADES = ["all", "A", "B", "C", "D", "F", "ungraded"];

  var state = {
    payload: null,
    error: null,
    /** True when the failure was the network, not a reply from our own API. */
    errorIsNetwork: false,
    loading: false,
    loadedAt: 0,
    /** Address of the agent whose detail panel is open. */
    selected: null,
    sort: DEFAULT_SORT,
    grade: "all",
    onlyOpen: false,
    /** Free-text filter applied to the already-fetched registry. */
    nameFilter: "",
    /** How the current payload was requested, so refresh and deep links agree. */
    request: { mode: "all", value: null },
    /** Set when a pubkey matched neither an agent PDA nor an owner wallet. */
    miss: null,
    copied: null,
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

  function ago(unixSeconds) {
    if (!unixSeconds) return "";
    var secs = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
    if (secs < 60) return secs + "s ago";
    if (secs < 3600) return Math.floor(secs / 60) + "m ago";
    return Math.floor(secs / 3600) + "h ago";
  }

  /** Base58, 32 bytes. Used only to decide *how* to look something up. */
  function looksLikePubkey(value) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ""));
  }

  function gradeBadge(grade) {
    var g = grade || "ungraded";
    return '<span class="x-grade g-' + esc(g) + '">' + esc(g) + "</span>";
  }

  function gradeRank(grade) {
    // Worst first, for the "Lowest score" sort and for reading a list quickly.
    return { ungraded: -1, F: 0, D: 1, C: 2, B: 3, A: 4 }[grade == null ? "ungraded" : grade];
  }

  function bondLamports(agent) {
    return agent.profile.bond ? Number(agent.profile.bond.amountLamports) : 0;
  }

  /* ── loading ────────────────────────────────────────────────────────── */

  function urlFor(request) {
    if (request.mode === "agent") return API + "?agent=" + encodeURIComponent(request.value);
    if (request.mode === "owner") return API + "?owner=" + encodeURIComponent(request.value);
    return API;
  }

  function load(request, options) {
    var opts = options || {};
    state.loading = true;
    state.error = null;
    state.miss = null;
    if (!opts.keepSelection) state.selected = null;
    state.request = request;
    render();

    fetch(urlFor(request), { headers: { accept: "application/json" } })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (body) {
            if (!response.ok || !body || !body.ok) {
              var failure = new Error(body && body.error ? body.error : "HTTP " + response.status);
              // The API answered and told us why. Do not blame the deployment.
              failure.fromApi = true;
              throw failure;
            }
            return body;
          });
      })
      .then(function (body) {
        // A pubkey may be an agent PDA or an owner wallet, and the reader should
        // not have to know which. Try the cheap point read first, then the owner
        // index, and only then report that nothing is registered.
        if (request.mode === "agent" && body.agents.length === 0) {
          return followOwnerFallback(request);
        }
        return body;
      })
      .then(function (body) {
        state.payload = body;
        state.loadedAt = Math.floor(Date.now() / 1000);
        state.errorIsNetwork = false;
        state.loading = false;
        // A deep link to exactly one agent opens its detail straight away.
        if (!opts.keepSelection && body.agents.length === 1 && state.request.mode !== "all") {
          state.selected = body.agents[0].address;
        }
        if (!opts.keepSelection && state.request.mode === "all" && body.agents.length === 1) {
          state.selected = body.agents[0].address;
        }
        render();
        if (opts.scrollTo) {
          var target = document.getElementById(opts.scrollTo);
          if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      })
      .catch(function (error) {
        state.loading = false;
        state.payload = null;
        state.error = error && error.message ? error.message : String(error);
        state.errorIsNetwork = !(error && error.fromApi);
        render();
      });
  }

  /** `?agent=` missed, so ask whether the address is an owner wallet instead. */
  function followOwnerFallback(request) {
    return fetch(API + "?owner=" + encodeURIComponent(request.value), {
      headers: { accept: "application/json" },
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (body) {
            if (!response.ok || !body || !body.ok) {
              // Never degrade a failure into "nothing found". If this lookup
              // cannot be answered, the page says so instead of inventing a
              // reassuring empty result.
              var failure = new Error(
                body && body.error ? body.error : "HTTP " + response.status
              );
              failure.fromApi = true;
              throw failure;
            }
            if (body.agents.length > 0) {
              state.request = { mode: "owner", value: request.value };
              state.miss = null;
              // Relabel the URL to what was actually found: the address was a
              // wallet, not an agent account, and a shared link should say so.
              history.replaceState(null, "", "?owner=" + encodeURIComponent(request.value));
              return body;
            }
            state.miss = request.value;
            return body;
          });
      });
  }

  function submitSearch(text) {
    var value = String(text || "").trim();
    if (!value) {
      history.replaceState(null, "", location.pathname);
      state.nameFilter = "";
      load({ mode: "all", value: null });
      return;
    }
    if (looksLikePubkey(value)) {
      state.nameFilter = "";
      history.replaceState(null, "", "?agent=" + encodeURIComponent(value));
      load({ mode: "agent", value: value });
      return;
    }
    // A name search is a filter over the registry, and it stays shareable.
    state.nameFilter = value;
    history.replaceState(null, "", "?q=" + encodeURIComponent(value));
    load({ mode: "all", value: null }, { scrollTo: "registry" });
  }

  function selectAgent(address) {
    state.selected = state.selected === address ? null : address;
    render();
    if (state.selected) {
      var panel = document.getElementById("detail");
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function copy(text, key) {
    var done = function () {
      state.copied = key;
      render();
      setTimeout(function () {
        if (state.copied === key) {
          state.copied = null;
          render();
        }
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        window.prompt("Copy this:", text);
      });
      return;
    }
    window.prompt("Copy this:", text);
  }

  /* ── score ledger ───────────────────────────────────────────────────── */

  /**
   * Render `profile.breakdown` as a ledger. The rows sum exactly to the score —
   * that is asserted in `tests/unit/layout.test.ts`, and it is the difference
   * between a grade and an explanation.
   */
  function renderBreakdown(profile) {
    var entries = profile.breakdown || [];
    var rows = entries
      .map(function (entry, index) {
        var isBase = index === 0;
        var points = entry.points;
        // Always the number, including the base row: the label already says what
        // it is, and repeating it in the points column reads like a mistake.
        var amount = (points < 0 ? "\u2212" : "+") + Math.abs(points);
        return (
          '<div class="x-ledger-row' +
          (isBase ? " base" : "") +
          '"><span class="x-ledger-pts">' +
          esc(amount) +
          "</span><span>" +
          esc(entry.label) +
          "</span></div>"
        );
      })
      .join("");

    return (
      '<div class="x-ledger">' +
      rows +
      '<div class="x-ledger-row total"><span class="x-ledger-pts">= ' +
      esc(profile.score) +
      "</span><span>Score, graded " +
      gradeBadge(profile.grade) +
      "</span></div>" +
      "</div>"
    );
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

    var programWarnings = (state.payload.warnings || [])
      .map(function (w) {
        return '<div class="x-warn">' + esc(w) + "</div>";
      })
      .join("");

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
      "</div>" +
      programWarnings +
      (state.miss
        ? '<div class="x-warn">No agent is registered at <span class="x-mono">' +
          esc(state.miss) +
          "</span>, and it owns no agents either.</div>"
        : "");
  }

  /** Apply the reader's sort, grade filter, open-slash filter and name search. */
  function visibleAgents() {
    if (!state.payload) return [];
    var filter = state.nameFilter.trim().toLowerCase();

    var list = state.payload.agents.filter(function (agent) {
      if (state.grade !== "all" && agent.profile.grade !== state.grade) return false;
      if (state.onlyOpen && !(agent.profile.stats.openSlashes > 0)) return false;
      if (filter) {
        var haystack = (agent.name + " " + agent.address + " " + agent.owner).toLowerCase();
        if (haystack.indexOf(filter) === -1) return false;
      }
      return true;
    });

    var byKey = {
      bond: function (a, b) {
        return bondLamports(b) - bondLamports(a) || a.name.localeCompare(b.name);
      },
      score: function (a, b) {
        return (
          gradeRank(a.profile.grade) - gradeRank(b.profile.grade) ||
          a.profile.score - b.profile.score ||
          b.profile.stats.slashCount - a.profile.stats.slashCount
        );
      },
      slashes: function (a, b) {
        return b.profile.stats.slashCount - a.profile.stats.slashCount || bondLamports(b) - bondLamports(a);
      },
      newest: function (a, b) {
        return b.createdAt - a.createdAt;
      },
      name: function (a, b) {
        return a.name.localeCompare(b.name);
      },
    };

    return list.sort(byKey[state.sort] || byKey[DEFAULT_SORT]);
  }

  function renderControls() {
    if (!state.payload || state.payload.agents.length === 0) {
      el.controls.innerHTML = "";
      return;
    }

    var sortButtons = SORTS.map(function (sort) {
      return (
        '<button type="button" class="x-chip' +
        (state.sort === sort.key ? " on" : "") +
        '" data-sort="' +
        esc(sort.key) +
        '" aria-pressed="' +
        (state.sort === sort.key ? "true" : "false") +
        '" title="' +
        esc(sort.hint) +
        '">' +
        esc(sort.label) +
        "</button>"
      );
    }).join("");

    var gradeButtons = GRADES.map(function (grade) {
      return (
        '<button type="button" class="x-chip' +
        (state.grade === grade ? " on" : "") +
        '" data-grade="' +
        esc(grade) +
        '" aria-pressed="' +
        (state.grade === grade ? "true" : "false") +
        '">' +
        esc(grade === "all" ? "Any grade" : grade) +
        "</button>"
      );
    }).join("");

    var shown = visibleAgents().length;

    el.controls.innerHTML =
      '<div class="x-card x-controls">' +
      '<div class="x-control-row"><span class="x-control-label">Sort</span>' +
      sortButtons +
      "</div>" +
      '<div class="x-control-row"><span class="x-control-label">Grade</span>' +
      gradeButtons +
      '<button type="button" class="x-chip' +
      (state.onlyOpen ? " on" : "") +
      '" id="onlyOpen" aria-pressed="' +
      (state.onlyOpen ? "true" : "false") +
      '">Only unpaid slashes</button>' +
      "</div>" +
      '<div class="x-control-row"><span class="x-control-label"></span><span class="x-sub">' +
      esc(shown) +
      " of " +
      esc(state.payload.agents.length) +
      " agents shown" +
      (state.nameFilter ? " · filtered by “" + esc(state.nameFilter) + "”" : "") +
      "</span></div>" +
      "</div>";

    Array.prototype.forEach.call(el.controls.querySelectorAll("[data-sort]"), function (button) {
      button.addEventListener("click", function () {
        state.sort = button.getAttribute("data-sort");
        render();
      });
    });
    Array.prototype.forEach.call(el.controls.querySelectorAll("[data-grade]"), function (button) {
      button.addEventListener("click", function () {
        state.grade = button.getAttribute("data-grade");
        render();
      });
    });
    var open = document.getElementById("onlyOpen");
    if (open) {
      open.addEventListener("click", function () {
        state.onlyOpen = !state.onlyOpen;
        render();
      });
    }
  }

  function renderRegistry() {
    if (!state.payload) {
      el.registry.innerHTML = "";
      return;
    }
    if (state.payload.agents.length === 0) {
      // Three different reasons for an empty table, and they are not
      // interchangeable: an empty cluster, a searched address that holds nothing,
      // and a wallet that owns nothing. Saying "the cluster is empty" when the
      // reader simply mistyped an address would be a lie about the data.
      var copy;
      if (state.miss) {
        copy =
          "Nothing is registered at <span class=\"x-mono\">" +
          esc(short(state.miss)) +
          "</span> — it is not an agent account, and it owns no agents on this cluster.";
      } else if (state.request.mode === "owner") {
        copy =
          "That wallet owns no Equxi agents on this cluster. Agents are owned by the wallet that " +
          "registered them, so check the owner address or search by name.";
      } else {
        copy =
          "No agents are registered on this cluster yet.<br />Register one from the " +
          '<a class="x-link" href="app.html">dashboard</a>, then reload this page.';
      }
      el.registry.innerHTML = '<div class="x-card"><div class="x-empty">' + copy + "</div></div>";
      return;
    }

    var list = visibleAgents();
    if (list.length === 0) {
      el.registry.innerHTML =
        '<div class="x-card"><div class="x-empty">No agent matches the current filter' +
        (state.nameFilter ? " (“" + esc(state.nameFilter) + "”)" : "") +
        '.<br /><button type="button" class="x-chip" id="clearFilters">Clear filters</button></div></div>';
      var clear = document.getElementById("clearFilters");
      if (clear) {
        clear.addEventListener("click", function () {
          state.nameFilter = "";
          state.grade = "all";
          state.onlyOpen = false;
          el.input.value = "";
          history.replaceState(null, "", location.pathname);
          render();
        });
      }
      return;
    }

    var rows = list
      .map(function (agent) {
        var p = agent.profile;
        var rules = agent.constraints.length;
        return (
          "<tr data-address=\"" +
          esc(agent.address) +
          '"' +
          (state.selected === agent.address ? ' class="sel"' : "") +
          ">" +
          "<td><strong>" +
          esc(agent.name) +
          "</strong><div>" +
          addrLink(agent.address) +
          "</div></td>" +
          "<td>" +
          addrLink(agent.owner) +
          "</td>" +
          "<td>" +
          gradeBadge(p.grade) +
          ' <span class="x-mono">' +
          esc(p.score) +
          "</span></td>" +
          "<td>" +
          (p.bond
            ? esc(sol(p.bond.amountLamports)) + " SOL"
            : '<span class="x-mono">none</span>') +
          "</td>" +
          "<td>" +
          esc(p.stats.slashCount) +
          (p.stats.openSlashes > 0
            ? ' <span class="x-pill owed">' + esc(p.stats.openSlashes) + " owed</span>"
            : "") +
          "</td>" +
          "<td>" +
          esc(rules) +
          (agent.layout === "v1"
            ? '<div class="x-sub" style="font-size:11px;">found (counter n/a)</div>'
            : "") +
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
      "<th>Agent</th><th>Owner</th><th>Grade</th><th>Collateral</th><th>Slashes</th><th>Rules</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      '<div class="x-sub" style="margin-top:14px;">Select a row to open its bond, slash history and score ledger. ' +
      "Rules are read from the constraint accounts themselves, so the count is correct even on a v0.1 " +
      "deployment that has no on-chain counter.</div>" +
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

  function renderEmbed(agent) {
    // Absolute URLs for the copyable snippets, because they are embedded
    // somewhere else; a same-origin path for the live preview, because that
    // renders correctly on a dev server too (the site's own host may not be
    // deployed yet, and a badge that 404s is blocked by ORB as a broken image).
    var badgePath = BADGE + "?agent=" + encodeURIComponent(agent.address);
    var badgeUrl = SITE + badgePath;
    var link = SITE + "/explorer.html?agent=" + agent.address;
    var markdown = "[![Equxi trust](" + badgeUrl + ")](" + link + ")";
    var html =
      '<a href="' + link + '"><img src="' + badgeUrl + '" alt="Equxi trust: ' + esc(agent.name) + '" /></a>';

    return (
      '<h2 style="margin-top:22px;font-size:15px;">Embed this agent\u2019s live grade</h2>' +
      '<div class="x-sub">The badge is not a certificate — it re-reads the chain on every request, ' +
      "so it cannot go stale or be faked by copying markup.</div>" +
      '<div class="x-embed-preview"><img src="' +
      esc(badgePath) +
      '" alt="Equxi trust badge" height="20" /></div>' +
      '<div class="x-embed-row"><input readonly value="' +
      esc(markdown) +
      '" aria-label="Markdown embed" />' +
      '<button type="button" data-copy="' +
      esc(markdown) +
      '" data-copykey="md">' +
      (state.copied === "md" ? "Copied" : "Copy Markdown") +
      "</button></div>" +
      '<div class="x-embed-row"><input readonly value="' +
      esc(html) +
      '" aria-label="HTML embed" />' +
      '<button type="button" data-copy="' +
      esc(html) +
      '" data-copykey="html">' +
      (state.copied === "html" ? "Copied" : "Copy HTML") +
      "</button></div>" +
      '<div class="x-embed-row"><input readonly value="' +
      esc(SITE + BADGE + "?agent=" + agent.address + "&format=json") +
      '" aria-label="JSON endpoint" />' +
      '<button type="button" data-copy="' +
      esc(SITE + BADGE + "?agent=" + agent.address + "&format=json") +
      '" data-copykey="json">' +
      (state.copied === "json" ? "Copied" : "Copy JSON URL") +
      "</button></div>"
    );
  }

  function renderDetail() {
    var agent = findAgent(state.selected);
    if (!agent) {
      el.detail.innerHTML = "";
      return;
    }

    var p = agent.profile;
    var notes = p.warnings
      .map(function (w) {
        return '<div class="x-note">' + esc(w) + "</div>";
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
                '" title="' +
                esc(
                  "max " +
                    sol(c.params.maxAmountLamports) +
                    " SOL per tx, " +
                    sol(c.params.maxPerPeriod) +
                    " SOL per " +
                    Math.round(c.params.periodSeconds / 3600) +
                    "h, timelock " +
                    c.params.timelockSeconds +
                    "s"
                ) +
                '">' +
                esc(c.type) +
                "</span>"
              );
            })
            .join(" ");

    var layoutNote =
      agent.layout === "v1"
        ? '<div class="x-note">This agent account predates the v0.2 layout, so the on-chain ' +
          "constraint <em>counter</em> does not exist. The rules above were found by reading the " +
          "Constraint accounts directly, which is why the registry shows a count where the account " +
          "itself would report 0.</div>"
        : "";

    el.detail.innerHTML =
      '<div class="x-card">' +
      '<div class="x-row"><div><h2>' +
      esc(agent.name) +
      '</h2><div class="x-sub">' +
      addrLink(agent.address) +
      " · owner " +
      addrLink(agent.owner) +
      " · " +
      esc(agent.agentType) +
      " · registered " +
      esc(when(agent.createdAt)) +
      " · status " +
      esc(agent.status) +
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
      layoutNote +
      notes +
      '<h2 style="margin-top:22px;font-size:15px;">Why this score</h2>' +
      '<div class="x-sub">Every point is derived from chain state, and the rows below sum to the ' +
      "score. The on-chain <span class=\"x-mono\">trust_score</span> is admin-set and is deliberately " +
      "not one of them.</div>" +
      renderBreakdown(p) +
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
      " SOL still owed · estimated " +
      esc(p.stats.slashRatePerMonth.toFixed(2)) +
      " slashes/month.</div>" +
      renderEmbed(agent) +
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
      '<button type="button" data-copy="' +
      esc(SITE + "/explorer.html?agent=" + agent.address) +
      '" data-copykey="link">' +
      (state.copied === "link" ? "Link copied" : "Copy link to this agent") +
      "</button>" +
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
    Array.prototype.forEach.call(el.detail.querySelectorAll("[data-copy]"), function (button) {
      button.addEventListener("click", function () {
        copy(button.getAttribute("data-copy"), button.getAttribute("data-copykey"));
      });
    });

    // A shared link should read like the agent, not like a generic page.
    document.title = agent.name + " · " + p.grade + " " + p.score + " · Equxi Trust Explorer";
  }

  function render() {
    if (state.payload) {
      el.cluster.textContent = state.payload.cluster;
    }
    if (!state.selected) {
      document.title = "Equxi | Trust Explorer";
    }
    renderStatus();
    renderSummary();
    renderDetail();
    renderControls();
    renderRegistry();
    el.lookup.disabled = state.loading;
    if (el.refresh) {
      el.refresh.disabled = state.loading;
      el.refresh.textContent = state.loading
        ? "Reading…"
        : state.loadedAt
          ? "Refresh · " + ago(state.loadedAt)
          : "Refresh";
    }
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */

  el.form.addEventListener("submit", function (event) {
    event.preventDefault();
    submitSearch(el.input.value);
  });

  // Handle Enter on the input directly instead of relying on implicit form
  // submission. Implicit submission works in a desktop browser with one submit
  // button, but it is the one interaction a phone keyboard ("Go") and an
  // embedded webview disagree about, and a search box that ignores Enter reads
  // as broken. `preventDefault` keeps the two paths from both firing.
  el.input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      submitSearch(el.input.value);
    }
  });

  el.all.addEventListener("click", function () {
    el.input.value = "";
    state.nameFilter = "";
    state.grade = "all";
    state.onlyOpen = false;
    history.replaceState(null, "", location.pathname);
    load({ mode: "all", value: null });
  });

  if (el.refresh) {
    el.refresh.addEventListener("click", function () {
      load(state.request || { mode: "all", value: null }, { keepSelection: true });
    });
  }

  // Keep the "refreshed Ns ago" label honest without refetching anything.
  setInterval(function () {
    if (state.loadedAt && !state.loading && el.refresh) {
      el.refresh.textContent = "Refresh · " + ago(state.loadedAt);
    }
  }, 15000);

  // Deep links: `explorer.html?agent=<pubkey>`, `?owner=<wallet>` and
  // `?q=<name>` all work, which is what a pitch, a README or a badge can hand
  // to a judge.
  var params = new URLSearchParams(location.search);
  var initialAgent = params.get("agent");
  var initialOwner = params.get("owner");
  var initialQuery = params.get("q");

  if (initialAgent) {
    el.input.value = initialAgent;
    load({ mode: "agent", value: initialAgent });
  } else if (initialOwner) {
    el.input.value = initialOwner;
    load({ mode: "owner", value: initialOwner });
  } else if (initialQuery) {
    el.input.value = initialQuery;
    state.nameFilter = initialQuery;
    load({ mode: "all", value: null });
  } else {
    load({ mode: "all", value: null });
  }
})();
