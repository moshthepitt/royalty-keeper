import assert from "node:assert/strict";
import test from "node:test";

const events = new Map();
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options) { this.type = type; this.detail = options?.detail; }
};
globalThis.window = {
  addEventListener(type, listener) { events.set(type, listener); },
  dispatchEvent(event) { events.get(event.type)?.(event); },
};

const { findWallet } = await import(`../wallets.js?test=${Date.now()}`);

class PublicKey {
  constructor(value) { this.value = value instanceof Uint8Array ? [...value].join(",") : value; }
  toString() { return this.value; }
}
const web3 = { PublicKey, Transaction: { from: (bytes) => ({ restored: [...bytes] }) } };

test("injected Phantom connects, signs, and disconnects without secret-key access", async () => {
  let disconnected = false;
  const signed = { serialize() {} };
  window.phantom = { solana: {
    async connect() { return { publicKey: { toString: () => "payer" } }; },
    async signTransaction(transaction) { assert.equal(transaction, "transaction"); return signed; },
    async disconnect() { disconnected = true; },
  } };
  const wallet = findWallet("Phantom", web3);
  assert.equal((await wallet.connect()).toString(), "payer");
  assert.equal(await wallet.sign("transaction"), signed);
  await wallet.disconnect();
  assert.equal(disconnected, true);
});

test("Wallet Standard registration and signTransaction payload follow the standard shape", async () => {
  delete window.phantom;
  let appRegistry;
  const registerListener = events.get("wallet-standard:register-wallet");
  const account = { publicKey: Uint8Array.of(1, 2, 3), chains: ["solana:mainnet"] };
  const standardWallet = {
    name: "Phantom",
    accounts: [account],
    features: {
      "standard:connect": { async connect() { return { accounts: [account] }; } },
      "solana:signTransaction": {
        async signTransaction(input) {
          assert.equal(input.account, account);
          assert.equal(input.chain, "solana:mainnet");
          assert.deepEqual([...input.transaction], [9, 8]);
          return [{ signedTransaction: Uint8Array.of(7, 6) }];
        },
      },
    },
  };
  registerListener({ detail(registry) { appRegistry = registry; } });
  appRegistry.register(standardWallet);

  const wallet = findWallet("Phantom", web3);
  assert.equal((await wallet.connect()).toString(), "1,2,3");
  const transaction = { serialize: () => Uint8Array.of(9, 8) };
  assert.deepEqual(await wallet.sign(transaction), { restored: [7, 6] });
});
