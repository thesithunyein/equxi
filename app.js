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

  /* ── Browser-safe Uint8Array helpers ───────────────────────────────── */
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  function bytes(str) { return enc.encode(str); }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a instanceof Uint8Array ? a : new Uint8Array(a), off); off += a.length; }
    return out;
  }
  function u64le(n) {
    const buf = new Uint8Array(8);
    const big = BigInt(n);
    const low = Number(big & 0xffffffffn);
    const high = Number((big >> 32n) & 0xffffffffn);
    buf[0] = low & 0xff; buf[1] = (low >> 8) & 0xff;
    buf[2] = (low >> 16) & 0xff; buf[3] = (low >> 24) & 0xff;
    buf[4] = high & 0xff; buf[5] = (high >> 8) & 0xff;
    buf[6] = (high >> 16) & 0xff; buf[7] = (high >> 24) & 0xff;
    return buf;
  }
  function i64le(n) {
    if (n >= 0) return u64le(n);
    const pos = u64le(-n);
    let carry = 1;
    for (let i = 0; i < 8; i++) {
      pos[i] = (~pos[i] + carry) & 0xff;
      carry = pos[i] === 0 ? 1 : 0;
    }
    return pos;
  }
  function u32le(n) {
    const buf = new Uint8Array(4);
    buf[0] = n & 0xff; buf[1] = (n >> 8) & 0xff;
    buf[2] = (n >> 16) & 0xff; buf[3] = (n >> 24) & 0xff;
    return buf;
  }
  function strWithLen(str) {
    const b = bytes(str);
    return concat(u32le(b.length), b);
  }

  /* ── SHA-256 (pure JS fallback) ───────────────────────────────────── */
  async function sha256(data) {
    if (window.crypto && window.crypto.subtle) {
      const buf = await window.crypto.subtle.digest("SHA-256", data);
      return new Uint8Array(buf);
    }
    return sha256Fallback(data);
  }

  function sha256Fallback(message) {
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    function rr(x,n){return(x>>>n)|(x<<(32-n));}
    function ch(x,y,z){return(x&y)^(~x&z);}
    function maj(x,y,z){return(x&y)^(x&z)^(y&z);}
    function sig0(x){return rr(x,2)^rr(x,13)^rr(x,22);}
    function sig1(x){return rr(x,6)^rr(x,11)^rr(x,25);}
    function ep0(x){return rr(x,7)^rr(x,18)^(x>>>3);}
    function ep1(x){return rr(x,17)^rr(x,19)^(x>>>10);}

    let msg = new Uint8Array(message);
    const bitLen = msg.length * 8;
    msg = concat(msg, new Uint8Array([0x80]));
    while (msg.length % 64 !== 0) msg = concat(msg, new Uint8Array([0]));
    const lenBytes = new Uint8Array(8);
    new DataView(lenBytes.buffer).setBigUint64(0, BigInt(bitLen));
    msg = concat(msg, lenBytes);

    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    for (let i = 0; i < msg.length; i += 64) {
      const W = new Array(64);
      for (let j = 0; j < 16; j++) W[j] = (msg[i+j*4]<<24)|(msg[i+j*4+1]<<16)|(msg[i+j*4+2]<<8)|msg[i+j*4+3];
      for (let j = 16; j < 64; j++) {
        const s0 = rr(W[j-15],7)^rr(W[j-15],18)^(W[j-15]>>>3);
        const s1 = rr(W[j-2],17)^rr(W[j-2],19)^(W[j-2]>>>10);
        W[j] = (W[j-16]+s0+W[j-7]+s1)|0;
      }
      let [a,b,c,d,e,f,g,h] = H;
      for (let j = 0; j < 64; j++) {
        const T1 = (h+sig1(e)+ch(e,f,g)+K[j]+W[j])|0;
        const T2 = (sig0(a)+maj(a,b,c))|0;
        h=g;g=f;f=e;e=(d+T1)|0;d=c;c=b;b=a;a=(T1+T2)|0;
      }
      H = [(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i*4]=(H[i]>>>24)&0xff; out[i*4+1]=(H[i]>>>16)&0xff;
      out[i*4+2]=(H[i]>>>8)&0xff; out[i*4+3]=H[i]&0xff;
    }
    return out;
  }

  async function instrDiscriminator(name) {
    const hash = await sha256(bytes("global:" + name));
    return hash.slice(0, 8);
  }

  const accountDiscriminators = {};
  async function getAccountDiscriminators() {
    for (const t of ["Config", "Agent", "Bond", "Constraint", "SlashRecord"]) {
      const hash = await sha256(bytes("account:" + t));
      accountDiscriminators[t] = Array.from(hash.slice(0, 8));
    }
  }

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function getPhantom() {
    if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) return window.phantom.solana;
    if (window.solana && window.solana.isPhantom) return window.solana;
    return null;
  }
  function short(addr) { return addr ? addr.slice(0, 4) + "\u2026" + addr.slice(-4) : "\u2014"; }
  function lamportsToSol(l) { return (Number(l) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 }); }
  function explorerTx(sig) { return EXPLORER + "/tx/" + sig + "?cluster=devnet"; }
  function explorerAddr(addr) { return EXPLORER + "/address/" + addr + "?cluster=devnet"; }
  function decodeName(d, offset, len) {
    let end = offset + len;
    for (let i = offset; i < offset + len; i++) { if (d[i] === 0) { end = i; break; } }
    return dec.decode(d.slice(offset, end));
  }
  function matchesDisc(data, disc) {
    if (data.length < 8) return false;
    return disc.every(function (v, i) { return data[i] === v; });
  }

  /* ── On-chain Fetchers ────────────────────────────────────────────── */
  async function fetchAllProgramAccounts() {
    if (!connection) return { agents: [], bonds: [], constraints: [] };
    try {
      var accounts = await connection.getProgramAccounts(PROGRAM_ID);
      var agents = [], bonds = [], constraints = [];
      for (var k = 0; k < accounts.length; k++) {
        var d = accounts[k].account.data;
        if (matchesDisc(d, accountDiscriminators.Agent)) {
          agents.push({
            pubkey: accounts[k].pubkey.toString(),
            owner: new solanaWeb3.PublicKey(d.slice(8, 40)).toString(),
            name: decodeName(d, 40, 32),
            trustScore: d[73],
            status: d[74] === 0 ? "active" : d[74] === 2 ? "slashed" : d[74] === 3 ? "deactivated" : "pending",
            bondAddress: new solanaWeb3.PublicKey(d.slice(75, 107)).toString(),
            createdAt: Number(new DataView(d.buffer, d.byteOffset + 107).getBigInt64(0, true)),
          });
        } else if (matchesDisc(d, accountDiscriminators.Bond)) {
          bonds.push({
            pubkey: accounts[k].pubkey.toString(),
            agent: new solanaWeb3.PublicKey(d.slice(8, 40)).toString(),
            operator: new solanaWeb3.PublicKey(d.slice(40, 72)).toString(),
            amount: new DataView(d.buffer, d.byteOffset + 72).getBigUint64(0, true).toString(),
            lockDuration: Number(new DataView(d.buffer, d.byteOffset + 80).getBigInt64(0, true)),
            lockedAt: Number(new DataView(d.buffer, d.byteOffset + 88).getBigInt64(0, true)),
            expiresAt: Number(new DataView(d.buffer, d.byteOffset + 96).getBigInt64(0, true)),
            isActive: d[104] === 1,
          });
        } else if (matchesDisc(d, accountDiscriminators.Constraint)) {
          var ctype = d[40];
          var typeMap = { 0: "spend", 1: "program", 2: "timelock", 3: "velocity", 4: "custom" };
          var labels = { 0: "Spending Limit", 1: "Allowed Programs", 2: "Timelock", 3: "Speed Limit", 4: "Custom Rule" };
          constraints.push({
            pubkey: accounts[k].pubkey.toString(),
            agent: new solanaWeb3.PublicKey(d.slice(8, 40)).toString(),
            type: typeMap[ctype] || "spend",
            title: labels[ctype] || "Rule",
            enforced: d[329] === 1,
          });
        }
      }
      return { agents: agents, bonds: bonds, constraints: constraints };
    } catch (e) { console.warn("Fetch accounts failed:", e); return { agents: [], bonds: [], constraints: [] }; }
  }

  async function refreshData() {
    if (!walletConnected) return;
    showStatus("Loading on-chain data...");
    var result = await fetchAllProgramAccounts();
    cachedAgents = result.agents.filter(function (a) { return a.owner === walletAddress; });
    cachedBonds = result.bonds.filter(function (b) { return b.operator === walletAddress; });
    cachedConstraints = result.constraints.filter(function (c) {
      return cachedAgents.some(function (a) { return a.pubkey === c.agent; });
    });

    cachedActivity = [];
    for (var i = 0; i < cachedBonds.length; i++) {
      var b = cachedBonds[i];
      cachedActivity.push({
        type: "bond", title: "Bond Created",
        desc: short(b.agent) + " \u2014 " + lamportsToSol(b.amount) + " SOL " + (b.isActive ? "locked" : "withdrawn"),
        amount: b.isActive ? "+" + lamportsToSol(b.amount) + " SOL" : null, amountType: "positive",
        time: b.lockedAt ? new Date(b.lockedAt * 1000).toLocaleDateString() : "",
      });
    }
    for (var j = 0; j < cachedAgents.length; j++) {
      var a = cachedAgents[j];
      cachedActivity.push({
        type: "constraint", title: "Agent Registered",
        desc: a.name + " \u2014 trust " + a.trustScore + "/100",
        time: a.createdAt ? new Date(a.createdAt * 1000).toLocaleDateString() : "",
      });
      if (a.status === "slashed") {
        cachedActivity.push({
          type: "slash", title: "Violation",
          desc: a.name + " \u2014 bond slashed", amountType: "negative",
          time: a.createdAt ? new Date(a.createdAt * 1000).toLocaleDateString() : "",
        });
      }
    }
    for (var c = 0; c < cachedConstraints.length; c++) {
      var con = cachedConstraints[c];
      var agentObj = cachedAgents.find(function (a) { return a.pubkey === con.agent; });
      cachedActivity.push({
        type: "constraint", title: "Rule Added",
        desc: (agentObj ? agentObj.name : "Agent") + " \u2014 " + con.title,
        time: "",
      });
    }
    cachedActivity.sort(function (a, b) { return (b.time || "").localeCompare(a.time || ""); });

    try {
      var sigs = await connection.getConfirmedSignaturesForAddress2(
        new solanaWeb3.PublicKey(walletAddress), { limit: 20 }
      );
      for (var s = 0; s < sigs.length; s++) {
        var sig = sigs[s];
        if (!sig.err && sig.signature) {
          cachedActivity.push({
            type: "tx", title: "Transaction",
            desc: sig.signature.slice(0, 20) + "...",
            time: sig.blockTime ? new Date(sig.blockTime * 1000).toLocaleDateString() : "",
            explorerUrl: explorerTx(sig.signature),
          });
        }
      }
      cachedActivity.sort(function (a, b) { return (b.time || "").localeCompare(a.time || ""); });
    } catch (e) { /* ignore */ }

    hideStatus();
    renderAll();
  }

  /* ── Wallet ─────────────────────────────────────────────────────────── */
  async function connectWallet() {
    var btn = document.getElementById("connectWallet");
    phantom = getPhantom();
    if (!phantom) {
      showToast("Phantom wallet not found. Install from phantom.app");
      window.open("https://phantom.app/", "_blank");
      return;
    }
    if (walletConnected) {
      try { await phantom.disconnect(); } catch (e) { /* ignore */ }
      walletConnected = false; walletAddress = null;
      cachedAgents = []; cachedBonds = []; cachedConstraints = []; cachedActivity = [];
      setWalletUI(false); renderAll(); showToast("Disconnected");
      return;
    }
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Connecting...</span>';
    btn.disabled = true;
    try {
      var resp = await phantom.connect();
      walletConnected = true;
      walletAddress = resp.publicKey.toString();
      connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");
      var bal = await connection.getBalance(resp.publicKey);
      document.getElementById("walletBalance").textContent = lamportsToSol(bal) + " SOL";
      document.getElementById("walletBalance").style.display = "inline";
      setWalletUI(true, walletAddress);
      btn.disabled = false;
      showToast("Connected: " + short(walletAddress));
      await refreshData();
    } catch (err) {
      console.error("Connect error:", err);
      setWalletUI(false); btn.disabled = false;
      showToast("Connection rejected");
    }
  }

  function setWalletUI(connected, addr) {
    var btn = document.getElementById("connectWallet");
    if (connected) {
      btn.innerHTML = '<i class="fa-solid fa-check"></i><span>' + short(addr) + '</span>';
      btn.classList.add("connected");
    } else {
      btn.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
      btn.classList.remove("connected");
      document.getElementById("walletBalance").style.display = "none";
    }
  }

  /* ── TX helpers ─────────────────────────────────────────────────────── */
  function showTxPending(msg) {
    var el = document.getElementById("txStatus");
    el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + msg + " \u2014 confirm in wallet";
    el.className = "tx-status pending"; el.style.display = "flex";
  }
  function showTxSuccess(msg, sig) {
    var el = document.getElementById("txStatus");
    var link = sig ? ' <a href="' + explorerTx(sig) + '" target="_blank" style="color:var(--green);text-decoration:underline;margin-left:4px;">View \u2197</a>' : "";
    el.innerHTML = '<i class="fa-solid fa-check-circle"></i> ' + msg + link;
    el.className = "tx-status success";
    setTimeout(function () { el.style.display = "none"; }, 8000);
  }
  function showTxError(msg) {
    var el = document.getElementById("txStatus");
    el.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> ' + msg;
    el.className = "tx-status error";
    setTimeout(function () { el.style.display = "none"; }, 10000);
  }
  function showStatus(msg) {
    var el = document.getElementById("txStatus");
    el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + msg;
    el.className = "tx-status pending"; el.style.display = "flex";
  }
  function hideStatus() { document.getElementById("txStatus").style.display = "none"; }

  // Balance check before every transaction (prevents Phantom malicious flag)
  async function checkMinBalance(requiredSol) {
    try {
      var bal = await connection.getBalance(new solanaWeb3.PublicKey(walletAddress));
      var balSol = bal / 1e9;
      if (balSol < requiredSol + 0.005) {
        showToast("Insufficient balance: need " + (requiredSol + 0.005).toFixed(4) + " SOL but have " + balSol.toFixed(4) + " SOL");
        return false;
      }
      return true;
    } catch (e) {
      console.warn("Balance check failed:", e);
      return true;
    }
  }

  async function sendAndWait(tx) {
    var blockhashInfo = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhashInfo.blockhash;
    tx.feePayer = new solanaWeb3.PublicKey(walletAddress);

    // Serialize to raw bytes — Phantom handles deserialization correctly
    tx.compileMessage();
    var txBytes = tx.serialize({ requireAllSignatures: false });
    var signed = await phantom.signTransaction(txBytes);
    // Phantom returns Uint8Array when given bytes, or Transaction object when given Transaction
    var raw = signed instanceof Uint8Array ? signed : (signed.serialize ? signed.serialize({ requireAllSignatures: false }) : signed);
    var sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
    console.log("TX sent:", sig);

    // Poll for confirmation with proper error fetching
    var start = Date.now();
    while (Date.now() - start < 90000) {
      await new Promise(function (r) { setTimeout(r, 3000); });
      try {
        var statusResp = await connection.getSignatureStatuses([sig]);
        if (statusResp && statusResp.value && statusResp.value[0]) {
          var st = statusResp.value[0];
          if (st.err) {
            // Fetch full error logs
            var txInfo = await connection.getTransaction(sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 });
            var errMsg = "Transaction failed on-chain";
            if (txInfo && txInfo.meta && txInfo.meta.logMessages && txInfo.meta.logMessages.length > 0) {
              errMsg = txInfo.meta.logMessages.slice(-5).join("\n");
            } else if (txInfo && txInfo.meta && txInfo.meta.err) {
              errMsg = JSON.stringify(txInfo.meta.err);
            }
            console.error("On-chain error:", errMsg);
            throw new Error(errMsg);
          }
          if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") {
            return sig;
          }
          // processed but not yet confirmed — keep waiting
        }
      } catch (e) {
        // Re-throw on-chain errors, continue on network errors
        if (e.message && (e.message.includes("Transaction failed") || e.message.includes("Instruction") || e.message.includes("Constraint") || e.message.includes("Custom program error"))) {
          throw e;
        }
        console.warn("Status check retry:", e.message || e);
      }
    }
    // Final check
    try {
      var finalResp = await connection.getTransaction(sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 });
      if (finalResp && finalResp.meta && !finalResp.meta.err) return sig;
      if (finalResp && finalResp.meta && finalResp.meta.logMessages) {
        throw new Error(finalResp.meta.logMessages.slice(-5).join("\n"));
      }
    } catch (e2) {
      if (e2.message && !e2.message.includes("Failed to fetch")) throw e2;
    }
    throw new Error("Transaction not confirmed. Check Explorer: " + explorerTx(sig));
  }

  /* ── Init IX builder ──────────────────────────────────────────────── */
  async function getOrBuildInitIx() {
    if (!connection) return null;
    try {
      var configPDA = solanaWeb3.PublicKey.findProgramAddressSync([bytes("config")], PROGRAM_ID)[0];
      var info = await connection.getAccountInfo(configPDA);
      if (info && info.data && info.data.length > 0) {
        console.log("Config PDA already exists:", configPDA.toString());
        return null;
      }
      console.log("Config PDA NOT found:", configPDA.toString());
    } catch (e) {
      console.warn("Config check error:", e);
    }
    try {
      var operator = new solanaWeb3.PublicKey(walletAddress);
      var disc = await instrDiscriminator("initialize");
      var data = concat(disc, operator.toBuffer());
      var configPDA2 = solanaWeb3.PublicKey.findProgramAddressSync([bytes("config")], PROGRAM_ID)[0];
      console.log("Building init IX, data:", Array.from(data).map(function(b){return b.toString(16).padStart(2,'0');}).join(''));
      return new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA2, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID, data: data,
      });
    } catch (e) {
      console.warn("Failed to build init IX:", e);
      return null;
    }
  }

  /* ── Navigation ─────────────────────────────────────────────────────── */
  function initNav() {
    var links = document.querySelectorAll(".sidebar-link[data-section]");
    var sections = document.querySelectorAll(".content-section");
    var title = document.getElementById("pageTitle");
    var sidebar = document.getElementById("sidebar");
    for (var i = 0; i < links.length; i++) {
      (function (link) {
        link.addEventListener("click", function (e) {
          e.preventDefault();
          for (var j = 0; j < links.length; j++) links[j].classList.remove("active");
          link.classList.add("active");
          for (var k = 0; k < sections.length; k++) sections[k].classList.remove("active");
          var target = document.getElementById("section-" + link.dataset.section);
          if (target) target.classList.add("active");
          title.textContent = link.querySelector("span").textContent;
          sidebar.classList.remove("open");
        });
      })(links[i]);
    }
    var menuBtn = document.getElementById("menuToggle");
    if (menuBtn) {
      menuBtn.addEventListener("click", function () { sidebar.classList.toggle("open"); });
    }
  }
  window.navigateTo = function (section) {
    var link = document.querySelector('.sidebar-link[data-section="' + section + '"]');
    if (link) link.click();
  };

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderAll() { updateStats(); renderActivity(); renderAgents(); renderBonds(); renderConstraints(); }
  function updateStats() {
    document.getElementById("totalAgents").textContent = cachedAgents.length || "0";
    document.getElementById("totalBonds").textContent = cachedBonds.filter(function (b) { return b.isActive; }).length || "0";
    var totalLocked = cachedBonds.filter(function (b) { return b.isActive; }).reduce(function (sum, b) { return sum + Number(b.amount); }, 0);
    document.getElementById("totalStaked").textContent = totalLocked ? lamportsToSol(totalLocked) : "0";
    document.getElementById("totalSlashes").textContent = cachedAgents.filter(function (a) { return a.status === "slashed"; }).length || "0";
  }
  function renderActivity() {
    var target = document.getElementById("activityList");
    var fullTarget = document.getElementById("activityFullList");
    var items = cachedActivity.length > 0 ? cachedActivity : [
      { type: "bond", title: "No activity yet", desc: "Connect wallet and register an agent to get started" },
    ];
    var iconMap = { bond: "fa-shield-halved", slash: "fa-bolt", constraint: "fa-list-check", tx: "fa-arrow-right-arrow-left" };
    target.innerHTML = items.slice(0, 8).map(function (a) {
      return '<div class="activity-item"><div class="activity-icon ' + a.type + '"><i class="fa-solid ' + (iconMap[a.type] || "fa-circle") + '"></i></div><div class="activity-info"><div class="activity-title">' + a.title + '</div><div class="activity-desc">' + a.desc + '</div></div>' + (a.amount ? '<span class="activity-amount ' + a.amountType + '">' + a.amount + '</span>' : "") + (a.time ? '<span class="activity-time">' + a.time + '</span>' : "") + '</div>';
    }).join("");
    if (fullTarget) {
      fullTarget.innerHTML = items.map(function (a) {
        return '<div class="activity-item"><div class="activity-icon ' + a.type + '"><i class="fa-solid ' + (iconMap[a.type] || "fa-circle") + '"></i></div><div class="activity-info"><div class="activity-title">' + (a.explorerUrl ? '<a href="' + a.explorerUrl + '" target="_blank" style="color:var(--purple);text-decoration:none;">' + a.title + '</a>' : a.title) + '</div><div class="activity-desc">' + a.desc + '</div></div>' + (a.amount ? '<span class="activity-amount ' + a.amountType + '">' + a.amount + '</span>' : "") + (a.time ? '<span class="activity-time">' + a.time + '</span>' : "") + '</div>';
      }).join("");
    }
  }
  function renderAgents() {
    var target = document.getElementById("agentsGrid");
    if (!walletConnected) { target.innerHTML = emptyState("fa-wallet", "Connect wallet to see agents"); return; }
    if (cachedAgents.length === 0) { target.innerHTML = emptyState("fa-robot", "No agents registered yet", "Click Register to create one"); return; }
    target.innerHTML = cachedAgents.map(function (a) {
      return '<div class="agent-card"><div class="agent-card-header"><div class="agent-card-avatar"><i class="fa-solid fa-robot"></i></div><div class="agent-card-info"><h3>' + a.name + '</h3><p>' + short(a.pubkey) + '</p></div><span class="status-badge ' + a.status + '">' + a.status + '</span></div><div class="agent-card-stats"><div class="agent-stat"><div class="value">' + a.trustScore + '</div><div class="label">Trust</div></div><div class="agent-stat"><div class="value"><a href="' + explorerAddr(a.pubkey) + '" target="_blank" style="color:var(--purple);">View \u2197</a></div><div class="label">On-chain</div></div></div></div>';
    }).join("");
  }
  function renderBonds() {
    var target = document.getElementById("bondsList");
    if (!walletConnected) { target.innerHTML = emptyState("fa-wallet", "Connect wallet to see bonds"); return; }
    if (cachedBonds.length === 0) { target.innerHTML = emptyState("fa-shield-halved", "No bonds yet", "Lock funds to create a safety deposit"); return; }
    target.innerHTML = cachedBonds.map(function (b) {
      var expired = b.expiresAt && Date.now() / 1000 > b.expiresAt;
      var agentObj = cachedAgents.find(function (a) { return a.pubkey === b.agent; });
      var agentName = agentObj ? agentObj.name : short(b.agent);
      var buttons = '';
      if (b.isActive) {
        buttons = '<button class="btn-outline" onclick="window._withdrawBond(\'' + b.pubkey + '\')">Withdraw</button>' +
          '<button class="btn-slash" onclick="window._openSlash(\'' + b.pubkey + '\',\'' + b.agent + '\',\'' + b.amount + '\',\'' + agentName + '\')">Slash</button>';
      }
      return '<div class="bond-card"><div class="bond-icon"><i class="fa-solid fa-shield-halved"></i></div><div class="bond-info"><h3>' + lamportsToSol(b.amount) + ' SOL</h3><p>' + agentName + ' \u2014 ' + (b.isActive ? (expired ? "Expired \u2014 withdrawable" : "Locked") : "Withdrawn") + '</p></div><div class="bond-amount"><div class="value">' + (b.isActive ? "Active" : "Closed") + '</div><div class="label">' + (b.expiresAt ? new Date(b.expiresAt * 1000).toLocaleDateString() : "") + '</div></div>' + buttons + '</div>';
    }).join("");
  }
  function renderConstraints() {
    var target = document.getElementById("constraintsGrid");
    if (!walletConnected) { target.innerHTML = emptyState("fa-wallet", "Connect wallet to see rules"); return; }
    if (cachedConstraints.length === 0) { target.innerHTML = emptyState("fa-list-check", "No rules configured", "Add rules to control agent behavior"); return; }
    target.innerHTML = cachedConstraints.map(function (c) {
      var iconClass = c.type === "spend" ? "fa-coins" : c.type === "program" ? "fa-cube" : c.type === "timelock" ? "fa-clock" : "fa-gauge-high";
      return '<div class="constraint-card"><div class="constraint-header"><div class="constraint-icon ' + c.type + '"><i class="fa-solid ' + iconClass + '"></i></div><h3>' + c.title + '</h3></div><div class="constraint-row"><span class="label">Status</span><span class="value">' + (c.enforced ? "Active" : "Pending") + '</span></div><div class="constraint-status"><span class="dot"></span>' + (c.enforced ? "Enforced" : "Pending") + '</div></div>';
    }).join("");
  }
  function emptyState(icon, text, sub) {
    return '<div class="empty-state"><i class="fa-solid ' + icon + '" style="font-size:28px;color:var(--text-muted);"></i><p>' + text + '</p>' + (sub ? '<p style="font-size:12px;color:var(--text-muted);margin-top:4px;">' + sub + '</p>' : "") + '</div>';
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
    document.getElementById("modalOverlay").addEventListener("click", function (e) { if (e.target.id === "modalOverlay") closeModal(); });

    document.getElementById("registerAgent").addEventListener("click", function () {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      openModal("Register Agent",
        '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Register an AI agent on Solana. It becomes accountable \u2014 if it breaks rules, its operator\'s bond compensates victims.</p>' +
        '<div class="form-group"><label>Agent Name</label><input type="text" id="regName" placeholder="e.g. Trading Bot" maxlength="32" /></div>' +
        '<div class="form-group"><label>Type</label><select id="regType"><option value="0">Trader</option><option value="1">Oracle</option><option value="2">DeFi</option><option value="3">Payment</option><option value="4">NFT</option><option value="5">Governance</option><option value="6">Bridge</option><option value="7">Custom</option></select></div>' +
        '<div class="form-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="regSubmit">Register</button></div>'
      );
      document.getElementById("regSubmit").onclick = handleRegister;
    });

    document.getElementById("createBond").addEventListener("click", function () {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      if (cachedAgents.length === 0) { showToast("Register an agent first"); return; }
      var opts = cachedAgents.filter(function (a) { return a.status === "active"; }).map(function (a) { return '<option value="' + a.pubkey + '">' + a.name + '</option>'; }).join("");
      openModal("Lock Bond",
        '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Lock SOL as collateral. If your agent breaks rules, these funds compensate the affected party.</p>' +
        '<div class="form-group"><label>Agent</label><select id="bondAgent">' + opts + '</select></div>' +
        '<div class="form-group"><label>Amount (SOL)</label><input type="number" id="bondAmount" placeholder="e.g. 5" min="0.1" step="0.1" /><p class="hint">Minimum 0.1 SOL</p></div>' +
        '<div class="form-group"><label>Lock Period</label><select id="bondDuration"><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="15552000">180 days</option></select></div>' +
        '<div class="form-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="bondSubmit">Lock</button></div>'
      );
      document.getElementById("bondSubmit").onclick = handleBond;
    });

    document.getElementById("addConstraint").addEventListener("click", function () {
      if (!walletConnected) { showToast("Connect wallet first"); return; }
      if (cachedAgents.length === 0) { showToast("Register an agent first"); return; }
      var opts = cachedAgents.filter(function (a) { return a.status === "active"; }).map(function (a) { return '<option value="' + a.pubkey + '">' + a.name + '</option>'; }).join("");
      openModal("Add Rule",
        '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Rules control what your agent can do. Breaking a rule triggers compensation.</p>' +
        '<div class="form-group"><label>Agent</label><select id="conAgent">' + opts + '</select></div>' +
        '<div class="form-group"><label>Rule Type</label><select id="conType"><option value="0">Spending Limit</option><option value="1">Allowed Programs</option><option value="2">Timelock</option><option value="3">Speed Limit</option></select></div>' +
        '<div class="form-group"><label>Max Amount (SOL)</label><input type="number" id="conMaxAmount" placeholder="e.g. 5" min="0.01" step="0.01" /></div>' +
        '<div class="form-group"><label>Period (seconds)</label><input type="number" id="conPeriod" placeholder="e.g. 86400 (1 day)" min="0" /></div>' +
        '<div class="form-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="conSubmit">Add Rule</button></div>'
      );
      document.getElementById("conSubmit").onclick = handleConstraint;
    });
  }

  function showToast(msg, duration) {
    var t = document.getElementById("toast");
    document.getElementById("toastMessage").textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, duration || 3000);
  }

  /* ── TX Handlers (skipPreflight for real errors) ───────────────────── */
  async function handleRegister() {
    var name = document.getElementById("regName") ? document.getElementById("regName").value.trim() : "";
    var typeIdx = parseInt(document.getElementById("regType") ? document.getElementById("regType").value : "0");
    if (!name) { showToast("Enter a name"); return; }
    if (!(await checkMinBalance(0.01))) return;
    closeModal(); showTxPending('Registering "' + name + '"');
    try {
      var operator = new solanaWeb3.PublicKey(walletAddress);
      var configPDA = solanaWeb3.PublicKey.findProgramAddressSync([bytes("config")], PROGRAM_ID)[0];
      var agentPDA = solanaWeb3.PublicKey.findProgramAddressSync(
        [bytes("agent"), operator.toBuffer(), bytes(name)], PROGRAM_ID
      )[0];
      var regDisc = await instrDiscriminator("register_agent");
      var regData = concat(regDisc, strWithLen(name), new Uint8Array([typeIdx]));

      console.log("Register data:", Array.from(regData).map(function(b){return b.toString(16).padStart(2,'0');}).join(' '));
      console.log("Config PDA:", configPDA.toString());
      console.log("Agent PDA:", agentPDA.toString());
      console.log("Operator:", operator.toString());
      console.log("Program:", PROGRAM_ID.toString());

      var registerIx = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: true },
          { pubkey: agentPDA, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID, data: regData,
      });

      var tx = new solanaWeb3.Transaction();
      var initIx = await getOrBuildInitIx();
      if (initIx) {
        console.log("Adding init IX to transaction");
        tx.add(initIx);
      }
      tx.add(registerIx);

      var sig = await sendAndWait(tx);
      showTxSuccess('Agent "' + name + '" registered', sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      console.error("Register error:", err);
      var msg = err.message || "Transaction failed";
      if (msg.includes("User rejected") || msg.includes("cancelled")) msg = "Cancelled by user";
      else if (msg.length > 200) msg = msg.substring(0, 200) + "...";
      showTxError(msg);
    }
  }

  async function handleBond() {
    var agentPubkey = document.getElementById("bondAgent") ? document.getElementById("bondAgent").value : "";
    var amountSol = parseFloat(document.getElementById("bondAmount") ? document.getElementById("bondAmount").value : "");
    var lockDuration = parseInt(document.getElementById("bondDuration") ? document.getElementById("bondDuration").value : "2592000");
    if (!agentPubkey || !amountSol || amountSol < 0.1) { showToast("Fill all fields"); return; }
    if (!(await checkMinBalance(amountSol))) return;
    closeModal(); showTxPending("Locking " + amountSol + " SOL");
    try {
      var operator = new solanaWeb3.PublicKey(walletAddress);
      var bondPDA = solanaWeb3.PublicKey.findProgramAddressSync(
        [bytes("bond"), new solanaWeb3.PublicKey(agentPubkey).toBuffer()], PROGRAM_ID
      )[0];
      var disc = await instrDiscriminator("create_bond");
      var data = concat(disc, u64le(Math.floor(amountSol * 1e9)), i64le(lockDuration));

      // Anchor #[account(init)] creates the bond PDA — no SystemProgram.createAccount needed
      var bondDataIx = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: solanaWeb3.PublicKey.findProgramAddressSync([bytes("config")], PROGRAM_ID)[0], isSigner: false, isWritable: false },
          { pubkey: bondPDA, isSigner: false, isWritable: true },
          { pubkey: new solanaWeb3.PublicKey(agentPubkey), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: operator, isSigner: false, isWritable: false },  // owner = agent.owner
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID, data: data,
      });
      var tx = new solanaWeb3.Transaction();
      var initIx = await getOrBuildInitIx();
      if (initIx) tx.add(initIx);
      tx.add(bondDataIx);

      var sig = await sendAndWait(tx);
      showTxSuccess("Locked " + amountSol + " SOL", sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      console.error("Bond error:", err);
      showTxError(err.message && err.message.includes("User rejected") ? "Cancelled" : (err.message || "Transaction failed"));
    }
  }

  async function handleConstraint() {
    var agentPubkey = document.getElementById("conAgent") ? document.getElementById("conAgent").value : "";
    var typeIdx = parseInt(document.getElementById("conType") ? document.getElementById("conType").value : "0");
    var maxAmountSol = parseFloat(document.getElementById("conMaxAmount") ? document.getElementById("conMaxAmount").value : "1");
    var periodSecs = parseInt(document.getElementById("conPeriod") ? document.getElementById("conPeriod").value : "86400");
    if (!agentPubkey) { showToast("Select an agent"); return; }
    if (!(await checkMinBalance(0.01))) return;
    closeModal(); showTxPending("Adding rule...");
    try {
      var operator = new solanaWeb3.PublicKey(walletAddress);
      var configPDA = solanaWeb3.PublicKey.findProgramAddressSync([bytes("config")], PROGRAM_ID)[0];
      // The Rust seed uses (config.total_bonds + 1) as the nonce — but for first constraint
      // we need to read the on-chain config to get total_bonds. Use 1 as initial guess.
      var configPDAForSeed = solanaWeb3.PublicKey.findProgramAddressSync([bytes("config")], PROGRAM_ID)[0];
      var nonce = 1; // First constraint after init = total_bonds(0) + 1 = 1
      try {
        var configInfo = await connection.getAccountInfo(configPDAForSeed);
        if (configInfo && configInfo.data) {
          // Config layout: discriminator(8) + admin(32) + total_agents(8) + total_bonds(8) + total_slashed(8) + bumped(1)
          // total_bonds is at offset 8+32+8 = 48, length 8
          var totalBonds = Number(new DataView(configInfo.data.buffer, configInfo.data.byteOffset + 48).getBigUint64(0, true));
          nonce = totalBonds + 1;
          console.log("Config total_bonds:", totalBonds, "-> constraint nonce:", nonce);
        }
      } catch (e) { console.warn("Could not read config for nonce:", e); }
      var constraintPDA = solanaWeb3.PublicKey.findProgramAddressSync(
        [bytes("constraint"), new solanaWeb3.PublicKey(agentPubkey).toBuffer(), u64le(nonce)], PROGRAM_ID
      )[0];
      var disc = await instrDiscriminator("add_constraint");
      var maxAmt = u64le(Math.floor(maxAmountSol * 1e9));
      var maxPerPeriod = u64le(Math.floor(maxAmountSol * 1e9 * 5));
      var period = i64le(periodSecs);
      var timelock = i64le(0);
      var allowedPrograms = new Uint8Array(32 * 8);
      var data = concat(disc, new Uint8Array([typeIdx]), maxAmt, maxPerPeriod, period, timelock, allowedPrograms);

      var constraintIx = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: constraintPDA, isSigner: false, isWritable: true },
          { pubkey: new solanaWeb3.PublicKey(agentPubkey), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID, data: data,
      });
      var tx = new solanaWeb3.Transaction();
      var initIx = await getOrBuildInitIx();
      if (initIx) tx.add(initIx);
      tx.add(constraintIx);

      var sig = await sendAndWait(tx);
      showTxSuccess("Rule added", sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      console.error("Constraint error:", err);
      showTxError(err.message && err.message.includes("User rejected") ? "Cancelled" : (err.message || "Transaction failed"));
    }
  }

  async function withdrawBond(bondPubkey) {
    if (!(await checkMinBalance(0.002))) return;
    showTxPending("Withdrawing...");
    try {
      var operator = new solanaWeb3.PublicKey(walletAddress);
      var disc = await instrDiscriminator("withdraw_bond");
      var ix = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: new solanaWeb3.PublicKey(bondPubkey), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID, data: disc,
      });
      var tx = new solanaWeb3.Transaction().add(ix);
      var sig = await sendAndWait(tx);
      showTxSuccess("Bond withdrawn", sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      console.error("Withdraw error:", err);
      showTxError(err.message && err.message.includes("User rejected") ? "Cancelled" : (err.message || "Transaction failed"));
    }
  }

  window._withdrawBond = withdrawBond;

  window._openSlash = function (bondPubkey, agentPubkey, bondAmount, agentName) {
    openModal("Slash Bond",
      '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Slash <strong>' + agentName + '</strong>\'s bond. The specified amount transfers from the bond to the admin treasury.</p>' +
      '<div class="form-group"><label>Slash Amount (SOL)</label><input type="number" id="slashAmount" placeholder="e.g. 0.1" min="0.01" step="0.01" max="' + lamportsToSol(bondAmount) + '" /><p class="hint">Max: ' + lamportsToSol(bondAmount) + ' SOL</p></div>' +
      '<div class="form-group"><label>Reason</label><input type="text" id="slashReason" placeholder="e.g. Rule violation: exceeded spending limit" maxlength="128" /></div>' +
      '<div class="form-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-danger" id="slashSubmit">Slash Bond</button></div>'
    );
    document.getElementById("slashSubmit").onclick = function () { handleSlash(bondPubkey, agentPubkey); };
  };

  async function handleSlash(bondPubkey, agentPubkey) {
    var amountSol = parseFloat(document.getElementById("slashAmount") ? document.getElementById("slashAmount").value : "");
    var reason = document.getElementById("slashReason") ? document.getElementById("slashReason").value.trim() : "";
    if (!amountSol || amountSol < 0.01) { showToast("Enter a valid amount"); return; }
    if (!reason) { showToast("Enter a reason"); return; }
    if (!(await checkMinBalance(0.01))) return;
    closeModal(); showTxPending("Slashing bond...");
    try {
      var operator = new solanaWeb3.PublicKey(walletAddress);
      var configPDA = solanaWeb3.PublicKey.findProgramAddressSync([bytes("config")], PROGRAM_ID)[0];
      var slashIdx = 0;
      try {
        var cfgInfo = await connection.getAccountInfo(configPDA);
        if (cfgInfo && cfgInfo.data) {
          slashIdx = Number(new DataView(cfgInfo.data.buffer, cfgInfo.data.byteOffset + 48).getBigUint64(0, true));
        }
      } catch (e) { console.warn("Could not read config for slash nonce:", e); }
      var agentKey = new solanaWeb3.PublicKey(agentPubkey);
      var nonceBytes = new Uint8Array(8);
      new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(slashIdx), true);
      var slashRecordPDA = solanaWeb3.PublicKey.findProgramAddressSync(
        [bytes("slash"), agentKey.toBuffer(), nonceBytes], PROGRAM_ID
      )[0];
      var disc = await instrDiscriminator("execute_slash");
      var data = concat(disc, strWithLen(reason), u64le(Math.floor(amountSol * 1e9)));

      var slashIx = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: configPDA, isSigner: false, isWritable: false },
          { pubkey: agentKey, isSigner: false, isWritable: true },
          { pubkey: new solanaWeb3.PublicKey(bondPubkey), isSigner: false, isWritable: true },
          { pubkey: slashRecordPDA, isSigner: false, isWritable: true },
          { pubkey: agentKey, isSigner: false, isWritable: false },  // owner (validated by has_one)
          { pubkey: operator, isSigner: true, isWritable: false },  // authority = config.admin
          { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID, data: data,
      });
      var tx = new solanaWeb3.Transaction().add(slashIx);
      var sig = await sendAndWait(tx);
      showTxSuccess("Bond slashed: " + amountSol + " SOL", sig);
      await Promise.all([refreshData(), refreshBalance()]);
    } catch (err) {
      console.error("Slash error:", err);
      var msg = err.message || "Transaction failed";
      if (msg.includes("User rejected") || msg.includes("cancelled")) msg = "Cancelled";
      else if (msg.length > 200) msg = msg.substring(0, 200) + "...";
      showTxError(msg);
    }
  }

  /* ── Boot ──────────────────────────────────────────────────────────── */
  function boot() {
    try { PROGRAM_ID = new solanaWeb3.PublicKey(PROGRAM_ID_STR); } catch (e) {
      console.error("Invalid program ID:", e); showToast("Failed to initialize."); return;
    }
    getAccountDiscriminators().then(function () {
      initNav(); initModals(); renderAll();
      var walletBtn = document.getElementById("connectWallet");
      if (walletBtn) {
        walletBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); connectWallet(); });
      }
      phantom = getPhantom();
      if (phantom) {
        phantom.on("connect", function () {
          walletConnected = true; walletAddress = phantom.publicKey.toString();
          connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");
          setWalletUI(true, walletAddress); refreshData();
        });
        // Always attempt silent reconnect on page load
        phantom.connect({ onlyIfTrusted: true }).then(function (resp) {
          if (resp && resp.publicKey) {
            walletConnected = true;
            walletAddress = resp.publicKey.toString();
            connection = new solanaWeb3.Connection(SOLANA_RPC, "confirmed");
            setWalletUI(true, walletAddress);
            refreshData();
          }
        }).catch(function () {});
      }
    }).catch(function (e) {
      console.error("Init failed:", e);
      initNav(); initModals(); renderAll();
    });
  }

  function waitForSolana() {
    if (typeof solanaWeb3 !== "undefined") { boot(); }
    else {
      var attempts = 0;
      var check = setInterval(function () {
        attempts++;
        if (typeof solanaWeb3 !== "undefined") { clearInterval(check); boot(); }
        else if (attempts > 50) { clearInterval(check); showToast("Failed to load Solana library. Refresh."); }
      }, 100);
    }
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", waitForSolana); }
  else { waitForSolana(); }
})();
