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

  /* Helpers */
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

  /* On-chain fetchers */
  async function fetchConfig() {
    if (!connection) return null;
    try {
      const [pda] = solanaWeb3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const info = await connection.getAccountInfo(pda);
      if (!info) return null;
      const d = info.data;
      return {
        admin: new solanaWeb3.PublicKey(d.slice(8, 40)).toString(),
        totalAgents: Number(d.readBigUInt64LE(40)),
        totalBonds: Number(d.readBigUInt64LE(48)),
        totalSlashed: Number(d.readBigUInt64LE(56)),
      };
    } catch { return null; }
  }

  async function fetchAgents() {
    if (!connection || !walletAddress) return [];
    try {
      const owner = new solanaWeb3.PublicKey(walletAddress);
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: 8 + 116 }, { memcmp: { offset: 8, bytes: owner.toBase58() } }],
      });
      return accounts.map(acc => {
        const d = acc.account.data;
        return {
          pubkey: acc.pubkey.toString(),
          name: decodeName(d.slice(40, 72)),
          trustScore: d[74],
          status: d[75] === 0 ? "active" : d[75] === 2 ? "slashed" : "pending",
        };
      });
    } catch { return []; }
  }

  async function fetchBonds() {
    if (!connection || !walletAddress) return [];
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: 8 + 113 }, { memcmp: { offset: 40, bytes: walletAddress } }],
      });
      return accounts.map(acc => {
        const d = acc.account.data;
        return {
          pubkey: acc.pubkey.toString(),
          amount: d.readBigUInt64LE(56).toString(),
          isActive: d[80] === 1,
          expiresAt: Number(d.readBigInt64LE(72)),
        };
      });
    } catch { return []; }
  }

  async function fetchConstraints() {
    if (!connection) return [];
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: 8 + 281 }],
      });
      return accounts.map(acc => {
        const d = acc.account.data;
        const type = d[40];
        const typeMap = { 0: "spend", 1: "program", 2: "timelock", 3: "velocity" };
        const labels = { 0: "Spending Limit", 1: "Allowed Programs", 2: "Timelock", 3: "Speed Limit" };
        return {
          pubkey: acc.pubkey.toString(),
          type: typeMap[type] || "spend",
          title: labels[type] || "Rule",
          enforced: d[280] === 1,
        };
      });
    } catch { return []; }
  }

  async function refreshData() {
    if (!walletConnected) return;
    showStatus("Loading on-chain data...");
    const [config, agents, bonds, constraints] = await Promise.all([
      fetchConfig(), fetchAgents(), fetchBonds(), fetchConstraints(),
    ]);
    cachedAgents = agents;
    cachedBonds = bonds;
    cachedConstraints = constraints;

    // Build activity
    cachedActivity = [];
    bonds.forEach(b => cachedActivity.push({
      type: "bond", title: "Bond Created",
      desc: `${lamportsToSol(b.amount)} SOL ${b.isActive ? "locked" : "withdrawn"}`,
      amount: b.isActive ? `+${lamportsToSol(b.amount)} SOL` : null, amountType: "positive",
    }));
    agents.forEach(a => {
      if (a.status === "slashed") cachedActivity.push({
        type: "slash", title: "Violation", desc: `${a.name} — bond slashed`, amountType: "negative",
      });
    });

    hideStatus();
    renderAll();
  }

  /* Wallet */
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
      btn.innerHTML = `<i class="fa-solid fa-check"></i><span>${short(addr)}</span>`;
      btn.classList.add("connected");
    } else {
      btn.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
      btn.classList.remove("connected");
      document.getElementById("walletBalance").style.display = "none";
    }
  }

  /* TX helpers */
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

  /* Navigation */
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

  /* Render */
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
    const items = cachedActivity.length > 0 ? cachedActivity : [
      { type: "bond", title: "No activity yet", desc: "Connect wallet and register an agent to get started" },
    ];
    const iconMap = { bond: "fa-shield-halved", slash: "fa-bolt", constraint: "fa-list-check" };
    target.innerHTML = items.slice(0, 8).map(a => `
      <div class="activity-item">
        <div class="activity-icon ${a.type}"><i class="fa-solid ${iconMap[a.type] || "fa-circle"}"></i></div>
        <div class="activity-info"><div class="activity-title">${a.title}</div><div class="activity-desc">${a.desc}</div></div>
        ${a.amount ? `<span class="activity-amount ${a.amountType}">${a.amount}</span>` : ""}
      </div>
    `).join("");
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
          <div class="bond-info"><h3>${lamportsToSol(b.amount)} SOL</h3><p>${b.isActive ? (expired ? "Expired — withdrawable" : "Locked") : "Withdrawn"}</p></div>
          <div class="bond-amount"><div class="value">${b.isActive ? "Active" : "Closed"}</div><div class="label">Status</div></div>
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

  /* Modals */
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
        <div class="form-group"><label>Type</label><select id="regType"><option value="trader">Trading Bot</option><option value="oracle">Data Fetcher</option><option value="defi">Investment Bot</option><option value="payment">Payment Bot</option></select></div>
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
        <div class="form-group"><label>Rule Type</label><select id="conType"><option value="spend">Spending Limit</option><option value="program">Allowed Programs</option><option value="timelock">Timelock</option><option value="velocity">Speed Limit</option></select></div>
        <div class="form-group"><label>Value</label><input type="text" id="conValue" placeholder="e.g. 5 SOL" /></div>
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

  async function refreshBalance() {
    if (!connection || !walletAddress) return;
    try {
      const bal = await connection.getBalance(new solanaWeb3.PublicKey(walletAddress));
      document.getElementById("walletBalance").textContent = `${lamportsToSol(bal)} SOL`;
    } catch {}
  }

  /* TX Handlers */
  async function handleRegister() {
    const name = document.getElementById("regName")?.value?.trim();
    if (!name) { showToast("Enter a name"); return; }
    closeModal(); showTxPending(`Registering "${name}"`);
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
    if (!agentPubkey || !amountSol || amountSol < 0.1) { showToast("Fill all fields"); return; }
    closeModal(); showTxPending(`Locking ${amountSol} SOL`);
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const [bondPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("bond"), new solanaWeb3.PublicKey(agentPubkey).toBuffer()], PROGRAM_ID
      );
      const space = 8 + 113;
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
    const type = document.getElementById("conType")?.value;
    const value = document.getElementById("conValue")?.value;
    if (!agentPubkey || !value) { showToast("Fill all fields"); return; }
    closeModal(); showTxPending("Adding rule...");
    try {
      const operator = new solanaWeb3.PublicKey(walletAddress);
      const [configPDA] = solanaWeb3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
      const nonce = cachedConstraints.length + 1;
      const nonceBuf = Buffer.alloc(8); nonceBuf.writeBigUInt64LE(BigInt(nonce));
      const [constraintPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
        [Buffer.from("constraint"), new solanaWeb3.PublicKey(agentPubkey).toBuffer(), nonceBuf], PROGRAM_ID
      );
      const ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: constraintPDA, isSigner: false, isWritable: true },
          { pubkey: new solanaWeb3.PublicKey(agentPubkey), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([2]),
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

  /* Init */
  document.addEventListener("DOMContentLoaded", () => {
    function boot() {
      PROGRAM_ID = new solanaWeb3.PublicKey(PROGRAM_ID_STR);
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
    }

    if (typeof solanaWeb3 !== "undefined") { boot(); }
    else {
      const check = setInterval(() => {
        if (typeof solanaWeb3 !== "undefined") { clearInterval(check); boot(); }
      }, 100);
    }
  });
})();
