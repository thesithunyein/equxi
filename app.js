(function () {
  "use strict";

  /* --------------------------------------------------------
     Mock Data
     -------------------------------------------------------- */
  const MOCK_AGENTS = [
    { id: "agent_01", name: "AlphaTrader", address: "7xKX...pQ9", type: "Trading Bot", trustScore: 94, bond: 5000, status: "active", icon: "fa-robot" },
    { id: "agent_02", name: "OracleBot", address: "3mLW...rT2", type: "Data Fetcher", trustScore: 87, bond: 3200, status: "active", icon: "fa-database" },
    { id: "agent_03", name: "YieldMax", address: "9pQS...nK4", type: "Investment Bot", trustScore: 72, bond: 8000, status: "pending", icon: "fa-chart-line" },
    { id: "agent_04", name: "NFT Scout", address: "2vBN...wX8", type: "Market Analyst", trustScore: 91, bond: 2500, status: "active", icon: "fa-image" },
    { id: "agent_05", name: "PayBot", address: "5tYU...mJ3", type: "Payment Bot", trustScore: 96, bond: 10000, status: "active", icon: "fa-credit-card" },
    { id: "agent_06", name: "ArbHunter", address: "8kLP...vC6", type: "Arbitrage Bot", trustScore: 45, bond: 1500, status: "slashed", icon: "fa-bolt" },
    { id: "agent_07", name: "GovernanceAI", address: "4nRT...sH1", type: "Voting Bot", trustScore: 88, bond: 6000, status: "active", icon: "fa-landmark" },
    { id: "agent_08", name: "BridgeBot", address: "6wQM...dE9", type: "Transfer Bot", trustScore: 79, bond: 4200, status: "active", icon: "fa-bridge" },
  ];

  const MOCK_ACTIVITY = [
    { type: "bond", title: "Safety Deposit Created", desc: "AlphaTrader locked 5,000 SOL as collateral", time: "2m ago", amount: "+5,000 SOL", amountType: "positive" },
    { type: "constraint", title: "Rule Added", desc: "PayBot: max 100 SOL per transaction", time: "15m ago", amount: null },
    { type: "slash", title: "Rule Violated", desc: "ArbHunter broke spending limit — 12.4 SOL returned to affected party", time: "1h ago", amount: "-12.4 SOL", amountType: "negative" },
    { type: "claim", title: "Compensation Paid", desc: "Victim received 12.4 SOL from ArbHunter's deposit", time: "1h ago", amount: "+12.4 SOL", amountType: "positive" },
    { type: "bond", title: "Deposit Increased", desc: "OracleBot added 200 SOL to their deposit", time: "3h ago", amount: "+200 SOL", amountType: "positive" },
    { type: "constraint", title: "Rule Updated", desc: "YieldMax: withdrawal delay changed from 24h to 48h", time: "5h ago", amount: null },
    { type: "bond", title: "Safety Deposit Created", desc: "NFT Scout locked 2,500 SOL as collateral", time: "1d ago", amount: "+2,500 SOL", amountType: "positive" },
    { type: "slash", title: "Rule Violated", desc: "ArbHunter exceeded transaction limit", time: "2d ago", amount: "-8.2 SOL", amountType: "negative" },
  ];

  const MOCK_CONSTRAINTS = [
    { agent: "AlphaTrader", type: "spend", title: "Spending Limit", rows: [{ label: "Max per transaction", value: "500 SOL" }, { label: "Checked", value: "Every transaction" }, { label: "Enforcement", value: "Automatic" }], status: "enforced" },
    { agent: "PayBot", type: "program", title: "Allowed Actions", rows: [{ label: "Allowed programs", value: "4 programs" }, { label: "Examples", value: "Transfer, Stake, Vote" }, { label: "Unknown actions", value: "Blocked" }], status: "enforced" },
    { agent: "YieldMax", type: "timelock", title: "Withdrawal Delay", rows: [{ label: "Delay", value: "48 hours" }, { label: "Cancel window", value: "24 hours" }, { label: "Override", value: "Multi-signature required" }], status: "enforced" },
    { agent: "ArbHunter", type: "velocity", title: "Speed Limit", rows: [{ label: "Max transactions", value: "10 per minute" }, { label: "Cooldown", value: "6 seconds between" }, { label: "If exceeded", value: "Auto-penalty" }], status: "pending" },
    { agent: "GovernanceAI", type: "program", title: "Voting Power Cap", rows: [{ label: "Max vote weight", value: "0.5%" }, { label: "Min participation", value: "10%" }, { label: "Cooldown", value: "7 days" }], status: "enforced" },
    { agent: "BridgeBot", type: "spend", title: "Transfer Limit", rows: [{ label: "Daily limit", value: "10,000 SOL" }, { label: "Per transaction", value: "2,000 SOL" }, { label: "Warning at", value: "80% used" }], status: "enforced" },
  ];

  let walletConnected = false;
  let walletAddress = null;
  let solana = null;

  /* --------------------------------------------------------
     Phantom Wallet
     -------------------------------------------------------- */
  function getPhantomProvider() {
    if ("solana" in window) {
      const provider = window.solana;
      if (provider.isPhantom) return provider;
    }
    return null;
  }

  async function connectWallet() {
    const btn = document.getElementById("connectWallet");
    solana = getPhantomProvider();
    if (!solana) {
      showToast("Please install Phantom wallet to connect");
      window.open("https://phantom.app/", "_blank");
      return;
    }
    if (walletConnected) {
      try { await solana.disconnect(); } catch (e) {}
      walletConnected = false;
      walletAddress = null;
      btn.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
      btn.classList.remove("connected");
      showToast("Wallet disconnected");
      return;
    }
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Connecting...</span>';
    try {
      const resp = await solana.connect();
      walletConnected = true;
      walletAddress = resp.publicKey.toString();
      const shortAddr = walletAddress.slice(0, 4) + "..." + walletAddress.slice(-4);
      btn.innerHTML = `<i class="fa-solid fa-check"></i><span>${shortAddr}</span>`;
      btn.classList.add("connected");
      showToast(`Connected: ${shortAddr}`);
      await loadOnChainData();
    } catch (err) {
      btn.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
      showToast("Connection rejected");
    }
  }

  async function loadOnChainData() {
    try {
      const connection = new solanaWeb3.Connection("https://api.devnet.solana.com", "confirmed");
      const balance = await connection.getBalance(new solanaWeb3.PublicKey(walletAddress));
      const solBalance = (balance / solanaWeb3.LAMPORTS_PER_SOL).toFixed(2);
      showToast(`Balance: ${solBalance} SOL`);
    } catch (err) {
      console.log("Could not fetch balance:", err);
    }
  }

  /* --------------------------------------------------------
     Navigation
     -------------------------------------------------------- */
  function initNavigation() {
    const links = document.querySelectorAll(".sidebar-link[data-section]");
    const sections = document.querySelectorAll(".content-section");
    const title = document.getElementById("pageTitle");
    const sidebar = document.getElementById("sidebar");
    const menuToggle = document.getElementById("menuToggle");
    links.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        links.forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        sections.forEach((s) => s.classList.remove("active"));
        document.getElementById(`section-${section}`).classList.add("active");
        title.textContent = link.querySelector("span").textContent;
        sidebar.classList.remove("open");
      });
    });
    menuToggle.addEventListener("click", () => sidebar.classList.toggle("open"));
    document.addEventListener("click", (e) => {
      if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== menuToggle) sidebar.classList.remove("open");
    });
  }

  window.navigateTo = function(section) {
    const link = document.querySelector(`.sidebar-link[data-section="${section}"]`);
    if (link) link.click();
  };

  /* --------------------------------------------------------
     Render
     -------------------------------------------------------- */
  function renderActivity() {
    document.getElementById("activityList").innerHTML = MOCK_ACTIVITY.slice(0, 5).map((a) => `
      <div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${a.type === "bond" ? "fa-shield-halved" : a.type === "slash" ? "fa-bolt" : a.type === "claim" ? "fa-hand-holding-dollar" : "fa-list-check"}"></i></div>
        <div class="activity-info"><div class="activity-title">${a.title}</div><div class="activity-desc">${a.desc}</div></div>
        <span class="activity-time">${a.time}</span>
        ${a.amount ? `<span class="activity-amount ${a.amountType}">${a.amount}</span>` : ""}
      </div>
    `).join("");
  }

  function renderAgentsTable() {
    document.getElementById("agentsTable").innerHTML = MOCK_AGENTS.map((a) => `
      <div class="table-row">
        <div class="agent-name">
          <div class="agent-avatar"><i class="fa-solid ${a.icon}"></i></div>
          <div class="agent-info"><span class="name">${a.name}</span><span class="address">${a.address}</span></div>
        </div>
        <div class="trust-score">
          <div class="trust-bar"><div class="trust-fill ${a.trustScore >= 80 ? "high" : a.trustScore >= 60 ? "medium" : "low"}" style="width: ${a.trustScore}%"></div></div>
          <span>${a.trustScore}</span>
        </div>
        <span>${a.bond.toLocaleString()}</span>
        <span class="status-badge ${a.status}">${a.status}</span>
      </div>
    `).join("");
  }

  function renderAgentsGrid() {
    document.getElementById("agentsGrid").innerHTML = MOCK_AGENTS.map((a) => `
      <div class="agent-card">
        <div class="agent-card-header">
          <div class="agent-card-avatar"><i class="fa-solid ${a.icon}"></i></div>
          <div class="agent-card-info"><h3>${a.name}</h3><p>${a.type}</p></div>
          <span class="status-badge ${a.status}">${a.status}</span>
        </div>
        <div class="agent-card-stats">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${a.bond.toLocaleString()}</span><span class="label">Deposit (SOL)</span></div>
          <div class="agent-stat"><span class="value">${a.type.split(" ")[0]}</span><span class="label">Type</span></div>
        </div>
        <div class="agent-card-actions">
          <button class="btn btn-outline btn-sm" onclick="viewAgent('${a.id}')">View Details</button>
          ${a.status === "active" ? `<button class="btn btn-danger btn-sm" onclick="slashAgent('${a.id}')">Report Violation</button>` : ""}
        </div>
      </div>
    `).join("");
  }

  function renderBonds() {
    document.getElementById("bondsList").innerHTML = MOCK_AGENTS.filter((a) => a.status !== "slashed").map((a) => `
      <div class="bond-card">
        <div class="bond-icon"><i class="fa-solid ${a.icon}"></i></div>
        <div class="bond-info"><h3>${a.name}</h3><p>${a.type} • Operator: ${a.address}</p></div>
        <div class="bond-amount"><div class="value">${a.bond.toLocaleString()} SOL</div><div class="label">Locked as collateral</div></div>
        <div class="bond-actions"><button class="btn btn-outline btn-sm">Manage</button><button class="btn btn-danger btn-sm">Report</button></div>
      </div>
    `).join("");
  }

  function renderConstraints() {
    document.getElementById("constraintsGrid").innerHTML = MOCK_CONSTRAINTS.map((c) => `
      <div class="constraint-card">
        <div class="constraint-header">
          <div class="constraint-icon ${c.type}"><i class="fa-solid ${c.type === "spend" ? "fa-coins" : c.type === "program" ? "fa-cube" : c.type === "timelock" ? "fa-clock" : "fa-gauge-high"}"></i></div>
          <h3>${c.title}</h3>
          <span class="type">${c.agent}</span>
        </div>
        <div class="constraint-body">${c.rows.map((r) => `<div class="constraint-row"><span class="label">${r.label}</span><span class="value">${r.value}</span></div>`).join("")}</div>
        <div class="constraint-status ${c.status}"><span class="dot"></span><span>${c.status === "enforced" ? "Active — being enforced" : "Pending — not yet active"}</span></div>
      </div>
    `).join("");
  }

  function renderFullActivity(filter = "all") {
    const filtered = filter === "all" ? MOCK_ACTIVITY : MOCK_ACTIVITY.filter((a) => a.type === filter);
    document.getElementById("activityFullList").innerHTML = filtered.map((a) => `
      <div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${a.type === "bond" ? "fa-shield-halved" : a.type === "slash" ? "fa-bolt" : a.type === "claim" ? "fa-hand-holding-dollar" : "fa-list-check"}"></i></div>
        <div class="activity-info"><div class="activity-title">${a.title}</div><div class="activity-desc">${a.desc}</div></div>
        <span class="activity-time">${a.time}</span>
        ${a.amount ? `<span class="activity-amount ${a.amountType}">${a.amount}</span>` : ""}
      </div>
    `).join("");
  }

  /* --------------------------------------------------------
     Modals
     -------------------------------------------------------- */
  function openModal(title, bodyHtml) {
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalBody").innerHTML = bodyHtml;
    document.getElementById("modalOverlay").classList.add("open");
  }
  function closeModal() { document.getElementById("modalOverlay").classList.remove("open"); }

  function initModals() {
    document.getElementById("modalClose").addEventListener("click", closeModal);
    document.getElementById("modalOverlay").addEventListener("click", (e) => { if (e.target === document.getElementById("modalOverlay")) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    document.getElementById("registerAgent").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect your wallet first"); return; }
      openModal("Register a New Agent", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">An agent is an AI program that acts on your behalf. Registering it on Equxi makes it accountable — if it breaks rules, its operator's deposit is used to compensate victims.</p>
        <div class="form-group"><label>Agent Name</label><input type="text" id="regName" placeholder="e.g. My Trading Bot" /></div>
        <div class="form-group"><label>What does this agent do?</label><select id="regType"><option value="trader">Trading Bot</option><option value="oracle">Data Fetcher</option><option value="defi">Investment Bot</option><option value="payment">Payment Bot</option><option value="nft">Market Analyst</option><option value="governance">Voting Bot</option><option value="bridge">Transfer Bot</option></select></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="handleRegisterAgent()">Register Agent</button></div>
      `);
    });

    document.getElementById("createBond").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect your wallet first"); return; }
      openModal("Lock a Safety Deposit", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Lock funds as a safety deposit. If your agent breaks a rule, these funds are used to compensate the affected party. You get them back when the deposit period ends.</p>
        <div class="form-group"><label>Which agent?</label><select id="bondAgent">${MOCK_AGENTS.filter((a) => a.status === "active").map((a) => `<option value="${a.id}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>How much to lock? (SOL)</label><input type="number" id="bondAmount" placeholder="e.g. 5000" min="0.1" step="0.1" /><p class="hint">This amount will be locked in a smart contract. You can get it back after the lock period ends.</p></div>
        <div class="form-group"><label>How long to lock?</label><select id="bondDuration"><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="15552000">180 days</option><option value="31536000">1 year</option></select></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="handleCreateBond()">Lock Funds</button></div>
      `);
    });

    document.getElementById("addConstraint").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect your wallet first"); return; }
      openModal("Add a Rule", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Rules control what your agent can do. If it breaks a rule, the safety deposit is automatically used to compensate the affected party.</p>
        <div class="form-group"><label>Which agent?</label><select id="conAgent">${MOCK_AGENTS.filter((a) => a.status === "active").map((a) => `<option value="${a.id}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>What kind of rule?</label><select id="conType"><option value="spend">Spending Limit (max per transaction)</option><option value="program">Allowed Actions (which programs it can use)</option><option value="timelock">Withdrawal Delay (wait time before funds move)</option><option value="velocity">Speed Limit (max transactions per time)</option></select></div>
        <div class="form-group"><label>Rule details</label><input type="text" id="conValue" placeholder="e.g. 500 SOL" /><p class="hint">The exact limit or value for this rule.</p></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="handleAddConstraint()">Add Rule</button></div>
      `);
    });

    document.getElementById("activityFilter").addEventListener("change", (e) => renderFullActivity(e.target.value));
  }

  function showToast(msg) {
    const t = document.getElementById("toast");
    document.getElementById("toastMessage").textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
  }

  /* --------------------------------------------------------
     Handlers
     -------------------------------------------------------- */
  window.closeModal = closeModal;

  window.handleRegisterAgent = () => {
    const name = document.getElementById("regName")?.value;
    if (!name) { showToast("Enter an agent name"); return; }
    closeModal();
    showToast(`Registering "${name}"...`);
    setTimeout(() => showToast(`Agent "${name}" registered!`), 2000);
  };

  window.handleCreateBond = () => {
    const amount = document.getElementById("bondAmount")?.value;
    if (!amount) { showToast("Enter an amount"); return; }
    closeModal();
    showToast(`Locking ${amount} SOL...`);
    setTimeout(() => showToast(`Safety deposit created: ${amount} SOL locked!`), 2000);
  };

  window.handleAddConstraint = () => {
    const value = document.getElementById("conValue")?.value;
    if (!value) { showToast("Enter rule details"); return; }
    closeModal();
    showToast("Adding rule...");
    setTimeout(() => showToast("Rule added and active!"), 2000);
  };

  window.viewAgent = function (id) {
    const a = MOCK_AGENTS.find((x) => x.id === id);
    if (!a) return;
    openModal(a.name, `
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div style="display:flex;align-items:center;gap:16px;">
          <div class="agent-card-avatar" style="width:56px;height:56px;font-size:24px;"><i class="fa-solid ${a.icon}"></i></div>
          <div><h3 style="font-size:20px;margin-bottom:4px;">${a.name}</h3><p style="font-size:13px;color:var(--text-muted);">${a.type}</p></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${a.bond.toLocaleString()}</span><span class="label">Deposit (SOL)</span></div>
          <div class="agent-stat"><span class="value">${a.type}</span><span class="label">Type</span></div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:16px;">
          <h4 style="font-size:14px;margin-bottom:12px;">Active Rules</h4>
          ${MOCK_CONSTRAINTS.filter((c) => c.agent === a.name).map((c) => `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">
              <div class="constraint-icon ${c.type}" style="width:32px;height:32px;font-size:12px;"><i class="fa-solid ${c.type === "spend" ? "fa-coins" : c.type === "program" ? "fa-cube" : c.type === "timelock" ? "fa-clock" : "fa-gauge-high"}"></i></div>
              <div><div style="font-size:13px;font-weight:500;">${c.title}</div><div style="font-size:12px;color:var(--text-muted);">${c.status === "enforced" ? "Active" : "Pending"}</div></div>
            </div>
          `).join("") || '<p style="font-size:13px;color:var(--text-muted);">No rules configured yet</p>'}
        </div>
      </div>
    `);
  };

  window.slashAgent = function (id) {
    if (!walletConnected) { showToast("Connect your wallet first"); return; }
    const a = MOCK_AGENTS.find((x) => x.id === id);
    if (!a) return;
    openModal(`Report Rule Violation — ${a.name}`, `
      <div style="text-align:center;padding:16px 0;">
        <div style="width:64px;height:64px;border-radius:50%;background:var(--red-bg);color:var(--red);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;"><i class="fa-solid fa-bolt"></i></div>
        <p style="margin-bottom:8px;">Report <strong>${a.name}</strong> for breaking a rule?</p>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">This will use part of their ${a.bond.toLocaleString()} SOL deposit to compensate the affected party.</p>
        <div class="form-group" style="text-align:left;"><label>What rule was broken?</label><textarea id="slashReason" rows="3" placeholder="Describe what happened..."></textarea></div>
        <div class="form-actions" style="justify-content:center;"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="confirmSlash('${id}')">Report Violation</button></div>
      </div>
    `);
  };

  window.confirmSlash = function (id) {
    const a = MOCK_AGENTS.find((x) => x.id === id);
    if (a) { a.status = "slashed"; renderAgentsGrid(); renderAgentsTable(); renderBonds(); }
    closeModal();
    showToast(`Processing violation report for ${a?.name}...`);
    setTimeout(() => showToast(`${a?.name} — deposit used to compensate affected party`), 2000);
  };

  /* --------------------------------------------------------
     Init
     -------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initModals();
    renderActivity();
    renderAgentsTable();
    renderAgentsGrid();
    renderBonds();
    renderConstraints();
    renderFullActivity();
    document.getElementById("connectWallet").addEventListener("click", connectWallet);
    solana = getPhantomProvider();
    if (solana && solana.isConnected) {
      solana.on("connect", () => {
        walletConnected = true;
        walletAddress = solana.publicKey.toString();
        const shortAddr = walletAddress.slice(0, 4) + "..." + walletAddress.slice(-4);
        const btn = document.getElementById("connectWallet");
        btn.innerHTML = `<i class="fa-solid fa-check"></i><span>${shortAddr}</span>`;
        btn.classList.add("connected");
      });
    }
  });
})();
