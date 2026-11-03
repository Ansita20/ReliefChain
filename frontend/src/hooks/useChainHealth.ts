/**
 * Is the node reachable, and is our contract really deployed there?
 * Catches the two most common demo problems:
 *   - the local node isn't running
 *   - the node was restarted, so the old contract address is now empty (needs re-deploy)
 */
import { useEffect, useState } from "react";
import { getDeployment } from "../lib/chains";
import { getReadProvider } from "../lib/contract";

export type ChainHealth = "checking" | "ok" | "not-deployed" | "no-contract" | "unreachable";

export function useChainHealth(chainId: number): ChainHealth {
  const [health, setHealth] = useState<ChainHealth>("checking");

  useEffect(() => {
    let cancelled = false;
    const deployment = getDeployment(chainId);

    async function check() {
      if (!deployment) {
        setHealth("not-deployed");
        return;
      }
      try {
        const code = await getReadProvider(chainId).getCode(deployment.address);
        if (!cancelled) setHealth(code === "0x" ? "no-contract" : "ok");
      } catch {
        if (!cancelled) setHealth("unreachable");
      }
    }

    setHealth("checking");
    check();
    const timer = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [chainId]);

  return health;
}
