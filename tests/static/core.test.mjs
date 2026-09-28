import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { validatePolicy, validateCatalog, withdrawalInstruction, withdrawable, expectedPayouts,
  lamports, formatSol, validateRpcUrl, watchSignature, PROGRAM, PROGRAM_DATA, MAINNET_GENESIS,
  RELEASE, SITE_VERSION, accountBytes, identifyRelease, verifyRouteProof, RpcClient } from "../../app.js";

const vendor = readFileSync(new URL("../../vendor/solana-web3-1.98.4.min.js", import.meta.url), "utf8");
const web3 = vm.runInThisContext(vendor + ";solanaWeb3;");
const data = JSON.parse(readFileSync(new URL("../../catalog.json", import.meta.url)));
const { routes } = data;
const deployment = JSON.parse(readFileSync(new URL("../fixtures/deployment.json", import.meta.url)));
const payer = web3.Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

test("page assets and catalog use the same cache version", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  for (const file of ["app.js", "styles.css"]) {
    assert.ok(html.includes(`"${file}?v=${SITE_VERSION}"`), file);
  }
  const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
  assert.ok(app.includes('fetch(`catalog.json?v=${SITE_VERSION}`)'));
});

test("all 66 routes validate and the original 33 remain byte-identical", () => {
  assert.equal(validateCatalog(data, web3).length, 66);
  assert.equal(createHash("sha256").update(JSON.stringify(routes.slice(0, 33))).digest("hex"), "991d65b9d32a60b32700def9bd64f723d1da2004fd5d3dc8183108247b047041");
  assert.equal(routes[33].name, "Moran Masks");
  assert.equal(routes[34].name, "Souls");
  assert.equal(routes.filter(r => r.masterAddress).length, 31);
  assert.equal(createHash("sha256").update(vendor).digest("hex"), "09cdbea951b2ed0e11bcbe3aeb1ee9f035f9fb51ed212aca645475ae82688cc3");
  assert.equal(new web3.PublicKey(MAINNET_GENESIS).toBytes().length, 32);
});

test("all routes preserve the sweep opcode, ID, account order, and privileges", () => {
  for (const route of routes) {
    const instruction = withdrawalInstruction(route.sourceAddress, route, payer.publicKey, web3);
    assert.equal(instruction.programId.toBase58(), PROGRAM);
    assert.deepEqual([...instruction.data], [1, route.id]);
    assert.deepEqual(instruction.keys.map(k => k.pubkey.toBase58()), [route.sourceAddress, ...route.recipients.map(s => s.address)]);
    assert.ok(instruction.keys.every(k => k.isWritable && !k.isSigner));
    const tx = new web3.Transaction({ feePayer: payer.publicKey, recentBlockhash: payer.publicKey.toBase58() }).add(instruction);
    assert.ok(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length < 1232);
    if (route.id < 35) {
      const seed = route.id === 33 ? "masks" : route.id === 34 ? "SoulsNFT" : "NFTSale";
      const [pda, bump] = web3.PublicKey.findProgramAddressSync([new TextEncoder().encode(seed)], new web3.PublicKey(route.originProgramAddress));
      assert.equal(pda.toBase58(), route.sourceAddress);
      assert.equal(bump, route.bump);
    }
  }
});

test("all payout variants preserve reserve and match deployed rounding across repeated deposits", () => {
  for (const route of routes) {
    for (const rent of [650240n, 890880n, 1024000n]) {
      const reserve = rent > BigInt(route.reserveFloorLamports ?? 0) ? rent : BigInt(route.reserveFloorLamports ?? 0);
      for (const surplus of [0n, 1n, 7n, 99n, 100n, 10001n, 9007199254740991n]) {
        const floorAmounts = route.recipients.map(r => surplus * BigInt(r.basisPoints) / 10000n);
        if (route.remainderIndex === 0) floorAmounts[0] = surplus - floorAmounts.slice(1).reduce((sum, n) => sum + n, 0n);
        const result = expectedPayouts(route, reserve + surplus, rent);
        assert.deepEqual(result.payouts, floorAmounts);
        assert.equal(result.reserve, reserve);
        assert.equal(result.distributed + result.retained, surplus);
        assert.equal(withdrawable(reserve + surplus, rent, route), result.distributed);
        let remaining = result.retained;
        for (let repeat = 0; repeat < route.recipients.length; repeat++) {
          const repeatPayout = withdrawable(reserve + remaining, rent, route);
          assert.ok(repeatPayout <= remaining);
          remaining -= repeatPayout;
        }
        assert.equal(withdrawable(reserve + remaining, rent, route), 0n);
        assert.equal(withdrawable(reserve - 1n, rent, route), 0n);
        const next = expectedPayouts(route, reserve + result.retained + 10000n, rent);
        assert.equal(next.distributed + next.retained, result.retained + 10000n);
      }
    }
    assert.equal(route.reserveFloorLamports ?? 0, route.id < 33 ? 0 : 890880);
    if (route.id >= 35) assert.equal(route.remainderIndex, null);
  }
});

test("invalid or duplicate routes and wrong source addresses are rejected", () => {
  for (const mutation of [
    r => { r.id = 300; }, r => { r.reserveFloorLamports = -1; },
    r => { r.recipients[0].basisPoints = 99; }, r => { r.remainderIndex = 1; },
    r => { r.recipients[1].address = r.recipients[0].address; },
  ]) {
    const bad = structuredClone(routes[0]); mutation(bad);
    assert.throws(() => validatePolicy(bad, web3), /Invalid/);
  }
  const duplicate = structuredClone(data); duplicate.routes[1].sourceAddress = routes[0].sourceAddress;
  assert.throws(() => validateCatalog(duplicate, web3), /Duplicate/);
  assert.throws(() => validateCatalog({ ...data, routes: routes.slice(1) }, web3), /Incorrect/);
  assert.throws(() => withdrawalInstruction(PROGRAM, routes[0], payer.publicKey, web3), /Incorrect/);
});

test("current deployed ELF validates; unknown code and nonzero loader padding fail", async () => {
  const bytes = accountBytes(deployment.value[1]).subarray(45);
  await identifyRelease(bytes);
  assert.equal(RELEASE.bytes, 26848);
  assert.equal(RELEASE.sha256, "ded1d708f98c6f75389945024424737d69b95ead04a43b95e7a138fc556cd620");
  const padded = new Uint8Array(bytes.length + 2); padded.set(bytes);
  await identifyRelease(padded);
  padded[padded.length - 1] = 1;
  await assert.rejects(identifyRelease(padded), /changed/);
  const changed = bytes.slice(); changed[100] ^= 1;
  await assert.rejects(identifyRelease(changed), /changed/);
  await assert.rejects(identifyRelease(bytes.subarray(1)), /changed/);
});

test("bounded proof checks code identity, source owner, data, and reserve", async () => {
  const snapshot = { context: deployment.context, value: [...deployment.value, { owner: PROGRAM, executable: false, data: ["", "base64"], lamports: 1000000 }] };
  const proof = await verifyRouteProof(snapshot, 650240n, routes[34], web3);
  assert.equal(proof.amount, 109120n);
  for (const mutate of [
    s => { s.value[2].owner = web3.SystemProgram.programId.toBase58(); },
    s => { s.value[2].data = ["AA==", "base64"]; },
    s => { s.value[2].lamports = 1; },
    s => { s.value[0].executable = false; },
    s => { s.value[1].owner = PROGRAM; },
    s => { s.value[0].data = ["AA==", "base64"]; },
    s => { s.value[1].data = ["AA==", "base64"]; },
    s => { s.value[2] = null; },
    s => { delete s.context.slot; },
  ]) {
    const bad = structuredClone(snapshot); mutate(bad);
    await assert.rejects(verifyRouteProof(bad, 650240n, routes[34], web3));
  }
  assert.equal(new web3.PublicKey(accountBytes(deployment.value[0]).subarray(4)).toBase58(), PROGRAM_DATA);
});

test("SOL formatting and RPC inputs stay exact", () => {
  assert.equal(formatSol(57_057_786_001n), "57.057786001");
  assert.throws(() => lamports(Number.MAX_SAFE_INTEGER + 1), /invalid/);
  assert.throws(() => lamports(-1), /invalid/);
  assert.equal(validateRpcUrl("https://rpc.test/?api-key=secret#x"), "https://rpc.test/?api-key=secret");
  assert.equal(validateRpcUrl("http://localhost:8899"), "http://localhost:8899/");
  for (const bad of ["javascript:alert(1)", "http://example.com", "https://user:password@rpc.test/"]) assert.throws(() => validateRpcUrl(bad));
});

async function watch(replies, entry = { signature: "test", lastValidBlockHeight: 5 }) {
  const calls = [];
  let clock = 0;
  let index = 0;
  const rpc = { request: async (method) => {
    calls.push(method);
    if (method === "getBlockHeight") return 20;
    const value = replies[Math.min(index++, replies.length - 1)];
    if (value instanceof Error) throw value;
    return { value: [value] };
  } };
  const result = await watchSignature(rpc, entry, { now: () => clock, sleep: async () => { clock += 2500; }, timeout: 10_000 });
  return { result, calls };
}
test("confirmed transactions do not expire while finalization catches up", async () => {
  const { result, calls } = await watch([{ confirmationStatus: "confirmed", err: null }, null, { confirmationStatus: "finalized", err: null }]);
  assert.equal(result.state, "finalized");
  assert.ok(!calls.includes("getBlockHeight"));
});
test("expiry reconciliation finds a late landed transaction", async () => {
  const { result, calls } = await watch([null, { confirmationStatus: "confirmed", err: null }, null, { confirmationStatus: "finalized", err: null }]);
  assert.equal(result.state, "finalized");
  assert.equal(calls.filter(c => c === "getBlockHeight").length, 1);
});
test("missing status and RPC failure stay uncertain, not falsely successful", async () => {
  assert.equal((await watch([null])).result.state, "unknown");
  assert.equal((await watch([new Error("offline")])).result.state, "unknown");
  assert.equal((await watch([{ confirmationStatus: "finalized", err: { InstructionError: [0, "Custom"] } }])).result.state, "failed");
  const { calls } = await watch([null], { signature: "test" });
  assert.ok(!calls.includes("getBlockHeight"), "wallet-replaced blockhash has no trusted expiry height");
});
test("unfinalized errors cannot terminate tracking on a fork", async () => {
  assert.equal((await watch([{confirmationStatus:"processed",err:{InstructionError:[0,"Custom"]}}, {confirmationStatus:"finalized",err:null}])).result.state, "finalized");
  assert.equal((await watch([null, {confirmationStatus:"processed",err:{InstructionError:[0,"Custom"]}}, {confirmationStatus:"finalized",err:null}])).result.state, "finalized");
});
test("a send makes only one attempt; recovery owns any resend", async () => {
  let count=0;
  const rpc=new RpcClient("https://rpc.test", async()=> {count++; throw new TypeError("Lost reply");});
  await assert.rejects(rpc.sendTransaction(new Uint8Array(1)), /unreachable/);
  assert.equal(count,1);
});
test("RPC never interprets missing data as account absence or retries simulation failures", async () => {
  const rpc = new RpcClient("https://rpc.test", async () => ({ ok: true, json: async () => ({}) }));
  await assert.rejects(rpc.request("x", []), /no result/);
  let count = 0;
  rpc.fetcher = async () => { count++; return { ok: true, json: async () => ({ error: { code: -32002, message: "Simulation failed" } }) }; };
  await assert.rejects(rpc.request("sendTransaction", []), /Simulation failed/);
  assert.equal(count, 1);
  rpc.fetcher = async () => ({ ok: false, status: 403 });
  await assert.rejects(rpc.request("x", []), error => error.code === 403);
});
