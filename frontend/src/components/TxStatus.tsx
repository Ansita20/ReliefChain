import type { TxState } from "../hooks/useTx";
import { txUrl } from "../lib/chains";
import { shortHash } from "../lib/format";

const TEXT: Record<TxState["stage"], string> = {
  idle: "",
  simulating: "Checking with the contract…",
  wallet: "Confirm the transaction in MetaMask…",
  pending: "Transaction sent. Waiting for it to be mined…",
  confirmed: "Confirmed on-chain",
  failed: "Failed",
};

/** Progress line for a transaction, with an Etherscan link on Sepolia. */
export function TxStatus({ tx, chainId, onDismiss }: { tx: TxState; chainId: number; onDismiss?: () => void }) {
  if (tx.stage === "idle") return null;
  const link = tx.hash ? txUrl(chainId, tx.hash) : null;
  const busy = tx.stage === "simulating" || tx.stage === "wallet" || tx.stage === "pending";

  return (
    <div className={`tx tx-${tx.stage}`} role="status" aria-live="polite">
      <span className="tx-icon" aria-hidden="true">
        {busy ? <span className="spinner" /> : tx.stage === "confirmed" ? "✓" : "✕"}
      </span>
      <div className="tx-body">
        <div>
          <strong>{tx.label}:</strong> {TEXT[tx.stage]}
        </div>
        {tx.error && <div className="tx-error">{tx.error}</div>}
        {tx.hash && (
          <div className="tx-hash">
            Tx{" "}
            {link ? (
              <a href={link} target="_blank" rel="noreferrer">
                {shortHash(tx.hash)} on Etherscan ↗
              </a>
            ) : (
              <code>{shortHash(tx.hash)}</code>
            )}
          </div>
        )}
      </div>
      {!busy && onDismiss && (
        <button className="tx-close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
