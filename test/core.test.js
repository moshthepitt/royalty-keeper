import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  alphabeticalRoutes,
  base58Encode,
  expectedPayouts,
  formatSol,
  publicRpcLabel,
  sweepDescriptor,
  validateRoutes,
  validateRpcUrl,
} from "../core.js";
import {
  KEEPER_ELF_BYTES,
  KEEPER_ELF_SHA256,
  KEEPER_PROGRAM_DATA_ADDRESS,
} from "../config.js";
import { KEEPER_PROGRAM_ADDRESS, ROUTES } from "../routes.js";

test("frozen Keeper release and all 33 routes validate", () => {
  assert.doesNotThrow(() => validateRoutes(ROUTES));
  assert.equal(ROUTES.length, 33);
  assert.equal(KEEPER_PROGRAM_ADDRESS, "KeEPA4MrRF45wBAwsJRGHwumd3LiRubpcvyZjMAMRvS");
  assert.equal(KEEPER_PROGRAM_DATA_ADDRESS, "BH7uPpKQBLArB59EJ9tZC8bm6sWzNXVroCz2XmRDwnnA");
  assert.equal(KEEPER_ELF_BYTES, 22_608);
  assert.equal(KEEPER_ELF_SHA256, "9cf01c79d55d031db9449155ed67e4ce30089c474226c8423fb8fc38871876c1");
});

test("the complete named route manifest matches its reviewed snapshot", () => {
  assert.equal(
    createHash("sha256").update(JSON.stringify(ROUTES)).digest("hex"),
    "991d65b9d32a60b32700def9bd64f723d1da2004fd5d3dc8183108247b047041",
  );
});

test("collections use ordinary stable English alphabetical order", () => {
  const ordered = alphabeticalRoutes(ROUTES);
  const names = ordered.map(({ name }) => name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  assert.deepEqual(ordered.filter(({ name }) => name === "Nobu Ninjas").map(({ id }) => id), [25, 31]);
  assert.deepEqual(ordered.filter(({ name }) => name === "Super Santa Christmas Club").map(({ id }) => id), [11, 29]);
});

test("every sweep descriptor contains only the frozen source and ordered recipients", () => {
  for (const route of ROUTES) {
    const descriptor = sweepDescriptor(route, KEEPER_PROGRAM_ADDRESS);
    assert.equal(descriptor.program, KEEPER_PROGRAM_ADDRESS);
    assert.deepEqual(descriptor.accounts, [route.sourceAddress, ...route.recipients.map(({ address }) => address)]);
    assert.deepEqual([...descriptor.data], [1, route.id]);
  }
});

test("standard remainder routes distribute the complete rent surplus", () => {
  const route = ROUTES.find(({ remainderIndex }) => remainderIndex === 0);
  const result = expectedPayouts(route, 1_000_003n, 890_880n);
  assert.equal(result.surplus, 109_123n);
  assert.equal(result.distributed, 109_123n);
  assert.equal(result.retained, 0n);
  assert.equal(result.payouts.reduce((sum, amount) => sum + amount, 0n), result.surplus);
});

test("legacy floor-rounding routes retain only undistributed dust", () => {
  const route = ROUTES.find(({ remainderIndex }) => remainderIndex === null);
  assert.ok(route, "fixture must contain a legacy floor-rounding route");
  const result = expectedPayouts(route, 890_881n, 890_880n);
  assert.equal(result.surplus, 1n);
  assert.equal(result.distributed, 0n);
  assert.equal(result.retained, 1n);
});

test("a PDA at or below rent has no distributable balance", () => {
  const result = expectedPayouts(ROUTES[0], 890_880n, 890_880n);
  assert.deepEqual(result, { surplus: 0n, payouts: [0n, 0n], distributed: 0n, retained: 0n });
});

test("SOL formatting is exact and does not use floating point", () => {
  assert.equal(formatSol(0n), "0");
  assert.equal(formatSol(1n), "0.000000001");
  assert.equal(formatSol(1_234_500_000n), "1.2345");
  assert.equal(formatSol(12_000_000_000_000n), "12,000");
});

test("base58 encoding handles leading zeroes and known bytes", () => {
  assert.equal(base58Encode(Uint8Array.of()), "");
  assert.equal(base58Encode(Uint8Array.of(0)), "1");
  assert.equal(base58Encode(Uint8Array.of(0, 0, 1)), "112");
  assert.equal(base58Encode(new TextEncoder().encode("Hello World")), "JxF12TrwUP45BMd");
});

test("RPC URLs require HTTPS except on loopback and labels omit paths and keys", () => {
  assert.equal(validateRpcUrl("https://rpc.example/path?api-key=secret"), "https://rpc.example/path?api-key=secret");
  assert.equal(publicRpcLabel("https://rpc.example/path?api-key=secret"), "rpc.example");
  assert.equal(validateRpcUrl("http://localhost:8899"), "http://localhost:8899/");
  assert.throws(() => validateRpcUrl("http://rpc.example"), /HTTPS/u);
  assert.throws(() => validateRpcUrl("file:///tmp/rpc"), /HTTPS/u);
});

test("vendored browser library is the reviewed artifact", async () => {
  const bytes = await readFile(new URL("../vendor/solana-web3-1.98.4.min.js", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "09cdbea951b2ed0e11bcbe3aeb1ee9f035f9fb51ed212aca645475ae82688cc3");
});
