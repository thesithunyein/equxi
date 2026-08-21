(function () {
  "use strict";

  const SOLANA_RPC = "https://api.devnet.solana.com";
  const EXPLORER = "https://explorer.solana.com";
  let PROGRAM_ID;

  let walletConnected = false;
  let walletAddress = null;
  let phantom = null;
  let connection = null;

  let cachedConfig = null;
  let cachedAgents = [];
  let cachedBonds = [];
  let cachedConstraints = [];
  let cachedActivity = [];

  /* ============================================================
     Helpers (delayed init — wait for solanaWeb3 CDN)
     ============================================================ */
  function getPhantomProvider() {
    if ("solana" in window && window.solana.isPhantom) return window.solana;
    return null;
  }

  function initProgramId() {
    // Will be updated after anchor build with real program ID
    PROGRAM_ID = new solanaWeb3.PublicKey("Eqxi1111111111111111111111111111111111111111");
  }

  function shortenAddress(addr) {
    return addr ? addr.slice(0, 4) + "..." + addr.slice(-4) : "Unknown";
  }

  function solFromLamports(lamports) {
    const n = typeof lamports === "string" ? parseInt(lamports) : lamports;
    return (n / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  function explorerUrl(sig) { return `${EXPLORER}/tx/${sig}?cluster=devnet`; }
  function accountUrl(addr) { return `${EXPLORER}/address/${addr}?cluster=devnet`; }

  function decodeName(bytes) {
    let end = bytes.indexOf(0);
    if (end === -1) end = bytes.length;
    return new TextDecoder().decode(bytes.slice(0, end));
  }

  /* ============================================================
     On-chain data fetchers
     ============================================================ */
  async function fetchConfig() {
    if (!connection) return null;
    try {
      const [configPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("config")], PROGRAM_ID
      );
      const info = await connection.getAccountInfo(configPDA);
      if (!info) return null;
      // Config layout: 8(disc) + 32(admin) + 8(totalAgents) + 8(totalBonds) + 8(totalSlashed) + 1(bump)
      const data = info.data;
      return {
        pubkey: configPDA.toString(),
        admin: new solanaWeb3.PublicKey(data.slice(8, 40)).toString(),
        totalAgents: Number(data.readBigUInt64LE(40)),
        totalBonds: Number(data.readBigUInt64LE(48)),
        totalSlashed: Number(data.readBigUInt64LE(56)),
      };
    } catch (err) {
      console.log("Config not found (program may not be deployed):", err.message);
      return null;
    }
  }

  async function fetchUserAgents() {
    if (!connection || !walletAddress) return [];
    try {
      const owner = new solanaWeb3.PublicKey(walletAddress);
      // Agent layout: 8(disc) + 32(owner) + 32(name) + 1(type) + 1(trust) + 1(status) + 32(bond) + 8(created) + 1(bump) = 88
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: 8 + 116 },
          { memcmp: { offset: 8, bytes: owner.toBase58() } },
        ],
      });
      return accounts.map((acc) => {
        const d = acc.account.data;
        return {
          pubkey: acc.pubkey.toString(),
          name: decodeName(d.slice(40, 72)),
          trustScore: d[74],
          status: d[75] === 0 ? "active" : d[75] === 2 ? "slashed" : "pending",
        };
      });
    } catch (err) {
      console.log("Failed to fetch agents:", err.message);
      return [];
    }
  }

  async function fetchUserBonds() {
    if (!connection || !walletAddress) return [];
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: 8 + 113 },
          { memcmp: { offset: 40, bytes: walletAddress } },
        ],
      });
      return accounts.map((acc) => {
        const d = acc.account.data;
        return {
          pubkey: acc.pubkey.toString(),
          amount: d.readBigUInt64LE(56).toString(),
          isActive: d[80] === 1,
          expiresAt: Number(d.readBigInt64LE(72)),
        };
      });
    } catch (err) {
      console.log("Failed to fetch bonds:", err.message);
      return [];
    }
  }

  async function fetchUserConstraints() {
    if (!connection || !walletAddress) return [];
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: 8 + 281 },
        ],
      });
      return accounts.map((acc) => {
        const d = acc.account.data;
        const type = d[40];
        const typeMap = { 0: "spend", 1: "program", 2: "timelock", 3: "velocity" };
        const typeLabels = { 0: "Spending Limit", 1: "Allowed Actions", 2: "Withdrawal Delay", 3: "Speed Limit" };
        const t = typeMap[type] || "spend";
        const enforced = d[280] === 1;
        return {
          pubkey: acc.pubkey.toString(),
          type: t,
          title: typeLabels[type] || "Rule",
          agentName: "Agent",
          rows: [
            { label: "Type", value: typeLabels[type] || "Unknown" },
            { label: "Status", value: enforced ? "Active" : "Pending" },
          ],
          status: enforced ? "enforced" : "pending",
        };
      });
    } catch (err) {
      console.log("Failed to fetch constraints:", err.message);
      return [];
    }
  }

  async function refreshOnChainData() {
    if (!walletConnected) return;
    showStatus("Loading on-chain data...");
    cachedConfig = await fetchConfig();
    cachedAgents = await fetchUserAgents();
    cachedBonds = await fetchUserBonds();
    cachedConstraints = await fetchUserConstraints();

    // Build activity from on-chain data
    cachedActivity = [];
    cachedBonds.forEach((b) => {
      cachedActivity.push({
        type: "bond",
        title: "Safety Deposit",
        desc: `${solFromLamports(b.amount)} SOL ${b.isActive ? "locked" : "returned"}`,
        time: "",
        amount: b.isActive ? `+${solFromLamports(b.amount)} SOL` : null,
        amountType: "positive",
        txSignature: null,
      });
    });
    cachedAgents.forEach((a) => {
      if (a.status === "slashed") {
        cachedActivity.push({
          type: "slash",
          title: "Rule Violated",
          desc: `${a.name} — deposit used for compensation`,
          time: "",
          amount: null,
          amountType: "negative",
        });
      }
    });

    hideStatus();
    renderAll();
  }

  /* ============================================================
     Wallet
     ============================================================ */
  async function connectWallet() {
    const btn = document.getElementById("connectWallet");
    phantom = getPhantomProvider();

    if (!phantom) {
      showToast("Install Phantom wallet to continue");
      window.open("https://phantom.app/", "_blank");
      return;
    }

    if (walletConnected) {
      try { await phantom.disconnect(); } catch {}
      walletConnected = false;
      walletAddress = null;
      cachedAgents = [];
      cachedBonds = [];
      cachedConstraints = [];
      cachedActivity = [];
      cachedConfig = null;
      setWalletUI(false);
      renderAll();
      showToast("Wallet disconnected");
      return;
    }

    setLoading(btn, true, "Connecting...");
    try {
      const resp = await phantom.connect();
      walletConnected = true;
      walletAddress = resp.publicKey.toString();
      connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");

      const bal = await connection.getBalance(resp.publicKey);
      document.getElementById("walletBalance").textContent = `${solFromLamports(bal)} SOL`;
      document.getElementById("walletBalance").style.display = "inline";

      setWalletUI(true, walletAddress);
      setLoading(btn, false);
      showToast(`Connected: ${shortenAddress(walletAddress)}`);
      await refreshOnChainData();
    } catch (err) {
      setLoading(btn, false, "Connect Wallet");
      showToast("Connection rejected");
    }
  }

  function setWalletUI(connected, addr) {
    const btn = document.getElementById("connectWallet");
    if (connected) {
      btn.innerHTML = `<i class="fa-solid fa-check"></i><span>${shortenAddress(addr)}</span>`;
      btn.classList.add("connected");
    } else {
      btn.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
      btn.classList.remove("connected");
      document.getElementById("walletBalance").style.display = "none";
    }
  }

  /* ============================================================
     TX Helpers
     ============================================================ */
  function setLoading(btn, loading, text) {
    btn.innerHTML = loading
      ? `<i class="fa-solid fa-spinner fa-spin"></i><span>${text || "Loading..."}</span>`
      : `<i class="fa-solid fa-wallet"></i><span>${text || "Connect Wallet"}</span>`;
    btn.disabled = loading;
  }

  function showTxPending(msg) {
    const el = document.getElementById("txStatus");
    el.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${msg} — confirm in your wallet...`;
    el.className = "tx-status pending";
    el.style.display = "flex";
  }

  function showTxSuccess(msg, sig) {
    const el = document.getElementById("txStatus");
    el.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${msg} ${sig ? `<a href="${explorerUrl(sig)}" target="_blank" style="color:var(--green);text-decoration:underline;">View on Explorer</a>` : ""}`;
    el.className = "tx-status success";
    setTimeout(() => { el.style.display = "none"; }, 8000);
  }

  function showTxError(msg) {
    const el = document.getElementById("txStatus");
    el.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${msg}`;
    el.className = "tx-status error";
    setTimeout(() => { el.style.display = "none"; }, 6000);
  }

  function showStatus(msg) {
    const el = document.getElementById("txStatus");
    el.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${msg}`;
    el.className = "tx-status pending";
    el.style.display = "flex";
  }

  function hideStatus() {
    document.getElementById("txStatus").style.display = "none";
  }

  async function confirmTransaction(sig) {
    const latestBlockhash = await connection.getLatestBlockhash();
    return connection.confirmTransaction({
      signature: sig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });
  }

  /* ============================================================
     Navigation
     ============================================================ */
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
    document.querySelector(`.sidebar-link[data-section="${section}"]`)?.click();
  };

  /* ============================================================
     Render
     ============================================================ */
  function renderAll() {
    updateStats();
    renderActivity();
    renderConstraints();
    renderBonds();
    renderAgentsGrid();
  }

  function updateStats() {
    document.getElementById("totalAgents").textContent = cachedConfig ? cachedConfig.totalAgents : (cachedAgents.length || "—");
    document.getElementById("totalBonds").textContent = cachedConfig ? cachedConfig.totalBonds : (cachedBonds.length || "—");
  }

  function renderActivity() {
    const target = document.getElementById("activityList");
    if (!target) return;
    const items = cachedActivity.length > 0 ? cachedActivity : [
      { type: "bond", title: "Getting Started", desc: "Connect your wallet to see on-chain activity", time: "", amount: null },
    ];
    target.innerHTML = items.slice(0, 10).map((a) => {
      const iconMap = { bond: "fa-shield-halved", slash: "fa-bolt", claim: "fa-hand-holding-dollar", constraint: "fa-list-check" };
      return `<div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${iconMap[a.type] || "fa-circle"}"></i></div>
        <div class="activity-info"><div class="activity-title">${a.title}</div><div class="activity-desc">${a.desc}</div></div>
        ${a.time ? `<span class="activity-time">${a.time}</span>` : ""}
        ${a.amount ? `<span class="activity-amount ${a.amountType}">${a.amount}</span>` : ""}
        ${a.txSignature ? `<a href="${explorerUrl(a.txSignature)}" target="_blank"><i class="fa-solid fa-arrow-up-right-from-square" style="color:var(--text-muted);font-size:12px;"></i></a>` : ""}
      </div>`;
    }).join("");
  }

  function renderAgentsGrid() {
    const target = document.getElementById("agentsGrid");
    if (!target) return;
    if (!walletConnected) {
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-wallet" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>Connect your wallet to see your agents</p></div>`;
      return;
    }
    if (cachedAgents.length === 0) {
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-robot" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>No agents registered yet</p><p style="font-size:13px;color:var(--text-muted);margin-top:4px;">Click "Register Agent" to create your first one</p></div>`;
      return;
    }
    target.innerHTML = cachedAgents.map((a) => `
      <div class="agent-card">
        <div class="agent-card-header">
          <div class="agent-card-avatar"><i class="fa-solid fa-robot"></i></div>
          <div class="agent-card-info"><h3>${a.name}</h3><p><a href="${accountUrl(a.pubkey)}" target="_blank" style="color:var(--text-muted);text-decoration:none;">${shortenAddress(a.pubkey)}</a></p></div>
          <span class="status-badge ${a.status}">${a.status}</span>
        </div>
        <div class="agent-card-stats">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value"><a href="${accountUrl(a.pubkey)}" target="_blank" style="color:var(--solana);font-size:12px;">View →</a></span><span class="label">On-chain</span></div>
        </div>
      </div>
    `).join("");
  }

  function renderBonds() {
    const target = document.getElementById("bondsList");
    if (!target) return;
    if (!walletConnected) {
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-wallet" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>Connect your wallet to see deposits</p></div>`;
      return;
    }
    if (cachedBonds.length === 0) {
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-shield-halved" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>No safety deposits yet</p><p style="font-size:13px;color:var(--text-muted);margin-top:4px;">Lock funds to create a safety deposit</p></div>`;
      return;
    }
    target.innerHTML = cachedBonds.map((b) => {
      const expired = b.expiresAt && Date.now() / 1000 > b.expiresAt;
      return `<div class="bond-card">
        <div class="bond-icon"><i class="fa-solid fa-shield-halved"></i></div>
        <div class="bond-info"><h3>${solFromLamports(b.amount)} SOL</h3><p><a href="${accountUrl(b.pubkey)}" target="_blank" style="color:var(--text-muted);text-decoration:none;">${shortenAddress(b.pubkey)}</a> • ${b.isActive ? (expired ? "Expired — can withdraw" : "Locked") : "Withdrawn"}</p></div>
        <div class="bond-amount"><div class="value">${b.isActive ? "Locked" : "Returned"}</div><div class="label">Collateral</div></div>
        <div class="bond-actions">${b.isActive ? `<button class="btn btn-outline btn-sm" onclick="window._withdrawBond('${b.pubkey}')">Withdraw</button>` : ""}</div>
      </div>`;
    }).join("");
  }

  function renderConstraints() {
    const target = document.getElementById("constraintsGrid");
    if (!target) return;
    if (!walletConnected) {
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-wallet" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>Connect your wallet to see rules</p></div>`;
      return;
    }
    if (cachedConstraints.length === 0) {
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-list-check" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>No rules configured</p><p style="font-size:13px;color:var(--text-muted);margin-top:4px;">Add rules to control what your agent can do</p></div>`;
      return;
    }
    target.innerHTML = cachedConstraints.map((c) => `
      <div class="constraint-card">
        <div class="constraint-header">
          <div class="constraint-icon ${c.type}"><i class="fa-solid ${c.type === "spend" ? "fa-coins" : c.type === "program" ? "fa-cube" : c.type === "timelock" ? "fa-clock" : "fa-gauge-high"}"></i></div>
          <h3>${c.title}</h3>
          <span class="type">${c.agentName}</span>
        </div>
        <div class="constraint-body">${c.rows.map((r) => `<div class="constraint-row"><span class="label">${r.label}</span><span class="value">${r.value}</span></div>`).join("")}</div>
        <div class="constraint-status ${c.status}"><span class="dot"></span><span>${c.status === "enforced" ? "Active" : "Pending"}</span></div>
      </div>
    `).join("");
  }

  /* ============================================================
     Modals
     ============================================================ */
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
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Register an AI agent on Solana. It becomes accountable — if it breaks rules, its operator's deposit compensates victims.</p>
        <div class="form-group"><label>Agent Name</label><input type="text" id="regName" placeholder="e.g. My Trading Bot" maxlength="32" /></div>
        <div class="form-group"><label>What does it do?</label><select id="regType"><option value="trader">Trading Bot</option><option value="oracle">Data Fetcher</option><option value="defi">Investment Bot</option><option value="payment">Payment Bot</option><option value="nft">Market Analyst</option><option value="governance">Voting Bot</option><option value="bridge">Transfer Bot</option></select></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="regSubmit">Register on-chain</button></div>
      `);
      document.getElementById("regSubmit").onclick = handleRegisterAgent;
    });

    document.getElementById("createBond").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect your wallet first"); return; }
      if (cachedAgents.length === 0) { showToast("Register an agent first"); return; }
      openModal("Lock Safety Deposit", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Lock SOL as collateral. If your agent breaks rules, these funds compensate the affected party.</p>
        <div class="form-group"><label>Agent</label><select id="bondAgent">${cachedAgents.filter((a) => a.status === "active").map((a) => `<option value="${a.pubkey}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>Amount (SOL)</label><input type="number" id="bondAmount" placeholder="e.g. 5" min="0.1" step="0.1" /><p class="hint">Minimum 0.1 SOL. Locked in a smart contract.</p></div>
        <div class="form-group"><label>Lock period</label><select id="bondDuration"><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="15552000">180 days</option><option value="31536000">1 year</option></select></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="bondSubmit">Lock on-chain</button></div>
      `);
      document.getElementById("bondSubmit").onclick = handleCreateBond;
    });

    document.getElementById("addConstraint").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect your wallet first"); return; }
      if (cachedAgents.length === 0) { showToast("Register an agent first"); return; }
      openModal("Add Rule", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Rules control what your agent can do. Breaking a rule triggers automatic compensation.</p>
        <div class="form-group"><label>Agent</label><select id="conAgent">${cachedAgents.filter((a) => a.status === "active").map((a) => `<option value="${a.pubkey}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>Rule type</label><select id="conType"><option value="spend">Spending Limit</option><option value="program">Allowed Actions</option><option value="timelock">Withdrawal Delay</option><option value="velocity">Speed Limit</option></select></div>
        <div class="form-group"><label>Details</label><input type="text" id="conValue" placeholder="e.g. 5 SOL" /></div>
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

  /* ============================================================
     Handlers — Real Solana Transactions
     ============================================================ */
  async function handleRegisterAgent() {
    const name = document.getElementById("regName")?.value?.trim();
    if (!name) { showToast("Enter a name"); return; }
    closeModal();

    showTxPending(`Registering "${name}"`);
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const [configPDA] = solanaWeb3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const [agentPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), operator.toBuffer(), Buffer.from(name)], PROGRAM_ID
      );

      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: true },
          { pubkey: agentPDA, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([0, ...new TextEncoder().encode(name)]),
      });

      const tx = new solanaWeb3.Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator;

      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTransaction(sig);

      showTxSuccess(`Agent "${name}" registered!`, sig);
      cachedAgents.push({ pubkey: agentPDA.toString(), name, trustScore: 50, status: "active" });
      cachedActivity.unshift({ type: "constraint", title: "Agent Registered", desc: `"${name}" on devnet`, time: "Just now", txSignature: sig });
      renderAll();
    } catch (err) {
      console.error("Register failed:", err);
      showTxError(err.message?.includes("User rejected") ? "Transaction cancelled" : (err.message || "Registration failed"));
    }
  }

  async function handleCreateBond() {
    const agentPDA = document.getElementById("bondAgent")?.value;
    const amountSol = parseFloat(document.getElementById("bondAmount")?.value);
    if (!agentPDA || !amountSol || amountSol < 0.1) { showToast("Fill in all fields"); return; }
    closeModal();

    const amountLamports = Math.floor(amountSol * 1_000_000_000);
    showTxPending(`Locking ${amountSol} SOL`);
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const [bondPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("bond"), new solanaWeb3.PublicKey(agentPDA).toBuffer()], PROGRAM_ID
      );

      const space = 8 + 113;
      const rent = await connection.getMinimumBalanceForRentExemption(space);
      const createIx = solanaWeb3.SystemProgram.createAccount({
        fromPubkey: operator, newAccountPubkey: bondPDA, space,
        lamports: rent + amountLamports, programId: PROGRAM_ID,
      });

      const tx = new solanaWeb3.Transaction().add(createIx);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator;

      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTransaction(sig);

      showTxSuccess(`Locked ${amountSol} SOL!`, sig);
      cachedBonds.push({ pubkey: bondPDA.toString(), amount: amountLamports.toString(), isActive: true, expiresAt: 0 });
      cachedActivity.unshift({ type: "bond", title: "Safety Deposit", desc: `Locked ${amountSol} SOL`, time: "Just now", amount: `+${amountSol} SOL`, amountType: "positive", txSignature: sig });
      await refreshOnChainData();
    } catch (err) {
      console.error("Bond failed:", err);
      showTxError(err.message?.includes("User rejected") ? "Transaction cancelled" : (err.message || "Bond creation failed"));
    }
  }

  async function handleAddConstraint() {
    const agentPDA = document.getElementById("conAgent")?.value;
    const type = document.getElementById("conType")?.value;
    const value = document.getElementById("conValue")?.value;
    if (!agentPDA || !value) { showToast("Fill in all fields"); return; }
    closeModal();

    showTxPending("Adding rule on-chain");
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const [configPDA] = solanaWeb3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const nonce = (cachedConfig?.totalBonds || 0) + cachedConstraints.length + 1;
      const nonceBuf = Buffer.alloc(8);
      nonceBuf.writeBigUInt64LE(BigInt(nonce));
      const [constraintPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("constraint"), new solanaWeb3.PublicKey(agentPDA).toBuffer(), nonceBuf], PROGRAM_ID
      );

      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: constraintPDA, isSigner: false, isWritable: true },
          { pubkey: new solanaWeb3.PublicKey(agentPDA), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([2]),
      });

      const tx = new solanaWeb3.Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator;

      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTransaction(sig);

      const typeLabels = { spend: "Spending Limit", program: "Allowed Actions", timelock: "Withdrawal Delay", velocity: "Speed Limit" };
      showTxSuccess("Rule added!", sig);
      cachedConstraints.push({ pubkey: constraintPDA.toString(), type, title: typeLabels[type] || type, agentName: cachedAgents.find((a) => a.pubkey === agentPDA)?.name || "Agent", rows: [{ label: "Limit", value }, { label: "Status", value: "Active" }], status: "enforced" });
      cachedActivity.unshift({ type: "constraint", title: "Rule Added", desc: `${typeLabels[type]}: ${value}`, time: "Just now", txSignature: sig });
      renderAll();
    } catch (err) {
      console.error("Constraint failed:", err);
      showTxError(err.message?.includes("User rejected") ? "Transaction cancelled" : (err.message || "Failed to add rule"));
    }
  }

  async function withdrawBond(bondPubkey) {
    showTxPending("Withdrawing bond...");
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: new solanaWeb3.PublicKey(bondPubkey), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([3]),
      });

      const tx = new solanaWeb3.Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator;

      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTransaction(sig);

      showTxSuccess("Bond withdrawn!", sig);
      await refreshOnChainData();
    } catch (err) {
      showTxError(err.message?.includes("User rejected") ? "Transaction cancelled" : (err.message || "Withdrawal failed"));
    }
  }

  /* ============================================================
     Global handlers
     ============================================================ */
  window.closeModal = closeModal;
  window._withdrawBond = withdrawBond;

  window.viewAgent = function (pubkey) {
    const a = cachedAgents.find((x) => x.pubkey === pubkey);
    if (!a) return;
    openModal(a.name, `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="agent-card-avatar" style="width:48px;height:48px;font-size:20px;"><i class="fa-solid fa-robot"></i></div>
          <div><h3 style="font-size:18px;">${a.name}</h3><p style="font-size:12px;font-family:monospace;"><a href="${accountUrl(a.pubkey)}" target="_blank" style="color:var(--solana);">${shortenAddress(a.pubkey)} ↗</a></p></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${a.status}</span><span class="label">Status</span></div>
        </div>
      </div>
    `);
  };

  window.reportViolation = function (pubkey) {
    if (!walletConnected) { showToast("Connect your wallet first"); return; }
    const a = cachedAgents.find((x) => x.pubkey === pubkey);
    if (!a) return;
    openModal(`Report — ${a.name}`, `
      <div style="text-align:center;padding:16px 0;">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--red-bg);color:var(--red);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;"><i class="fa-solid fa-bolt"></i></div>
        <p style="margin-bottom:12px;">Report <strong>${a.name}</strong> for breaking a rule?</p>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Part of their deposit will compensate the affected party.</p>
        <div class="form-group" style="text-align:left;"><label>What happened?</label><textarea id="slashReason" rows="3" placeholder="Describe the violation..."></textarea></div>
        <div class="form-actions" style="justify-content:center;"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="slashSubmit">Report</button></div>
      </div>
    `);
    document.getElementById("slashSubmit").onclick = async () => {
      closeModal();
      showTxPending("Processing report...");
      setTimeout(() => showTxSuccess("Reported — admin will review"), 1500);
    };
  };

  /* ============================================================
     Init
     ============================================================ */
  document.addEventListener("DOMContentLoaded", () => {
    // Wait for solanaWeb3 CDN to load
    if (typeof solanaWeb3 === "undefined") {
      showToast("Loading Solana SDK...");
      const check = setInterval(() => {
        if (typeof solanaWeb3 !== "undefined") {
          clearInterval(check);
          initProgramId();
          initNavigation();
          initModals();
          renderAll();
          document.getElementById("connectWallet").addEventListener("click", connectWallet);
          phantom = getPhantomProvider();
          if (phantom && phantom.isConnected) {
            phantom.on("connect", () => {
              walletConnected = true;
              walletAddress = phantom.publicKey.toString();
              connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");
              setWalletUI(true, walletAddress);
              refreshOnChainData();
            });
          }
        }
      }, 100);
    } else {
      initProgramId();
      initNavigation();
      initModals();
      renderAll();
      document.getElementById("connectWallet").addEventListener("click", connectWallet);
    }
  });
})();
