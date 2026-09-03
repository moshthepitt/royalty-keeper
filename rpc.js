import { RPC_TIMEOUT_MS } from "./config.js";


export class RpcError extends Error {
  constructor(message, { retryable = false, code = null } = {}) {
    super(message);
    this.name = "RpcError";
    this.retryable = retryable;
    this.code = code;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableCode(code) {
  return [-32016, -32005, -32004, -32002].includes(code);
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  }
  return btoa(binary);
}

export function decodeAccount(account) {
  if (!account || !Array.isArray(account.data) || account.data.length !== 2 || account.data[1] !== "base64") {
    throw new RpcError("RPC returned an unsupported account.");
  }
  const binary = atob(account.data[0]);
  const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { ...account, data };
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
        const response = await this.fetcher(this.endpoint, {
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
          });
        }
        const payload = await response.json();
        if (payload.error) {
          const code = payload.error.code ?? null;
          throw new RpcError(`RPC error ${code ?? "unknown"}: ${payload.error.message ?? "request failed"}.`, {
            retryable: retryableCode(code),
            code,
          });
        }
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

  async getMultipleAccounts(addresses, { commitment = "confirmed", minContextSlot } = {}) {
    const options = { commitment, encoding: "base64" };
    if (minContextSlot !== undefined) options.minContextSlot = minContextSlot;
    return this.request("getMultipleAccounts", [addresses, options]);
  }

  getMinimumBalanceForRentExemption(size = 0) {
    return this.request("getMinimumBalanceForRentExemption", [size, { commitment: "confirmed" }]);
  }

  getLatestBlockhash(minContextSlot) {
    const options = { commitment: "confirmed" };
    if (minContextSlot !== undefined) options.minContextSlot = minContextSlot;
    return this.request("getLatestBlockhash", [options]);
  }

  simulateTransaction(bytes, sigVerify, minContextSlot) {
    const options = {
      commitment: "confirmed",
      encoding: "base64",
      replaceRecentBlockhash: false,
      sigVerify,
    };
    if (minContextSlot !== undefined) options.minContextSlot = minContextSlot;
    return this.request("simulateTransaction", [bytesToBase64(bytes), options]);
  }

  sendTransaction(bytes) {
    return this.request("sendTransaction", [bytesToBase64(bytes), {
      encoding: "base64",
      maxRetries: 20,
      preflightCommitment: "confirmed",
      skipPreflight: true,
    }], { attempts: 2 });
  }

  getSignatureStatus(signature) {
    return this.request("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
  }

  getBlockHeight() {
    return this.request("getBlockHeight", [{ commitment: "confirmed" }]);
  }
}
