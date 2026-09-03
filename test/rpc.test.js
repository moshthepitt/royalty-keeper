import assert from "node:assert/strict";
import test from "node:test";

import { RpcClient } from "../rpc.js";

function response({ ok = true, status = 200, result, error }) {
  return {
    ok,
    status,
    async json() { return { jsonrpc: "2.0", id: 1, result, error }; },
  };
}

test("RPC retries transient HTTP failure and preserves request semantics", async () => {
  const requests = [];
  const replies = [response({ ok: false, status: 429 }), response({ result: { value: 42 } })];
  const rpc = new RpcClient("https://rpc.example", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return replies.shift();
  });
  const result = await rpc.request("example", [1], { attempts: 2 });
  assert.deepEqual(result, { value: 42 });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ method }) => method === "example"));
});

test("non-transient RPC errors fail without retry", async () => {
  let calls = 0;
  const rpc = new RpcClient("https://rpc.example", async () => {
    calls += 1;
    return response({ error: { code: -32602, message: "bad params" } });
  });
  await assert.rejects(rpc.request("example", [], { attempts: 3 }), /bad params/u);
  assert.equal(calls, 1);
});

test("freshness slots are forwarded to blockhash and simulation requests", async () => {
  const bodies = [];
  const rpc = new RpcClient("https://rpc.example", async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response({ result: {} });
  });
  await rpc.getLatestBlockhash(123);
  await rpc.simulateTransaction(Uint8Array.of(1, 2, 3), true, 456);
  assert.equal(bodies[0].params[0].minContextSlot, 123);
  assert.equal(bodies[1].params[1].minContextSlot, 456);
  assert.equal(bodies[1].params[1].sigVerify, true);
});
