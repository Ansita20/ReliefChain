/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Pins the app to one chain (e.g. 11155111 for Sepolia). Unset = local dev mode. */
  readonly VITE_CHAIN_ID?: string;
  /** ReliefRegistry address on VITE_CHAIN_ID (overrides src/contracts/deployments.json). */
  readonly VITE_CONTRACT_ADDRESS?: string;
  /** Block the contract was deployed in; event history is read from here. */
  readonly VITE_DEPLOY_BLOCK?: string;
  /** Read-only RPC for VITE_CHAIN_ID. */
  readonly VITE_RPC_URL?: string;
  readonly VITE_DEFAULT_CHAIN_ID?: string;
  readonly VITE_LOCAL_RPC_URL?: string;
  readonly VITE_SEPOLIA_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The provider MetaMask injects into the page. */
interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on(event: string, handler: (...args: any[]) => void): void;
  removeListener(event: string, handler: (...args: any[]) => void): void;
  isMetaMask?: boolean;
}

interface Window {
  ethereum?: EthereumProvider;
}
