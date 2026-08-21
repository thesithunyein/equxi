(function () {
  "use strict";

  /* --------------------------------------------------------
     Solana Connection Config
     -------------------------------------------------------- */
  const SOLANA_RPC = "https://api.devnet.solana.com";
  const PROGRAM_ID = "EQUxi11111111111111111111111111111111111111111";

  /* --------------------------------------------------------
     Mock Data (displayed when wallet not connected)
     -------------------------------------------------------- */
  const MOCK_AGENTS = [
    { id: "agent_01", name: "AlphaTrader", address: "7xKX...pQ9", type: "Autonomous Trader", trustScore: 94, bond: 5000, status: "active", icon: "fa-robot" },
    { id: "agent_02", name: "OracleBot", address: "3mLW...rT2", type: "Data Oracle", trustScore: 87, bond: 3200, status: "active", icon: "fa-database" },
    { id: "agent_03", name: "YieldMax", address: "9pQS...nK4", type: "DeFi Optimizer", trustScore: 72, bond: 8000, status: "pending", icon: "fa-chart-line" },
    { id: "agent_04", name: "NFT Scout", address: "2vBN...wX8", type: "NFT Analyst", trustScore: 91, bond: 2500, status: "active", icon: "fa-image" },
    { id: "agent_05", name: "PayBot", address: "5tYU...mJ3", type: "Payment Agent", trustScore: 96, bond: 10000, status: "active", icon: "fa-credit-card" },
    { id: "agent_06", name: "ArbHunter", address: "8kLP...vC6", type: "Arbitrage Bot", trustScore: 45, bond: 1500, status: "slashed", icon: "fa-bolt" },
    { id: "agent_07", name: "GovernanceAI", address: "4nRT...sH1", type: "DAO Voter", trustScore: 88, bond: 6000, status: "active", icon: "fa-landmark" },
    { id: "agent_08", name: "BridgeBot", address: "6wQM...dE9", type: "Cross-chain Bridge", trustScore: 79, bond: 4200, status: "active", icon: "fa-bridge" },
  ];

  const MOCK_ACTIVITY = [
    { type: "bond", title: "Bond Created", desc: "AlphaTrader bonded 5,000 SOL on Solana devnet", time: "2m ago", amount: "+5,000 SOL", amountType: "positive" },
    { type: "constraint", title: "Constraint Added", desc: "PayBot: max 100 SOL per transaction enforced on-chain", time: "15m ago", amount: null },
    { type: "slash", title: "Slashing Event", desc: "ArbHunter violated spend limit — 12.4 SOL slashed", time: "1h ago", amount: "-12.4 SOL", amountType: "negative" },
    { type: "claim", title: "Compensation Paid", desc: "Victim compensated from ArbHunter's bond collateral", time: "1h ago", amount: "+12.4 SOL", amountType: "positive" },
    { type: "bond", title: "Bond Topped Up", desc: "OracleBot added 200 SOL collateral", time: "3h ago", amount: "+200 SOL", amountType: "positive" },
    { type: "constraint", title: "Timelock Updated", desc: "YieldMax: 24h → 48h withdrawal delay deployed", time: "5h ago", amount: null },
    { type: "bond", title: "Bond Created", desc: "NFT Scout bonded 2,500 SOL", time: "1d ago", amount: "+2,500 SOL", amountType: "positive" },
    { type: "slash", title: "Slashing Event", desc: "ArbHunter exceeded velocity limit", time: "2d ago", amount: "-8.2 SOL", amountType: "negative" },
  ];

  const MOCK_CONSTRAINTS = [
    { agent: "AlphaTrader", type: "spend", title: "Max Spend Per Transaction", rows: [{ label: "Limit", value: "500 SOL" }, { label: "Period", value: "Per transaction" }, { label: "Enforcement", value: "On-chain" }], status: "enforced" },
    { agent: "PayBot", type: "program", title: "Allowlisted Programs", rows: [{ label: "Programs", value: "4 allowed" }, { label: "Examples", value: "Token, Stake, Vote" }, { label: "Block Unknown", value: "Yes" }], status: "enforced" },
    { agent: "YieldMax", type: "timelock", title: "Withdrawal Timelock", rows: [{ label: "Delay", value: "48 hours" }, { label: "Grace Period", value: "24 hours" }, { label: "Override", value: "Multi-sig required" }], status: "enforced" },
    { agent: "ArbHunter", type: "velocity", title: "Transaction Velocity Limit", rows: [{ label: "Max TPS", value: "10 tx/min" }, { label: "Cooldown", value: "6 seconds" }, { label: "Violation", value: "Auto-slash" }], status: "pending" },
    { agent: "GovernanceAI", type: "program", title: "Voting Power Cap", rows: [{ label: "Max Vote Weight", value: "0.5%" }, { label: "Quorum Requirement", value: "10%" }, { label: "Cooldown", value: "7 days" }], status: "enforced" },
    { agent: "BridgeBot", type: "spend", title: "Bridge Transfer Limit", rows: [{ label: "Max Per Day", value: "10,000 SOL" }, { label: "Max Per Tx", value: "2,000 SOL" }, { label: "Alert Threshold", value: "80%" }], status: "enforced" },
  ];

  /* --------------------------------------------------------
     State
     -------------------------------------------------------- */
  let walletConnected = false;
  let walletAddress = null;
  let solana = null; // Phantom provider

  /* --------------------------------------------------------
     Phantom Wallet Integration
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

    // Check if Phantom is installed
    solana = getPhantomProvider();
    if (!solana) {
      showToast("Please install Phantom wallet to connect");
      window.open("https://phantom.app/", "_blank");
      return;
    }

    if (walletConnected) {
      // Disconnect
      try {
        await solana.disconnect();
      } catch (e) {}
      walletConnected = false;
      walletAddress = null;
      btn.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
      btn.classList.remove("connected");
      showToast("Wallet disconnected");
      return;
    }

    // Connect
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Connecting...</span>';
    try {
      const resp = await solana.connect();
      walletConnected = true;
      walletAddress = resp.publicKey.toString();
      const shortAddr = walletAddress.slice(0, 4) + "..." + walletAddress.slice(-4);
      btn.innerHTML = `<i class="fa-solid fa-check"></i><span>${shortAddr}</span>`;
      btn.classList.add("connected");
      showToast(`Connected: ${shortAddr}`);

      // Try to fetch on-chain data
      await loadOnChainData();
    } catch (err) {
      btn.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
      showToast("Connection rejected");
    }
  }

  async function loadOnChainData() {
    try {
      // Connect to Solana devnet
      const connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");

      // Fetch balance
      const balance = await connection.getBalance(new solanaWeb3.PublicKey(walletAddress));
      const solBalance = (balance / solanaWeb3.LAMPORTS_PER_SOL).toFixed(2);

      showToast(`Wallet balance: ${solBalance} SOL`);

      // Here you would fetch agent data from the program
      // For now, the dashboard shows mock data
    } catch (err) {
      console.log("Could not fetch on-chain data:", err);
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

  /* --------------------------------------------------------
     Render Functions
     -------------------------------------------------------- */
  function renderActivity() {
    document.getElementById("activityList").innerHTML = MOCK_ACTIVITY.map((a) => `
      <div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${a.type === "bond" ? "fa-shield-halved" : a.type === "slash" ? "fa-bolt" : a.type === "claim" ? "fa-hand-holding-dollar" : "fa-lock"}"></i></div>
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
          <div class="agent-card-info"><h3>${a.name}</h3><p>${a.address}</p></div>
          <span class="status-badge ${a.status}">${a.status}</span>
        </div>
        <div class="agent-card-stats">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${a.bond.toLocaleString()}</span><span class="label">Bond (SOL)</span></div>
          <div class="agent-stat"><span class="value">${a.type.split(" ")[0]}</span><span class="label">Type</span></div>
        </div>
        <div class="agent-card-actions">
          <button class="btn btn-outline btn-sm" onclick="viewAgent('${a.id}')">View Details</button>
          ${a.status === "active" ? `<button class="btn btn-danger btn-sm" onclick="slashAgent('${a.id}')">Slash</button>` : ""}
        </div>
      </div>
    `).join("");
  }

  function renderBonds() {
    document.getElementById("bondsList").innerHTML = MOCK_AGENTS.filter((a) => a.status !== "slashed").map((a) => `
      <div class="bond-card">
        <div class="bond-icon"><i class="fa-solid ${a.icon}"></i></div>
        <div class="bond-info"><h3>${a.name} Bond</h3><p>Operator: ${a.address} • Type: ${a.type}</p></div>
        <div class="bond-amount"><div class="value">${a.bond.toLocaleString()} SOL</div><div class="label">Locked Collateral</div></div>
        <div class="bond-actions"><button class="btn btn-outline btn-sm">Manage</button><button class="btn btn-danger btn-sm">Slash</button></div>
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
        <div class="constraint-status ${c.status}"><span class="dot"></span><span>${c.status === "enforced" ? "Enforced on-chain" : "Pending deployment"}</span></div>
      </div>
    `).join("");
  }

  function renderFullActivity(filter = "all") {
    const filtered = filter === "all" ? MOCK_ACTIVITY : MOCK_ACTIVITY.filter((a) => a.type === filter);
    document.getElementById("activityFullList").innerHTML = filtered.map((a) => `
      <div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${a.type === "bond" ? "fa-shield-halved" : a.type === "slash" ? "fa-bolt" : a.type === "claim" ? "fa-hand-holding-dollar" : "fa-lock"}"></i></div>
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

    // Register Agent
    document.getElementById("registerAgent").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      openModal("Register New Agent", `
        <div class="form-group"><label>Agent Name</label><input type="text" id="regName" placeholder="e.g. AlphaTrader" /></div>
        <div class="form-group"><label>Agent Type</label><select id="regType"><option value="trader">Autonomous Trader</option><option value="oracle">Data Oracle</option><option value="defi">DeFi Optimizer</option><option value="payment">Payment Agent</option><option value="nft">NFT Analyst</option><option value="governance">DAO Voter</option><option value="bridge">Cross-chain Bridge</option></select></div>
        <div class="form-group"><label>Initial Bond (SOL)</label><input type="number" id="regBond" placeholder="e.g. 5000" min="0.1" step="0.1" /><p class="hint">Minimum 0.1 SOL. This collateral backs the agent's behavior on Solana devnet.</p></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="handleRegisterAgent()">Register on-chain</button></div>
      `);
    });

    // Create Bond
    document.getElementById("createBond").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      openModal("Create Bond", `
        <div class="form-group"><label>Select Agent</label><select id="bondAgent">${MOCK_AGENTS.filter((a) => a.status === "active").map((a) => `<option value="${a.id}">${a.name} (${a.address})</option>`).join("")}</select></div>
        <div class="form-group"><label>Bond Amount (SOL)</label><input type="number" id="bondAmount" placeholder="e.g. 5000" min="0.1" step="0.1" /><p class="hint">Collateral slashed if agent violates constraints</p></div>
        <div class="form-group"><label>Lock Duration</label><select id="bondDuration"><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="15552000">180 days</option><option value="31536000">365 days</option></select></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="handleCreateBond()">Lock on-chain</button></div>
      `);
    });

    // Add Constraint
    document.getElementById("addConstraint").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      openModal("Add Behavioral Constraint", `
        <div class="form-group"><label>Select Agent</label><select id="conAgent">${MOCK_AGENTS.filter((a) => a.status === "active").map((a) => `<option value="${a.id}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>Constraint Type</label><select id="conType"><option value="spend">Spend Limit (max SOL per tx)</option><option value="program">Allowlisted Programs</option><option value="timelock">Withdrawal Timelock</option><option value="velocity">Transaction Velocity</option></select></div>
        <div class="form-group"><label>Limit Value</label><input type="text" id="conValue" placeholder="e.g. 500 SOL" /><p class="hint">On-chain enforcement — violation triggers auto-slashing</p></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="handleAddConstraint()">Deploy on-chain</button></div>
      `);
    });

    document.getElementById("activityFilter").addEventListener("change", (e) => renderFullActivity(e.target.value));
  }

  /* --------------------------------------------------------
     Toast
     -------------------------------------------------------- */
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
    if (!name) { showToast("Enter agent name"); return; }
    closeModal();
    showToast(`Registering "${name}" on Solana devnet...`);
    // In production: await equxiClient.registerAgent(name, type)
    setTimeout(() => showToast(`Agent "${name}" registered!`), 2000);
  };

  window.handleCreateBond = () => {
    const amount = document.getElementById("bondAmount")?.value;
    if (!amount) { showToast("Enter bond amount"); return; }
    closeModal();
    showToast(`Locking ${amount} SOL on Solana devnet...`);
    setTimeout(() => showToast(`Bond created: ${amount} SOL locked!`), 2000);
  };

  window.handleAddConstraint = () => {
    const value = document.getElementById("conValue")?.value;
    if (!value) { showToast("Enter constraint value"); return; }
    closeModal();
    showToast("Deploying constraint on-chain...");
    setTimeout(() => showToast("Constraint enforced on-chain!"), 2000);
  };

  window.viewAgent = function (id) {
    const a = MOCK_AGENTS.find((x) => x.id === id);
    if (!a) return;
    openModal(a.name, `
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div style="display:flex;align-items:center;gap:16px;">
          <div class="agent-card-avatar" style="width:56px;height:56px;font-size:24px;"><i class="fa-solid ${a.icon}"></i></div>
          <div><h3 style="font-size:20px;margin-bottom:4px;">${a.name}</h3><p style="font-size:13px;color:var(--text-muted);font-family:monospace;">${a.address}</p></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${a.bond.toLocaleString()}</span><span class="label">Bond (SOL)</span></div>
          <div class="agent-stat"><span class="value">${a.type}</span><span class="label">Type</span></div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:16px;">
          <h4 style="font-size:14px;margin-bottom:12px;">Active Constraints</h4>
          ${MOCK_CONSTRAINTS.filter((c) => c.agent === a.name).map((c) => `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">
              <div class="constraint-icon ${c.type}" style="width:32px;height:32px;font-size:12px;"><i class="fa-solid ${c.type === "spend" ? "fa-coins" : c.type === "program" ? "fa-cube" : c.type === "timelock" ? "fa-clock" : "fa-gauge-high"}"></i></div>
              <div><div style="font-size:13px;font-weight:500;">${c.title}</div><div style="font-size:12px;color:var(--text-muted);">${c.status}</div></div>
            </div>
          `).join("") || '<p style="font-size:13px;color:var(--text-muted);">No constraints configured</p>'}
        </div>
      </div>
    `);
  };

  window.slashAgent = function (id) {
    if (!walletConnected) { showToast("Connect wallet first"); return; }
    const a = MOCK_AGENTS.find((x) => x.id === id);
    if (!a) return;
    openModal(`Slash ${a.name}`, `
      <div style="text-align:center;padding:16px 0;">
        <div style="width:64px;height:64px;border-radius:50%;background:var(--red-bg);color:var(--red);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;"><i class="fa-solid fa-bolt"></i></div>
        <p style="margin-bottom:8px;">Slash <strong>${a.name}</strong>'s bond of <strong>${a.bond.toLocaleString()} SOL</strong>?</p>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">This penalizes the operator and compensates affected counterparties from locked collateral on Solana.</p>
        <div class="form-group" style="text-align:left;"><label>Reason for Slashing</label><textarea id="slashReason" rows="3" placeholder="Describe the violation..."></textarea></div>
        <div class="form-actions" style="justify-content:center;"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="confirmSlash('${id}')">Execute Slash</button></div>
      </div>
    `);
  };

  window.confirmSlash = function (id) {
    const a = MOCK_AGENTS.find((x) => x.id === id);
    if (a) { a.status = "slashed"; renderAgentsGrid(); renderAgentsTable(); renderBonds(); }
    closeModal();
    showToast(`Executing slash on ${a?.name}'s bond...`);
    setTimeout(() => showToast(`${a?.name} slashed — bond penalized on Solana`), 2000);
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

    // Wallet connect button
    document.getElementById("connectWallet").addEventListener("click", connectWallet);

    // Check if already connected
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
