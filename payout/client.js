"use strict";

const createForm = document.querySelector("#create");
const lookup = document.querySelector("#lookup");
const signButton = document.querySelector("#approve");
const verifyButton = document.querySelector("#verify-credit");
const notice = document.querySelector("#notice");
let payout;

async function request(path, data) {
  const token = document.querySelector("#token").value;
  const response = await fetch(path, {
    method: data ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: data && JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function show(record) {
  payout = record;
  lookup.elements.id.value = record.terms.id;
  document.querySelector("#details").hidden = false;
  document.querySelector("#state").textContent = {
    awaiting_approval: "Awaiting reviewer signature",
    approved: "Approved. Ready for Steve to claim.",
    claimed: "Claimed. Check Steve and MultiHopper before taking any further action.",
    route_reported: "Route reported. The recipient credit has yet to be verified.",
    credit_verified: "Recipient credit verified on Solana mainnet. Check the MultiHopper route separately.",
  }[record.state];
  const rows = {
    "Reviewer": record.terms.reviewer,
    "Recipient": record.terms.recipient,
    "Steve agent wallet": record.terms.agentWallet,
    "Solana token mint": record.terms.mint,
    "Payout (base units)": record.terms.amountRaw,
    "Maximum debit (base units)": record.terms.maxDebitRaw,
    "Approval expires": new Date(record.terms.expiresAt).toLocaleString(),
    "Approval signature": record.approvalSignature,
    "MultiHopper route": record.routeId,
  };
  const terms = document.querySelector("#terms");
  terms.replaceChildren();
  for (const [label, value] of Object.entries(rows)) {
    if (value === null) continue;
    const name = document.createElement("dt");
    const detail = document.createElement("dd");
    name.textContent = label;
    detail.textContent = value;
    terms.append(name, detail);
  }
  signButton.hidden = record.state !== "awaiting_approval";
  verifyButton.hidden = record.state !== "route_reported";
  const explorer = document.querySelector("#explorer");
  explorer.hidden = !record.transactionSignature;
  if (record.transactionSignature) {
    explorer.href = "https://explorer.solana.com/tx/" + encodeURIComponent(record.transactionSignature);
  } else {
    explorer.removeAttribute("href");
  }
}

async function run(button, task) {
  button.disabled = true;
  notice.textContent = "";
  try { show(await task()); }
  catch (error) { notice.textContent = error.message; }
  finally { button.disabled = false; }
}

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void run(event.submitter, () => request("/payouts", Object.fromEntries(new FormData(createForm))));
});
lookup.addEventListener("submit", (event) => {
  event.preventDefault();
  void run(event.submitter, () => request("/payouts/" + encodeURIComponent(lookup.elements.id.value.trim())));
});
signButton.addEventListener("click", () => {
  const record = payout;
  void run(signButton, async () => {
    const wallet = window.phantom?.solana;
    if (!wallet?.isPhantom) throw new Error("Open the page in a browser with Phantom installed.");
    const { publicKey } = await wallet.connect();
    if (publicKey.toString() !== record.terms.reviewer) throw new Error("Connect the designated reviewer wallet.");
    const { signature } = await wallet.signMessage(new TextEncoder().encode(record.message), "utf8");
    return request("/payouts/" + record.terms.id + "/approve", { signature: btoa(String.fromCharCode(...signature)) });
  });
});

verifyButton.addEventListener("click", () => {
  const { id } = payout.terms;
  void run(verifyButton, () => request("/payouts/" + id + "/verify-credit", {}));
});
