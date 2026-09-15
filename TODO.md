# Deferred: publish Moran, Souls and Nova5 withdrawals

Updated 2026-09-15 after Nova5 retirement. Moran, Souls and Nova5 migrations and old-program closures are complete. The user has deferred this site work; resume only when requested. This note does not authorize a withdrawal or publication.

The local site already includes Moran Masks (route 33). Souls (route 34) and the 31 Nova5 PDAs (routes 35–65) still need rows. The target is 66 routes, including the unchanged original 33. Check the local changes against the published repository before deciding what remains to ship.

## Saved inputs

The audited addresses and payout rules are already local; no collection rediscovery is needed:

- Moran: `../royalty-keeper/routes/moran.json`.
- Souls: `../royalty-keeper/routes/souls.json`.
- All 31 Nova5 PDAs: `../royalty-keeper/routes/nova5.json`; generated browser-compatible route data is in `../royalty-keeper/client/src/nova5-routes.js`.
- Nova5 withdrawal instruction reference: `../royalty-keeper/client/src/nova5.js`. It uses the existing permissionless sweep ABI, with the source PDA supplied as an account. No migration or new Keeper instruction is needed for the site update.

The deployed 26,848-byte Keeper ELF is pinned in `../royalty-keeper/routes/nova5-release.json` with SHA-256 `ded1d708f98c6f75389945024424737d69b95ead04a43b95e7a138fc556cd620`. That frozen build file still labels itself a local candidate; deployment/closeout evidence takes precedence over its historical status label. The console's finalized inspection at slot 447294736 recorded Nova5 closed, all 31 royalty PDAs handed off, zero remaining state accounts and no pending worker transaction. Reuse cached evidence and make only bounded fresh reads when this task resumes.

## Work to do

1. Compare the existing Moran configuration with its manifest; add Souls and all 31 Nova5 routes from the saved inputs above. Preserve route IDs, exact PDA addresses, recipient order, payout rounding and rent floors. Keep each route separate even when collection names repeat. Sort the 66 rows by ordinary English collection name, with no custom tiebreaker.
2. Update the site's reviewed program-release pin for the deployed Nova5-capable Keeper. Check exact ELF bytes, the 33 newly supported PDA owners and their reserves with bounded, cached mainnet reads. No further program upgrade or migration is planned for this UI release. The current site only accepts older Keeper hashes, so adding rows alone will not restore withdrawals for any collection.
3. Test all original 33 routes plus Moran, Souls and Nova5. Compare instruction accounts/data and payout results against the audited client and program tests. Cover one and multiple recipients, Nova5's retained rounding dust, zero/small balances, repeat deposits/withdrawals and preservation of the rent reserve. Keep balance loading optional and asynchronous. Test RPC failure/fallback, wallet rejection and compute-budget edits, and confirmation when a transaction lands near blockhash expiry. A lower Keeper reserve is a separate deferred task; use the deployed rules until that change is explicitly approved and tested.
4. Browser-QA the table and withdrawal flow on desktop and mobile layouts with Phantom/Backpack mocks. Keep the existing utilitarian design: wallet controls in the header, collection name, balance and Withdraw. Recipient details and Keeper terminology stay out of the user-facing table. Use simulations for live checks; a real withdrawal needs a separate request.
5. Update the README's route count and outdated rollout notes. Keep the official Solana mainnet RPC default, visible fallback and custom RPC option. Preserve static GitHub Pages hosting; no backend, new dependency or transaction-v1 migration is needed just to add these rows. Review the diff, commit, and publish to the existing GitHub Pages repository only when the user authorizes publication. Verify the hosted version and all 66 rows after deployment.

The old published site's code-hash pin may reject withdrawals after the Keeper upgrade, including withdrawals for the original collections. Confirm what is actually hosted when resuming; shipping the reviewed 66-route release support is part of this task.

Done means all 66 routes pass tests, the approved site release is published and checked, and the original collections still work. Keep the site static and self-contained. Worker keys, RPC secrets and retirement controls do not belong in this repository.
