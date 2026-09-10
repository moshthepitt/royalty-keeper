# Deferred: publish Moran and Souls withdrawals

Recorded 2026-09-10. Both migrations and old-program closures are complete. The user has deferred this site work; resume only when requested.

The local site already includes Moran Masks (route 33) and accepts the combined Moran/Souls program release. Souls (route 34) still needs a row. Check the local changes against the published repository before deciding what remains to ship.

## Work to do

1. Compare the existing Moran configuration with `../royalty-keeper/routes/moran.json`. Add Souls from `../royalty-keeper/routes/souls.json`. Preserve those manifests' PDA addresses, recipient order, payout rounding and rent floors. The table should contain 35 routes in ordinary English alphabetical order.
2. Confirm the site's accepted program hash matches the deployed combined release recorded in `../royalty-keeper/README.md`. Check both royalty PDAs with bounded, cached mainnet reads. The closeout evidence is in `../royalty-keeper/MORAN.md` and `../royalty-keeper/SOULS.md`. No further program upgrade or migration is planned for this UI release.
3. Test all original 33 routes plus Moran and Souls. Cover instruction accounts/data, payout rounding and preservation of the rent reserve. Keep balance loading optional and asynchronous. Test RPC failure/fallback, wallet rejection and compute-budget edits, and confirmation when a transaction lands near blockhash expiry.
4. Browser-QA the table and withdrawal flow on desktop and mobile layouts with Phantom/Backpack mocks. Keep the existing utilitarian design: wallet controls in the header, collection name, balance and Withdraw. Recipient details and Keeper terminology stay out of the user-facing table. Use simulations for live checks; a real withdrawal needs a separate request.
5. Update the README's route count and outdated rollout notes. Review the diff, commit, and publish to the existing GitHub Pages repository only when the user authorizes publication. Verify the hosted version and all 35 rows after deployment.

The old published site's code-hash pin may reject withdrawals after the Keeper upgrade, including withdrawals for the original collections. Confirm what is actually hosted when resuming; shipping the reviewed combined-release support is part of this task.

Done means all 35 routes pass tests, the approved site release is published and checked, and the original collections still work. Keep the site static and self-contained. Worker keys, RPC secrets and retirement controls do not belong in this repository.
