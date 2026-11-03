/** Load every campaign from the contract (re-checked every 10 seconds). */
import { useCallback, useEffect, useState } from "react";
import { getReadContract } from "../lib/contract";
import { decodeAidType } from "../lib/aidTypes";

export interface CampaignInfo {
  id: number;
  name: string;
  region: string;
  startTime: number; // unix seconds
  endTime: number;
  closed: boolean;
  aidTypes: string[]; // bytes32 values
  aidLabels: string[]; // decoded, e.g. "FOOD_KIT"
}

/** Same rule as the contract's isCampaignActive(), using the local clock. */
export function isActive(c: CampaignInfo): boolean {
  const now = Date.now() / 1000;
  return !c.closed && now >= c.startTime && now <= c.endTime;
}

export function campaignStatus(c: CampaignInfo): "Active" | "Closed" | "Not started" | "Ended" {
  const now = Date.now() / 1000;
  if (c.closed) return "Closed";
  if (now < c.startTime) return "Not started";
  if (now > c.endTime) return "Ended";
  return "Active";
}

export function useCampaigns(chainId: number) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const contract = getReadContract(chainId);
      const count = Number(await contract.campaignCount());
      const list = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const id = i + 1;
          const c = await contract.getCampaign(id);
          const aidTypes: string[] = Array.from(c.aidTypes);
          return {
            id,
            name: c.name,
            region: c.region,
            startTime: Number(c.startTime),
            endTime: Number(c.endTime),
            closed: c.closed,
            aidTypes,
            aidLabels: aidTypes.map(decodeAidType),
          };
        }),
      );
      setCampaigns(list);
      setError(null);
    } catch {
      setError("Could not load campaigns from the blockchain.");
    } finally {
      setLoading(false);
    }
  }, [chainId]);

  useEffect(() => {
    setLoading(true);
    setCampaigns([]);
    reload();
    const timer = setInterval(reload, 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  return { campaigns, loading, error, reload };
}
