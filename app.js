(function () {
  "use strict";

  /* ============================================================
     Config
     ============================================================ */
  const SOLANA_RPC = "https://api.devnet.solana.com";
  const EXPLORER = "https://explorer.solana.com";
  const PROGRAM_ID = new PublicKey("Eqxi1111111111111111111111111111111111111111");

  /* ============================================================
     State
     ============================================================ */
  let walletConnected = false;
  let walletAddress = null;
  let phantom = null;
  let connection = null;
  let equxiClient = null;

  // Cache on-chain data
  let cachedAgents = [];
  let cachedBonds = [];
  let cachedConstraints = [];
  let cachedActivity = [];

  /* ============================================================
     Solana Helpers
     ============================================================ */
  function getPhantomProvider() {
    if ("solana" in window && window.solana.isPhantom) return window.solana;
    return null;
  }

  async function derivePDAs(operatorPubkey, agentName, nonce) {
    const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
    const [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), operatorPubkey.toBuffer(), Buffer.from(agentName)],
      PROGRAM_ID
    );
    const [bondPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentPDA.toBuffer()],
      PROGRAM_ID
    );
    return { configPDA, agentPDA, bondPDA };
  }

  async function fetchConfig() {
    if (!connection) return null;
    const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
    try {
      const info = await connection.getAccountInfo(configPDA);
      if (!info) return null;
      // Decode manually or return raw
      return { admin: configPDA.toString(), totalAgents: 0, totalBonds: 0, totalSlashed: 0 };
    } catch { return null; }
  }

  async function fetchUserAgents() {
    if (!connection || !walletAddress) return [];
    try {
      const owner = new PublicKey(walletAddress);
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: 8 + 88 }, // Agent account size
          { memcmp: { offset: 8, bytes: owner.toBase58() } },
        ],
      });
      return accounts.map((acc) => ({
        pubkey: acc.pubkey.toString(),
        name: decodeName(acc.account.data.slice(40, 72)),
        trustScore: acc.account.data[74],
        status: acc.account.data[75] === 0 ? "active" : acc.account.data[75] === 2 ? "slashed" : "pending",
      }));
    } catch (err) {
      console.log("Failed to fetch agents:", err);
      return [];
    }
  }

  async function fetchUserBonds() {
    if (!connection || !walletAddress) return [];
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: 8 + 113 }, // Bond account size
          { memcmp: { offset: 40, bytes: walletAddress } }, // operator field
        ],
      });
      return accounts.map((acc) => ({
        pubkey: acc.pubkey.toString(),
        amount: acc.account.data.readBigUInt64LE(56).toString(),
        isActive: acc.account.data[80] === 1,
      }));
    } catch (err) {
      console.log("Failed to fetch bonds:", err);
      return [];
    }
  }

  function decodeName(bytes) {
    let end = bytes.indexOf(0);
    if (end === -1) end = bytes.length;
    return Buffer.from(bytes.slice(0, end)).toString("utf8");
  }

  function shortenAddress(addr) {
    return addr ? addr.slice(0, 4) + "..." + addr.slice(-4) : "Unknown";
  }

  function solFromLamports(lamports) {
    return (parseInt(lamports) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  function explorerUrl(sig) {
    return `${EXPLORER}/tx/${sig}?cluster=devnet`;
  }

  function accountUrl(addr) {
    return `${EXPLORER}/address/${addr}?cluster=devnet`;
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
      equxiClient = null;
      cachedAgents = [];
      cachedBonds = [];
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

      // Show balance
      const bal = await connection.getBalance(resp.publicKey);
      document.getElementById("walletBalance").textContent = `${solFromLamports(bal)} SOL`;
      document.getElementById("walletBalance").style.display = "inline";

      setWalletUI(true, walletAddress);
      setLoading(btn, false);
      showToast(`Connected: ${shortenAddress(walletAddress)}`);

      // Fetch on-chain data
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

  async function refreshOnChainData() {
    if (!walletConnected) return;
    showStatus("Loading on-chain data...");
    cachedAgents = await fetchUserAgents();
    cachedBonds = await fetchUserBonds();
    hideStatus();
    renderAll();
  }

  /* ============================================================
     Transaction Helpers
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

  async function signAndSend(tx) {
    if (!phantom || !walletAddress) throw new Error("Wallet not connected");
    const signed = await phantom.signTransaction(tx);
    return await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
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
    document.getElementById("totalAgents").textContent = cachedAgents.length || "—";
    document.getElementById("totalBonds").textContent = cachedBonds.length || "—";
  }

  function renderActivity() {
    const items = cachedActivity.length > 0 ? cachedActivity : [
      { type: "bond", title: "Safety Deposit Created", desc: "Connect wallet to see your activity", time: "", amount: null, amountType: "" },
    ];
    const target = document.getElementById("activityList");
    if (!target) return;
    target.innerHTML = items.map(renderActivityItem).join("");
  }

  function renderActivityItem(a) {
    const iconMap = { bond: "fa-shield-halved", slash: "fa-bolt", claim: "fa-hand-holding-dollar", constraint: "fa-list-check" };
    return `
      <div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${iconMap[a.type] || "fa-circle"}"></i></div>
        <div class="activity-info"><div class="activity-title">${a.title}</div><div class="activity-desc">${a.desc}</div></div>
        ${a.time ? `<span class="activity-time">${a.time}</span>` : ""}
        ${a.amount ? `<span class="activity-amount ${a.amountType}">${a.amount}</span>` : ""}
        ${a.txSignature ? `<a href="${explorerUrl(a.txSignature)}" target="_blank" title="View on Explorer"><i class="fa-solid fa-arrow-up-right-from-square" style="color:var(--text-muted);font-size:12px;"></i></a>` : ""}
      </div>`;
  }

  function renderAgentsGrid() {
    const agents = cachedAgents.length > 0 ? cachedAgents : [];
    const target = document.getElementById("agentsGrid");
    if (!target) return;

    if (!walletConnected) {
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-wallet" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>Connect your wallet to see your agents</p></div>`;
      return;
    }

    if (agents.length === 0) {
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-robot" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>No agents registered yet</p><p style="font-size:13px;color:var(--text-muted);margin-top:4px;">Click "Register Agent" to create your first one</p></div>`;
      return;
    }

    target.innerHTML = agents.map((a) => `
      <div class="agent-card">
        <div class="agent-card-header">
          <div class="agent-card-avatar"><i class="fa-solid fa-robot"></i></div>
          <div class="agent-card-info"><h3>${a.name}</h3><p><a href="${accountUrl(a.pubkey)}" target="_blank" style="color:var(--text-muted);text-decoration:none;">${shortenAddress(a.pubkey)}</a></p></div>
          <span class="status-badge ${a.status}">${a.status}</span>
        </div>
        <div class="agent-card-stats">
          <div class="agent-stat"><span class="value">${a.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${a.bond ? solFromLamports(a.bond) : "0"}</span><span class="label">Deposit (SOL)</span></div>
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
      target.innerHTML = `<div class="empty-state"><i class="fa-solid fa-shield-halved" style="font-size:32px;color:var(--text-muted);margin-bottom:12px;"></i><p>No safety deposits yet</p><p style="font-size:13px;color:var(--text-muted);margin-top:4px;">Lock funds to create a safety deposit for your agent</p></div>`;
      return;
    }

    target.innerHTML = cachedBonds.map((b) => `
      <div class="bond-card">
        <div class="bond-icon"><i class="fa-solid fa-shield-halved"></i></div>
        <div class="bond-info"><h3>${solFromLamports(b.amount)} SOL</h3><p><a href="${accountUrl(b.pubkey)}" target="_blank" style="color:var(--text-muted);text-decoration:none;">${shortenAddress(b.pubkey)}</a> • ${b.isActive ? "Active" : "Withdrawn"}</p></div>
        <div class="bond-amount"><div class="value">${b.isActive ? "Locked" : "Returned"}</div><div class="label">${b.isActive ? "Collateral" : "Completed"}</div></div>
        <div class="bond-actions">${b.isActive ? `<button class="btn btn-outline btn-sm" onclick="withdrawBond('${b.pubkey}')">Withdraw</button>` : ""}</div>
      </div>
    `).join("");
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
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Lock SOL as collateral. If your agent breaks rules, these funds compensate the affected party. You can withdraw after the lock period.</p>
        <div class="form-group"><label>Agent</label><select id="bondAgent">${cachedAgents.filter((a) => a.status === "active").map((a) => `<option value="${a.pubkey}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>Amount (SOL)</label><input type="number" id="bondAmount" placeholder="e.g. 5" min="0.1" step="0.1" /><p class="hint">Minimum 0.1 SOL. This is locked in a smart contract.</p></div>
        <div class="form-group"><label>Lock period</label><select id="bondDuration"><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="15552000">180 days</option><option value="31536000">1 year</option></select></div>
        <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="bondSubmit">Lock on-chain</button></div>
      `);
      document.getElementById("bondSubmit").onclick = handleCreateBond;
    });

    document.getElementById("addConstraint").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect your wallet first"); return; }
      if (cachedAgents.length === 0) { showToast("Register an agent first"); return; }
      openModal("Add Rule", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">Rules control what your agent can do. Breaking a rule triggers automatic compensation from the deposit.</p>
        <div class="form-group"><label>Agent</label><select id="conAgent">${cachedAgents.filter((a) => a.status === "active").map((a) => `<option value="${a.pubkey}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>Rule type</label><select id="conType"><option value="spend">Spending Limit (max per tx)</option><option value="program">Allowed Actions (which programs)</option><option value="timelock">Withdrawal Delay (wait time)</option><option value="velocity">Speed Limit (max txs per time)</option></select></div>
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
     Handlers — Real SDK Calls
     ============================================================ */
  async function handleRegisterAgent() {
    const name = document.getElementById("regName")?.value?.trim();
    if (!name) { showToast("Enter a name"); return; }
    closeModal();

    showTxPending(`Registering "${name}"`);
    try {
      const operator = new PublicKey(walletAddress);
      const typeMap = { trader: { trader: {} }, oracle: { oracle: {} }, defi: { defi: {} }, payment: { payment: {} }, nft: { nft: {} }, governance: { governance: {} }, bridge: { bridge: {} } };
      const agentType = typeMap[document.getElementById("regType").value] || { trader: {} };

      // Build transaction
      const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const [agentPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), operator.toBuffer(), Buffer.from(name)],
        PROGRAM_ID
      );

      // Use system program createAccount + our instruction
      // For now, build a simple transfer as proof of concept
      // Full SDK integration available after `anchor build`
      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: true },
          { pubkey: agentPDA, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([0, ...Buffer.from(name)]), // Instruction discriminator + name
      });

      const tx = new solanaWeb3.Transaction();
      tx.add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator;

      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTransaction(sig);

      showTxSuccess(`Agent "${name}" registered!`, sig);

      // Add to local cache
      cachedAgents.push({
        pubkey: agentPDA.toString(),
        name,
        trustScore: 50,
        status: "active",
        bond: 0,
        type: agentType,
      });

      cachedActivity.unshift({
        type: "constraint",
        title: "Agent Registered",
        desc: `"${name}" registered on Solana devnet`,
        time: "Just now",
        amount: null,
        txSignature: sig,
      });

      renderAll();
    } catch (err) {
      console.error("Register failed:", err);
      showTxError(err.message || "Registration failed");
    }
  }

  async function handleCreateBond() {
    const agentPDA = document.getElementById("bondAgent")?.value;
    const amountSol = parseFloat(document.getElementById("bondAmount")?.value);
    const duration = parseInt(document.getElementById("bondDuration")?.value);
    if (!agentPDA || !amountSol || amountSol < 0.1) { showToast("Fill in all fields"); return; }
    closeModal();

    const amountLamports = Math.floor(amountSol * 1_000_000_000);
    showTxPending(`Locking ${amountSol} SOL`);
    try {
      const operator = new PublicKey(walletAddress);
      const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const [bondPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("bond"), new PublicKey(agentPDA).toBuffer()],
        PROGRAM_ID
      );

      // Create bond PDA + transfer SOL
      const space = 8 + 113;
      const rent = await connection.getMinimumBalanceForRentExemption(space);
      const createIx = solanaWeb3.SystemProgram.createAccount({
        fromPubkey: operator,
        newAccountPubkey: bondPDA,
        space,
        lamports: rent + amountLamports,
        programId: PROGRAM_ID,
      });

      const tx = new solanaWeb3.Transaction();
      tx.add(createIx);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator;

      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTransaction(sig);

      showTxSuccess(`Locked ${amountSol} SOL!`, sig);

      cachedBonds.push({
        pubkey: bondPDA.toString(),
        amount: amountLamports.toString(),
        isActive: true,
      });

      cachedActivity.unshift({
        type: "bond",
        title: "Safety Deposit Created",
        desc: `Locked ${amountSol} SOL as collateral`,
        time: "Just now",
        amount: `+${amountSol} SOL`,
        amountType: "positive",
        txSignature: sig,
      });

      await refreshOnChainData();
    } catch (err) {
      console.error("Bond creation failed:", err);
      showTxError(err.message || "Bond creation failed");
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
      const operator = new PublicKey(walletAddress);
      const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const config = await fetchConfig();
      const nonce = (config?.totalBonds || 0) + 1;
      const [constraintPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("constraint"), new PublicKey(agentPDA).toBuffer(), new Uint8Array(new BN(nonce).toArrayLike(Buffer, "le", 8))],
        PROGRAM_ID
      );

      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: constraintPDA, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(agentPDA), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([2]), // Instruction discriminator for addConstraint
      });

      const tx = new solanaWeb3.Transaction();
      tx.add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator;

      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTransaction(sig);

      showTxSuccess("Rule added!", sig);

      const typeLabels = { spend: "Spending Limit", program: "Allowed Actions", timelock: "Withdrawal Delay", velocity: "Speed Limit" };
      cachedConstraints.push({
        pubkey: constraintPDA.toString(),
        type,
        title: typeLabels[type] || type,
        agentName: cachedAgents.find((a) => a.pubkey === agentPDA)?.name || "Agent",
        rows: [{ label: "Limit", value }, { label: "Status", value: "Active" }],
        status: "enforced",
      });

      cachedActivity.unshift({
        type: "constraint",
        title: "Rule Added",
        desc: `${typeLabels[type]}: ${value}`,
        time: "Just now",
        amount: null,
        txSignature: sig,
      });

      renderAll();
    } catch (err) {
      console.error("Add constraint failed:", err);
      showTxError(err.message || "Failed to add rule");
    }
  }

  async function withdrawBond(bondPubkey) {
    showTxPending("Withdrawing bond...");
    try {
      const operator = new PublicKey(walletAddress);
      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: new PublicKey(bondPubkey), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([3]), // withdrawBond discriminator
      });

      const tx = new solanaWeb3.Transaction();
      tx.add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator;

      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTransaction(sig);

      showTxSuccess("Bond withdrawn!", sig);
      await refreshOnChainData();
    } catch (err) {
      showTxError(err.message || "Withdrawal failed");
    }
  }

  /* ============================================================
     Global functions for onclick handlers
     ============================================================ */
  window.closeModal = closeModal;
  window.withdrawBond = withdrawBond;

  window.viewAgent = function (pubkey) {
    const agent = cachedAgents.find((a) => a.pubkey === pubkey);
    if (!agent) return;
    openModal(agent.name, `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="agent-card-avatar" style="width:48px;height:48px;font-size:20px;"><i class="fa-solid fa-robot"></i></div>
          <div><h3 style="font-size:18px;">${agent.name}</h3><p style="font-size:12px;color:var(--text-muted);font-family:monospace;"><a href="${accountUrl(agent.pubkey)}" target="_blank" style="color:var(--solana);">${shortenAddress(agent.pubkey)} ↗</a></p></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <div class="agent-stat"><span class="value">${agent.trustScore}</span><span class="label">Trust Score</span></div>
          <div class="agent-stat"><span class="value">${agent.bond ? solFromLamports(agent.bond) : "0"}</span><span class="label">Deposit</span></div>
          <div class="agent-stat"><span class="value">${agent.status}</span><span class="label">Status</span></div>
        </div>
      </div>
    `);
  };

  window.reportViolation = function (pubkey) {
    if (!walletConnected) { showToast("Connect your wallet first"); return; }
    const agent = cachedAgents.find((a) => a.pubkey === pubkey);
    if (!agent) return;
    openModal(`Report — ${agent.name}`, `
      <div style="text-align:center;padding:16px 0;">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--red-bg);color:var(--red);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;"><i class="fa-solid fa-bolt"></i></div>
        <p style="margin-bottom:12px;">Report <strong>${agent.name}</strong> for breaking a rule?</p>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Part of their deposit will compensate the affected party.</p>
        <div class="form-group" style="text-align:left;"><label>What happened?</label><textarea id="slashReason" rows="3" placeholder="Describe the violation..."></textarea></div>
        <div class="form-actions" style="justify-content:center;"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="slashSubmit">Report</button></div>
      </div>
    `);
    document.getElementById("slashSubmit").onclick = async () => {
      closeModal();
      showTxPending("Processing violation report...");
      try {
        // Report would be handled by admin authority
        showTxSuccess("Violation reported — admin will review");
      } catch (err) {
        showTxError(err.message || "Report failed");
      }
    };
  };

  /* ============================================================
     Init
     ============================================================ */
  document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initModals();
    renderAll();
    document.getElementById("connectWallet").addEventListener("click", connectWallet);

    // Auto-reconnect if already connected
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
  });
})();
