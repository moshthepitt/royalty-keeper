import {
  FINALIZATION_TIMEOUT_MS,
  KEEPER_ELF_BYTES,
  KEEPER_ELF_SHA256,
  KEEPER_PROGRAM_DATA_ADDRESS,
  PROGRAM_DATA_METADATA_BYTES,
  REBROADCAST_INTERVAL_MS,
  UPGRADEABLE_LOADER_ADDRESS,
} from "./config.js";
import { base58Encode, checkedLamports, expectedPayouts, sweepDescriptor } from "./core.js";
import { decodeAccount } from "./rpc.js";
import { KEEPER_PROGRAM_ADDRESS } from "./routes.js";


function u32(bytes, offset = 0) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function assertCanonicalAccount(account, owner, executable) {
  if (account.owner !== owner || account.executable !== executable) {
    throw new Error("The onchain withdrawal setup has changed.");
  }
}

export async function fetchRouteProof(rpc, web3, route, minContextSlot) {
  const addresses = [KEEPER_PROGRAM_ADDRESS, KEEPER_PROGRAM_DATA_ADDRESS, route.sourceAddress];
  const [accountsResult, rentResult] = await Promise.all([
    rpc.getMultipleAccounts(addresses, { minContextSlot }),
    rpc.getMinimumBalanceForRentExemption(0),
  ]);
  if (!accountsResult || !Number.isSafeInteger(accountsResult.context?.slot)) {
    throw new Error("RPC returned no proof slot.");
  }
  const [programRaw, programDataRaw, sourceRaw] = accountsResult.value ?? [];
  if (!programRaw || !programDataRaw || !sourceRaw) throw new Error("A required onchain account is absent.");

  const program = decodeAccount(programRaw);
  const programData = decodeAccount(programDataRaw);
  const source = decodeAccount(sourceRaw);
  assertCanonicalAccount(program, UPGRADEABLE_LOADER_ADDRESS, true);
  assertCanonicalAccount(programData, UPGRADEABLE_LOADER_ADDRESS, false);
  assertCanonicalAccount(source, KEEPER_PROGRAM_ADDRESS, false);

  if (program.data.length !== 36 || u32(program.data) !== 2 ||
      new web3.PublicKey(program.data.slice(4)).toString() !== KEEPER_PROGRAM_DATA_ADDRESS) {
    throw new Error("The onchain withdrawal setup has changed.");
  }
  if (programData.data.length !== PROGRAM_DATA_METADATA_BYTES + KEEPER_ELF_BYTES || u32(programData.data) !== 3) {
    throw new Error("The onchain withdrawal setup has changed.");
  }
  if (await sha256(programData.data.slice(PROGRAM_DATA_METADATA_BYTES)) !== KEEPER_ELF_SHA256) {
    throw new Error("The onchain withdrawal code has changed.");
  }
  if (source.data.length !== 0) throw new Error("This collection's royalty account has an unexpected format.");
  const rentLamports = checkedLamports(rentResult);
  const sourceLamports = checkedLamports(source.lamports);
  if (sourceLamports < rentLamports) throw new Error("This collection's royalty account is below its rent reserve.");
  return {
    slot: accountsResult.context.slot,
    sourceLamports,
    rentLamports,
    ...expectedPayouts(route, sourceLamports, rentLamports),
  };
}

export function buildSweepTransaction(web3, route, payer, blockhash) {
  const descriptor = sweepDescriptor(route, KEEPER_PROGRAM_ADDRESS);
  const instruction = new web3.TransactionInstruction({
    programId: new web3.PublicKey(descriptor.program),
    keys: descriptor.accounts.map((address) => ({
      pubkey: new web3.PublicKey(address),
      isSigner: false,
      isWritable: true,
    })),
    data: descriptor.data,
  });
  return new web3.Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(instruction);
}

export function unsignedTransactionBytes(transaction) {
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
}

export function serializeSignedTransaction(signed, payer) {
  const payerSignature = signed.signatures.find(({ publicKey }) => publicKey.equals(payer));
  if (!payerSignature?.signature || !signed.verifySignatures()) {
    throw new Error("Wallet did not return a valid fee-payer signature.");
  }
  return signed.serialize({ requireAllSignatures: true, verifySignatures: true });
}

function simulationError(result) {
  const value = result?.value;
  if (!value) return "Simulation returned no result.";
  if (value.err === null) return null;
  const logs = Array.isArray(value.logs) ? value.logs.slice(-3).join(" · ") : "No logs returned.";
  return `Simulation failed: ${JSON.stringify(value.err)}. ${logs}`;
}

export async function requireSuccessfulSimulation(rpc, bytes, sigVerify, minContextSlot) {
  const result = await rpc.simulateTransaction(bytes, sigVerify, minContextSlot);
  const error = simulationError(result);
  if (error) throw new Error(error);
  return result.value;
}

export async function broadcastAndFinalize(rpc, bytes, signature, blockhashContext, progress = () => {}) {
  const deadline = Date.now() + FINALIZATION_TIMEOUT_MS;
  let nextBroadcast = 0;
  let lastBroadcastError = null;
  let blockhashExpired = false;
  while (Date.now() < deadline) {
    if (!blockhashExpired && Date.now() >= nextBroadcast) {
      try {
        const returned = await rpc.sendTransaction(bytes);
        if (returned !== signature) throw new Error("RPC returned a different transaction signature.");
        lastBroadcastError = null;
      } catch (error) {
        lastBroadcastError = error;
      }
      nextBroadcast = Date.now() + REBROADCAST_INTERVAL_MS;
    }

    let observationError = null;
    try {
      const statuses = await rpc.getSignatureStatus(signature);
      const status = statuses?.value?.[0];
      if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}.`);
      if (status?.confirmationStatus === "finalized") return signature;
      const height = blockhashContext ? await rpc.getBlockHeight() : null;
      if (Number.isSafeInteger(height) && height > blockhashContext.lastValidBlockHeight) {
        blockhashExpired = true;
      }
    } catch (error) {
      if (/^Transaction failed:/iu.test(error.message)) throw error;
      observationError = error;
    }
    progress(blockhashExpired
      ? "The blockhash window closed. Checking transaction history for the final result…"
      : lastBroadcastError || observationError
      ? "RPC is retrying and reconciling the same signed transaction…"
      : "Waiting for finalization…");
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
  if (blockhashExpired) {
    throw new Error("Transaction expired and was not found onchain after final reconciliation.");
  }
  throw lastBroadcastError ?? new Error("Timed out waiting for transaction finalization.");
}

export function transactionSignature(transaction) {
  if (!transaction.signature) throw new Error("Signed transaction has no fee-payer signature.");
  return base58Encode(transaction.signature);
}
