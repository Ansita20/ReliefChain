/**
 * MetaMask connection, shared by the whole app through React context.
 *
 * It also decides which chain the app reads from:
 *   - the wallet's chain, if a wallet is connected to a supported network
 *   - otherwise DEFAULT_CHAIN_ID (so the public dashboard works without a wallet)
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CHAINS, DEFAULT_CHAIN_ID, LOCAL_CHAIN_ID, isSupportedChain } from "../lib/chains";
import { friendlyError } from "../lib/errors";
import { setWalletProvider } from "../lib/contract";

interface WalletContextValue {
  hasWallet: boolean; // is MetaMask (or another injected wallet) installed?
  account: string | null;
  walletChainId: number | null;
  appChainId: number; // the chain the app reads from
  wrongNetwork: boolean; // connected, but to a network we don't support
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchChain: (chainId: number) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [ethereum, setEthereum] = useState<EthereumProvider | undefined>(() => window.ethereum);
  const [account, setAccount] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Find the wallet. Most wallets set window.ethereum before the page loads, but some
  // only announce themselves via the EIP-6963 event, or inject a moment later.
  useEffect(() => {
    if (ethereum) {
      setWalletProvider(ethereum);
      setError(null);
      return;
    }
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as CustomEvent).detail ?? {};
      // Prefer MetaMask if several wallets are installed.
      if (provider && (info?.rdns === "io.metamask" || !window.ethereum)) setEthereum(provider);
    };
    const onInjected = () => window.ethereum && setEthereum(window.ethereum);

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.addEventListener("ethereum#initialized", onInjected);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const timer = setTimeout(onInjected, 1500);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.removeEventListener("ethereum#initialized", onInjected);
      clearTimeout(timer);
    };
  }, [ethereum]);

  // On load: silently check whether the site is already connected (no popup),
  // and listen for the user switching account or network in MetaMask.
  useEffect(() => {
    if (!ethereum) return;
    const onAccounts = (accounts: string[]) => setAccount(accounts[0] ?? null);
    const onChain = (hexId: string) => setWalletChainId(Number(hexId));

    ethereum.request({ method: "eth_accounts" }).then((a) => onAccounts(a as string[])).catch(() => {});
    ethereum.request({ method: "eth_chainId" }).then((c) => onChain(c as string)).catch(() => {});

    ethereum.on("accountsChanged", onAccounts);
    ethereum.on("chainChanged", onChain);
    return () => {
      ethereum.removeListener("accountsChanged", onAccounts);
      ethereum.removeListener("chainChanged", onChain);
    };
  }, [ethereum]);

  const switchChain = useCallback(
    async (chainId: number) => {
      if (!ethereum) return;
      const hexId = `0x${chainId.toString(16)}`;
      setError(null);
      try {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      } catch (err) {
        // MetaMask doesn't know the local network yet (usually error 4902, but some versions
        // report it differently), so offer to add it. 4001 means the user pressed Reject.
        // Sepolia is built into MetaMask, but other wallets may need it added too.
        const rejected = (err as { code?: number }).code === 4001;
        const chain = CHAINS[chainId];
        if (!rejected && chain) {
          try {
            await ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: hexId,
                  chainName: chain.name,
                  rpcUrls: [chain.walletRpcUrl],
                  nativeCurrency: { name: chainId === LOCAL_CHAIN_ID ? "Ether" : "Sepolia Ether", symbol: "ETH", decimals: 18 },
                  ...(chain.explorerUrl ? { blockExplorerUrls: [chain.explorerUrl] } : {}),
                },
              ],
            });
          } catch (addErr) {
            setError(friendlyError(addErr));
          }
        } else {
          setError(friendlyError(err));
        }
      }
    },
    [ethereum],
  );

  const connect = useCallback(async () => {
    if (!ethereum) {
      setError(
        "No wallet found in this browser. To record distributions, open this page in Chrome, Brave, Edge or " +
          "Firefox with the MetaMask extension installed (metamask.io), then reload. " +
          "The Dashboard and eligibility checks work without a wallet.",
      );
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(accounts[0] ?? null);
      const chainId = Number(await ethereum.request({ method: "eth_chainId" }));
      setWalletChainId(chainId);
      // Connected on the wrong network: ask MetaMask to switch right away
      // (the "Switch to …" banner stays as a fallback if the user dismisses it).
      if (!isSupportedChain(chainId)) await switchChain(DEFAULT_CHAIN_ID);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setConnecting(false);
    }
  }, [ethereum, switchChain]);

  const value = useMemo<WalletContextValue>(() => {
    const supported = isSupportedChain(walletChainId);
    return {
      hasWallet: Boolean(ethereum),
      account,
      walletChainId,
      appChainId: account && supported ? walletChainId : DEFAULT_CHAIN_ID,
      wrongNetwork: Boolean(account) && !supported,
      connecting,
      error,
      connect,
      switchChain,
    };
  }, [ethereum, account, walletChainId, connecting, error, connect, switchChain]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
