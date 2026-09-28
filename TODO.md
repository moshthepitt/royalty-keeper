# Withdrawal site release

Published on 2026-09-28: [withdrawal site](https://moshthepitt.github.io/royalty-keeper/). Application release: `22c4498`.

The site now includes all 66 routes: original 33, Moran Masks, Souls, and 31 Nova5 royalty accounts. Their audited sources and payout rules are in `catalog.json`. The original 33 route objects retain their reviewed snapshot hash. No onchain program, royalty split or rent floor was changed.

The current 26,848-byte deployed release is pinned in `app.js` with SHA-256 `ded1d708f98c6f75389945024424737d69b95ead04a43b95e7a138fc556cd620`. The test fixture contains the public program accounts read at finalized slot 451251672. The site checks only the chosen route and deployed code when preparing a withdrawal; opening the page performs no RPC request.

## Publication checks

CI and Pages deployment passed. A clean browser loaded all 66 rows in five requests, fetched all balances through the public fallback, and prepared Moran's unsigned withdrawal. Hosted assets matched the tested files. No transactions were signed or sent. See [QA.md](QA.md) for test coverage and limits.

## Separate backlog

Moran, Souls and Nova5 retain their deployed 890,880-lamport minimum when it exceeds live zero-data rent. Reducing that floor requires a separately approved onchain change and tests. This site uses the deployed rules.

Nine small original-route payouts currently fail Solana's destination-account rent check. The UI reports that during simulation. No automatic funding, changed destination or diverted payment is included.
