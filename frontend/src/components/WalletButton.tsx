import { useWallet } from "../hooks/useWallet";
import { CHAINS } from "../lib/chains";
import { shortAddress } from "../lib/format";

/** Connect button / connected-account badge shown in the header. */
export function WalletButton() {
  const { hasWallet, account, walletChainId, wrongNetwork, connecting, connect } = useWallet();

  // No wallet extension in this browser: link to the MetaMask download page instead.
  if (!hasWallet) {
    return (
      <a className="btn btn-primary btn-sm" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Install MetaMask ↗
      </a>
    );
  }

  if (!account) {
    return (
      <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  const chainName = walletChainId !== null ? (CHAINS[walletChainId]?.name ?? `Chain ${walletChainId}`) : "";
  return (
    <div className={`wallet-badge ${wrongNetwork ? "wallet-badge-bad" : ""}`} title={account}>
      <span className="wallet-dot" aria-hidden="true" />
      <span className="wallet-text">
        <span className="wallet-address">{shortAddress(account)}</span>
        <span className="wallet-chain">{chainName}</span>
      </span>
    </div>
  );
}
