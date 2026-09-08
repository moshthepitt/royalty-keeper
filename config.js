export const DEFAULT_RPC_URL = "https://api.mainnet.solana.com/";
export const FALLBACK_RPC_URL = "https://solana-rpc.publicnode.com/";
export const BALANCE_BATCH_SIZE = 10;
export const CHAIN = "solana:mainnet";
export const KEEPER_PROGRAM_DATA_ADDRESS = "BH7uPpKQBLArB59EJ9tZC8bm6sWzNXVroCz2XmRDwnnA";
export const KEEPER_ELF_BYTES = 22_608;
export const KEEPER_ELF_SHA256 = "9cf01c79d55d031db9449155ed67e4ce30089c474226c8423fb8fc38871876c1";
// Both sides of the Moran/Souls Keeper upgrade are accepted during rollout. The existing
// release remains usable before upgrade; unknown code is still rejected.
export const KEEPER_RELEASES = Object.freeze([
  { bytes: KEEPER_ELF_BYTES, sha256: KEEPER_ELF_SHA256, lastRoute: 32 },
  { bytes: 23_208, sha256: "eeac65ff218403ee8b13f8a34941ecba3e6214bf26bc8a9442e9c317358825eb", lastRoute: 34 },
]);
export const UPGRADEABLE_LOADER_ADDRESS = "BPFLoaderUpgradeab1e11111111111111111111111";
export const PROGRAM_DATA_METADATA_BYTES = 45;
export const RPC_TIMEOUT_MS = 20_000;
export const FINALIZATION_TIMEOUT_MS = 180_000;
export const REBROADCAST_INTERVAL_MS = 5_000;
