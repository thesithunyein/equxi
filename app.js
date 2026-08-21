(function () {
  "use strict";

  const SOLANA_RPC = "https://api.devnet.solana.com";
  const PROGRAM_ID = "Eqxi1111111111111111111111111111111111111111";

  let walletConnected = false;
  let walletAddress = null;
  let solana = null;
  let connection = null;
  let userAgents = [];
  let userBonds = [];

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
      showToast("Please install Phantom wallet");
      window.open("https://phantom.app/", "_blank");
      return;
    }
    if (walletConnected) {
      try { await solana.disconnect(); } catch (e) {}
      walletConnected = false;
      walletAddress = null;
      userAgents = [];
      userBonds = [];
      btn.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
      btn.classList.remove("connected");
      renderAll();
      showToast("Wallet disconnected");
      return;
    }
    setLoading(btn, true, "Connecting...");
    try {
      const resp = await solana.connect();
      walletConnected = true;
      walletAddress = resp.publicKey.toString();
      connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");
      const shortAddr = walletAddress.slice(0, 4) + "..." + walletAddress.slice(-4);
      btn.innerHTML = `<i class="fa-solid fa-check"></i><span>${shortAddr}</span>`;
      btn.classList.add("connected");
      setLoading(btn, false);
      showToast(`Connected: ${shortAddr}`);
      await loadOnChainData();
    } catch (err) {
      setLoading(btn, false, "Connect Wallet");
      showToast("Connection rejected");
    }
  }

  async function loadOnChainData() {
    try {
      const balance = await connection.getBalance(new solanaWeb3.PublicKey(walletAddress));
      const solBalance = (balance / solanaWeb3.LAMPORTS_PER_SOL).toFixed(2);
      document.getElementById("walletBalance").textContent = `${solBalance} SOL`;
      document.getElementById("walletBalance").style.display = "block";
      // Fetch user's agents from program (would use getProgramAccounts in production)
      showToast(`Balance: ${solBalance} SOL`);
    } catch (err) {
      console.log("Could not fetch balance:", err);
    }
  }

  function setLoading(btn, loading, text) {
    if (loading) {
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>${text || "Loading..."}</span>`;
      btn.disabled = true;
    } else {
      btn.innerHTML = `<i class="fa-solid fa-wallet"></i><span>${text || "Connect Wallet"}</span>`;
      btn.disabled = false;
    }
  }

  function showTxLoading(msg) {
    showToast(`${msg}... (check wallet)`);
  }

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

  window.navigateTo = function (section) {
    const link = document.querySelector(`.sidebar-link[data-section="${section}"]`);
    if (link) link.click();
  };

  function renderAll() {
    renderActivity();
    renderConstraints();
    renderBonds();
    renderAgentsGrid();
    renderFullActivity();
    updateStats();
  }

  function updateStats() {
    document.getElementById("totalAgents").textContent = userAgents.length || "8";
    document.getElementById("totalBonds").textContent = userBonds.length || "12";
  }

  function renderActivity() {
    const activities = [
      { type: "bond", title: "Safety Deposit Created", desc: "AlphaTrader locked 5,000 SOL", time: "2m ago", amount: "+5,000 SOL", amountType: "positive" },
      { type: "constraint", title: "Rule Added", desc: "PayBot: max 100 SOL per transaction", time: "15m ago", amount: null },
      { type: "slash", title: "Rule Violated", desc: "ArbHunter broke spending limit", time: "1h ago", amount: "-12.4 SOL", amountType: "negative" },
      { type: "claim", title: "Compensation Paid", desc: "Victim received 12.4 SOL", time: "1h ago", amount: "+12.4 SOL", amountType: "positive" },
    ];
    document.getElementById("activityList").innerHTML = activities.map((a) => `
      <div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${a.type === "bond" ? "fa-shield-halved" : a.type === "slash" ? "fa-bolt" : a.type === "claim" ? "fa-hand-holding-dollar" : "fa-list-check"}"></i></div>
        <div class="activity-info"><div class="activity-title">${a.title}</div><div class="activity-desc">${a.desc}</div></div>
        <span class="activity-time">${a.time}</span>
        ${a.amount ? `<span class="activity-amount ${a.amountType}">${a.amount}</span>` : ""}
      </div>
    `).join("");
  }

  function renderAgentsGrid() {
    const agents = userAgents.length > 0 ? userAgents : [
      { name: "AlphaTrader", type: "Trading Bot", trustScore: 94, bond: 5000, status: "active", icon: "fa-robot", address: "7xKX...pQ9" },
      { name: "OracleBot", type: "Data Fetcher", trustScore: 87, bond: 3200, status: "active", icon: "fa-database", address: "3mLW...rT2" },
      { name: "PayBot", type: "Payment Bot", trustScore: 96, bond: 10000, status: "active", icon: "fa-credit-card", address: "5tYU...mJ3" },
      { name: "ArbHunter", type: "Arbitrage Bot", trustScore: 45, bond: 1500, status: "slashed", icon: "fa-bolt", address: "8kLP...vC6" },
    ];
    document.getElementById("agentsGrid").innerHTML = agents.map((a) => `
      <div class="agent-card">
        <div class="agent-card-header">
          <div class="agent-card-avatar"><i class="fa-solid ${a.icon || "fa-robot"}"></i></div>
          <div class="agent-card-info"><h3>${a.name}</h3><p>${a.address || a.type}</p></div>
          <span class="status-badge ${a.status}">${a.status}</span>
        </div>
        <div class="agent-card-stats">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${a.bond.toLocaleString()}</span><span class="label">Deposit (SOL)</span></div>
          <div class="agent-stat"><span class="value">${a.type}</span><span class="label">Type</span></div>
        </div>
        <div class="agent-card-actions">
          <button class="btn btn-outline btn-sm" onclick="viewAgent('${a.name}')">Details</button>
          ${a.status === "active" ? `<button class="btn btn-danger btn-sm" onclick="reportViolation('${a.name}')">Report</button>` : ""}
        </div>
      </div>
    `).join("");
  }

  function renderBonds() {
    const bonds = [
      { name: "AlphaTrader", type: "Trading Bot", bond: 5000, address: "7xKX...pQ9" },
      { name: "OracleBot", type: "Data Fetcher", bond: 3200, address: "3mLW...rT2" },
      { name: "PayBot", type: "Payment Bot", bond: 10000, address: "5tYU...mJ3" },
    ];
    document.getElementById("bondsList").innerHTML = bonds.map((a) => `
      <div class="bond-card">
        <div class="bond-icon"><i class="fa-solid fa-shield-halved"></i></div>
        <div class="bond-info"><h3>${a.name}</h3><p>${a.type} • ${a.address}</p></div>
        <div class="bond-amount"><div class="value">${a.bond.toLocaleString()} SOL</div><div class="label">Locked</div></div>
        <div class="bond-actions"><button class="btn btn-outline btn-sm">Manage</button></div>
      </div>
    `).join("");
  }

  function renderConstraints() {
    const constraints = [
      { agent: "AlphaTrader", type: "spend", title: "Spending Limit", rows: [{ label: "Max per transaction", value: "500 SOL" }, { label: "Enforcement", value: "Automatic" }], status: "enforced" },
      { agent: "PayBot", type: "program", title: "Allowed Actions", rows: [{ label: "Allowed programs", value: "4 programs" }, { label: "Unknown actions", value: "Blocked" }], status: "enforced" },
    ];
    document.getElementById("constraintsGrid").innerHTML = constraints.map((c) => `
      <div class="constraint-card">
        <div class="constraint-header">
          <div class="constraint-icon ${c.type}"><i class="fa-solid ${c.type === "spend" ? "fa-coins" : "fa-cube"}"></i></div>
          <h3>${c.title}</h3>
          <span class="type">${c.agent}</span>
        </div>
        <div class="constraint-body">${c.rows.map((r) => `<div class="constraint-row"><span class="label">${r.label}</span><span class="value">${r.value}</span></div>`).join("")}</div>
        <div class="constraint-status ${c.status}"><span class="dot"></span><span>${c.status === "enforced" ? "Active" : "Pending"}</span></div>
      </div>
    `).join("");
  }

  function renderFullActivity(filter) { renderActivity(); }

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
      openModal("Register Agent", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Register an AI agent. It will be accountable — if it breaks rules, its operator's deposit compensates victims.</p>
        <div class="form-group"><label>Agent Name</label><input type="text" id="regName" placeholder="e.g. My Trading Bot" /></div>
        <div class="form-group"><label>What does it do?</label><select id="regType"><option value="trader">Trading Bot</option><option value="oracle">Data Fetcher</option><option value="defi">Investment Bot</option><option value="payment">Payment Bot</option><option value="nft">Market Analyst</option><option value="governance">Voting Bot</option><option value="bridge">Transfer Bot</option></select></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="regSubmit">Register</button></div>
      `);
      document.getElementById("regSubmit").onclick = handleRegisterAgent;
    });

    document.getElementById("createBond").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect your wallet first"); return; }
      openModal("Lock Safety Deposit", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Lock funds as collateral. If your agent breaks rules, these funds compensate the affected party.</p>
        <div class="form-group"><label>Agent</label><select id="bondAgent"><option>AlphaTrader</option><option>OracleBot</option><option>PayBot</option></select></div>
        <div class="form-group"><label>Amount (SOL)</label><input type="number" id="bondAmount" placeholder="e.g. 5000" min="0.1" step="0.1" /></div>
        <div class="form-group"><label>Lock period</label><select id="bondDuration"><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="15552000">180 days</option><option value="31536000">1 year</option></select></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="bondSubmit">Lock Funds</button></div>
      `);
      document.getElementById("bondSubmit").onclick = handleCreateBond;
    });

    document.getElementById("addConstraint").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect your wallet first"); return; }
      openModal("Add Rule", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Rules control what your agent can do. Breaking a rule triggers automatic compensation from the deposit.</p>
        <div class="form-group"><label>Agent</label><select id="conAgent"><option>AlphaTrader</option><option>OracleBot</option><option>PayBot</option></select></div>
        <div class="form-group"><label>Rule type</label><select id="conType"><option value="spend">Spending Limit</option><option value="program">Allowed Actions</option><option value="timelock">Withdrawal Delay</option><option value="velocity">Speed Limit</option></select></div>
        <div class="form-group"><label>Details</label><input type="text" id="conValue" placeholder="e.g. 500 SOL" /></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="conSubmit">Add Rule</button></div>
      `);
      document.getElementById("conSubmit").onclick = handleAddConstraint;
    });

    document.getElementById("activityFilter").addEventListener("change", () => renderActivity());
  }

  function showToast(msg) {
    const t = document.getElementById("toast");
    document.getElementById("toastMessage").textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
  }

  async function handleRegisterAgent() {
    const name = document.getElementById("regName")?.value;
    if (!name) { showToast("Enter a name"); return; }
    closeModal();
    showTxLoading(`Registering "${name}"`);
    try {
      // In production: use SDK
      // const client = new EquxiClient(provider);
      // const { agentPDA, tx } = await client.registerAgent(name, { trader: {} });
      await new Promise(r => setTimeout(r, 1500));
      userAgents.push({ name, type: "Agent", trustScore: 50, bond: 0, status: "active", icon: "fa-robot", address: walletAddress?.slice(0, 4) + "..." + walletAddress?.slice(-4) });
      renderAgentsGrid();
      updateStats();
      showToast(`Agent "${name}" registered!`);
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  }

  async function handleCreateBond() {
    const amount = document.getElementById("bondAmount")?.value;
    if (!amount) { showToast("Enter an amount"); return; }
    closeModal();
    showTxLoading(`Locking ${amount} SOL`);
    try {
      await new Promise(r => setTimeout(r, 1500));
      showToast(`Locked ${amount} SOL!`);
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  }

  async function handleAddConstraint() {
    const value = document.getElementById("conValue")?.value;
    if (!value) { showToast("Enter details"); return; }
    closeModal();
    showTxLoading("Adding rule");
    try {
      await new Promise(r => setTimeout(r, 1500));
      showToast("Rule added!");
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  }

  window.closeModal = closeModal;

  window.viewAgent = function (name) {
    const agents = userAgents.length > 0 ? userAgents : [
      { name: "AlphaTrader", type: "Trading Bot", trustScore: 94, bond: 5000, address: "7xKX...pQ9" },
      { name: "OracleBot", type: "Data Fetcher", trustScore: 87, bond: 3200, address: "3mLW...rT2" },
      { name: "PayBot", type: "Payment Bot", trustScore: 96, bond: 10000, address: "5tYU...mJ3" },
      { name: "ArbHunter", type: "Arbitrage Bot", trustScore: 45, bond: 1500, address: "8kLP...vC6" },
    ];
    const a = agents.find((x) => x.name === name);
    if (!a) return;
    openModal(a.name, `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="agent-card-avatar" style="width:48px;height:48px;font-size:20px;"><i class="fa-solid fa-robot"></i></div>
          <div><h3 style="font-size:18px;">${a.name}</h3><p style="font-size:12px;color:var(--text-muted);font-family:monospace;">${a.address || "Not on-chain"}</p></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${a.bond.toLocaleString()}</span><span class="label">Deposit</span></div>
          <div class="agent-stat"><span class="value">${a.type}</span><span class="label">Type</span></div>
        </div>
      </div>
    `);
  };

  window.reportViolation = function (name) {
    if (!walletConnected) { showToast("Connect your wallet first"); return; }
    openModal(`Report — ${name}`, `
      <div style="text-align:center;padding:16px 0;">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--red-bg);color:var(--red);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;"><i class="fa-solid fa-bolt"></i></div>
        <p style="margin-bottom:12px;">Report <strong>${name}</strong> for breaking a rule?</p>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Part of their deposit will compensate the affected party.</p>
        <div class="form-group" style="text-align:left;"><label>What happened?</label><textarea id="slashReason" rows="3" placeholder="Describe the violation..."></textarea></div>
        <div class="form-actions" style="justify-content:center;"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="slashSubmit">Report</button></div>
      </div>
    `);
    document.getElementById("slashSubmit").onclick = async () => {
      closeModal();
      showTxLoading("Processing report");
      await new Promise(r => setTimeout(r, 1500));
      showToast("Violation reported — deposit used for compensation");
    };
  };

  document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initModals();
    renderAll();
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
        loadOnChainData();
      });
    }
  });
})();
