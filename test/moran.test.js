import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { expectedPayouts, validateRoutes } from "../core.js";
import { identifyKeeperRelease } from "../keeper.js";
import { ROUTES } from "../routes.js";

test("Moran preserves legacy reserve, payout split and all rounding lamports", () => {
  const route = ROUTES[33];
  assert.equal(route.name, "Moran Masks");
  assert.equal(route.reserveFloorLamports, 890880);
  for (const live of [810624n, 890880n, 1024000n]) {
    const reserve = live > 890880n ? live : 890880n;
    for (let dust = 0n; dust < 1000n; dust++) {
      const result = expectedPayouts(route, reserve + dust, live);
      assert.deepEqual(result.payouts, [dust - dust / 10n, dust / 10n]);
      assert.equal(result.distributed, dust);
    }
  }
  const bad = ROUTES.map((route) => ({ ...route }));
  bad[33].reserveFloorLamports = -1;
  assert.throws(() => validateRoutes(bad), /reserve floor/);
});

test("mixed deployment accepts either reviewed ELF with only zero padding", async () => {
  const old = Uint8Array.of(1, 2, 3), candidate = Uint8Array.of(4, 5, 6, 7);
  const releases = [old, candidate].map((bytes, i) => ({ bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), lastRoute: 32 + i }));
  for (const [i, bytes] of [old, candidate].entries()) {
    assert.equal((await identifyKeeperRelease(bytes, releases)).lastRoute, 32 + i);
    assert.equal((await identifyKeeperRelease(Uint8Array.from([...bytes, 0, 0]), releases)).lastRoute, 32 + i);
    await assert.rejects(identifyKeeperRelease(Uint8Array.from([...bytes, 0, 1]), releases), /code has changed/);
    await assert.rejects(identifyKeeperRelease(bytes.subarray(1), releases), /code has changed/);
  }
});
