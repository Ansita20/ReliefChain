/**
 * The networks this app knows about, and where the contract is deployed on each.
 * deployments.json is written automatically by `npm run deploy:local` / `deploy:sepolia`.
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

export const CHAINS: Record<number, ChainInfo> = {
  [LOCAL_CHAIN_ID]: {
    id: LOCAL_CHAIN_ID,
    name: "Hardhat Local",
    // "/rpc" is proxied to http://127.0.0.1:8545 by the Vite server (see vite.config.ts)
    rpcUrl: import.meta.env.VITE_LOCAL_RPC_URL || `${window.location.origin}/rpc`,
    walletRpcUrl: "http://127.0.0.1:8545",
    explorerUrl: null,
  },
  [SEPOLIA_CHAIN_ID]: {
    id: SEPOLIA_CHAIN_ID,
    name: "Sepolia",
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    walletRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
  },
};

const deployments = deploymentsJson as Record<string, Deployment | undefined>;

/** Where the contract lives on this chain, or null if it was never deployed there. */
export function getDeployment(chainId: number): Deployment | null {
  return deployments[String(chainId)] ?? null;
}

/** A chain is "supported" when we know it AND the contract has been deployed on it. */
export function isSupportedChain(chainId: number | null): chainId is number {
  return chainId !== null && chainId in CHAINS && getDeployment(chainId) !== null;
}

/** Chain used for reading before a wallet is connected. */
export const DEFAULT_CHAIN_ID: number = (() => {
  const fromEnv = Number(import.meta.env.VITE_DEFAULT_CHAIN_ID);
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
