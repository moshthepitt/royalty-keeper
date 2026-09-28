# Withdrawal site checks

Checked locally on 2026-09-28. No transactions were signed or sent, and this release has not been published.

## Automated checks

`npm test`: 14 tests passed. Covers all 66 instruction layouts, payout rounding and rent reserves, catalog validation, the deployed-code fixture, RPC failures, and transaction confirmation recovery. The original 33 route objects retain their reviewed snapshot hash. A separate comparison confirmed Moran's existing route and the new Souls and Nova5 routes match their audited manifests.

`npm run test:browser`: passed in Chromium with mocked RPCs and wallets. It checks:

- Five cold-load requests and no RPC request until an action needs one.
- Optional balances, failed lookups, custom RPCs, fallback and competing responses.
- Injected and Wallet Standard Phantom and Backpack adapters.
- Rejection, account changes, wallet timeouts and fresh blockhash preparation.
- Saved signatures, reload recovery and rebroadcast of identical signed bytes after an ambiguous response.
- Expiration checks that do not treat a landed transaction as missing.
- Root and GitHub Pages project paths, search, and desktop and mobile layouts.
- Cached old HTML loading the current script: a reload link replaces the incompatible page before any wallet action.

Versioned app, style and catalog URLs prevent old assets being reused with the new page. Bump `SITE_VERSION` and the matching HTML URLs together when publishing changed assets.

An independent code review found the cached-page incompatibility. That fix passed a second review and browser test run; no findings remained.

## Mainnet reads and unsigned simulations

At finalized slot 451251672, all 66 royalty accounts passed the source-owner, data and reserve checks. The deployed code matched the release pinned in `app.js`. The public program-account snapshot is saved in `tests/fixtures/deployment.json`.

Of 66 unsigned withdrawal simulations, 57 passed. Nine failed Solana's `InsufficientFundsForRent` check at a configured payout destination: Cowdy Cactus, Turtle Trader, Nobu Ninjas (route 25), Cow Mafia, NFTendo, Dapper Dolphins, Super Santa Christmas Club, Sanctuary and Cvivors. Each source had only 240,640 lamports available above live rent. The site explains the simulation failure; it does not fund destinations or change payouts.

A clean browser loaded all 66 live balances through the public fallback and prepared Moran's unsigned withdrawal. A public-key-only wallet mock was used; its signing method was never called.

These checks do not replace an end-to-end test with a real wallet extension. The wallet adapters and recovery paths were tested with mocks. Mainnet balances and account rent requirements can change after this snapshot.
