/**
 * Run a transaction and track its status for the <TxStatus> component.
 *
 * Steps:
 *   1. simulate: dry-run the call first so errors like "already received" show up
 *                 clearly before MetaMask even opens
 *   2. wallet:   waiting for the user to confirm in MetaMask
 *   3. pending:  sent; waiting to be mined (we now have a tx hash / Etherscan link)
 *   4. confirmed or failed
 */
import { useCallback, useState } from "react";
import type { TransactionReceipt, TransactionResponse } from "ethers";
import { friendlyError } from "../lib/errors";

export type TxStage = "idle" | "simulating" | "wallet" | "pending" | "confirmed" | "failed";

export interface TxState {
  stage: TxStage;
  label: string; // e.g. "Record distribution"
  hash?: string;
  error?: string;
}

export function useTx() {
  const [tx, setTx] = useState<TxState>({ stage: "idle", label: "" });

  const run = useCallback(
    async (
      label: string,
      simulate: () => Promise<unknown>,
      send: () => Promise<TransactionResponse>,
    ): Promise<TransactionReceipt | null> => {
      try {
        setTx({ stage: "simulating", label });
        await simulate();

        setTx({ stage: "wallet", label });
        const response = await send();

        setTx({ stage: "pending", label, hash: response.hash });
        const receipt = await response.wait();

        setTx({ stage: "confirmed", label, hash: response.hash });
        return receipt;
      } catch (err) {
        setTx((prev) => ({ stage: "failed", label, hash: prev.hash, error: friendlyError(err) }));
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => setTx({ stage: "idle", label: "" }), []);

  const busy = tx.stage === "simulating" || tx.stage === "wallet" || tx.stage === "pending";
  return { tx, run, reset, busy };
}
