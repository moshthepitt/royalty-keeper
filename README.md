# Royalty Keeper withdrawals

A deliberately boring, static interface for withdrawing native-SOL royalties from 33 frozen Royalty Keeper routes.

There is no build step, application server, database, analytics, or secret-key input. GitHub Pages can serve the repository root as-is. The browser connects directly to a Solana mainnet RPC and to Phantom or Backpack.

## Run locally

Wallet extensions require a web origin. Serve the files instead of opening `index.html` directly:

```sh
python3 -m http.server 4175
```

Then open <http://localhost:4175>.

## Publish with GitHub Pages

In the repository settings, choose **Pages → Deploy from a branch → `main` / root**. No Actions workflow or package installation is needed.

## What a withdrawal does

The connected wallet is only the fee payer. It does not select or authenticate royalty recipients.

For the chosen route, the page:

1. downloads the Keeper Program, ProgramData, and royalty PDA in one RPC snapshot;
2. checks the ProgramData link, exact 22,608-byte ELF SHA-256, PDA owner, zero data length, and rent reserve;
3. constructs one Keeper `SWEEP` instruction containing the frozen PDA and frozen ordered recipients;
4. simulates the exact unsigned transaction;
5. asks the wallet to sign and rejects any changed message;
6. simulates the signed transaction, rechecks unchanged onchain inputs, broadcasts the same bytes, and waits for finalization.

Every successful withdrawal leaves the current zero-data rent reserve in the PDA. Routes with historical floor-rounding behavior may also retain a few lamports of rounding dust.

The Keeper currently retains an upgrade authority. This release therefore pins its exact reviewed ELF and refuses to withdraw if the onchain code changes. A deliberate reviewed website release is required after any Keeper upgrade.

## Balances and RPC endpoints

The table renders immediately in ordinary English alphabetical order. Balance loading is asynchronous and optional: an unavailable or rate-limited RPC does not remove the routes or wallet controls. A withdrawal always performs its own fresh safety proof and simulation.

The default endpoint is Solana's public mainnet RPC. A user may enter a custom HTTPS endpoint; it is kept only in the current tab and is never written to storage. The endpoint must permit browser CORS requests. Treat URLs containing API keys as secrets even though the field is masked and this page sends no referrer.

## Frozen inputs

- Keeper program: `KeEPA4MrRF45wBAwsJRGHwumd3LiRubpcvyZjMAMRvS`
- Keeper ProgramData: `BH7uPpKQBLArB59EJ9tZC8bm6sWzNXVroCz2XmRDwnnA`
- Keeper ELF SHA-256: `9cf01c79d55d031db9449155ed67e4ce30089c474226c8423fb8fc38871876c1`
- Vendored Solana Web3.js: `1.98.4`
- Vendored minified file SHA-256: `09cdbea951b2ed0e11bcbe3aeb1ee9f035f9fb51ed212aca645475ae82688cc3`

The route PDA, recipient order, basis points, and legacy remainder behavior live in `routes.js`. They must be changed only from an audited Keeper manifest. The vendored library license is in `vendor/solana-web3-LICENSE`.

## Maintenance rule

Keep this repository static and dependency-free at runtime. Do not replace the vendored browser library with a CDN URL. Review and test any change to routes, transaction construction, Keeper identity, or code hash before publishing it.
