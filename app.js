import { DEFAULT_RPC_URL } from "./config.js";
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
  verifyWalletTransaction,
} from "./keeper.js";
import { decodeAccount, RpcClient } from "./rpc.js";
import { KEEPER_PROGRAM_ADDRESS, ROUTES } from "./routes.js";
import { findWallet, onWalletRegistration } from "./wallets.js";


if (window.top !== window.self) {
  const warning = document.createElement("main");
  warning.className = "frame-warning";
  warning.textContent = "Royalty Keeper withdrawals cannot run inside another page. Open this site directly.";
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
  const metadata = document.createElement("span");
  metadata.className = "metadata";
  metadata.textContent = `Route ${route.id} · ${shortAddress(route.sourceAddress)} · ${route.recipients.length} fixed recipient${route.recipients.length === 1 ? "" : "s"}`;
  collection.append(name, metadata);

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
      ? `${balance.retained} lamports of legacy rounding dust remain in the PDA.`
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
  elements.refresh.disabled = state.busyRoute !== null;
  [...elements.rpcForm.elements].forEach((control) => { control.disabled = state.busyRoute !== null; });
  if (state.wallet) {
    elements.walletStatus.textContent = `${state.wallet.name} · ${shortAddress(state.payer.toString())}`;
  } else {
    elements.walletStatus.textContent = "Connect a wallet to pay the network fee. No recipient signature is required.";
  }
}

async function refreshBalances({ showLoading = true } = {}) {
  const generation = ++state.balanceGeneration;
  const rpc = state.rpc;
  if (showLoading) {
    ROUTES.forEach((route) => {
      state.balances.set(route.id, { status: "loading" });
      updateBalance(route);
    });
  }
  elements.refresh.classList.add("spinning");
  try {
    const [accounts, rentValue] = await Promise.all([
      rpc.getMultipleAccounts(ROUTES.map(({ sourceAddress }) => sourceAddress)),
      rpc.getMinimumBalanceForRentExemption(0),
    ]);
    if (generation !== state.balanceGeneration) return;
    if (!Array.isArray(accounts?.value) || accounts.value.length !== ROUTES.length) {
      throw new Error("RPC returned the wrong number of royalty accounts.");
    }
    const rent = checkedLamports(rentValue);
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
    setPageStatus("Balances updated. Anyone may trigger a withdrawal; the Keeper fixes every recipient.", "good");
  } catch {
    if (generation !== state.balanceGeneration) return;
    ROUTES.forEach((route) => {
      state.balances.set(route.id, { status: "unavailable" });
      updateBalance(route);
    });
    setPageStatus("Balance lookup failed. The table and wallet remain usable; retry or choose another RPC.", "warn");
  } finally {
    if (generation === state.balanceGeneration) elements.refresh.classList.remove("spinning");
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
    setPageStatus(`${name} connected. The wallet only pays transaction fees; payouts remain hard-coded.`, "good");
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
  setOperation(row, "Verifying Keeper code and this royalty PDA…");
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

    const reviewed = web3.Transaction.from(unsigned);
    const toSign = web3.Transaction.from(unsigned);
    setOperation(row, `Approve in ${wallet.name}. Current distributable balance: ${formatSol(before.distributed)} SOL.`);
    const signed = await wallet.sign(toSign);
    const wire = verifyWalletTransaction(reviewed, signed, payer);
    attemptedSignature = transactionSignature(signed);
    await requireSuccessfulSimulation(rpc, wire, true, before.slot);

    setOperation(row, "Rechecking unchanged onchain inputs before broadcast…");
    const rechecked = await fetchRouteProof(rpc, web3, route, before.slot);
    if (rechecked.sourceLamports !== before.sourceLamports || rechecked.rentLamports !== before.rentLamports) {
      throw new Error("Royalty state changed while the wallet was open. Nothing was sent; retry with a fresh amount.");
    }

    setOperation(row, "Broadcasting and waiting for finalization…");
    broadcastAttempted = true;
    await broadcastAndFinalize(rpc, wire, attemptedSignature, blockhashContext, (message) => setOperation(row, message));
    setOperation(row, "Withdrawal finalized. Frozen recipients were paid by the Keeper.", "good", attemptedSignature);
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
    elements.rpcStatus.textContent = url === DEFAULT_RPC_URL ? "Public mainnet RPC" : "Custom mainnet RPC · kept in this tab only";
    void refreshBalances();
  } catch (error) {
    setPageStatus(errorMessage(error), "bad");
  }
}

function resetRpc() {
  elements.rpcUrl.value = DEFAULT_RPC_URL;
  state.rpc = new RpcClient(DEFAULT_RPC_URL);
  elements.rpcLabel.textContent = publicRpcLabel(DEFAULT_RPC_URL);
  elements.rpcStatus.textContent = "Public mainnet RPC";
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
