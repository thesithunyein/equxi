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
 *   * **Written for someone checking an agent, not someone reading the repo.**
 *     Every label answers the question the page exists to answer, the explainer
 *     lives on the page rather than in a Markdown file, and the only material
 *     behind a fold is what a developer embedding the badge needs. Nothing here
 *     requires the source to be understood or opened.
 */
(function () {
  "use strict";

  var API = "/api/trust";
  var MARKETS = "/api/markets";
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
    registry: document.getElementById("registry"),
    markets: document.getElementById("markets"),
    controls: document.getElementById("controls"),
    cluster: document.getElementById("clusterName"),
  };

  /** Default sort. The product's claim is that collateral creates
   *  accountability, so the registry leads with the most accountable agents. */
  var DEFAULT_SORT = "bond";

  var SORTS = [
    { key: "bond", label: "Collateral", hint: "Most collateral at stake first" },
    { key: "score", label: "Lowest score", hint: "Weakest accountability first" },
    { key: "slashes", label: "Slashes", hint: "Most recorded slashes first" },
    { key: "newest", label: "Newest", hint: "Most recently registered first" },
    { key: "name", label: "Name", hint: "Alphabetical" },
  ];

  var GRADES = ["all", "A", "B", "C", "D", "F", "ungraded"];

  /** The on-chain rule names, said the way a reader would say them. */
  var RULE_LABELS = {
    spend_limit: "Spending limit",
    program_allowlist: "Allowed programs",
    timelock: "Timelock",
    velocity: "Speed limit",
    custom: "Custom rule",
  };

  var state = {
    payload: null,
    /** The Panta markets feed, read independently of the chain registry. */
    markets: null,
    marketsError: null,
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
    if (!unixSeconds) return "N/A";
    try {
      return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
    } catch (e) {
      return "N/A";
    }
  }

  function ago(unixSeconds) {
    if (!unixSeconds) return "";
    var secs = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
    if (secs < 60) return secs + "s ago";
    if (secs < 3600) return Math.floor(secs / 60) + "m ago";
    return Math.floor(secs / 3600) + "h ago";
  }

  /** One line for the slashes tile: paid, unpaid, or none at all. */
  function slashSummary(totals) {
    if (!totals.slashCount) return "none recorded";
    var unpaid = totals.openSlashes || 0;
    var paid = Math.max(0, totals.slashCount - unpaid);
    if (!unpaid) return paid === 1 ? "1 paid to a victim" : "all paid to victims";
    return paid + " paid · " + unpaid + " still unpaid";
  }

  /** One market, rendered the same way in the registry card and per agent. */
  function marketRow(m) {
    var stats = [];
    if (m.yesPrice != null && m.yesPrice !== "") stats.push("<span>YES " + esc(m.yesPrice) + "</span>");
    if (m.noPrice != null && m.noPrice !== "") stats.push("<span>NO " + esc(m.noPrice) + "</span>");
    if (m.volumeUsdc != null && m.volumeUsdc !== "") {
      stats.push("<span>" + esc(m.volumeUsdc) + " USDC traded</span>");
    }
    if (m.category) stats.push("<span>" + esc(m.category) + "</span>");
    var phase = m.phase || m.status || "";
    return (
      '<div class="x-market-row"><div class="x-market-head"><span class="x-market-title">' +
      esc(m.title || m.marketId || "Untitled market") +
      "</span>" +
      (phase ? '<span class="x-market-phase">' + esc(phase) + "</span>" : "") +
      "</div>" +
      (m.description ? '<div class="x-sub">' + esc(m.description) + "</div>" : "") +
      (stats.length ? '<div class="x-market-stats">' + stats.join("") + "</div>" : "") +
      "</div>"
    );
  }

  /** Markets that name this agent, by address or by name, in any field. */
  function marketsFor(agent) {
    var feed = state.markets;
    if (!feed || !feed.configured) return [];
    var list = feed.markets || [];
    var name = String(agent.name || "").toLowerCase();
    var address = String(agent.address || "").toLowerCase();
    if (!name && !address) return [];
    return list.filter(function (m) {
      var haystack = (
        String(m.title || "") +
        " " +
        String(m.description || "") +
        " " +
        String(m.marketId || "")
      ).toLowerCase();
      if (address && haystack.indexOf(address) !== -1) return true;
      return name ? haystack.indexOf(name) !== -1 : false;
    });
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

  /**
   * Read the Panta markets feed. It is a separate request from the chain read
   * on purpose: a markets outage must not make the registry look empty, and a
   * registry outage must not hide the markets.
   */
  function loadMarkets() {
    fetch(MARKETS + "?limit=50", { headers: { accept: "application/json" } })
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
      .then(function (body) {
        state.markets = body;
        state.marketsError = null;
        render();
      })
      .catch(function (error) {
        state.markets = null;
        state.marketsError = error && error.message ? error.message : String(error);
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

  /**
   * Open or close one agent's panel. The panel renders directly under that
   * agent's row, so there is nothing to scroll to: the reader stays exactly
   * where they clicked.
   */
  function selectAgent(address) {
    state.selected = state.selected === address ? null : address;
    render();
    // render() rebuilds the table, so put focus back on the row that was just
    // used: expanding a row must not drop the keyboard on the floor.
    var row = rowFor(address);
    if (row && typeof row.focus === "function") {
      try {
        row.focus({ preventScroll: true });
      } catch (e) {
        row.focus();
      }
    }
  }

  /**
   * Select a snippet so the reader can copy it themselves. This is the fallback
   * when the clipboard API is unavailable or refused, which happens on http and
   * in embedded webviews. A native prompt would block the page, so the snippet
   * is selected in place instead: the text the button was going to copy is the
   * text now highlighted under the reader's cursor.
   */
  function selectSnippet(text, button) {
    var row = button && button.parentNode;
    var input = row ? row.querySelector("input") : null;
    if (input && input.value === text) {
      input.focus();
      input.select();
      return true;
    }
    return false;
  }

  function copy(text, key, button) {
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
        selectSnippet(text, button);
      });
      return;
    }
    selectSnippet(text, button);
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
        '<div class="x-card"><span class="x-spinner"></span>Reading the chain…</div>';
      return;
    }
    if (state.error) {
      // A failure to read is reported as a failure, with the one thing the
      // reader can act on: try again. It is never rendered as an empty registry.
      var hint = state.errorIsNetwork
        ? '<div class="x-sub">The chain read did not come back, so nothing is shown as zero ' +
          "and nothing is shown as an empty registry. Use Refresh to try again.</div>"
        : "";
      el.status.innerHTML =
        '<div class="x-card x-warn x-error">' +
        "<strong>Could not read the registry.</strong> " +
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

    // A lookup for one address that matched nothing is not an empty network.
    // Rendering the fleet tiles here would say "0 agents, 0 SOL, 0 slashes"
    // about a chain that has six of each, which is a lie about the data; the
    // registry card explains the miss and offers the way back instead.
    if (counts.agents === 0 && state.request.mode !== "all") {
      el.summary.innerHTML = "";
      return;
    }

    // Plain words, not the schema's: these are the four things a reader is
    // actually deciding about before they let an agent hold their money.
    var tiles = [
      {
        k: "Agents listed",
        v: counts.agents,
        s: counts.bonds === 1 ? "1 with collateral posted" : counts.bonds + " with collateral posted",
      },
      {
        k: "Collateral at stake",
        v: sol(t.bondedLamports) + " SOL",
        s: "locked on chain by their owners",
      },
      { k: "Slashes recorded", v: t.slashCount, s: slashSummary(t) },
      {
        k: "Escrow for victims",
        v: vault ? sol(vault.availableLamports) + " SOL" : "N/A",
        s: vault ? "held by the program to pay victims" : "no vault on this deployment",
      },
    ];

    var warnings = state.payload.warnings || [];
    // Published next to the totals, never buried: a total that does not
    // reconcile is a fact about this deployment, not something to round away.
    var notes = warnings.length
      ? '<div class="x-card x-datanotes"><div class="x-datanotes-head">Data notes</div>' +
        '<div class="x-sub">What the totals above leave out, published rather than rounded away.</div>' +
        warnings
          .map(function (w) {
            return '<div class="x-note">' + esc(w) + "</div>";
          })
          .join("") +
        "</div>"
      : "";

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
      notes;
  }

  /**
   * The Panta markets feed. Hidden when this deployment has no key; when the
   * key is a test key the fixtures are labelled as fixtures, never presented
   * as live markets.
   */
  function renderMarkets() {
    if (!el.markets) return;

    if (state.marketsError) {
      el.markets.innerHTML =
        '<div class="x-card"><div class="x-row"><h2>Markets on agents</h2>' +
        '<span class="x-sub">Powered by Panta</span></div>' +
        '<div class="x-sub">The Panta markets feed could not be read, so no market is ' +
        "shown. The registry above is read separately and is unaffected.</div></div>";
      return;
    }

    var feed = state.markets;
    if (!feed || !feed.configured) {
      el.markets.innerHTML = "";
      return;
    }

    var list = feed.markets || [];
    var sandbox = feed.sandbox === true;
    var head =
      '<div class="x-row"><h2>Markets on agents</h2><span class="x-sub">' +
      esc(list.length) +
      (list.length === 1 ? " market" : " markets") +
      " from Panta · " +
      '<a class="x-link" href="https://panta.market" target="_blank" rel="noopener">Powered by Panta</a></span></div>';

    var banner = sandbox
      ? '<div class="x-sandbox"><strong>Sandbox fixtures.</strong> ' +
        esc(
          feed.disclaimer ||
            "This deployment reads Panta with a test key, so the markets below are fixtures and do not touch Solana mainnet."
        ) +
        "</div>"
      : "";

    var body = list.length
      ? '<div class="x-market-list">' + list.map(marketRow).join("") + "</div>"
      : '<div class="x-sub">No markets are open on Panta right now.</div>';

    el.markets.innerHTML = '<div class="x-card">' + head + banner + body + "</div>";
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
      (state.nameFilter ? " · matching “" + esc(state.nameFilter) + "”" : "") +
      "</span></div>" +
      '<div class="x-legend">Grade <b>A</b> is the strongest and <b>F</b> the weakest, built from ' +
      "on-chain evidence only. <b>Ungraded</b> means no collateral is posted, so nothing is at stake.</div>" +
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

  /** True when an address is in the list that is being rendered. */
  function isVisible(address, list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].address === address) return true;
    }
    return false;
  }

  /** The row element for an address, or null when a filter has hidden it. */
  function rowFor(address) {
    var rows = el.registry.querySelectorAll("tr[data-address]");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-address") === address) return rows[i];
    }
    return null;
  }

  /** The empty state's one button takes the reader back to the full list. */
  function wireClearSearch() {
    var button = document.getElementById("clearSearchBtn");
    if (!button) return;
    button.addEventListener("click", function () {
      el.input.value = "";
      state.nameFilter = "";
      state.miss = null;
      history.replaceState(null, "", location.pathname);
      load({ mode: "all", value: null });
    });
  }

  /** Wire the controls inside an expanded panel, after it has been inserted. */
  function wireDetail() {
    var close = document.getElementById("closeDetail");
    if (close) {
      close.addEventListener("click", function () {
        state.selected = null;
        render();
      });
    }
    Array.prototype.forEach.call(el.registry.querySelectorAll("[data-copy]"), function (button) {
      button.addEventListener("click", function () {
        copy(button.getAttribute("data-copy"), button.getAttribute("data-copykey"), button);
      });
    });
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
      var actions;
      if (state.miss) {
        copy =
          "<strong>Nothing is registered at this address</strong><span class=\"x-mono\">" +
          esc(short(state.miss)) +
          "</span> is not an agent, and it owns none. Check the address, or search by name.";
        actions = '<button type="button" id="clearSearchBtn">Show all agents</button>';
      } else if (state.request.mode === "owner") {
        copy =
          "<strong>That wallet owns no agent yet</strong>" +
          "Agents belong to the wallet that registered them. Check the owner address, or search by name.";
        actions = '<button type="button" id="clearSearchBtn">Show all agents</button>';
      } else {
        copy =
          "<strong>No agents are registered yet</strong>" +
          "The registry is empty right now. An agent appears here the moment its owner registers it.";
        actions = '<a href="app.html">Register your first agent</a>';
      }
      el.registry.innerHTML =
        '<div class="x-card"><div class="x-empty">' + copy + '<div class="x-actions">' + actions + "</div></div></div>";
      wireClearSearch();
      return;
    }

    var list = visibleAgents();

    // A filter can hide the agent whose panel is open; close it rather than
    // leave a panel expanded for a row the reader cannot see.
    if (state.selected && !isVisible(state.selected, list)) state.selected = null;

    if (list.length === 0) {
      el.registry.innerHTML =
        '<div class="x-card"><div class="x-empty"><strong>No agent matches these filters</strong>' +
        (state.nameFilter ? "Nothing matches “" + esc(state.nameFilter) + "”." : "Try a wider grade.") +
        '<div class="x-actions"><button type="button" id="clearFilters">Clear filters</button></div></div></div>';
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

    var selectedAgent = findAgent(state.selected);
    // The panel is a row of the table, directly under the agent it describes.
    var detailRow = selectedAgent
      ? '<tr class="x-detail-tr"><td colspan="7"><div class="x-card x-detail-card" id="detail">' +
        detailHtml(selectedAgent) +
        "</div></td></tr>"
      : "";

    var rows = list
      .map(function (agent) {
        var p = agent.profile;
        var rules = agent.constraints.length;
        var open = selectedAgent && selectedAgent.address === agent.address;
        return (
          '<tr data-address="' +
          esc(agent.address) +
          '" tabindex="0" role="button" aria-expanded="' +
          (open ? "true" : "false") +
          '"' +
          (open ? ' class="open"' : "") +
          ">" +
          '<td data-label="Agent"><strong>' +
          esc(agent.name) +
          "</strong><div>" +
          addrLink(agent.address) +
          "</div></td>" +
          '<td data-label="Owner">' +
          addrLink(agent.owner) +
          "</td>" +
          '<td data-label="Grade">' +
          gradeBadge(p.grade) +
          ' <span class="x-mono">' +
          esc(p.score) +
          "</span></td>" +
          '<td data-label="Collateral at stake">' +
          (p.bond
            ? esc(sol(p.bond.amountLamports)) + " SOL"
            : '<span class="x-mono">none</span>') +
          "</td>" +
          '<td data-label="Slashes">' +
          esc(p.stats.slashCount) +
          (p.stats.openSlashes > 0
            ? ' <span class="x-pill owed" title="Recorded but not yet paid to a victim">' +
              esc(p.stats.openSlashes) +
              " unpaid</span>"
            : "") +
          "</td>" +
          '<td data-label="Rules">' +
          esc(rules) +
          "</td>" +
          '<td data-label="Details"><span class="sr-only">' +
          (open ? "Hide details" : "Show details") +
          '</span><i class="fa-solid fa-chevron-right x-caret" aria-hidden="true"></i></td>' +
          "</tr>" +
          (open ? detailRow : "")
        );
      })
      .join("");

    el.registry.innerHTML =
      '<div class="x-card"><div class="x-row"><h2>Agents on this chain</h2>' +
      '<span class="x-sub">' +
      esc(state.payload.agents.length) +
      " registered · updated " +
      esc(ago(state.payload.generatedAt) || when(state.payload.generatedAt)) +
      "</span></div>" +
      '<div style="overflow-x:auto;margin-top:14px;">' +
      '<table class="x-table"><thead><tr>' +
      "<th>Agent</th><th>Owner</th>" +
      '<th title="Built only from on-chain evidence: collateral locked, and whether each slash was paid">Grade</th>' +
      '<th title="SOL the owner locked behind this agent, slashable if a rule breaks">Collateral at stake</th>' +
      '<th title="Times collateral has actually been taken">Slashes</th>' +
      '<th title="On-chain rules the owner attached, such as a spend cap or a timelock">Rules</th>' +
      '<th><span class="sr-only">Details</span></th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      '<div class="x-sub" style="margin-top:14px;">Open a row to see its collateral, its slash history and the ledger behind its grade. ' +
      "Rules is how many on-chain rules the owner attached; an unpaid mark means a recorded slash has not reached its victim yet.</div>" +
      "</div>";

    Array.prototype.forEach.call(el.registry.querySelectorAll("tr[data-address]"), function (row) {
      row.addEventListener("click", function (event) {
        // The address and owner links open the chain explorer; clicking one of
        // them should not also toggle the row it sits in.
        if (event.target && event.target.closest && event.target.closest("a")) return;
        selectAgent(row.getAttribute("data-address"));
      });
      // A row that behaves like a button has to answer the keyboard like one.
      row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          selectAgent(row.getAttribute("data-address"));
        }
      });
    });
    wireDetail();
  }

  function findAgent(address) {
    if (!state.payload || !address) return null;
    for (var i = 0; i < state.payload.agents.length; i++) {
      if (state.payload.agents[i].address === address) return state.payload.agents[i];
    }
    return null;
  }

  /** One copyable snippet, so the three of them cannot drift apart. */
  function embedRow(label, value, key, action) {
    return (
      '<div class="x-embed-row"><input readonly value="' +
      esc(value) +
      '" aria-label="' +
      esc(label) +
      '" />' +
      '<button type="button" data-copy="' +
      esc(value) +
      '" data-copykey="' +
      esc(key) +
      '">' +
      (state.copied === key ? "Copied" : esc(action)) +
      "</button></div>"
    );
  }

  /**
   * The builder snippets, folded away. A person checking an agent never needs
   * them, and the page is shorter for it; a developer opens one fold and gets
   * the badge without leaving the site.
   */
  function renderBuilders(agent) {
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
    var badgeJson = SITE + BADGE + "?agent=" + agent.address + "&format=json";
    var rawJson = API + "?agent=" + agent.address;

    return (
      '<details class="x-fold" style="margin-top:20px;border-radius:12px;">' +
      '<summary><span style="font-size:14px;">Add this grade to your own site</span>' +
      '<span class="x-fold-hint">Badge, Markdown, HTML</span>' +
      '<i class="fa-solid fa-chevron-down"></i></summary>' +
      '<div class="x-fold-body">' +
      '<p class="x-help-note">The badge re-reads the chain on every request, so it cannot go ' +
      "stale or be faked by copying markup. This is the only part of the page that needs code.</p>" +
      '<div class="x-embed-preview"><img src="' +
      esc(badgePath) +
      '" alt="Equxi trust badge" height="20" /></div>' +
      embedRow("Markdown", markdown, "md", "Copy Markdown") +
      embedRow("HTML", html, "html", "Copy HTML") +
      '<div class="x-sub" style="margin-top:12px;">Exact values, as machine-readable numbers: ' +
      '<a class="x-link" href="' +
      esc(rawJson) +
      '" target="_blank" rel="noopener">raw JSON for this agent</a> · ' +
      '<a class="x-link" href="' +
      esc(badgeJson) +
      '" target="_blank" rel="noopener">badge as JSON</a></div>' +
      "</div></details>"
    );
  }

  /**
   * The per-agent market section. Markets that name the agent are listed;
   * when none do, that is said plainly instead of showing an empty box or a
   * market that belongs to someone else.
   */
  function marketBlock(agent) {
    if (!state.markets || !state.markets.configured) return "";
    var mine = marketsFor(agent);
    if (mine.length) {
      return (
        '<h3 class="x-sec">Market on this agent</h3>' +
        '<div class="x-market-list">' +
        mine.map(marketRow).join("") +
        "</div>"
      );
    }
    var line =
      state.markets.sandbox === true
        ? "No Panta market references this agent yet. This deployment reads Panta in sandbox mode, so the markets feed is labeled fixtures, not live money."
        : "No Panta market references this agent yet. When one opens on this agent, its live price appears here.";
    return '<h3 class="x-sec">Market on this agent</h3><div class="x-sub">' + line + "</div>";
  }

  /** What the lock state means, in a sentence rather than a badge. */
  function bondNote(p) {
    if (!p.bond || !p.bond.isActive) return "";
    if (p.bond.withdrawable) {
      return '<div class="x-sub">The lock has ended, so the owner can withdraw.</div>';
    }
    if (p.bond.expired) {
      return (
        '<div class="x-sub">The lock has ended, but the collateral is still slashable until ' +
        "the exit period finishes, so ending a lock is not an escape from a debt.</div>"
      );
    }
    return "";
  }

  /**
   * The expanded panel for one agent. It renders inside the table, directly
   * under the agent's own row, so opening it never moves the reader somewhere
   * else on the page.
   */
  function detailHtml(agent) {
    var p = agent.profile;
    var notes = p.warnings
      .map(function (w) {
        return '<div class="x-note">' + esc(w) + "</div>";
      })
      .join("");

    var bond = p.bond
      // The exact lamport count is one link away in the JSON; the panel shows
      // the number a person is deciding about.
      ? '<div class="x-slash-row"><span>Locked collateral</span><span>' +
        esc(sol(p.bond.amountLamports)) +
        " SOL</span></div>" +
        '<div class="x-slash-row"><span>Unlocks</span><span>' +
        esc(when(p.bond.expiresAt)) +
        (p.bond.withdrawable
          ? ' · <span class="x-pill paid">withdrawable</span>'
          : ' · <span class="x-pill owed">' +
            (p.bond.expired ? "unbonding" : "locked") +
            "</span>") +
        "</span></div>" +
        '<div class="x-slash-row"><span>Status</span><span>' +
        (p.bond.isActive ? "active" : "inactive, so it does not count toward the grade") +
        "</span></div>" +
        // Said in words under the numbers: a pill is too small to carry the one
        // thing a reader needs to know about an expired lock.
        bondNote(p)
      : '<div class="x-warn">No collateral is locked behind this agent, so there is nothing a victim could be paid from. It stays ungraded until its owner locks SOL.</div>';

    var slashes =
      p.slashes.length === 0
        ? '<div class="x-slash-row"><span>No slash has ever been recorded for this agent.</span><span class="x-pill paid">clean</span></div>'
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
                esc(RULE_LABELS[c.type] || c.type) +
                "</span>"
              );
            })
            .join(" ");

    var layoutNote =
      agent.layout === "v1"
        ? '<div class="x-note">This agent was registered before the current account layout, so ' +
          "the on-chain rule counter does not exist. The rules above were found by reading the " +
          "rule accounts directly, which is why the registry shows a count where the account " +
          "itself would report 0.</div>"
        : "";

    return (
      '<div class="x-row"><div><h2>' +
      esc(agent.name) +
      '</h2><div class="x-sub">' +
      addrLink(agent.address) +
      " · owned by " +
      addrLink(agent.owner) +
      " · " +
      esc(agent.agentType) +
      " · registered " +
      esc(when(agent.createdAt)) +
      " · status " +
      esc(agent.status) +
      "</div></div><div>" +
      gradeBadge(p.grade) +
      ' <span class="x-mono">' +
      esc(p.score) +
      "/100</span></div></div>" +
      '<div class="x-sub" style="margin-top:14px;">Rules: ' +
      constraints +
      "</div>" +
      layoutNote +
      notes +
      '<h3 class="x-sec">Collateral</h3>' +
      bond +
      '<h3 class="x-sec">Slash history</h3>' +
      '<div class="x-slashes">' +
      slashes +
      "</div>" +
      '<div class="x-note">Totals: ' +
      esc(sol(p.stats.totalSlashedLamports)) +
      " SOL slashed, " +
      esc(sol(p.stats.compensationPaidLamports)) +
      " SOL paid to victims, " +
      esc(sol(p.stats.uncompensatedLamports)) +
      " SOL uncompensated · estimated " +
      esc(p.stats.slashRatePerMonth.toFixed(2)) +
      " slashes/month.</div>" +
      '<h3 class="x-sec">Why this grade</h3>' +
      '<div class="x-sub">Every point comes from chain state, and the rows below sum to the ' +
      'score. The on-chain <span class="x-mono">trust_score</span> is admin-set and is deliberately ' +
      "not one of them.</div>" +
      renderBreakdown(p) +
      marketBlock(agent) +
      renderBuilders(agent) +
      '<div class="x-actions" style="margin-top:18px;">' +
      '<a href="' +
      EXPLORER +
      "/address/" +
      esc(agent.address) +
      '?cluster=devnet" target="_blank" rel="noopener">View on Solana Explorer</a>' +
      '<button type="button" data-copy="' +
      esc(SITE + "/explorer.html?agent=" + agent.address) +
      '" data-copykey="link">' +
      (state.copied === "link" ? "Link copied" : "Copy link to this agent") +
      "</button>" +
      '<button type="button" id="closeDetail">Close</button>' +
      "</div>"
    );
  }

  function render() {
    if (state.payload) {
      el.cluster.textContent = state.payload.cluster;
    }
    // A shared link should read like the agent, not like a generic page.
    var open = findAgent(state.selected);
    document.title = open
      ? open.name + " · " + open.profile.grade + " " + open.profile.score + " · Equxi Trust Explorer"
      : "Equxi | Trust Explorer";
    renderStatus();
    renderSummary();
    renderControls();
    renderRegistry();
    renderMarkets();
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
      loadMarkets();
      load(state.request || { mode: "all", value: null }, { keepSelection: true });
    });
  }

  // Keep the "refreshed Ns ago" label honest without refetching anything.
  setInterval(function () {
    if (state.loadedAt && !state.loading && el.refresh) {
      el.refresh.textContent = "Refresh · " + ago(state.loadedAt);
    }
  }, 15000);

  // The markets feed does not depend on the lookup, so it loads once up front
  // and again on Refresh.
  loadMarkets();

  // Deep links: `explorer.html?agent=<pubkey>`, `?owner=<wallet>` and
  // `?q=<name>` all work, which is what a pitch, a README or a badge can hand
  // to a judge.
  var params = new URLSearchParams(location.search);
  var initialAgent = params.get("agent");
  var initialOwner = params.get("owner");
  var initialQuery = params.get("q");

  if (initialAgent && !looksLikePubkey(initialAgent)) {
    // A truncated or hand-typed link is a name search, not a malformed request.
    // Sending it to the API would answer with a schema error, which is about
    // the API rather than about the agent the reader was looking for.
    initialQuery = initialAgent;
    history.replaceState(null, "", "?q=" + encodeURIComponent(initialAgent));
    initialAgent = null;
  } else if (initialOwner && !looksLikePubkey(initialOwner)) {
    initialQuery = initialOwner;
    history.replaceState(null, "", "?q=" + encodeURIComponent(initialOwner));
    initialOwner = null;
  }

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
