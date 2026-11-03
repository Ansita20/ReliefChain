/**
 * Turn blockchain errors into messages a volunteer can understand.
 *
 * The contract uses custom errors (e.g. AlreadyReceived). When a call fails, the error
 * comes back as hex "revert data" buried somewhere inside the error object (the exact
 * place differs between MetaMask, Hardhat and public RPC nodes), so we search for it
 * and decode it with the contract's ABI.
 */
import { keccak256, toUtf8Bytes, type Result } from "ethers";
import { registryInterface } from "./contract";
import { decodeAidType, aidLabel } from "./aidTypes";

export interface DecodedError {
  name: string;
  args: Result;
}

const AGENCY_ROLE = keccak256(toUtf8Bytes("AGENCY_ROLE"));
const COORDINATOR_ROLE = keccak256(toUtf8Bytes("COORDINATOR_ROLE"));
const VERIFIER_ROLE = keccak256(toUtf8Bytes("VERIFIER_ROLE"));

/** Collect every hex string inside an error object (it can be nested several levels deep). */
function findHexStrings(value: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 6 || value == null) return found;
  if (typeof value === "string") {
    for (const match of value.match(/0x[0-9a-fA-F]{8,}/g) ?? []) found.push(match);
  } else if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      findHexStrings(child, found, depth + 1);
    }
  }
  return found;
}

/** Find and decode a ReliefRegistry custom error inside any error object. */
export function decodeContractError(err: unknown): DecodedError | null {
  const e = err as { revert?: { name: string; args: Result } };
  if (e?.revert?.name) return { name: e.revert.name, args: e.revert.args };

  for (const hex of findHexStrings(err)) {
    try {
      const parsed = registryInterface.parseError(hex);
      if (parsed) return { name: parsed.name, args: parsed.args };
    } catch {
      // not our error, keep looking
    }
  }
  return null;
}

/** A short, friendly explanation for any error thrown while reading or writing. */
export function friendlyError(err: unknown): string {
  const e = err as { code?: string | number; shortMessage?: string; message?: string };

  // The user pressed "Reject" in MetaMask
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) {
    return "You rejected the request in your wallet.";
  }

  const decoded = decodeContractError(err);
  if (decoded) {
    const a = decoded.args;
    switch (decoded.name) {
      case "AlreadyReceived":
        return `Duplicate blocked: this person has already received ${aidLabel(decodeAidType(a[2]))} in this campaign.`;
      case "AccessControlUnauthorizedAccount":
        if (a[1] === AGENCY_ROLE) return "Not authorized: this wallet is not an approved agency.";
        if (a[1] === COORDINATOR_ROLE) return "Not authorized: this wallet is not a coordinator.";
        if (a[1] === VERIFIER_ROLE) return "Not authorized: this wallet is not a community verifier.";
        return "Not authorized: this wallet does not have the required role.";
      case "CampaignIsClosed":
        return "This campaign has been closed. No more distributions can be recorded.";
      case "CampaignNotActive":
        return "This campaign is not active right now (outside its start and end dates).";
      case "CampaignNotFound":
        return "That campaign does not exist.";
      case "AidTypeNotInCampaign":
        return `${aidLabel(decodeAidType(a[1]))} is not one of this campaign's aid types.`;
      case "InvalidNullifier":
        return "Invalid beneficiary hash.";
      case "DistributionNotFound":
        return "There is no active record for this beneficiary hash and aid type, so nothing to void.";
      case "EmptyBatch":
        return "The batch is empty.";
      case "ArrayLengthMismatch":
        return "Batch data is inconsistent (internal error).";
      case "InvalidTimeWindow":
        return "The end time must be after the start time.";
      case "EmptyName":
        return "A name is required.";
      case "NoAidTypes":
        return "Choose at least one aid type.";
      case "InvalidAidType":
        return "Aid types must be unique and not empty.";
      case "ZeroAddress":
        return "That address is not valid.";
      case "EmptyReason":
        return "Please give a reason.";
      case "NotAVoucher":
        return "Not authorized: only approved agencies, community verifiers and coordinators can enroll or vouch.";
      case "InvalidThreshold":
        return "The vouch threshold must be at least 1.";
      case "InvalidReliefId":
        return "Invalid Relief ID.";
      case "ReliefIdExists":
        return "This Relief ID card number is already enrolled.";
      case "ReliefIdNotFound":
        return "This Relief ID was never enrolled. Check the card number.";
      case "ReliefIdIsRevoked":
        return "This Relief ID card has been revoked (lost, replaced or fraudulent).";
      case "MissingDedupTag":
        return "Enter the enrollment secret and the person's details (only a coordinator can skip the duplicate check).";
      case "PossibleDuplicatePerson":
        return "Possible duplicate: someone with the same name, parent's name, village and birth decade already has a Relief ID. If this is really a different person, ask a coordinator.";
      case "AlreadyVouched":
        return "You have already vouched for this person.";
      default:
        return `The contract rejected this action (${decoded.name}).`;
    }
  }

  const text = `${e?.shortMessage ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (e?.code === "INSUFFICIENT_FUNDS" || text.includes("insufficient funds")) {
    return "This wallet does not have enough ETH to pay for gas.";
  }
  if (text.includes("nonce")) {
    return "Nonce mismatch. If you restarted the local node, reset MetaMask: Settings → Advanced → Clear activity tab data.";
  }
  if (e?.code === "NETWORK_ERROR" || text.includes("failed to fetch") || text.includes("econnrefused")) {
    return "Could not reach the blockchain node. Check that it is running and try again.";
  }
  return e?.shortMessage ?? e?.message ?? "Something went wrong.";
}
