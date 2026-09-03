import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("page uses only repository-local scripts and styles", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(urls.length >= 3);
  assert.ok(urls.every((url) => url.startsWith("./")), urls.join(", "));
  assert.match(html, /Content-Security-Policy/iu);
  assert.match(html, /No analytics · No backend · No secret-key access/u);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/iu);
  assert.doesNotMatch(html, /<style/iu);
});

test("withdrawal UI has no migration, loader, authority-key, or storage machinery", async () => {
  const sources = await Promise.all(["app.js", "keeper.js", "wallets.js", "rpc.js"].map((name) => readFile(new URL(name, root), "utf8")));
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /localStorage|sessionStorage|indexedDB/iu);
  assert.doesNotMatch(joined, /Keypair|secretKey/iu);
  assert.doesNotMatch(joined, /BPFLoaderUpgradeab1e.*(?:upgrade|close)/iu);
  assert.doesNotMatch(joined, /assign|handoff/iu);
});
