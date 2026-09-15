# NFT royalty withdrawals

A static interface for withdrawing native-SOL royalties from 34 configured NFT collections.

There is no build step, application server, database, analytics, or secret-key input. GitHub Pages can serve the repository root as-is. The browser connects directly to a Solana mainnet RPC and to Phantom or Backpack.

For the deferred Moran, Souls and Nova5 site release, read [TODO.md](TODO.md) before changing routes or publishing. The deployed Keeper now has 66 routes; this local site's rows and accepted code hashes have not yet been updated for that release.

## Run locally

Wallet extensions require a web origin. Serve the files instead of opening `index.html` directly:

```sh
python3 -m http.server 4175
```

Then open <http://localhost:4175>.

## Publish with GitHub Pages

In the repository settings, choose **Pages → Deploy from a branch → `main` / root**. No Actions workflow or package installation is needed.

## What a withdrawal does

The connected wallet pays the network fee and approves the transaction.

For the chosen collection, the page:

1. downloads the withdrawal program, its ProgramData, and the royalty account in one RPC snapshot;
2. checks the ProgramData link, a reviewed ELF SHA-256 with zero-only loader padding, account owner, zero data length, and rent reserve;
3. constructs one withdrawal instruction containing the configured royalty account and recipients;
4. simulates the exact unsigned transaction;
5. asks the wallet to review and sign the transaction;
6. simulates the signed transaction, rechecks unchanged onchain inputs, broadcasts the same bytes, and waits for finalization.

The wallet may add compute-budget settings. The site accepts those edits and simulates the returned signed transaction.

Every successful withdrawal leaves the current zero-data rent reserve in the royalty account. Moran Masks also retains its legacy 890,880-lamport minimum when that is higher. Collections with historical floor rounding may retain a few lamports.

The onchain program currently retains an upgrade authority. This site pins the reviewed ELF and refuses to withdraw if that code changes. Updating the program requires a reviewed site release.

## Balances and RPC endpoints

The table renders immediately in ordinary English alphabetical order. Balance loading is asynchronous and optional: an unavailable or rate-limited RPC does not remove the routes or wallet controls. A withdrawal always performs its own fresh safety proof and simulation.

The page tries [Solana's public mainnet RPC](https://solana.com/docs/references/clusters) first. If that endpoint rejects the browser request, the page visibly switches to [PublicNode's public Solana RPC](https://publicnode.com/). A custom HTTPS endpoint is kept only in the current tab and is never replaced automatically. The endpoint must permit browser CORS requests. Treat URLs containing API keys as secrets even though the field is masked and this page sends no referrer.

## Frozen inputs

- Withdrawal program: `KeEPA4MrRF45wBAwsJRGHwumd3LiRubpcvyZjMAMRvS`
- ProgramData: `BH7uPpKQBLArB59EJ9tZC8bm6sWzNXVroCz2XmRDwnnA`
- Original 22,608-byte ELF SHA-256: `9cf01c79d55d031db9449155ed67e4ce30089c474226c8423fb8fc38871876c1`
- Moran/Souls-capable 23,208-byte ELF SHA-256: `eeac65ff218403ee8b13f8a34941ecba3e6214bf26bc8a9442e9c317358825eb`
- Vendored Solana Web3.js: `1.98.4`
- Vendored minified file SHA-256: `09cdbea951b2ed0e11bcbe3aeb1ee9f035f9fb51ed212aca645475ae82688cc3`

The royalty account, recipient order, basis points, and legacy remainder behavior live in `routes.js`. Change them only from the audited manifest. The vendored library license is in `vendor/solana-web3-LICENSE`.

During Moran rollout, both reviewed program releases are accepted. The original
release supports routes 0–32; Moran route 33 requires the new release and its
royalty account must already be migrated. Publish this site update last, after
both Moran and Souls migrations are complete and verified. Until publication,
the old site's code-hash check will refuse withdrawals once Keeper is upgraded,
including for existing collections. The updated local page remains usable.
The candidate also supports Souls route 34. Its public row is deferred until
the separate Souls migration; this update does not change the Souls program.

## Maintenance rule

Keep this repository static and dependency-free at runtime. Do not replace the vendored browser library with a CDN URL. Review and test any change to the manifest, transaction construction, program identity, or code hash before publishing it.
