/**
 * Keep an up-to-date list of all contract events.
 * Loads the full history once, then asks for new blocks every few seconds.
 */
import { useEffect, useState } from "react";
import { getDeployment } from "../lib/chains";
import { getReadProvider } from "../lib/contract";
import { fetchEvents, type RegistryEvent } from "../lib/events";

const POLL_MS = 4_000;

export function useRegistryEvents(chainId: number) {
  const [events, setEvents] = useState<RegistryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deployment = getDeployment(chainId);
    setEvents([]);
    setLoading(true);
    setError(null);

    if (!deployment) {
      setLoading(false);
      setError("The contract is not deployed on this network.");
      return;
    }

    let nextBlock = deployment.deployBlock; // first block we haven't read yet

    async function poll() {
      try {
        const latest = await getReadProvider(chainId).getBlockNumber();
        if (latest >= nextBlock) {
          const fresh = await fetchEvents(chainId, nextBlock, latest);
          if (cancelled) return;
          nextBlock = latest + 1;
          if (fresh.length > 0) setEvents((prev) => [...prev, ...fresh]);
        }
        if (!cancelled) {
          setError(null);
          setLastUpdated(new Date());
        }
      } catch {
        if (!cancelled) setError("Could not load events from the blockchain. Retrying…");
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(poll, POLL_MS);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chainId]);

  return { events, loading, error, lastUpdated };
}
