export const PROGRAM = "KeEPA4MrRF45wBAwsJRGHwumd3LiRubpcvyZjMAMRvS";
export const PROGRAM_DATA = "BH7uPpKQBLArB59EJ9tZC8bm6sWzNXVroCz2XmRDwnnA";
export const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const RELEASE = Object.freeze({ bytes: 26_848, sha256: "ded1d708f98c6f75389945024424737d69b95ead04a43b95e7a138fc556cd620" });
export const CHAIN = "solana:mainnet";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
export const FALLBACK_RPC = "https://solana-rpc.publicnode.com";
export const RPC_TIMEOUT_MS = 12_000;
export const SITE_VERSION = "20260928-66";

export function lamports(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("RPC returned an invalid balance.");
  return BigInt(value);
}

export function formatSol(value) {
  const n = BigInt(value);
  const fraction = (n % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${n / 1_000_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export function validateRpcUrl(raw) {
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error("Enter a complete RPC URL."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP on localhost.");
  }
  if (url.username || url.password) throw new Error("Use an RPC URL without HTTP username or password fields.");
  url.hash = "";
  return url.toString();
}

export function validatePolicy(route, web3) {
  if (!Number.isInteger(route.id) || route.id < 0 || route.id > 65 || !route.name ||
      !Number.isInteger(route.bump) || route.bump < 0 || route.bump > 255) throw new Error("Invalid collection.");
  new web3.PublicKey(route.sourceAddress);
  new web3.PublicKey(route.originProgramAddress);
  const shares = route.recipients;
  if (!Array.isArray(shares) || shares.length < 1 || shares.length > 5 ||
      shares.some(s => !Number.isInteger(s.basisPoints) || s.basisPoints <= 0 || s.basisPoints % 50 !== 0) ||
      shares.reduce((sum, s) => sum + s.basisPoints, 0) !== 10_000 ||
      new Set(shares.map(s => s.address)).size !== shares.length ||
      shares.some(s => s.address === route.sourceAddress)) throw new Error("Invalid royalty policy.");
  for (const s of shares) new web3.PublicKey(s.address);
  if (route.remainderIndex !== null && route.remainderIndex !== 0) throw new Error("Invalid rounding policy.");
  const floor = route.reserveFloorLamports ?? 0;
  if (!Number.isSafeInteger(floor) || floor < 0) throw new Error("Invalid rent reserve.");
  return route;
}

export function validateCatalog(data, web3) {
  if (data.program !== PROGRAM || !Array.isArray(data.routes) || data.routes.length !== 66) throw new Error("Incorrect collection file.");
  const sources = new Set();
  data.routes.forEach((route, i) => {
    validatePolicy(route, web3);
    if (route.id !== i || sources.has(route.sourceAddress)) throw new Error("Duplicate or missing collection.");
    sources.add(route.sourceAddress);
  });
  return data.routes;
}

export function withdrawalInstruction(source, route, _payer, web3) {
  if (source !== route.sourceAddress) throw new Error("Incorrect royalty account.");
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(PROGRAM),
    keys: [route.sourceAddress, ...route.recipients.map(s => s.address)]
      .map(address => ({ pubkey: new web3.PublicKey(address), isSigner: false, isWritable: true })),
    data: Uint8Array.of(1, route.id),
  });
}

export function expectedPayouts(route, balance, rent) {
  const floor = BigInt(route.reserveFloorLamports ?? 0);
  const reserve = rent > floor ? rent : floor;
  const surplus = balance > reserve ? balance - reserve : 0n;
  const payouts = route.recipients.map(s => surplus * BigInt(s.basisPoints) / 10_000n);
  let distributed = payouts.reduce((sum, n) => sum + n, 0n);
  if (route.remainderIndex !== null) {
    payouts[route.remainderIndex] += surplus - distributed;
    distributed = surplus;
  }
  return { payouts, distributed, reserve, retained: surplus - distributed };
}

export function withdrawable(balance, rent, route) {
  return expectedPayouts(route, balance, rent).distributed;
}

export function accountBytes(account) {
  if (!account || !Array.isArray(account.data) || account.data[1] !== "base64") throw new Error("RPC returned incomplete account data.");
  return Uint8Array.from(atob(account.data[0]), c => c.charCodeAt(0));
}

export async function identifyRelease(elf, release = RELEASE) {
  if (elf.length < release.bytes || elf.subarray(release.bytes).some(byte => byte !== 0)) throw new Error("The withdrawal program has changed.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", elf.subarray(0, release.bytes)))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== release.sha256) throw new Error("The withdrawal program has changed.");
}

export async function verifyRouteProof(result, rent, route, web3) {
  if (!Number.isSafeInteger(result?.context?.slot) || result.context.slot < 0 || result.value?.length !== 3) throw new Error("RPC returned an incomplete account snapshot.");
  const [program, code, source] = result.value;
  if (!program || !code || !source) throw new Error("A required withdrawal account is absent.");
  if (program.owner !== LOADER || program.executable !== true || code.owner !== LOADER || code.executable !== false ||
      source.owner !== PROGRAM || source.executable !== false) throw new Error("The withdrawal account setup has changed.");
  const programBytes = accountBytes(program), codeBytes = accountBytes(code);
  const u32 = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (programBytes.length !== 36 || u32(programBytes) !== 2 ||
      new web3.PublicKey(programBytes.subarray(4)).toBase58() !== PROGRAM_DATA ||
      codeBytes.length < 45 || u32(codeBytes) !== 3 || accountBytes(source).length !== 0) throw new Error("The withdrawal account setup has changed.");
  await identifyRelease(codeBytes.subarray(45));
  const balance = lamports(source.lamports);
  const reserve = expectedPayouts(route, balance, rent).reserve;
  if (balance < reserve) throw new Error("This collection's royalty account is below its rent reserve.");
  return { slot: result.context.slot, amount: withdrawable(balance, rent, route) };
}

export function base58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n, text = "", zeros = 0;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  while (value) { text = alphabet[Number(value % 58n)] + text; value /= 58n; }
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return "1".repeat(zeros) + text;
}

export async function watchSignature(rpc, pending, {
  onStatus = () => {}, resend = async () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, timeout = 120_000,
} = {}) {
  const deadline = now() + timeout;
  let seen = Boolean(pending.seen);
  while (now() < deadline) {
    try {
      const status = (await rpc.request("getSignatureStatuses", [[pending.signature], { searchTransactionHistory: true }], { attempts: 1 }))?.value?.[0];
      if (status) {
        seen = true;
        pending.seen = true;
        if (status.confirmationStatus === "finalized" || status.confirmations === null) return status.err
          ? { state: "failed", message: `Transaction failed: ${JSON.stringify(status.err)}` }
          : { state: "finalized", message: "Withdrawal finalized." };
        onStatus(status.err ? "Transaction reported an error. Waiting for finalization…" : status.confirmationStatus === "confirmed" ? "Confirmed. Waiting for finalization…" : "Processed. Waiting for confirmation…");
      } else if (!seen) {
        // A confirmed transaction must not be declared expired while finalization catches up.
        if (Number.isSafeInteger(pending.lastValidBlockHeight)) {
          const height = await rpc.request("getBlockHeight", [{ commitment: "finalized" }], { attempts: 1 });
          if (Number.isSafeInteger(height) && height > pending.lastValidBlockHeight) {
            const again = (await rpc.request("getSignatureStatuses", [[pending.signature], { searchTransactionHistory: true }], { attempts: 1 }))?.value?.[0];
            if (!again) return { state: "unknown", message: "Blockhash expired; this RPC has no transaction status. Check the transaction before trying again." };
            seen = true;
            pending.seen = true;
            if (again.confirmationStatus === "finalized" || again.confirmations === null) return again.err
              ? { state: "failed", message: `Transaction failed: ${JSON.stringify(again.err)}` }
              : { state: "finalized", message: "Withdrawal finalized." };
            onStatus("Transaction seen on-chain. Waiting for finalization…");
            await sleep(2_500);
            continue;
          }
        }
        await resend(); // The same signed bytes, never a fresh transaction or a fresh signature.
        onStatus("Sent. Waiting for confirmation…");
      }
    } catch {
      onStatus("Waiting for RPC. Your transaction link is still available.");
    }
    await sleep(2_500);
  }
  return { state: "unknown", message: seen ? "Transaction seen on-chain. Finalization is not yet verified; check status again." : "Confirmation unavailable. Check the transaction or try checking status again." };
}



export class RpcError extends Error {
  constructor(message, { retryable = false, code = null, data = null } = {}) {
    super(message);
    this.name = "RpcError";
    this.retryable = retryable;
    this.code = code;
    this.data = data;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableCode(code) {
  return [-32016, -32005, -32004].includes(code);
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  }
  return btoa(binary);
}

export class RpcClient {
  constructor(endpoint, fetcher = globalThis.fetch) {
    this.endpoint = endpoint;
    this.fetcher = fetcher;
    this.nextId = 1;
  }

  async request(method, params, { attempts = 3 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
      try {
        const response = await this.fetcher.call(globalThis, this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new RpcError(`RPC returned HTTP ${response.status}.`, {
            retryable: response.status === 429 || response.status >= 500,
            code: response.status,
          });
        }
        const payload = await response.json();
        if (payload.error) {
          const code = payload.error.code ?? null;
          throw new RpcError(`RPC error ${code ?? "unknown"}: ${payload.error.message ?? "request failed"}.`, {
            retryable: retryableCode(code),
            code,
            data: payload.error.data,
          });
        }
        if (!Object.hasOwn(payload, "result")) throw new RpcError("RPC returned no result.");
        return payload.result;
      } catch (error) {
        lastError = error instanceof RpcError
          ? error
          : new RpcError(error.name === "AbortError" ? "RPC request timed out." : "RPC is unreachable or blocks browser requests.", { retryable: true });
        if (!lastError.retryable || attempt === attempts) throw lastError;
        await sleep(Math.min(400 * 2 ** (attempt - 1), 2_000));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  sendTransaction(bytes) {
    return this.request("sendTransaction", [bytesToBase64(bytes), {
      encoding: "base64",
      maxRetries: 20,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    }], { attempts: 1 }); // Recovery owns retries, preserving ambiguous outcomes.
  }

}



const standardWallets = new Set();
const listeners = new Set();
const registry = Object.freeze({
  register(...wallets) {
    wallets.forEach((wallet) => standardWallets.add(wallet));
    listeners.forEach((listener) => listener());
    return () => wallets.forEach((wallet) => standardWallets.delete(wallet));
  },
});

if (typeof window !== "undefined") {
  window.addEventListener("wallet-standard:register-wallet", ({ detail }) => {
    if (typeof detail === "function") detail(registry);
  });
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: registry }));
}

function injectedProvider(name) {
  if (name === "Phantom") return window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null);
  if (name === "Backpack") return window.backpack?.solana ?? (window.backpack?.isBackpack ? window.backpack : null);
  return null;
}

function injectedAdapter(name, provider, web3) {
  return {
    name,
    async connect() {
      const result = await provider.connect();
      const key = result?.publicKey ?? provider.publicKey;
      if (!key) throw new Error(`${name} returned no Solana account.`);
      return new web3.PublicKey(key.toString());
    },
    async sign(transaction) {
      const signed = await provider.signTransaction(transaction);
      if (!signed?.serialize) throw new Error(`${name} returned no signed transaction.`);
      return signed;
    },
    async disconnect() {
      await provider.disconnect?.();
    },
    subscribe(listener) {
      const changed = key => listener(key ? new web3.PublicKey(key.toString()) : null);
      const disconnected = () => listener(null);
      provider.on?.("accountChanged", changed);
      provider.on?.("disconnect", disconnected);
      return () => {
        provider.removeListener?.("accountChanged", changed);
        provider.removeListener?.("disconnect", disconnected);
      };
    },
  };
}

function standardAdapter(wallet, web3) {
  const connectFeature = wallet.features?.["standard:connect"];
  const disconnectFeature = wallet.features?.["standard:disconnect"];
  const signFeature = wallet.features?.["solana:signTransaction"];
  if (!connectFeature || !signFeature) return null;
  let account = null;
  return {
    name: wallet.name,
    async connect() {
      const result = await connectFeature.connect();
      account = result.accounts?.find(({ chains = [] }) => !chains.length || chains.includes(CHAIN))
        ?? wallet.accounts?.find(({ chains = [] }) => !chains.length || chains.includes(CHAIN));
      if (!account) throw new Error(`${wallet.name} returned no mainnet Solana account.`);
      return new web3.PublicKey(account.publicKey);
    },
    async sign(transaction) {
      if (!account) throw new Error(`Reconnect ${wallet.name}.`);
      if (Array.isArray(signFeature.supportedTransactionVersions) &&
          !signFeature.supportedTransactionVersions.includes("legacy")) {
        throw new Error(`${wallet.name} does not support legacy Solana transactions.`);
      }
      const bytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [result] = await signFeature.signTransaction({ account, chain: CHAIN, transaction: bytes });
      if (!result?.signedTransaction) throw new Error(`${wallet.name} returned no signed transaction.`);
      return web3.Transaction.from(result.signedTransaction);
    },
    async disconnect() {
      account = null;
      await disconnectFeature?.disconnect();
    },
    subscribe(listener) {
      return wallet.features?.["standard:events"]?.on("change", change => {
        if (!change.accounts) return;
        account = change.accounts.find(a => a.chains?.includes(CHAIN)) ?? null;
        listener(account ? new web3.PublicKey(account.publicKey) : null);
      }) ?? (() => {});
    },
  };
}

export function findWallet(name, web3) {
  const injected = injectedProvider(name);
  if (injected) return injectedAdapter(name, injected, web3);
  const standard = [...standardWallets].find((wallet) => wallet.name?.toLowerCase() === name.toLowerCase());
  return standard ? standardAdapter(standard, web3) : null;
}

export function onWalletRegistration(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startApp() {

const $ = id => document.getElementById(id);
if (window.top !== window.self) {
  document.body.textContent = "Open this withdrawal page directly.";
  throw new Error("Refusing to run inside a frame.");
}
if (!document.getElementById("collections") || !document.getElementById("notice")) {
  const warning = document.createElement("main");
  warning.textContent = "This page has been updated. ";
  const reload = document.createElement("a");
  const url = new URL(location.href);
  url.searchParams.set("release", SITE_VERSION);
  reload.href = url.href;
  reload.textContent = "Reload page to continue.";
  warning.append(reload);
  document.body.replaceChildren(warning);
  return;
}
const web3 = window.solanaWeb3;
let rpc = new RpcClient(DEFAULT_RPC), customRpc = false, chainChecked = false;
let wallet = null, payer = null, active = null, prepared = null;
let policies = {}, collections = [], balances = new Map(), messages = new Map(), pending = new Map();
let loadingBalances = false, balanceGeneration = 0;
let ready = false, connecting = false, walletRevision = 0, unsubscribeWallet = () => {};
const storageKey = "keeper-withdrawals-pending-v1";
const short = value => `${value.slice(0, 5)}…${value.slice(-5)}`;

function notice(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
}
function savePending() {
  try { sessionStorage.setItem(storageKey, JSON.stringify([...pending])); } catch { /* Storage is optional. */ }
}
function setMessage(source, text, error = false) {
  messages.set(source, { text, error });
  render();
}
function showRpc() {
  $("rpc-url").value = rpc.endpoint;
  $("rpc-status").textContent = `RPC: ${new URL(rpc.endpoint).host}${customRpc ? " (custom)" : rpc.endpoint === FALLBACK_RPC ? " (public fallback; default RPC unavailable)" : ""}`;
  $("rpc-fallback").hidden = customRpc || rpc.endpoint !== FALLBACK_RPC;
}
async function request(method, params, current = () => true) {
  const client = rpc;
  try {
    const result = await client.request(method, params);
    if (rpc !== client || !current()) throw new Error("RPC changed. Try again.");
    return result;
  }
  catch (error) {
    if (current() && rpc === client && !customRpc && client.endpoint === DEFAULT_RPC && (error.retryable || error.code === 403)) {
      rpc = new RpcClient(FALLBACK_RPC);
      chainChecked = false;
      showRpc();
      return rpc.request(method, params);
    }
    throw error;
  }
}

function visibleCollections() {
  const query = $("search").value.trim();
  return collections.filter(c => `${c.name} ${c.source}`.toLocaleLowerCase("en").includes(query.toLocaleLowerCase("en")) || c.source === query);
}

function render() {
  const focused = document.activeElement;
  const focusedMaster = focused?.closest("tr")?.dataset.source;
  const focusedAction = focused?.dataset.action;
  const fragment = document.createDocumentFragment();
  for (const collection of visibleCollections()) {
    const { source, name } = collection;
    const row = document.createElement("tr");
    row.dataset.source = source;
    const label = row.insertCell();
    const title = document.createElement("span");
    title.textContent = name;
    label.append(title);
    const address = document.createElement("span");
    address.className = "address";
    address.textContent = short(source);
    address.title = source;
    label.append(address);
    const message = messages.get(source);
    if (message || pending.has(source)) {
      const status = document.createElement("p");
      status.className = `row-status${message?.error ? " error" : ""}`;
      status.setAttribute("role", "status");
      const transaction = pending.get(source);
      status.textContent = message?.text ?? transaction?.message ?? "Saved transaction. Check its status before withdrawing again.";
      if (transaction) {
        const link = document.createElement("a");
        link.href = `https://explorer.solana.com/tx/${transaction.signature}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View transaction";
        status.append(link);
      }
      label.append(status);
    }
    const balance = balances.get(source);
    row.insertCell().textContent = typeof balance === "bigint" ? formatSol(balance) : balance ?? "—";
    const action = row.insertCell();
    const button = document.createElement("button");
    const isPrepared = prepared?.source === source;
    const busy = active === source && !isPrepared;
    button.textContent = isPrepared ? `Review in ${wallet.name}` : busy ? "Working…" : pending.has(source) && !pending.get(source).finished ? "Check status" : "Withdraw";
    button.setAttribute("aria-label", `${button.textContent}: ${name}`);
    button.dataset.action = "withdraw";
    button.disabled = Boolean(active && !isPrepared) || connecting;
    button.setAttribute("aria-busy", String(busy));
    button.addEventListener("click", () => isPrepared ? signPrepared() : pending.has(source) ? checkPending(source) : prepare(source));
    action.append(button);
    if (!active && pending.get(source)?.unknown) {
      const retry = document.createElement("button");
      retry.textContent = "Retry withdrawal";
      retry.addEventListener("click", () => prepare(source));
      action.append(retry);
    }
    if (isPrepared) {
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        active = null; prepared = null;
        setMessage(source, pending.has(source) ? "New withdrawal cancelled. Previous transaction is still tracked." : "Cancelled. Nothing sent.");
      });
      action.append(cancel);
    }
    fragment.append(row);
  }
  $("collections").replaceChildren(fragment);
  if (focusedMaster && focusedAction) {
    $("collections").querySelector(`tr[data-source="${focusedMaster}"] [data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
  }
  $("empty").hidden = visibleCollections().length !== 0;
  $("wallet-status").textContent = connecting ? "Connecting…" : payer ? `${wallet.name} · ${short(payer.toBase58())}` : "Wallet disconnected";
  for (const name of ["phantom", "backpack"]) $(name).disabled = !ready || Boolean(connecting || active || (payer && wallet.name.toLowerCase() === name));
  $("disconnect").hidden = !payer;
  $("disconnect").disabled = Boolean(active || connecting);
  for (const input of $("rpc-form").elements) input.disabled = Boolean(active);
  $("search").disabled = Boolean(active);
  $("refresh").disabled = !ready || loadingBalances || Boolean(active);
  $("refresh").setAttribute("aria-busy", String(loadingBalances));
}

async function loadBalances(onlyMaster) {
  if (loadingBalances) return;
  const generation = ++balanceGeneration;
  const routes = onlyMaster ? [{ source: onlyMaster }] : visibleCollections();
  if (!routes.length) return;
  loadingBalances = true;
  const read = (method, params) => request(method, params, () => generation === balanceGeneration);
  render();
  try {
    const rent = lamports(await read("getMinimumBalanceForRentExemption", [0, { commitment: "confirmed" }]));
    // The public fallback accepts at most ten accounts per balance request.
    for (let offset = 0; offset < routes.length; offset += 10) {
      if (generation !== balanceGeneration) return;
      const batch = routes.slice(offset, offset + 10);
      const result = await read("getMultipleAccounts", [batch.map(c => policies[c.source].sourceAddress), { commitment: "confirmed", encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
      if (!Array.isArray(result?.value) || result.value.length !== batch.length) throw new Error("RPC returned an incomplete balance batch.");
      if (generation !== balanceGeneration) return;
      batch.forEach((c, i) => {
        const account = result.value[i];
        if (!account || account.owner !== PROGRAM || account.executable || (account.space !== undefined && account.space !== 0)) balances.set(c.source, "Unavailable");
        else balances.set(c.source, withdrawable(account ? lamports(account.lamports) : 0n, rent, policies[c.source]));
      });
      notice(`Loading balances… ${Math.min(offset + batch.length, routes.length)}/${routes.length}`);
      render();
    }
    notice("Balances refreshed. Amounts exclude retained rent and rounding dust.");
  } catch (error) {
    if (generation !== balanceGeneration) return;
    for (const c of routes) if (!balances.has(c.source)) balances.set(c.source, "Unavailable");
    notice(`${error.message} Balance lookup is optional; withdrawals can still be attempted.`, true);
  } finally {
    if (generation === balanceGeneration) {
      loadingBalances = false;
      render();
    }
  }
}

async function connect(name) {
  if (active || connecting) return;
  connecting = true;
  let connectionTimeout;
  try {
    const adapter = findWallet(name, web3);
    if (!adapter) throw new Error(`${name} was not detected. Install or unlock its browser extension.`);
    // Invoke connect on the user's click, before any network request.
    const connection = adapter.connect();
    render();
    const key = await Promise.race([
      connection,
      new Promise((_, reject) => { connectionTimeout = setTimeout(() => reject(new Error("Wallet did not respond. Close its pending request, then reconnect.")), 90_000); }),
    ]);
    unsubscribeWallet();
    wallet = adapter;
    payer = key;
    walletRevision++;
    unsubscribeWallet = adapter.subscribe(key => {
      walletRevision++;
      payer = key;
      if (prepared) {
        const source = prepared.source;
        prepared = null;
        active = null;
        setMessage(source, "Wallet account changed. Prepare the withdrawal again.");
      }
      notice(key ? "" : "Wallet disconnected. Connect again to withdraw.");
      render();
    });
    notice("");
  } catch (error) { notice(error.message, true); }
  finally { clearTimeout(connectionTimeout); connecting = false; }
  render();
}

async function ensureMainnet() {
  if (!chainChecked) {
    const genesis = await request("getGenesisHash", []);
    if (genesis !== MAINNET_GENESIS) throw new Error("This RPC is not Solana mainnet.");
    chainChecked = true;
  }
}

async function prepare(source) {
  if (!payer) { notice("Connect a wallet in the header first."); return; }
  if (active) return;
  balanceGeneration++;
  loadingBalances = false;
  active = source;
  const revision = walletRevision;
  const feePayer = payer;
  setMessage(source, "Preparing withdrawal…");
  try {
    await ensureMainnet();
    // One fresh bounded snapshot per preparation; balance loading is never required.
    if (!Object.hasOwn(policies, source)) throw new Error("Unknown collection address.");
    const policy = validatePolicy(policies[source], web3);
    const accounts = await request("getMultipleAccounts", [[PROGRAM, PROGRAM_DATA, source], { commitment: "confirmed", encoding: "base64" }]);
    const rent = lamports(await request("getMinimumBalanceForRentExemption", [0, { commitment: "confirmed" }]));
    const proof = await verifyRouteProof(accounts, rent, policy, web3);
    if (proof.amount === 0n) throw new Error("No withdrawable royalties right now.");
    const { value } = await request("getLatestBlockhash", [{ commitment: "confirmed", minContextSlot: proof.slot }]);
    const blockhashFetchedAt = Date.now();
    if (!value?.blockhash || !Number.isSafeInteger(value.lastValidBlockHeight)) throw new Error("RPC returned an invalid blockhash.");
    if (revision !== walletRevision) throw new Error("Wallet account changed. Prepare the withdrawal again.");
    const transaction = new web3.Transaction({ feePayer, recentBlockhash: value.blockhash });
    transaction.add(
      web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
      web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      withdrawalInstruction(source, policy, feePayer, web3),
    );
    const simulation = await request("simulateTransaction", [bytesToBase64(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })), {
      encoding: "base64", commitment: "confirmed", sigVerify: false, minContextSlot: proof.slot,
    }]);
    if (simulation?.value?.err?.InsufficientFundsForRent) throw new Error("Withdrawal cannot meet Solana's account rent minimum. More royalties may be needed. Nothing sent.");
    if (!simulation?.value || simulation.value.err !== null) throw new Error(`Withdrawal simulation failed: ${JSON.stringify(simulation?.value?.err ?? "no result")}`);
    if (revision !== walletRevision) throw new Error("Wallet account changed. Prepare the withdrawal again.");
    prepared = { source, transaction, walletRevision: revision, blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight, createdAt: blockhashFetchedAt };
    setMessage(source, "Ready. Review the withdrawal in your wallet.");
  } catch (error) { active = null; setMessage(source, error.message, true); }
}

async function signPrepared() {
  const item = prepared;
  if (!item) return;
  if (Date.now() - item.createdAt > 30_000) {
    prepared = null;
    active = null;
    await prepare(item.source);
    setMessage(item.source, prepared ? "Refreshed blockhash. Click Review again." : messages.get(item.source)?.text, !prepared);
    return;
  }
  prepared = null;
  let approvalTimeout;
  try {
    // This call stays directly in the click handler so the extension can open.
    const signing = wallet.sign(item.transaction);
    setMessage(item.source, "Waiting for wallet approval…");
    const signed = await Promise.race([
      signing,
      new Promise((_, reject) => {
        approvalTimeout = setTimeout(() => reject(new Error("Wallet did not respond. Close its pending request, then try again.")), 90_000);
      }),
    ]);
    clearTimeout(approvalTimeout);
    if (walletRevision !== item.walletRevision) throw new Error("Wallet account changed. Nothing sent; prepare again.");
    const bytes = signed.serialize();
    if (!signed.signature) throw new Error("Wallet returned no signature.");
    const entry = {
      signature: base58(signed.signature),
      wire: bytesToBase64(bytes),
      lastValidBlockHeight: signed.recentBlockhash === item.blockhash ? item.lastValidBlockHeight : undefined,
    };
    pending.set(item.source, entry);
    savePending(); // Save the signature before broadcasting; an HTTP timeout is ambiguous.
    setMessage(item.source, "Sending transaction…");
    try { await rpc.sendTransaction(bytes); }
    catch (error) {
      // Only a definite first preflight rejection can finish without reconciliation.
      // AlreadyProcessed, AccountInUse and lost responses remain ambiguous.
      if (error.code === -32602 || (error.code === -32002 &&
          (error.data?.err?.InstructionError || error.data?.err?.InsufficientFundsForRent))) {
        if (error.data?.err?.InsufficientFundsForRent) error.message = "Withdrawal cannot meet Solana's account rent minimum. More royalties may be needed. Nothing sent.";
        entry.finished = true;
        entry.message = error.message;
        savePending();
        throw error;
      }
      // An HTTP timeout or lost response cannot prove that the transaction failed.
    }
    await reconcile(item.source, () => rpc.sendTransaction(bytes));
  } catch (error) { setMessage(item.source, error.message || "Wallet request failed.", true); }
  finally { clearTimeout(approvalTimeout); active = null; render(); }
}

async function reconcile(source, resend) {
  const entry = pending.get(source);
  const result = await watchSignature(rpc, entry, {
    resend,
    onStatus: text => { savePending(); setMessage(source, text); },
  });
  entry.unknown = result.state === "unknown";
  entry.message = result.message;
  savePending();
  setMessage(source, result.message, result.state !== "finalized");
  if (result.state === "finalized" || result.state === "failed") {
    // Preserve the explorer link in this tab, but let the user withdraw future deposits.
    entry.finished = true;
    savePending();
    if (result.state === "finalized") void loadBalances(source);
  }
}

async function checkPending(source) {
  if (active) return;
  const entry = pending.get(source);
  if (entry.finished) {
    await prepare(source);
    return;
  }
  balanceGeneration++;
  loadingBalances = false;
  active = source;
  setMessage(source, "Checking saved transaction…");
  try {
    await ensureMainnet();
    const resend = entry.wire ? () => rpc.sendTransaction(Uint8Array.from(atob(entry.wire), c => c.charCodeAt(0))) : undefined;
    await reconcile(source, resend);
  }
  catch (error) { setMessage(source, error.message, true); }
  finally { active = null; render(); }
}

function changeRpc(endpoint, custom) {
  balanceGeneration++;
  loadingBalances = false;
  rpc = new RpcClient(endpoint);
  customRpc = custom;
  chainChecked = false;
  balances.clear();
  showRpc();
  notice("RPC changed. Load balances when needed.");
  render();
}

$("phantom").addEventListener("click", () => connect("Phantom"));
$("backpack").addEventListener("click", () => connect("Backpack"));
$("disconnect").addEventListener("click", async () => {
  const previous = wallet;
  unsubscribeWallet();
  walletRevision++;
  wallet = null; payer = null; render();
  try { await previous?.disconnect(); } catch { /* Local state is already disconnected. */ }
});
$("refresh").addEventListener("click", () => loadBalances());
$("search").addEventListener("input", render);
$("rpc-form").addEventListener("submit", event => {
  event.preventDefault();
  try { changeRpc(validateRpcUrl($("rpc-url").value), true); $("rpc-settings").open = false; }
  catch (error) { notice(error.message, true); }
});
$("rpc-reset").addEventListener("click", () => changeRpc(DEFAULT_RPC, false));
onWalletRegistration(render);

async function start() {
  if (!web3) throw new Error("The local Solana library did not load. Reload this page.");
  const policyResponse = await fetch(`catalog.json?v=${SITE_VERSION}`);
  if (!policyResponse.ok) throw new Error("Collections did not load. Reload this page.");
  const data = await policyResponse.json();
  const routes = validateCatalog(data, web3);
  policies = Object.fromEntries(routes.map(route => [route.sourceAddress, route]));
  collections = routes.map(route => ({ source: route.sourceAddress, name: route.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  try {
    for (const [source, entry] of JSON.parse(sessionStorage.getItem(storageKey) ?? "[]")) {
      if (Object.hasOwn(policies, source) && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(entry.signature)) pending.set(source, entry);
    }
  } catch { /* Storage is optional, and old or malformed entries are ignored. */ }
  const initial = new URLSearchParams(location.search).get("account");
  if (initial) $("search").value = initial;
  notice("");
  ready = true;
  showRpc();
  render();
}
render();
start().catch(error => notice(error.message, true));

}
if (typeof document !== 'undefined') startApp();
