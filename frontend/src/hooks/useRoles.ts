/** What is the connected wallet allowed to do? (agency / community verifier / coordinator) */
import { useCallback, useEffect, useState } from "react";
import { getReadContract } from "../lib/contract";

export interface Roles {
  isAgency: boolean;
  isCoordinator: boolean;
  isVerifier: boolean;
  agencyName: string;
  verifierName: string;
  loaded: boolean;
}

const NONE: Roles = {
  isAgency: false,
  isCoordinator: false,
  isVerifier: false,
  agencyName: "",
  verifierName: "",
  loaded: false,
};

export function useRoles(chainId: number, account: string | null) {
  const [roles, setRoles] = useState<Roles>(NONE);

  const reload = useCallback(async () => {
    if (!account) {
      setRoles(NONE);
      return;
    }
    try {
      const c = getReadContract(chainId);
      const [isAgency, isCoordinator, isVerifier, agencyName, verifierName] = await Promise.all([
        c.isAgency(account),
        c.isCoordinator(account),
        c.isVerifier(account),
        c.agencyName(account),
        c.verifierName(account),
      ]);
      setRoles({ isAgency, isCoordinator, isVerifier, agencyName, verifierName, loaded: true });
    } catch {
      setRoles({ ...NONE, loaded: true });
    }
  }, [chainId, account]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...roles, reload };
}
