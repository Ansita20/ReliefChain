/**
 * The networks this app knows about, and where the contract is deployed on each.
 *
 * Two sources, env first:
 *   1. VITE_CHAIN_ID + VITE_CONTRACT_ADDRESS (+ VITE_DEPLOY_BLOCK, VITE_RPC_URL) — used by
 *      hosted builds (e.g. Vercel). When VITE_CHAIN_ID is set, the app runs on that chain
 *      ONLY, so a stale local Hardhat entry can never be picked in production.
 *   2. deployments.json, written automatically by `npm run deploy:local` / `deploy:sepolia`
 *      — used for local development when no env vars are set.
 */
import deploymentsJson from "../contracts/deployments.json";

export interface ChainInfo {
  id: number;
  name: string;
  rpcUrl: string; // used by this app for read-only calls
  walletRpcUrl: string; // given to MetaMask when adding the network
  explorerUrl: string | null; // block explorer (Etherscan) if any
}

export interface Deployment {
  address: string;
  deployBlock: number;
}

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 11155111;

const env = import.meta.env;
const PUBLIC_SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

/** Chain pinned by VITE_CHAIN_ID, or null when not set (local dev). */
export const ENV_CHAIN_ID: number | null = (() => {
  const id = Number(env.VITE_CHAIN_ID);
  return Number.isInteger(id) && id > 0 ? id : null;
})();

/** VITE_RPC_URL overrides the RPC of the pinned chain. */
const rpcOverride = (chainId: number): string | undefined =>
  chainId === ENV_CHAIN_ID && env.VITE_RPC_URL ? env.VITE_RPC_URL : undefined;

export const CHAINS: Record<number, ChainInfo> = {
  [LOCAL_CHAIN_ID]: {
    id: LOCAL_CHAIN_ID,
    name: "Hardhat Local",
    // "/rpc" is proxied to http://127.0.0.1:8545 by the Vite server (see vite.config.ts)
    rpcUrl: rpcOverride(LOCAL_CHAIN_ID) || env.VITE_LOCAL_RPC_URL || `${window.location.origin}/rpc`,
    walletRpcUrl: "http://127.0.0.1:8545",
    explorerUrl: null,
  },
  [SEPOLIA_CHAIN_ID]: {
    id: SEPOLIA_CHAIN_ID,
    name: "Sepolia",
    rpcUrl: rpcOverride(SEPOLIA_CHAIN_ID) || env.VITE_SEPOLIA_RPC_URL || PUBLIC_SEPOLIA_RPC,
    walletRpcUrl: rpcOverride(SEPOLIA_CHAIN_ID) || PUBLIC_SEPOLIA_RPC,
    explorerUrl: "https://sepolia.etherscan.io",
  },
};

const deployments: Record<string, Deployment | undefined> = (() => {
  const fromFile = deploymentsJson as Record<string, Deployment | undefined>;
  if (ENV_CHAIN_ID === null) return fromFile;
  // Pinned chain: only that chain is known. Env address wins over the file.
  const address = env.VITE_CONTRACT_ADDRESS?.trim();
  const deployBlock = Number(env.VITE_DEPLOY_BLOCK);
  const entry = address
    ? { address, deployBlock: Number.isInteger(deployBlock) && deployBlock >= 0 ? deployBlock : 0 }
    : fromFile[String(ENV_CHAIN_ID)];
  return { [String(ENV_CHAIN_ID)]: entry };
})();

/** Where the contract lives on this chain, or null if it was never deployed there. */
export function getDeployment(chainId: number): Deployment | null {
  return deployments[String(chainId)] ?? null;
}

/** A chain is "supported" when we know it AND the contract has been deployed on it. */
export function isSupportedChain(chainId: number | null): chainId is number {
  return chainId !== null && chainId in CHAINS && getDeployment(chainId) !== null;
}

/** Chain used for reading before a wallet is connected, and the one we ask MetaMask to switch to. */
export const DEFAULT_CHAIN_ID: number = (() => {
  if (ENV_CHAIN_ID !== null) return ENV_CHAIN_ID;
  const fromEnv = Number(env.VITE_DEFAULT_CHAIN_ID);
  if (isSupportedChain(fromEnv)) return fromEnv;
  if (isSupportedChain(LOCAL_CHAIN_ID)) return LOCAL_CHAIN_ID;
  return SEPOLIA_CHAIN_ID;
})();

export function txUrl(chainId: number, hash: string): string | null {
  const explorer = CHAINS[chainId]?.explorerUrl;
  return explorer ? `${explorer}/tx/${hash}` : null;
}

export function addressUrl(chainId: number, address: string): string | null {
  const explorer = CHAINS[chainId]?.explorerUrl;
  return explorer ? `${explorer}/address/${address}` : null;
}
