/**
 * Helpers to talk to the ReliefRegistry contract.
 *
 * - Reads (eligibility checks, dashboard) use a plain JSON-RPC provider, so they work
 *   without a wallet.
 * - Writes (recording, coordinator actions) use MetaMask's signer.
 */
import { BrowserProvider, Contract, Interface, JsonRpcProvider, Network, type ContractRunner } from "ethers";
import abi from "../contracts/ReliefRegistry.abi.json";
import { CHAINS, getDeployment } from "./chains";

export const registryInterface = new Interface(abi);

// One read-only provider per chain, created on first use.
const readProviders = new Map<number, JsonRpcProvider>();

export function getReadProvider(chainId: number): JsonRpcProvider {
  let provider = readProviders.get(chainId);
  if (!provider) {
    const chain = CHAINS[chainId];
    if (!chain) throw new Error(`Unknown chain ${chainId}`);
    // staticNetwork: we already know the chain, so ethers doesn't keep re-detecting it
    // (which would spam errors when the local node is not running).
    provider = new JsonRpcProvider(chain.rpcUrl, chainId, { staticNetwork: Network.from(chainId) });
    readProviders.set(chainId, provider);
  }
  return provider;
}

function makeContract(chainId: number, runner: ContractRunner): Contract {
  const deployment = getDeployment(chainId);
  if (!deployment) throw new Error(`ReliefRegistry is not deployed on chain ${chainId}`);
  return new Contract(deployment.address, abi, runner);
}

/** Contract instance for view calls and simulations (no wallet needed). */
export function getReadContract(chainId: number): Contract {
  return makeContract(chainId, getReadProvider(chainId));
}

// The wallet found by useWallet (window.ethereum or one announced via EIP-6963).
let walletProvider: EthereumProvider | undefined;

export function setWalletProvider(provider: EthereumProvider): void {
  walletProvider = provider;
}

/** Contract instance connected to the MetaMask account, for sending transactions. */
export async function getWriteContract(chainId: number): Promise<Contract> {
  const provider = walletProvider ?? window.ethereum;
  if (!provider) throw new Error("MetaMask is not installed");
  const signer = await new BrowserProvider(provider).getSigner();
  return makeContract(chainId, signer);
}
