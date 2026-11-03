import { useWallet } from "../hooks/useWallet";
import { useChainHealth } from "../hooks/useChainHealth";
import { CHAINS, DEFAULT_CHAIN_ID, LOCAL_CHAIN_ID } from "../lib/chains";

/** Warnings shown across the top of every page: wrong network, node down, contract missing. */
export function NetworkBanner() {
  const { wrongNetwork, appChainId, switchChain, error } = useWallet();
  const health = useChainHealth(appChainId);
  const chainName = CHAINS[appChainId]?.name ?? `chain ${appChainId}`;

  return (
    <>
      {wrongNetwork && (
        <div className="banner banner-warn" role="alert">
          <span>
            <strong>Wrong network.</strong> Your wallet is on a network where ReliefChain is not deployed.
          </span>
          <button className="btn btn-sm" onClick={() => switchChain(DEFAULT_CHAIN_ID)}>
            Switch to {CHAINS[DEFAULT_CHAIN_ID]?.name}
          </button>
        </div>
      )}
      {health === "unreachable" && (
        <div className="banner banner-error" role="alert">
          <strong>Can't reach {chainName}.</strong>{" "}
          {appChainId === LOCAL_CHAIN_ID
            ? "Is the local node running? Start everything with `npm run dev:all`."
            : "The RPC node did not respond. Retrying…"}
        </div>
      )}
      {(health === "no-contract" || health === "not-deployed") && (
        <div className="banner banner-error" role="alert">
          <strong>Contract not found on {chainName}.</strong>{" "}
          {appChainId === LOCAL_CHAIN_ID
            ? "The local node was probably restarted. Run `npm run deploy:local` and `npm run seed:local`."
            : "Deploy it first with `npm run deploy:sepolia`."}
        </div>
      )}
      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
