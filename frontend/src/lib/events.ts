/**
 * Read the contract's event log: the public audit trail.
 *
 * Every action on ReliefRegistry emits an event. Anyone can download these events
 * from any Ethereum node, so the dashboard needs no wallet and no backend server.
 */
import { EventLog, type Contract } from "ethers";
import { getReadContract, getReadProvider } from "./contract";

export type RegistryEventKind =
  | "CampaignCreated"
  | "CampaignClosed"
  | "AgencyApproved"
  | "AgencyRemoved"
  | "DistributionRecorded"
  | "DistributionVoided"
  | "VerifierApproved"
  | "VerifierRemoved"
  | "ReliefIdEnrolled"
  | "ReliefIdVouched"
  | "ReliefIdRevoked"
  | "ReliefIdReplaced";

const KINDS = new Set<string>([
  "CampaignCreated",
  "CampaignClosed",
  "AgencyApproved",
  "AgencyRemoved",
  "DistributionRecorded",
  "DistributionVoided",
  "VerifierApproved",
  "VerifierRemoved",
  "ReliefIdEnrolled",
  "ReliefIdVouched",
  "ReliefIdRevoked",
  "ReliefIdReplaced",
]);

/** One event, flattened into a simple object the UI can use. */
export interface RegistryEvent {
  id: string; // unique key: txHash-logIndex
  kind: RegistryEventKind;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  timestamp: number; // unix seconds
  campaignId?: number;
  nullifier?: string;
  aidType?: string; // bytes32
  agency?: string; // agency address (approve/remove/record/void)
  actor?: string; // coordinator who performed the action
  name?: string; // campaign or agency name
  region?: string;
  reason?: string;
  cardHash?: string; // Relief ID card hash (never the card number)
  newCardHash?: string; // replacement card
  vouchCount?: number;
}

// Many public RPC nodes refuse log queries that span too many blocks, so we ask in chunks.
// publicnode.com accepts 9,000; if an RPC refuses, the range is halved down to MIN_BLOCK_CHUNK.
const BLOCK_CHUNK = 9_000;
const MIN_BLOCK_CHUNK = 500;

// Block number -> timestamp, so each block is only fetched once.
const blockTimes = new Map<string, number>();

async function blockTimestamp(chainId: number, blockNumber: number): Promise<number> {
  const key = `${chainId}:${blockNumber}`;
  const cached = blockTimes.get(key);
  if (cached !== undefined) return cached;
  const block = await getReadProvider(chainId).getBlock(blockNumber);
  const ts = block?.timestamp ?? Math.floor(Date.now() / 1000);
  blockTimes.set(key, ts);
  return ts;
}

/** Convert one raw ethers EventLog into our RegistryEvent shape. */
async function toRegistryEvent(chainId: number, log: EventLog): Promise<RegistryEvent | null> {
  const kind = log.eventName;
  if (!KINDS.has(kind)) return null; // ignore OpenZeppelin's RoleGranted/RoleRevoked etc.
  const a = log.args;
  const base = {
    id: `${log.transactionHash}-${log.index}`,
    kind: kind as RegistryEventKind,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    txHash: log.transactionHash,
  };

  switch (kind) {
    case "DistributionRecorded":
      // This event carries its own timestamp, so no extra request is needed.
      return {
        ...base,
        timestamp: Number(a.timestamp),
        campaignId: Number(a.campaignId),
        nullifier: a.nullifier,
        aidType: a.aidType,
        agency: a.agency,
      };
    case "DistributionVoided":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        campaignId: Number(a.campaignId),
        nullifier: a.nullifier,
        aidType: a.aidType,
        agency: a.originalAgency,
        actor: a.coordinator,
        reason: a.reason,
      };
    case "CampaignCreated":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        campaignId: Number(a.campaignId),
        name: a.name,
        region: a.region,
        actor: a.coordinator,
      };
    case "CampaignClosed":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        campaignId: Number(a.campaignId),
        actor: a.coordinator,
      };
    case "AgencyApproved":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        agency: a.agency,
        name: a.name,
        actor: a.coordinator,
      };
    case "AgencyRemoved":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        agency: a.agency,
        actor: a.coordinator,
      };
    case "VerifierApproved":
    case "VerifierRemoved":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        agency: a.verifier,
        name: kind === "VerifierApproved" ? a.name : undefined,
        actor: a.coordinator,
      };
    case "ReliefIdEnrolled":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        cardHash: a.cardHash,
        actor: a.enrolledBy,
      };
    case "ReliefIdVouched":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        cardHash: a.cardHash,
        actor: a.voucher,
        vouchCount: Number(a.vouchCount),
      };
    case "ReliefIdRevoked":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        cardHash: a.cardHash,
        actor: a.coordinator,
        reason: a.reason,
      };
    case "ReliefIdReplaced":
      return {
        ...base,
        timestamp: await blockTimestamp(chainId, log.blockNumber),
        cardHash: a.oldCardHash,
        newCardHash: a.newCardHash,
        actor: a.coordinator,
        reason: a.reason,
      };
  }
  return null;
}

/** Fetch all ReliefRegistry events between two blocks (inclusive), oldest first. */
export async function fetchEvents(chainId: number, fromBlock: number, toBlock: number): Promise<RegistryEvent[]> {
  const contract: Contract = getReadContract(chainId);
  const result: RegistryEvent[] = [];

  let chunk = BLOCK_CHUNK;
  for (let start = fromBlock; start <= toBlock; ) {
    const end = Math.min(start + chunk - 1, toBlock);
    let logs;
    try {
      logs = await contract.queryFilter("*", start, end);
    } catch (err) {
      // Stricter RPCs reject wide ranges ("block range too large"): retry smaller.
      if (chunk <= MIN_BLOCK_CHUNK) throw err;
      chunk = Math.max(MIN_BLOCK_CHUNK, Math.floor(chunk / 2));
      continue;
    }
    start = end + 1;
    const parsed = await Promise.all(
      logs.filter((l): l is EventLog => l instanceof EventLog).map((l) => toRegistryEvent(chainId, l)),
    );
    for (const ev of parsed) if (ev) result.push(ev);
  }

  return result.sort((x, y) => x.blockNumber - y.blockNumber || x.logIndex - y.logIndex);
}

/**
 * Work out which DistributionRecorded events are still valid (not voided afterwards).
 * Returns the set of event ids that were later voided.
 */
export function findVoidedRecordIds(events: RegistryEvent[]): Set<string> {
  const activeRecord = new Map<string, string>(); // campaign|nullifier|aidType -> record event id
  const voided = new Set<string>();
  for (const ev of events) {
    const key = `${ev.campaignId}|${ev.nullifier}|${ev.aidType}`;
    if (ev.kind === "DistributionRecorded") activeRecord.set(key, ev.id);
    if (ev.kind === "DistributionVoided") {
      const recordId = activeRecord.get(key);
      if (recordId) voided.add(recordId);
      activeRecord.delete(key);
    }
  }
  return voided;
}
