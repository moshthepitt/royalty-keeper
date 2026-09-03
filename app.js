import { BALANCE_BATCH_SIZE, DEFAULT_RPC_URL, FALLBACK_RPC_URL } from "./config.js";
import {
  alphabeticalRoutes,
  checkedLamports,
  expectedPayouts,
  formatSol,
  publicRpcLabel,
  shortAddress,
  validateRoutes,
  validateRpcUrl,
} from "./core.js";
import {
  broadcastAndFinalize,
  buildSweepTransaction,
  fetchRouteProof,
  requireSuccessfulSimulation,
  transactionSignature,
  unsignedTransactionBytes,
  serializeSignedTransaction,
} from "./keeper.js";
import { decodeAccount, RpcClient } from "./rpc.js";
import { KEEPER_PROGRAM_ADDRESS, ROUTES } from "./routes.js";
import { findWallet, onWalletRegistration } from "./wallets.js";


if (window.top !== window.self) {
  const warning = document.createElement("main");
  warning.className = "frame-warning";
  warning.textContent = "NFT royalty withdrawals cannot run inside another page. Open this site directly.";
  document.body.replaceChildren(warning);
  throw new Error("Refusing to run inside a frame.");
}

const web3 = window.solanaWeb3;
if (!web3) throw new Error("The pinned Solana browser library did not load.");
validateRoutes(ROUTES);

const orderedRoutes = alphabeticalRoutes(ROUTES);
const elements = Object.fromEntries([
  "wallet-status", "phantom", "backpack", "disconnect", "rpc-form", "rpc-url", "rpc-toggle",
  "rpc-reset", "rpc-label", "rpc-status", "refresh", "search", "rows", "page-status",
].map((id) => [id.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

const state = {
  rpc: new RpcClient(DEFAULT_RPC_URL),
  balanceGeneration: 0,
  balances: new Map(),
  balanceLoading: false,
  rentByEndpoint: new Map(),
  rows: new Map(),
  wallet: null,
  payer: null,
  busyRoute: null,
};

function text(element, value) {
  element.textContent = value;
}

function errorMessage(error) {
  if (error?.code === 4001 || /reject|declin|cancel/iu.test(error?.message ?? "")) {
    return "Wallet request cancelled. Nothing was sent.";
  }
  return error?.message || "Unexpected error.";
}

function setPageStatus(message, tone = "") {
  elements.pageStatus.className = `page-status ${tone}`;
  text(elements.pageStatus, message);
}

function setOperation(row, message, tone = "", signature = null) {
  row.operation.className = `row-status ${tone}`;
  row.operation.replaceChildren(document.createTextNode(message));
  if (signature) {
    const link = document.createElement("a");
    link.href = `https://explorer.solana.com/tx/${signature}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = " View transaction";
    row.operation.append(link);
  }
}

function makeRow(route) {
  const row = document.createElement("tr");
  row.dataset.search = `${route.name} ${route.id} ${route.sourceAddress}`.toLowerCase();

  const collection = document.createElement("td");
  const name = document.createElement("strong");
  name.textContent = route.name;
  collection.append(name);

  const balance = document.createElement("td");
  balance.dataset.label = "Royalty balance";
  const amount = document.createElement("strong");
  amount.className = "amount loading";
  amount.textContent = "Loading…";
  balance.append(amount);

  const action = document.createElement("td");
  action.dataset.label = "Action";
  const button = document.createElement("button");
  button.className = "withdraw";
  button.type = "button";
  button.textContent = "Withdraw";
  button.addEventListener("click", () => withdraw(route));
  action.append(button);

  const operation = document.createElement("span");
  operation.className = "row-status";
  collection.append(operation);
  row.append(collection, balance, action);
  elements.rows.append(row);
  state.rows.set(route.id, { row, amount, button, operation });
}

function renderRows() {
  orderedRoutes.forEach(makeRow);
  updateControls();
}

function updateBalance(route) {
  const row = state.rows.get(route.id);
  const balance = state.balances.get(route.id) ?? { status: "loading" };
  row.amount.className = `amount ${balance.status}`;
  if (balance.status === "ready") {
    row.amount.textContent = `${formatSol(balance.distributed)} SOL`;
    row.amount.title = balance.retained > 0n
      ? `${balance.retained} lamports remain in the royalty account after rounding.`
      : "Withdrawable after retaining the current zero-data rent reserve.";
  } else if (balance.status === "invalid") {
    row.amount.textContent = "Invalid account";
  } else if (balance.status === "unavailable") {
    row.amount.textContent = "Unavailable";
  } else {
    row.amount.textContent = "Loading…";
  }
}

function updateControls() {
  for (const route of ROUTES) {
    const row = state.rows.get(route.id);
    if (!row) continue;
    const balance = state.balances.get(route.id);
    const noBalance = balance?.status === "ready" && balance.distributed === 0n;
    const invalid = balance?.status === "invalid";
    row.button.disabled = state.busyRoute !== null || !state.wallet || noBalance || invalid;
    row.button.textContent = state.busyRoute === route.id
      ? "Working…"
      : noBalance
        ? "No balance"
        : "Withdraw";
  }
  elements.phantom.disabled = state.busyRoute !== null || state.wallet?.name === "Phantom";
  elements.backpack.disabled = state.busyRoute !== null || state.wallet?.name === "Backpack";
  elements.disconnect.hidden = !state.wallet;
  elements.disconnect.disabled = state.busyRoute !== null;
  elements.refresh.disabled = state.busyRoute !== null || state.balanceLoading;
  [...elements.rpcForm.elements].forEach((control) => { control.disabled = state.busyRoute !== null; });
  if (state.wallet) {
    elements.walletStatus.textContent = `${state.wallet.name} · ${shortAddress(state.payer.toString())}`;
  } else {
    elements.walletStatus.textContent = "Wallet not connected";
  }
}

async function balanceRent(rpc) {
  const cached = state.rentByEndpoint.get(rpc.endpoint);
  if (cached !== undefined) return cached;
  const pending = rpc.getMinimumBalanceForRentExemption(0).then(checkedLamports);
  state.rentByEndpoint.set(rpc.endpoint, pending);
  try {
    const rent = await pending;
    state.rentByEndpoint.set(rpc.endpoint, rent);
    return rent;
  } catch (error) {
    if (state.rentByEndpoint.get(rpc.endpoint) === pending) state.rentByEndpoint.delete(rpc.endpoint);
    throw error;
  }
}

async function fetchBalances(rpc) {
  const [accounts, rent] = await Promise.all([
    rpc.getMultipleAccountsBatched(
      ROUTES.map(({ sourceAddress }) => sourceAddress),
      { batchSize: BALANCE_BATCH_SIZE },
    ),
    balanceRent(rpc),
  ]);
  return { accounts, rent };
}

async function refreshBalances({ showLoading = true } = {}) {
  const generation = ++state.balanceGeneration;
  const rpc = state.rpc;
  state.balanceLoading = true;
  updateControls();
  if (showLoading) {
    ROUTES.forEach((route) => {
      state.balances.set(route.id, { status: "loading" });
      updateBalance(route);
    });
  }
  elements.refresh.classList.add("spinning");
  let balanceRpc = rpc;
  try {
    let snapshot;
    try {
      snapshot = await fetchBalances(rpc);
    } catch (error) {
      if (rpc.endpoint !== DEFAULT_RPC_URL || state.rpc !== rpc) throw error;
      balanceRpc = new RpcClient(FALLBACK_RPC_URL);
      setPageStatus("The official RPC rejected this browser. Trying the fallback…", "warn");
      snapshot = await fetchBalances(balanceRpc);
      if (generation !== state.balanceGeneration) return;
      state.rpc = balanceRpc;
      elements.rpcUrl.value = FALLBACK_RPC_URL;
      elements.rpcLabel.textContent = publicRpcLabel(FALLBACK_RPC_URL);
      elements.rpcStatus.textContent = "Automatic fallback. Use default to try the official RPC again.";
    }
    if (generation !== state.balanceGeneration) return;
    const { accounts, rent: rentValue } = snapshot;
    if (!Array.isArray(accounts?.value) || accounts.value.length !== ROUTES.length) {
      throw new Error("RPC returned the wrong number of royalty accounts.");
    }
    const rent = rentValue;
    ROUTES.forEach((route, index) => {
      try {
        const account = decodeAccount(accounts.value[index]);
        if (account.owner !== KEEPER_PROGRAM_ADDRESS || account.executable || account.data.length !== 0) {
          state.balances.set(route.id, { status: "invalid" });
        } else {
          const calculation = expectedPayouts(route, checkedLamports(account.lamports), rent);
          state.balances.set(route.id, { status: "ready", ...calculation });
        }
      } catch {
        state.balances.set(route.id, { status: "unavailable" });
      }
      updateBalance(route);
    });
    setPageStatus(balanceRpc.endpoint === FALLBACK_RPC_URL ? "Balances updated using the fallback RPC." : "Balances updated.", "good");
  } catch (error) {
    if (generation !== state.balanceGeneration) return;
    ROUTES.forEach((route) => {
      state.balances.set(route.id, { status: "unavailable" });
      updateBalance(route);
    });
    setPageStatus(`Balances unavailable from ${publicRpcLabel(balanceRpc.endpoint)}: ${errorMessage(error)} Try again or choose another RPC.`, "warn");
  } finally {
    if (generation === state.balanceGeneration) {
      state.balanceLoading = false;
      elements.refresh.classList.remove("spinning");
    }
    updateControls();
  }
}

async function connect(name) {
  try {
    const wallet = findWallet(name, web3);
    if (!wallet) throw new Error(`${name} is not detected in this browser.`);
    const payer = await wallet.connect();
    state.wallet = wallet;
    state.payer = payer;
    setPageStatus(`${name} connected.`, "good");
  } catch (error) {
    setPageStatus(errorMessage(error), "bad");
  }
  updateControls();
}

async function disconnect() {
  try {
    await state.wallet?.disconnect();
  } finally {
    state.wallet = null;
    state.payer = null;
    updateControls();
  }
}

async function withdraw(route) {
  if (!state.wallet || !state.payer || state.busyRoute !== null) return;
  const row = state.rows.get(route.id);
  const rpc = state.rpc;
  const wallet = state.wallet;
  const payer = state.payer;
  let attemptedSignature = null;
  let broadcastAttempted = false;
  state.busyRoute = route.id;
  updateControls();
  setOperation(row, "Checking the collection and current balance…");
  try {
    const before = await fetchRouteProof(rpc, web3, route);
    if (before.distributed === 0n) {
      setOperation(row, "No distributable royalties are currently available.");
      return;
    }

    const latest = await rpc.getLatestBlockhash(before.slot);
    const blockhashContext = latest?.value;
    if (!blockhashContext?.blockhash || !Number.isSafeInteger(blockhashContext.lastValidBlockHeight)) {
      throw new Error("RPC returned an invalid blockhash.");
    }
    const transaction = buildSweepTransaction(web3, route, payer, blockhashContext.blockhash);
    const unsigned = unsignedTransactionBytes(transaction);
    setOperation(row, "Simulating the exact withdrawal…");
    await requireSuccessfulSimulation(rpc, unsigned, false, before.slot);

    const toSign = web3.Transaction.from(unsigned);
    setOperation(row, `Approve in ${wallet.name}. Current distributable balance: ${formatSol(before.distributed)} SOL.`);
    const signed = await wallet.sign(toSign);
    const wire = serializeSignedTransaction(signed, payer);
    attemptedSignature = transactionSignature(signed);
    await requireSuccessfulSimulation(rpc, wire, true, before.slot);

    setOperation(row, "Rechecking unchanged onchain inputs before broadcast…");
    const rechecked = await fetchRouteProof(rpc, web3, route, before.slot);
    if (rechecked.sourceLamports !== before.sourceLamports || rechecked.rentLamports !== before.rentLamports) {
      throw new Error("Royalty state changed while the wallet was open. Nothing was sent; retry with a fresh amount.");
    }

    setOperation(row, "Broadcasting and waiting for finalization…");
    broadcastAttempted = true;
    const confirmationContext = signed.recentBlockhash === blockhashContext.blockhash ? blockhashContext : null;
    await broadcastAndFinalize(rpc, wire, attemptedSignature, confirmationContext, (message) => setOperation(row, message));
    setOperation(row, "Withdrawal finalized. Refreshing the balance…", "good", attemptedSignature);
    void refreshBalances({ showLoading: false });
  } catch (error) {
    setOperation(row, errorMessage(error), "bad", broadcastAttempted ? attemptedSignature : null);
  } finally {
    state.busyRoute = null;
    updateControls();
  }
}

function applyRpc(event) {
  event.preventDefault();
  try {
    const url = validateRpcUrl(elements.rpcUrl.value, location.protocol);
    state.rpc = new RpcClient(url);
    elements.rpcLabel.textContent = publicRpcLabel(url);
    elements.rpcStatus.textContent = url === DEFAULT_RPC_URL ? "Default public RPC. Custom URLs stay in this tab." : "Custom RPC. This URL stays in this tab.";
    void refreshBalances();
  } catch (error) {
    setPageStatus(errorMessage(error), "bad");
  }
}

function resetRpc() {
  elements.rpcUrl.value = DEFAULT_RPC_URL;
  state.rpc = new RpcClient(DEFAULT_RPC_URL);
  elements.rpcLabel.textContent = publicRpcLabel(DEFAULT_RPC_URL);
  elements.rpcStatus.textContent = "Default public RPC. Custom URLs stay in this tab.";
  void refreshBalances();
}

function filterRows() {
  const query = elements.search.value.trim().toLowerCase();
  orderedRoutes.forEach((route) => {
    state.rows.get(route.id).row.hidden = Boolean(query) && !state.rows.get(route.id).row.dataset.search.includes(query);
  });
}

elements.phantom.addEventListener("click", () => connect("Phantom"));
elements.backpack.addEventListener("click", () => connect("Backpack"));
elements.disconnect.addEventListener("click", disconnect);
elements.rpcForm.addEventListener("submit", applyRpc);
elements.rpcReset.addEventListener("click", resetRpc);
elements.rpcToggle.addEventListener("click", () => {
  const revealing = elements.rpcUrl.type === "password";
  elements.rpcUrl.type = revealing ? "url" : "password";
  elements.rpcToggle.textContent = revealing ? "Hide" : "Show";
});
elements.refresh.addEventListener("click", () => refreshBalances());
elements.search.addEventListener("input", filterRows);
onWalletRegistration(updateControls);

elements.rpcUrl.value = DEFAULT_RPC_URL;
elements.rpcLabel.textContent = publicRpcLabel(DEFAULT_RPC_URL);
renderRows();
void refreshBalances();
