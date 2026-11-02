/* AAS-2 page: the verifier panel.
 *
 * Two inputs, one endpoint. The published proof is fetched from this site's own
 * fixtures; a visitor's receipt is read from their files. Neither is stored:
 * the request body is the whole exchange.
 */
(function () {
  "use strict";

  var ENDPOINT = "/api/aas2-verify";

  var LABELS = {
    shape: "Receipt shape",
    agreement_hash: "Agreement commitment",
    output_hashes: "Output hashes",
    rerun: "Checks rerun",
    report_hash: "Report commitment",
    inputs: "Inputs",
    verifier_signature: "Verifier signature",
    provider_signature: "Provider signature",
    anchors: "Anchor set",
    submitted_at_clock: "Delivery clock",
    anchors_on_chain: "On-chain memos",
    agreement_signatures: "Agreement signatures",
    limits: "Stated limits"
  };

  var resultEl = document.getElementById("a2-result");
  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-a2-run]"));
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-a2-tab]"));
  var panes = Array.prototype.slice.call(document.querySelectorAll("[data-a2-pane]"));

  if (!resultEl) return;


  /* ------------------------------------------------------------- tabs */

  function selectTab(name) {
    tabs.forEach(function (tab) {
      var active = tab.getAttribute("data-a2-tab") === name;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    });
    panes.forEach(function (pane) {
      pane.hidden = pane.getAttribute("data-a2-pane") !== name;
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      selectTab(tab.getAttribute("data-a2-tab"));
    });
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      var index = tabs.indexOf(tab);
      var next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index + tabs.length - 1) % tabs.length;
      tabs[next].focus();
      selectTab(tabs[next].getAttribute("data-a2-tab"));
    });
  });

  /* --------------------------------------------------------- rendering */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name, className) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className || "a2-i");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + name);
    svg.appendChild(use);
    return svg;
  }

  function emptyState(title, body) {
    var wrap = el("div", "a2-result-empty");
    var mark = el("div", "a2-result-mark");
    mark.appendChild(icon("i-check"));
    wrap.appendChild(mark);
    wrap.appendChild(el("b", null, title));
    wrap.appendChild(el("p", null, body));
    resultEl.replaceChildren(wrap);
    resultEl.removeAttribute("aria-busy");
  }

  function busy(label) {
    resultEl.setAttribute("aria-busy", "true");
    var wrap = el("div", "a2-result-empty");
    var mark = el("div", "a2-result-mark");
    mark.appendChild(icon("i-hash"));
    wrap.appendChild(mark);
    wrap.appendChild(el("b", null, label));
    wrap.appendChild(el("p", null, "Recomputing every hash from the files you supplied."));
    resultEl.replaceChildren(wrap);
  }

  function errorState(message) {
    resultEl.removeAttribute("aria-busy");
    var wrap = el("div", "a2-result-error");
    wrap.appendChild(el("b", null, "Could not verify"));
    wrap.appendChild(el("p", null, message));
    wrap.appendChild(el("span", null, "Check that the files are the exact ones the receipt names."));
    resultEl.replaceChildren(wrap);
  }

  function stepDetail(step, cluster) {
    if (step.id === "anchors_on_chain" && step.detail && step.detail.slots) {
      return "slots " + step.detail.slots.join(" · ");
    }
    if (step.detail === null || step.detail === undefined) return "verified";
    if (typeof step.detail === "string") return step.detail;
    if (step.id === "anchors" && cluster === "offline") return "present; chain read skipped";
    return JSON.stringify(step.detail);
  }

  function anchorLinks(receipt, cluster) {
    if (!receipt || !receipt.anchors) return null;
    if (cluster === "offline") return null;

    var suffix = cluster === "devnet" ? "?cluster=devnet" : "";
    var list = el("div", "a2-anchors");
    list.appendChild(el("div", "a2-anchors-title", "Anchored transactions"));

    ["agreement", "output", "receipt"].forEach(function (name) {
      var anchor = receipt.anchors[name];
      if (!anchor || !anchor.tx) return;
      var link = el("a", "a2-anchor-link");
      link.href = "https://explorer.solana.com/tx/" + encodeURIComponent(anchor.tx) + suffix;
      link.target = "_blank";
      link.rel = "noopener";
      var label = name.charAt(0).toUpperCase() + name.slice(1);
      link.appendChild(el("span", null, label));
      link.appendChild(document.createTextNode(anchor.tx.slice(0, 8) + "…" + anchor.tx.slice(-6)));
      link.appendChild(icon("i-external", "a2-anchor-go"));
      list.appendChild(link);
    });

    return list.childElementCount > 1 ? list : null;
  }

  function copyButton(value) {
    var button = el("button", "a2-copy");
    button.type = "button";
    button.title = "Copy core hash";
    button.setAttribute("aria-label", "Copy core hash");
    button.appendChild(icon("i-copy", null));

    button.addEventListener("click", function () {
      function done() {
        button.title = "Copied";
        setTimeout(function () {
          button.title = "Copy core hash";
        }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, done);
        return;
      }
      var area = el("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch (error) {
        /* the hash is visible above; copying is a convenience */
      }
      document.body.removeChild(area);
      done();
    });

    return button;
  }

  function render(data, receipt, cluster) {
    resultEl.removeAttribute("aria-busy");
    var frame = document.createDocumentFragment();

    var top = el("div", "a2-result-top");
    var left = el("div");
    left.appendChild(el("span", "a2-verdict " + (data.valid ? "is-valid" : "is-invalid"), data.valid ? "Valid" : "Invalid"));

    if (data.identity) {
      var identity = el("div", "a2-identity");
      identity.appendChild(icon("i-key"));
      var who;
      if (data.identity.known) {
        who = (data.identity.issuer || "Verifier") + " · key " + data.identity.key_id + " · " + data.identity.status;
      } else {
        who = "Signer is not in the published key registry.";
      }
      identity.appendChild(document.createTextNode(who));
      left.appendChild(identity);
    }

    var meta = el("div", "a2-result-meta");
    meta.appendChild(document.createTextNode(data.passed + " / " + data.total + " checks"));
    meta.appendChild(document.createElement("br"));
    meta.appendChild(
      document.createTextNode(
        (data.evidence_level || "—") + " · " + cluster + " · " + data.elapsed_ms + " ms"
      )
    );
    if (receipt && receipt.verdict) {
      meta.appendChild(document.createElement("br"));
      meta.appendChild(document.createTextNode("delivery " + receipt.verdict));
    }
    top.appendChild(left);
    top.appendChild(meta);
    frame.appendChild(top);

    if (data.core_hash) {
      var core = el("div", "a2-core");
      core.appendChild(el("span", null, "Core"));
      var code = el("code", null, data.core_hash);
      code.title = data.core_hash;
      core.appendChild(code);
      core.appendChild(copyButton(data.core_hash));
      frame.appendChild(core);
    }

    var steps = el("div", "a2-steps");
    (data.steps || []).forEach(function (step) {
      var row = el("div", "a2-step " + (step.ok ? "is-pass" : "is-fail"));
      row.appendChild(el("span", "a2-step-glyph", step.ok ? "✓" : "×"));
      var body = el("div", "a2-step-body");
      body.appendChild(el("span", "a2-step-name", LABELS[step.id] || step.id));
      var detail = stepDetail(step, cluster);
      if (detail !== "verified") body.appendChild(el("span", "a2-step-detail", detail));
      row.appendChild(body);
      row.appendChild(el("span", "a2-step-state", step.ok ? "pass" : "fail"));
      steps.appendChild(row);
    });
    frame.appendChild(steps);

    if (cluster === "offline" && data.evidence_level === "L3") {
      frame.appendChild(
        el(
          "div",
          "a2-result-note",
          "Chain read skipped. The anchor set was checked for structure and order, not for presence on Solana."
        )
      );
    }

    var links = anchorLinks(receipt, cluster);
    if (links) frame.appendChild(links);

    if (!data.valid) {
      frame.appendChild(
        el(
          "div",
          "a2-result-note",
          "An invalid result is still a verification: the files do not match what the receipt commits to. Nothing is stored."
        )
      );
    }

    resultEl.replaceChildren(frame);
  }

  /* ----------------------------------------------------------- requests */

  function setBusy(on) {
    buttons.forEach(function (button) {
      button.disabled = on;
    });
  }

  async function post(payload) {
    var response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new Error("The verification endpoint could not be reached. Try again in a moment.");
    }

    var data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (!response.ok || !data || !data.ok) {
      var detail = (data && (data.detail || data.error)) || "Request failed with status " + response.status + ".";
      throw new Error(detail);
    }

    return data;
  }

  async function fetchJson(path) {
    var response = await fetch(path, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Could not load " + path + " (" + response.status + ").");
    return response.json();
  }

  async function runPublished() {
    busy("Reading the published proof");
    setBusy(true);

    try {
      var files = await Promise.all([
        fetchJson("fixtures/aas-2/mainnet/receipt.json"),
        fetchJson("fixtures/aas-2/mainnet/agreement.signed.json"),
        fetchJson("fixtures/aas-2/mainnet/report.json"),
        fetch("fixtures/aas-2/output.product-feed.csv", { headers: { accept: "text/csv" } })
      ]);

      if (!files[3].ok) throw new Error("Could not load the delivered file (" + files[3].status + ").");
      var output = await files[3].text();

      var data = await post({
        receipt: files[0],
        agreement: files[1],
        report: files[2],
        output: output,
        cluster: "mainnet"
      });

      render(data, files[0], "mainnet");
    } catch (error) {
      errorState(error.message);
    } finally {
      setBusy(false);
    }
  }

  function readJson(input, name) {
    return new Promise(function (resolve, reject) {
      var file = input.files && input.files[0];
      if (!file) {
        reject(new Error(name + " is required."));
        return;
      }
      file.text().then(function (text) {
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new Error(name + " is not valid JSON."));
        }
      }, function () {
        reject(new Error("Could not read " + name + "."));
      });
    });
  }

  function readText(input, name) {
    return new Promise(function (resolve, reject) {
      var file = input.files && input.files[0];
      if (!file) {
        reject(new Error(name + " is required."));
        return;
      }
      file.text().then(resolve, function () {
        reject(new Error("Could not read " + name + "."));
      });
    });
  }

  async function runFiles() {
    var receiptInput = document.getElementById("a2-file-receipt");
    var agreementInput = document.getElementById("a2-file-agreement");
    var outputInput = document.getElementById("a2-file-output");
    var reportInput = document.getElementById("a2-file-report");
    var clusterInput = document.getElementById("a2-file-cluster");
    var cluster = clusterInput ? clusterInput.value : "offline";

    busy("Reading your files");
    setBusy(true);

    try {
      var receipt = await readJson(receiptInput, "The receipt");
      var agreement = await readJson(agreementInput, "The agreement");
      var output = await readText(outputInput, "The delivered file");

      var payload = {
        receipt: receipt,
        agreement: agreement,
        output: output,
        cluster: cluster
      };

      if (reportInput && reportInput.files && reportInput.files[0]) {
        payload.report = await readJson(reportInput, "The report");
      }

      var data = await post(payload);
      render(data, receipt, cluster);
    } catch (error) {
      errorState(error.message);
    } finally {
      setBusy(false);
    }
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      if (button.getAttribute("data-a2-run") === "published") runPublished();
      else runFiles();
    });
  });
})();
