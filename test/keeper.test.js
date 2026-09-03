import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  buildSweepTransaction,
  transactionSignature,
  unsignedTransactionBytes,
  verifyWalletTransaction,
} from "../keeper.js";
import { base58Encode } from "../core.js";
import { KEEPER_PROGRAM_ADDRESS, ROUTES } from "../routes.js";

async function loadVendoredWeb3() {
  const context = {
    ArrayBuffer,
    BigInt,
    DataView,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    clearTimeout,
    console,
    crypto: webcrypto,
    setTimeout,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  const source = await readFile(new URL("../vendor/solana-web3-1.98.4.min.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "solana-web3-1.98.4.min.js" });
  return context.solanaWeb3;
}

test("transaction construction exactly matches the Keeper sweep ABI", async () => {
  const web3 = await loadVendoredWeb3();
  const payer = web3.Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const blockhash = web3.Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => 32 - index)).publicKey.toString();
  const route = ROUTES[18];
  const transaction = buildSweepTransaction(web3, route, payer.publicKey, blockhash);

  assert.equal(transaction.instructions.length, 1);
  const [instruction] = transaction.instructions;
  assert.equal(instruction.programId.toString(), KEEPER_PROGRAM_ADDRESS);
  assert.deepEqual([...instruction.data], [1, route.id]);
  assert.deepEqual(
    instruction.keys.map(({ pubkey, isSigner, isWritable }) => [pubkey.toString(), isSigner, isWritable]),
    [route.sourceAddress, ...route.recipients.map(({ address }) => address)].map((address) => [address, false, true]),
  );
  assert.equal(transaction.feePayer.toString(), payer.publicKey.toString());
  assert.equal(transaction.recentBlockhash, blockhash);
});

test("an exact wallet signature is accepted and any message change is rejected", async () => {
  const web3 = await loadVendoredWeb3();
  const payer = web3.Keypair.fromSeed(new Uint8Array(32).fill(7));
  const blockhash = web3.Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey.toString();
  const unsigned = unsignedTransactionBytes(buildSweepTransaction(web3, ROUTES[0], payer.publicKey, blockhash));
  const reviewed = web3.Transaction.from(unsigned);
  const signed = web3.Transaction.from(unsigned);
  signed.partialSign(payer);

  const wire = verifyWalletTransaction(reviewed, signed, payer.publicKey);
  assert.ok(wire.length > unsigned.length - 1);
  assert.equal(transactionSignature(signed), base58Encode(signed.signature));

  const changed = web3.Transaction.from(unsigned);
  changed.recentBlockhash = web3.Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toString();
  changed.partialSign(payer);
  assert.throws(() => verifyWalletTransaction(reviewed, changed, payer.publicKey), /Wallet changed/u);
});
