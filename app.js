(function () {
  "use strict";

  const SOLANA_RPC = "https://api.devnet.solana.com";
  const EXPLORER = "https://explorer.solana.com";
  const PROGRAM_ID_STR = "9p47LiT9ondNZwhC1dqC6ChMTNr7mRLc3RGvi39JVemQ";

  let PROGRAM_ID;
  let walletConnected = false;
  let walletAddress = null;
  let phantom = null;
  let connection = null;

  let cachedAgents = [];
  let cachedBonds = [];
  let cachedConstraints = [];
  let cachedActivity = [];

  /* ── Anchor Discriminator ───────────────────────────────────────────── */
  // Anchor uses SHA256("global:<name>")[0..8] as instruction discriminator
  async function sha256(data) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(buf);
  }
  async function instrDiscriminator(name) {
    const pre = new TextEncoder().encode(`global:${name}`);
    const hash = await sha256(pre);
    return hash.slice(0, 8);
  }

  // Account type discriminators: SHA256("account:<StructName>")[0..8]
  const accountDiscriminators = {};
  async function getAccountDiscriminators() {
    const types = ["Config", "Agent", "Bond", "Constraint", "SlashRecord"];
    for (const t of types) {
      const pre = new TextEncoder().encode(`account:${t}`);
      const hash = await sha256(pre);
      accountDiscriminators[t] = Array.from(hash.slice(0, 8));
    }
  }

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function getPhantom() {
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom) return window.solana;
    return null;
  }
  function short(addr) { return addr ? addr.slice(0, 4) + "..." + addr.slice(-4) : "—"; }
  function lamportsToSol(l) { return (Number(l) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 }); }
  function explorerTx(sig) { return `${EXPLORER}/tx/${sig}?cluster=devnet`; }
  function explorerAddr(addr) { return `${EXPLORER}/address/${addr}?cluster=devnet`; }
  function decodeName(bytes) {
    let end = bytes.indexOf(0);
    return new TextDecoder().decode(bytes.slice(0, end === -1 ? bytes.length : end));
  }
  function matchesDisc(data, disc) {
    if (data.length < 8) return false;
    return disc.every((v, i) => data[i] === v);
  }

  /* ── On-chain Fetchers (use discriminator matching, not dataSize) ──── */
  async function fetchAllProgramAccounts() {
    if (!connection) return { agents: [], bonds: [], constraints: [] };
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID);
      const agents = [], bonds = [], constraints = [];

      for (const acc of accounts) {
        const d = acc.account.data;
        if (matchesDisc(d, accountDiscriminators.Agent)) {
          agents.push({
            pubkey: acc.pubkey.toString(),
            owner: new solanaWeb3.PublicKey(d.slice(8, 40)).toString(),
            name: decodeName(d.slice(40, 72)),
            trustScore: d[74],
            status: d[75] === 0 ? "active" : d[75] === 2 ? "slashed" : d[75] === 3 ? "deactivated" : "pending",
            bondAddress: new solanaWeb3.PublicKey(d.slice(76, 108)).toString(),
            createdAt: Number(d.readBigInt64LE(108)),
          });
        } else if (matchesDisc(d, accountDiscriminators.Bond)) {
          bonds.push({
            pubkey: acc.pubkey.toString(),
            agent: new solanaWeb3.PublicKey(d.slice(8, 40)).toString(),
            operator: new solanaWeb3.PublicKey(d.slice(40, 72)).toString(),
            amount: d.readBigUInt64LE(72).toString(),
            lockDuration: Number(d.readBigInt64LE(80)),
            lockedAt: Number(d.readBigInt64LE(88)),
            expiresAt: Number(d.readBigInt64LE(96)),
            isActive: d[104] === 1,
          });
        } else if (matchesDisc(d, accountDiscriminators.Constraint)) {
          const type = d[40];
          const typeMap = { 0: "spend", 1: "program", 2: "timelock", 3: "velocity", 4: "custom" };
          const labels = { 0: "Spending Limit", 1: "Allowed Programs", 2: "Timelock", 3: "Speed Limit", 4: "Custom Rule" };
          constraints.push({
            pubkey: acc.pubkey.toString(),
            agent: new solanaWeb3.PublicKey(d.slice(8, 40)).toString(),
            type: typeMap[type] || "spend",
            title: labels[type] || "Rule",
            enforced: d[331] === 1,
          });
        }
      }
      return { agents, bonds, constraints };
    } catch { return { agents: [], bonds: [], constraints: [] }; }
  }

  async function refreshData() {
    if (!walletConnected) return;
    showStatus("Loading on-chain data...");
    const { agents, bonds, constraints } = await fetchAllProgramAccounts();

    // Filter to current wallet's accounts
    cachedAgents = agents.filter(a => a.owner === walletAddress);
    cachedBonds = bonds.filter(b => b.operator === walletAddress);
    cachedConstraints = constraints.filter(c =>
      cachedAgents.some(a => a.pubkey === c.agent)
    );

    // Build activity from on-chain data
    cachedActivity = [];
    for (const b of cachedBonds) {
      cachedActivity.push({
        type: "bond",
        title: "Bond Created",
        desc: `${short(b.agent)} — ${lamportsToSol(b.amount)} SOL ${b.isActive ? "locked" : "withdrawn"}`,
        amount: b.isActive ? `+${lamportsToSol(b.amount)} SOL` : null,
        amountType: "positive",
        time: b.lockedAt ? new Date(b.lockedAt * 1000).toLocaleDateString() : "",
      });
    }
    for (const a of cachedAgents) {
      if (a.status === "slashed") {
        cachedActivity.push({
          type: "slash", title: "Violation",
          desc: `${a.name} — bond slashed`,
          amountType: "negative",
          time: a.createdAt ? new Date(a.createdAt * 1000).toLocaleDateString() : "",
        });
      }
      cachedActivity.push({
        type: "constraint", title: "Agent Registered",
        desc: `${a.name} — trust ${a.trustScore}/100`,
        time: a.createdAt ? new Date(a.createdAt * 1000).toLocaleDateString() : "",
      });
    }
    // Sort by most recent
    cachedActivity.sort((a, b) => (b.time || "").localeCompare(a.time || ""));

    // Also try to fetch recent tx signatures for real transaction history
    try {
      const sigs = await connection.getConfirmedSignaturesForAddress2(
        new solanaWeb3.PublicKey(walletAddress),
        { limit: 20 }
      );
      // Merge real tx history
      for (const sig of sigs) {
        if (!sig.err && sig.signature) {
          cachedActivity.push({
            type: "tx",
            title: "Transaction",
            desc: sig.signature.slice(0, 20) + "...",
            time: sig.blockTime ? new Date(sig.blockTime * 1000).toLocaleDateString() : "",
            explorerUrl: explorerTx(sig.signature),
          });
        }
      }
      // Re-sort
      cachedActivity.sort((a, b) => (b.time || "").localeCompare(a.time || ""));
    } catch {}

    hideStatus();
    renderAll();
  }

  /* ── Wallet ─────────────────────────────────────────────────────────── */
  async function connectWallet() {
    const btn = document.getElementById("connectWallet");
    phantom = getPhantom();
    if (!phantom) { showToast("Install Phantom wallet"); window.open("https://phantom.app/", "_blank"); return; }

    if (walletConnected) {
      try { await phantom.disconnect(); } catch {}
      walletConnected = false; walletAddress = null;
      cachedAgents = []; cachedBonds = []; cachedConstraints = []; cachedActivity = [];
      setWalletUI(false); renderAll(); showToast("Disconnected");
      return;
    }

    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Connecting...</span>';
    btn.disabled = true;
    try {
      const resp = await phantom.connect();
      walletConnected = true;
      walletAddress = resp.publicKey.toString();
      connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");
      const bal = await connection.getBalance(resp.publicKey);
      document.getElementById("walletBalance").textContent = `${lamportsToSol(bal)} SOL`;
      document.getElementById("walletBalance").style.display = "inline";
      setWalletUI(true, walletAddress);
      btn.disabled = false;
      showToast(`Connected: ${short(walletAddress)}`);
      await refreshData();
    } catch {
      setWalletUI(false); btn.disabled = false;
      showToast("Connection rejected");
    }
  }

  function setWalletUI(connected, addr) {
    const btn = document.getElementById("connectWallet");
    if (connected) {
      btn.innerHTML = `<i class=\"fa-solid fa-check\"></i><span>${short(addr)}</span>`;
      btn.classList.add("connected");
    } else {
      btn.innerHTML = '<i class=\"fa-solid fa-wallet\"></i><span>Connect Wallet</span>';
      btn.classList.remove("connected");
      document.getElementById("walletBalance").style.display = "none";
    }
  }

  /* ── TX helpers ─────────────────────────────────────────────────────── */
  function showTxPending(msg) {
    const el = document.getElementById("txStatus");
    el.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${msg} — confirm in wallet`;
    el.className = "tx-status pending"; el.style.display = "flex";
  }
  function showTxSuccess(msg, sig) {
    const el = document.getElementById("txStatus");
    el.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${msg} ${sig ? `<a href="${explorerTx(sig)}" target="_blank" style="color:var(--green);text-decoration:underline;margin-left:4px;">View ↗</a>` : ""}`;
    el.className = "tx-status success";
    setTimeout(() => el.style.display = "none", 8000);
  }
  function showTxError(msg) {
    const el = document.getElementById("txStatus");
    el.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${msg}`;
    el.className = "tx-status error";
    setTimeout(() => el.style.display = "none", 6000);
  }
  function showStatus(msg) {
    const el = document.getElementById("txStatus");
    el.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${msg}`;
    el.className = "tx-status pending"; el.style.display = "flex";
  }
  function hideStatus() { document.getElementById("txStatus").style.display = "none"; }

  async function confirmTx(sig) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    return connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  }

  async function refreshBalance() {
    if (!connection || !walletAddress) return;
    try {
      const bal = await connection.getBalance(new solanaWeb3.PublicKey(walletAddress));
      document.getElementById("walletBalance").textContent = `${lamportsToSol(bal)} SOL`;
    } catch {}
  }

  /* ── Navigation ─────────────────────────────────────────────────────── */
  function initNav() {
    const links = document.querySelectorAll(".sidebar-link[data-section]");
    const sections = document.querySelectorAll(".content-section");
    const title = document.getElementById("pageTitle");
    const sidebar = document.getElementById("sidebar");
    links.forEach(link => {
      link.addEventListener("click", e => {
        e.preventDefault();
        links.forEach(l => l.classList.remove("active"));
        link.classList.add("active");
        sections.forEach(s => s.classList.remove("active"));
        document.getElementById(`section-${link.dataset.section}`).classList.add("active");
        title.textContent = link.querySelector("span").textContent;
        sidebar.classList.remove("open");
      });
    });
    document.getElementById("menuToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
  }

  window.navigateTo = function (section) {
    document.querySelector(`.sidebar-link[data-section="${section}"]`)?.click();
  };

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderAll() { updateStats(); renderActivity(); renderAgents(); renderBonds(); renderConstraints(); }

  function updateStats() {
    document.getElementById("totalAgents").textContent = cachedAgents.length || "0";
    document.getElementById("totalBonds").textContent = cachedBonds.filter(b => b.isActive).length || "0";
    const totalLocked = cachedBonds.filter(b => b.isActive).reduce((sum, b) => sum + Number(b.amount), 0);
    document.getElementById("totalStaked").textContent = totalLocked ? lamportsToSol(totalLocked) : "0";
    document.getElementById("totalSlashes").textContent = cachedAgents.filter(a => a.status === "slashed").length || "0";
  }

  function renderActivity() {
    const target = document.getElementById("activityList");
    const fullTarget = document.getElementById("activityFullList");
    const items = cachedActivity.length > 0 ? cachedActivity : [
      { type: "bond", title: "No activity yet", desc: "Connect wallet and register an agent to get started" },
    ];
    const iconMap = { bond: "fa-shield-halved", slash: "fa-bolt", constraint: "fa-list-check", tx: "fa-arrow-right-arrow-left" };

    target.innerHTML = items.slice(0, 8).map(a => `
      <div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${iconMap[a.type] || "fa-circle"}"></i></div>
        <div class="activity-info">
          <div class="activity-title">${a.title}</div>
          <div class="activity-desc">${a.desc}</div>
        </div>
        ${a.amount ? `<span class="activity-amount ${a.amountType}">${a.amount}</span>` : ""}
        ${a.time ? `<span class="activity-time">${a.time}</span>` : ""}
      </div>
    `).join("");

    if (fullTarget) {
      fullTarget.innerHTML = items.map(a => `
        <div class="activity-item">
          <div class="activity-icon ${a.type}"><i class="fa-solid ${iconMap[a.type] || "fa-circle"}"></i></div>
          <div class="activity-info">
            <div class="activity-title">${a.explorerUrl ? `<a href="${a.explorerUrl}" target="_blank" style="color:var(--purple);text-decoration:none;">${a.title}</a>` : a.title}</div>
            <div class="activity-desc">${a.desc}</div>
          </div>
          ${a.amount ? `<span class="activity-amount ${a.amountType}">${a.amount}</span>` : ""}
          ${a.time ? `<span class="activity-time">${a.time}</span>` : ""}
        </div>
      `).join("");
    }
  }

  function renderAgents() {
    const target = document.getElementById("agentsGrid");
    if (!walletConnected) { target.innerHTML = emptyState("fa-wallet", "Connect wallet to see agents"); return; }
    if (cachedAgents.length === 0) { target.innerHTML = emptyState("fa-robot", "No agents registered yet", "Click Register to create one"); return; }
    target.innerHTML = cachedAgents.map(a => `
      <div class="agent-card">
        <div class="agent-card-header">
          <div class="agent-card-avatar"><i class="fa-solid fa-robot"></i></div>
          <div class="agent-card-info"><h3>${a.name}</h3><p>${short(a.pubkey)}</p></div>
          <span class="status-badge ${a.status}">${a.status}</span>
        </div>
        <div class="agent-card-stats">
          <div class="agent-stat"><div class="value">${a.trustScore}</div><div class="label">Trust</div></div>
          <div class="agent-stat"><div class="value"><a href="${explorerAddr(a.pubkey)}" target="_blank" style="color:var(--purple);">View ↗</a></div><div class="label">On-chain</div></div>
        </div>
      </div>
    `).join("");
  }

  function renderBonds() {
    const target = document.getElementById("bondsList");
    if (!walletConnected) { target.innerHTML = emptyState("fa-wallet", "Connect wallet to see bonds"); return; }
    if (cachedBonds.length === 0) { target.innerHTML = emptyState("fa-shield-halved", "No bonds yet", "Lock funds to create a safety deposit"); return; }
    target.innerHTML = cachedBonds.map(b => {
      const expired = b.expiresAt && Date.now() / 1000 > b.expiresAt;
      return `
        <div class="bond-card">
          <div class="bond-icon"><i class="fa-solid fa-shield-halved"></i></div>
          <div class="bond-info">
            <h3>${lamportsToSol(b.amount)} SOL</h3>
            <p>${b.isActive ? (expired ? "Expired — withdrawable" : "Locked") : "Withdrawn"}</p>
          </div>
          <div class="bond-amount">
            <div class="value">${b.isActive ? "Active" : "Closed"}</div>
            <div class="label">${b.expiresAt ? new Date(b.expiresAt * 1000).toLocaleDateString() : ""}</div>
          </div>
          ${b.isActive ? `<button class="btn-outline" onclick="window._withdrawBond('${b.pubkey}')">Withdraw</button>` : ""}
        </div>
      `;
    }).join("");
  }

  function renderConstraints() {
    const target = document.getElementById("constraintsGrid");
    if (!walletConnected) { target.innerHTML = emptyState("fa-wallet", "Connect wallet to see rules"); return; }
    if (cachedConstraints.length === 0) { target.innerHTML = emptyState("fa-list-check", "No rules configured", "Add rules to control agent behavior"); return; }
    target.innerHTML = cachedConstraints.map(c => `
      <div class="constraint-card">
        <div class="constraint-header">
          <div class="constraint-icon ${c.type}"><i class="fa-solid ${c.type === "spend" ? "fa-coins" : c.type === "program" ? "fa-cube" : c.type === "timelock" ? "fa-clock" : "fa-gauge-high"}"></i></div>
          <h3>${c.title}</h3>
        </div>
        <div class="constraint-row"><span class="label">Status</span><span class="value">${c.enforced ? "Active" : "Pending"}</span></div>
        <div class="constraint-status"><span class="dot"></span>${c.enforced ? "Enforced" : "Pending"}</div>
      </div>
    `).join("");
  }

  function emptyState(icon, text, sub) {
    return `<div class="empty-state"><i class="fa-solid ${icon}" style="font-size:28px;color:var(--text-muted);"></i><p>${text}</p>${sub ? `<p style="font-size:12px;color:var(--text-muted);margin-top:4px;">${sub}</p>` : ""}</div>`;
  }

  /* ── Modals ─────────────────────────────────────────────────────────── */
  function openModal(title, html) {
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalBody").innerHTML = html;
    document.getElementById("modalOverlay").classList.add("open");
  }
  function closeModal() { document.getElementById("modalOverlay").classList.remove("open"); }
  window.closeModal = closeModal;

  function initModals() {
    document.getElementById("modalClose").addEventListener("click", closeModal);
    document.getElementById("modalOverlay").addEventListener("click", e => { if (e.target.id === "modalOverlay") closeModal(); });

    document.getElementById("registerAgent").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      openModal("Register Agent", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Register an AI agent on Solana. It becomes accountable — if it breaks rules, its operator's bond compensates victims.</p>
        <div class="form-group"><label>Agent Name</label><input type="text" id="regName" placeholder="e.g. Trading Bot" maxlength="32" /></div>
        <div class="form-group"><label>Type</label><select id="regType"><option value="0">Trader</option><option value="1">Oracle</option><option value="3">Payment</option><option value="7">Custom</option></select></div>
        <div class="form-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="regSubmit">Register</button></div>
      `);
      document.getElementById("regSubmit").onclick = handleRegister;
    });

    document.getElementById("createBond").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      if (cachedAgents.length === 0) { showToast("Register an agent first"); return; }
      openModal("Lock Bond", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Lock SOL as collateral. If your agent breaks rules, these funds compensate the affected party.</p>
        <div class="form-group"><label>Agent</label><select id="bondAgent">${cachedAgents.filter(a => a.status === "active").map(a => `<option value="${a.pubkey}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>Amount (SOL)</label><input type="number" id="bondAmount" placeholder="e.g. 5" min="0.1" step="0.1" /><p class="hint">Minimum 0.1 SOL</p></div>
        <div class="form-group"><label>Lock Period</label><select id="bondDuration"><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="15552000">180 days</option></select></div>
        <div class="form-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="bondSubmit">Lock</button></div>
      `);
      document.getElementById("bondSubmit").onclick = handleBond;
    });

    document.getElementById("addConstraint").addEventListener("click", () => {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      if (cachedAgents.length === 0) { showToast("Register an agent first"); return; }
      openModal("Add Rule", `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Rules control what your agent can do. Breaking a rule triggers compensation.</p>
        <div class="form-group"><label>Agent</label><select id="conAgent">${cachedAgents.filter(a => a.status === "active").map(a => `<option value="${a.pubkey}">${a.name}</option>`).join("")}</select></div>
        <div class="form-group"><label>Rule Type</label><select id="conType"><option value="0">Spending Limit</option><option value="1">Allowed Programs</option><option value="2">Timelock</option><option value="3">Speed Limit</option></select></div>
        <div class="form-group"><label>Max Amount (SOL)</label><input type="number" id="conMaxAmount" placeholder="e.g. 5" min="0.01" step="0.01" /></div>
        <div class="form-group"><label>Period (seconds)</label><input type="number" id="conPeriod" placeholder="e.g. 86400 (1 day)" min="0" /></div>
        <div class="form-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="conSubmit">Add Rule</button></div>
      `);
      document.getElementById("conSubmit").onclick = handleConstraint;
    });
  }

  function showToast(msg, duration) {
    const t = document.getElementById("toast");
    document.getElementById("toastMessage").textContent = msg;
    t.classList.add("show"); setTimeout(() => t.classList.remove("show"), duration || 3000);
  }

  /* ── TX Handlers (with Anchor discriminators) ───────────────────────── */
  async function handleRegister() {
    const name = document.getElementById("regName")?.value?.trim();
    const typeIdx = parseInt(document.getElementById("regType")?.value || "0");
    if (!name) { showToast("Enter a name"); return; }
    closeModal(); showTxPending(`Registering "${name}"`);
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const [configPDA] = solanaWeb3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const [agentPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), operator.toBuffer(), Buffer.from(name)], PROGRAM_ID
      );

      // Build instruction data: 8-byte discriminator + borsh-encoded args
      const disc = await instrDiscriminator("register_agent");
      const nameBytes = new TextEncoder().encode(name);
      const nameLen = Buffer.alloc(4);
      nameLen.writeUInt32LE(nameBytes.length);
      const data = Buffer.concat([Buffer.from(disc), nameLen, Buffer.from(nameBytes), Buffer.from([typeIdx])]);

      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: true },
          { pubkey: agentPDA, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data,
      });
      const tx = new solanaWeb3.Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash; tx.feePayer = operator;
      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTx(sig);
      showTxSuccess(`Agent "${name}" registered`, sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      showTxError(err.message?.includes("User rejected") ? "Cancelled" : (err.message || "Failed"));
    }
  }

  async function handleBond() {
    const agentPubkey = document.getElementById("bondAgent")?.value;
    const amountSol = parseFloat(document.getElementById("bondAmount")?.value);
    const lockDuration = parseInt(document.getElementById("bondDuration")?.value || "2592000");
    if (!agentPubkey || !amountSol || amountSol < 0.1) { showToast("Fill all fields"); return; }
    closeModal(); showTxPending(`Locking ${amountSol} SOL`);
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const [bondPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("bond"), new solanaWeb3.PublicKey(agentPubkey).toBuffer()], PROGRAM_ID
      );

      // Build instruction data: discriminator + amount (u64 LE) + lockDuration (i64 LE)
      const disc = await instrDiscriminator("create_bond");
      const amountBuf = Buffer.alloc(8);
      amountBuf.writeBigUInt64LE(BigInt(Math.floor(amountSol * 1e9)));
      const durationBuf = Buffer.alloc(8);
      durationBuf.writeBigInt64LE(BigInt(lockDuration));
      const data = Buffer.concat([Buffer.from(disc), amountBuf, durationBuf]);

      const space = 106; // Bond account size
      const rent = await connection.getMinimumBalanceForRentExemption(space);
      const ix = solanaWeb3.SystemProgram.createAccount({
        fromPubkey: operator, newAccountPubkey: bondPDA, space,
        lamports: rent + Math.floor(amountSol * 1e9), programId: PROGRAM_ID,
      });
      const tx = new solanaWeb3.Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash; tx.feePayer = operator;
      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTx(sig);
      showTxSuccess(`Locked ${amountSol} SOL`, sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      showTxError(err.message?.includes("User rejected") ? "Cancelled" : (err.message || "Failed"));
    }
  }

  async function handleConstraint() {
    const agentPubkey = document.getElementById("conAgent")?.value;
    const typeIdx = parseInt(document.getElementById("conType")?.value || "0");
    const maxAmountSol = parseFloat(document.getElementById("conMaxAmount")?.value || "1");
    const periodSecs = parseInt(document.getElementById("conPeriod")?.value || "86400");
    if (!agentPubkey) { showToast("Select an agent"); return; }
    closeModal(); showTxPending("Adding rule...");
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const [configPDA] = solanaWeb3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const nonce = cachedConstraints.length + 1;
      const nonceBuf = Buffer.alloc(8); nonceBuf.writeBigUInt64LE(BigInt(nonce));
      const [constraintPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("constraint"), new solanaWeb3.PublicKey(agentPubkey).toBuffer(), nonceBuf], PROGRAM_ID
      );

      // Build instruction data: discriminator + constraintType (u8) + ConstraintParams
      const disc = await instrDiscriminator("add_constraint");
      const maxAmountBuf = Buffer.alloc(8);
      maxAmountBuf.writeBigUInt64LE(BigInt(Math.floor(maxAmountSol * 1e9)));
      const maxPerPeriodBuf = Buffer.alloc(8);
      maxPerPeriodBuf.writeBigUInt64LE(BigInt(Math.floor(maxAmountSol * 1e9 * 5))); // 5x max amount per period
      const periodBuf = Buffer.alloc(8);
      periodBuf.writeBigInt64LE(BigInt(periodSecs));
      const timelockBuf = Buffer.alloc(8); // 0 = no timelock
      const allowedPrograms = Buffer.alloc(32 * 8); // 8 empty Pubkeys

      const data = Buffer.concat([
        Buffer.from(disc),
        Buffer.from([typeIdx]),
        maxAmountBuf, maxPerPeriodBuf, periodBuf, timelockBuf, allowedPrograms,
      ]);

      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: constraintPDA, isSigner: false, isWritable: true },
          { pubkey: new solanaWeb3.PublicKey(agentPubkey), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data,
      });
      const tx = new solanaWeb3.Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash; tx.feePayer = operator;
      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTx(sig);
      showTxSuccess("Rule added", sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      showTxError(err.message?.includes("User rejected") ? "Cancelled" : (err.message || "Failed"));
    }
  }

  async function withdrawBond(bondPubkey) {
    showTxPending("Withdrawing...");
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const disc = await instrDiscriminator("withdraw_bond");

      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: new solanaWeb3.PublicKey(bondPubkey), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from(disc),
      });
      const tx = new solanaWeb3.Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash; tx.feePayer = operator;
      const signed = await phantom.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await confirmTx(sig);
      showTxSuccess("Bond withdrawn", sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      showTxError(err.message?.includes("User rejected") ? "Cancelled" : (err.message || "Failed"));
    }
  }

  window._withdrawBond = withdrawBond;

  /* ── Init ───────────────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    function boot() {
      PROGRAM_ID = new solanaWeb3.PublicKey(PROGRAM_ID_STR);
      getAccountDiscriminators().then(() => {
        initNav();
        initModals();
        renderAll();
        document.getElementById("connectWallet").addEventListener("click", connectWallet);

        phantom = getPhantom();
        if (phantom) {
          phantom.on("connect", () => {
            walletConnected = true;
            walletAddress = phantom.publicKey.toString();
            connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");
            setWalletUI(true, walletAddress);
            refreshData();
          });
          if (phantom.isConnected) phantom.connect({ onlyIfTrusted: true }).catch(() => {});
        }
      });
    }

    if (typeof solanaWeb3 !== "undefined") { boot(); }
    else {
      const check = setInterval(() => {
        if (typeof solanaWeb3 !== "undefined") { clearInterval(check); boot(); }
      }, 100);
    }
  });
})();
