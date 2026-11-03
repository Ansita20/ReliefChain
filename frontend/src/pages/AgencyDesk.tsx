/**
 * Agency Desk: the screen a volunteer uses at the distribution point.
 *
 * 1. Pick campaign + aid type, load the campaign secret.
 * 2. Type the beneficiary's ID, or their Relief ID card number if they have no government ID.
 *    The app hashes it ON THIS DEVICE into a nullifier.
 * 3. The app asks the contract whether that nullifier already received this aid type.
 * 4. If eligible, "Record distribution" sends ONLY the hash to the blockchain.
 */
import { useEffect, useMemo, useState } from "react";
import { ZeroAddress, ZeroHash } from "ethers";
import { computeNullifier, isValidCampaignSecret, normalizeId } from "@shared/nullifier";
import { hashReliefId, isValidReliefId, normalizeReliefId, reliefIdSubject } from "@shared/reliefId";
import { useWallet } from "../hooks/useWallet";
import { useCampaigns, isActive, campaignStatus } from "../hooks/useCampaigns";
import { useRoles } from "../hooks/useRoles";
import { useTx } from "../hooks/useTx";
import { getReadContract, getWriteContract } from "../lib/contract";
import { aidLabel, decodeAidType } from "../lib/aidTypes";
import { friendlyError } from "../lib/errors";
import { formatDateTime, shortHash } from "../lib/format";
import { CampaignSelect } from "../components/CampaignSelect";
import { SecretInput, type SecretFile } from "../components/SecretInput";
import { TxStatus } from "../components/TxStatus";

/** One aid type this beneficiary has already received in the selected campaign. */
interface ReceivedRecord {
  aidType: string; // bytes32
  agency: string;
  agencyName: string;
  timestamp: number;
}

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; received: ReceivedRecord[] }
  | { status: "error"; message: string };

/** On-chain status of a typed Relief ID card. */
type CardState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; root: string; revoked: boolean; vouches: number; threshold: number; valid: boolean }
  | { status: "error"; message: string };

type IdMode = "gov" | "relief";

/** A distribution waiting in the local batch queue (only the hash is kept, never the ID). */
interface BatchItem {
  nullifier: string;
  aidType: string;
}

export function AgencyDesk() {
  const { account, appChainId, wrongNetwork, connect } = useWallet();
  const { campaigns, loading: campaignsLoading } = useCampaigns(appChainId);
  const roles = useRoles(appChainId, account);
  const { tx, run, reset, busy } = useTx();

  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [aidType, setAidType] = useState("");
  const [secret, setSecret] = useState(""); // memory only: never persisted
  const [idMode, setIdMode] = useState<IdMode>("gov");
  const [rawId, setRawId] = useState(""); // memory only: never persisted or sent
  const [card, setCard] = useState<CardState>({ status: "idle" });
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [secretNote, setSecretNote] = useState<string | null>(null);

  const campaign = campaigns.find((c) => c.id === campaignId) ?? null;
  const aidTypesKey = campaign?.aidTypes.join(",") ?? "";

  // Pre-select the first active campaign.
  useEffect(() => {
    if (campaignId === null && campaigns.length > 0) {
      setCampaignId((campaigns.find(isActive) ?? campaigns[0]).id);
    }
  }, [campaigns, campaignId]);

  // When the campaign changes: pick its first aid type and empty the batch.
  useEffect(() => {
    if (campaign && !campaign.aidTypes.includes(aidType)) setAidType(campaign.aidTypes[0] ?? "");
  }, [campaign, aidType]);
  useEffect(() => setBatch([]), [campaignId, appChainId]);

  // Different network = different contract: start over.
  useEffect(() => setCampaignId(null), [appChainId]);

  // ---- Relief ID mode: look the card up on-chain (only its hash is sent). ----
  const cardHash = idMode === "relief" && isValidReliefId(rawId) ? hashReliefId(rawId) : null;
  useEffect(() => {
    if (!cardHash) {
      setCard({ status: "idle" });
      return;
    }
    let cancelled = false;
    setCard({ status: "checking" });
    (async () => {
      try {
        const contract = getReadContract(appChainId);
        const [info, threshold] = await Promise.all([contract.getReliefId(cardHash), contract.vouchThreshold()]);
        if (cancelled) return;
        setCard({
          status: "done",
          root: info.root,
          revoked: info.revoked,
          vouches: Number(info.vouches),
          threshold: Number(threshold),
          valid: info.valid,
        });
      } catch (err) {
        if (!cancelled) setCard({ status: "error", message: friendlyError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardHash, appChainId, refreshTick]);

  // ---- The privacy step: hash the ID locally. ----
  // Government ID: the normalized ID number. Relief ID: the card's on-chain root, so a
  // replacement card for a lost one gives the same nullifier.
  const normalized = idMode === "gov" ? normalizeId(rawId) : normalizeReliefId(rawId);
  const subject =
    idMode === "gov" ? normalized : card.status === "done" && card.valid ? reliefIdSubject(card.root) : "";
  const nullifier = useMemo(() => {
    if (!campaign || !isValidCampaignSecret(secret) || subject === "") return null;
    return computeNullifier(secret, campaign.id, subject);
  }, [campaign, secret, subject]);

  // ---- Ask the contract what this nullifier has already received (read-only, free). ----
  useEffect(() => {
    if (!nullifier || !campaign) {
      setCheck({ status: "idle" });
      return;
    }
    let cancelled = false;
    setCheck({ status: "checking" });

    // Small delay so we don't query on every keystroke.
    const timer = setTimeout(async () => {
      try {
        const contract = getReadContract(appChainId);
        const results = await Promise.all(
          campaign.aidTypes.map((at) => contract.getDistribution(campaign.id, nullifier, at)),
        );
        const received: ReceivedRecord[] = [];
        for (let i = 0; i < results.length; i++) {
          const [agency, timestamp] = results[i];
          if (agency !== ZeroAddress) {
            received.push({
              aidType: campaign.aidTypes[i],
              agency,
              agencyName: await contract.agencyName(agency),
              timestamp: Number(timestamp),
            });
          }
        }
        if (!cancelled) setCheck({ status: "done", received });
      } catch (err) {
        if (!cancelled) setCheck({ status: "error", message: friendlyError(err) });
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // aidTypesKey instead of `campaign` so the 10-second campaign refresh doesn't re-trigger this
  }, [nullifier, campaign?.id, aidTypesKey, appChainId, refreshTick]);

  const existing = check.status === "done" ? check.received.find((r) => r.aidType === aidType) : undefined;
  const inBatch = nullifier !== null && batch.some((b) => b.nullifier === nullifier && b.aidType === aidType);
  const eligible = check.status === "done" && !existing && !inBatch;

  // ---- Why can't we record right now? (shown under the button) ----
  let blocker: string | null = null;
  if (!account) blocker = "Connect your wallet to record.";
  else if (wrongNetwork) blocker = "Switch your wallet to the right network.";
  else if (roles.loaded && !roles.isAgency) blocker = "This wallet is not an approved agency. Ask a coordinator.";
  else if (campaign && !isActive(campaign)) blocker = `This campaign is ${campaignStatus(campaign).toLowerCase()}.`;

  const canRecord = eligible && !blocker && !busy && nullifier !== null && campaign !== null;

  async function recordDistribution() {
    if (!campaign || !nullifier || !account) return;
    const receipt = await run(
      "Record distribution",
      // dry run first: gives a clear "already received" error before MetaMask opens
      () => getReadContract(appChainId).recordDistribution.staticCall(campaign.id, nullifier, aidType, { from: account }),
      async () => (await getWriteContract(appChainId)).recordDistribution(campaign.id, nullifier, aidType),
    );
    setRefreshTick((t) => t + 1); // re-check: the banner should now turn red
    if (receipt) roles.reload();
  }

  function addToBatch() {
    if (!nullifier || !eligible) return;
    setBatch((b) => [...b, { nullifier, aidType }]);
    setRawId(""); // ready for the next person
  }

  async function recordBatch() {
    if (!campaign || !account || batch.length === 0) return;
    const nullifiers = batch.map((b) => b.nullifier);
    const types = batch.map((b) => b.aidType);
    const receipt = await run(
      `Record batch of ${batch.length}`,
      () => getReadContract(appChainId).recordBatch.staticCall(campaign.id, nullifiers, types, { from: account }),
      async () => (await getWriteContract(appChainId)).recordBatch(campaign.id, nullifiers, types),
    );
    if (receipt) setBatch([]);
    setRefreshTick((t) => t + 1);
  }

  function nextBeneficiary() {
    setRawId("");
    reset();
  }

  function onSecretFile(file: SecretFile) {
    setSecretNote(null);
    if (file.chainId && file.chainId !== appChainId) {
      setSecretNote(`Warning: this secret file is for chain ${file.chainId}, but the app is on chain ${appChainId}.`);
    } else if (file.campaignId) {
      if (campaigns.some((c) => c.id === file.campaignId)) {
        setCampaignId(file.campaignId);
        setSecretNote(`Loaded secret for campaign #${file.campaignId}.`);
      } else {
        setSecretNote(`Warning: campaign #${file.campaignId} does not exist on this network.`);
      }
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">For field volunteers</span>
        <h1>Agency Desk</h1>
        <p className="lead">Check a beneficiary and record aid without their personal data ever leaving this device.</p>
      </header>

      <div className="desk-grid">
        {/* ---------- Left: inputs ---------- */}
        <section className="card">
          <div className="field">
            <label htmlFor="campaign">Campaign</label>
            <CampaignSelect id="campaign" campaigns={campaigns} value={campaignId} onChange={setCampaignId} />
            {!campaignsLoading && campaigns.length === 0 && (
              <p className="hint">No campaigns yet. A coordinator can create one in the Coordinator panel.</p>
            )}
            {campaign && (
              <p className="hint">
                {campaign.region} · {formatDateTime(campaign.startTime)} → {formatDateTime(campaign.endTime)}
              </p>
            )}
          </div>

          {campaign && (
            <div className="field">
              <span className="label" id="aid-label">
                Aid type
              </span>
              <div className="chips" role="radiogroup" aria-labelledby="aid-label">
                {campaign.aidTypes.map((at) => (
                  <button
                    key={at}
                    type="button"
                    role="radio"
                    aria-checked={at === aidType}
                    className={`chip ${at === aidType ? "chip-on" : ""}`}
                    onClick={() => setAidType(at)}
                  >
                    {aidLabel(decodeAidType(at))}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="campaign-secret">Campaign secret</label>
            <SecretInput value={secret} onChange={setSecret} onFileLoaded={onSecretFile} />
            {secretNote && <p className="hint">{secretNote}</p>}
          </div>

          <div className="field">
            <span className="label" id="id-mode-label">
              Beneficiary has
            </span>
            <div className="segmented" role="group" aria-labelledby="id-mode-label">
              {(
                [
                  ["gov", "Government ID"],
                  ["relief", "Relief ID card (no documents)"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={idMode === mode ? "on" : ""}
                  aria-pressed={idMode === mode}
                  onClick={() => {
                    setIdMode(mode);
                    setRawId("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="beneficiary-id">{idMode === "gov" ? "Beneficiary ID number" : "Relief ID card number"}</label>
            {/* autoComplete off: the browser must not remember typed ID numbers */}
            <input
              id="beneficiary-id"
              type="text"
              className="input-lg mono"
              placeholder={idMode === "gov" ? "e.g. 1234-5678" : "e.g. RID-7KQ2-M9XD-4HPA-TT3W"}
              value={rawId}
              onChange={(e) => setRawId(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
            />
            {idMode === "gov" ? (
              <p className="hint">
                {rawId ? (
                  <>
                    Normalized as <code>{normalized || "(empty)"}</code>: spaces and dashes removed, uppercase.
                  </>
                ) : (
                  "Spaces, dashes and lowercase letters don't matter."
                )}
              </p>
            ) : (
              <p className="hint">
                {rawId && !isValidReliefId(rawId) ? (
                  <>{normalized.length} of 16 characters typed.</>
                ) : (
                  <>
                    No government ID? Enroll the person on the <a href="#/relief-ids">Relief IDs</a> page first.
                  </>
                )}
              </p>
            )}
          </div>
        </section>

        {/* ---------- Right: result + action ---------- */}
        <section className="desk-result">
          <Verdict
            hasCampaign={campaign !== null}
            hasSecret={isValidCampaignSecret(secret)}
            hasId={normalized !== ""}
            idMode={idMode}
            card={card}
            cardComplete={cardHash !== null}
            check={check}
            existing={existing}
            inBatch={inBatch}
            aidType={aidType}
            myAccount={account}
          />

          {check.status === "done" && check.received.length > 0 && (
            <div className="card card-tight">
              <div className="label">Already received in this campaign</div>
              <ul className="received-list">
                {check.received.map((r) => (
                  <li key={r.aidType}>
                    <span className="badge">{aidLabel(decodeAidType(r.aidType))}</span>
                    <span>
                      {r.agencyName || "Unknown agency"} · {formatDateTime(r.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card card-tight">
            {!account ? (
              <button className="btn btn-primary btn-block btn-lg" onClick={connect}>
                Connect wallet to record
              </button>
            ) : (
              <>
                <button className="btn btn-primary btn-block btn-lg" disabled={!canRecord} onClick={recordDistribution}>
                  Record distribution
                </button>
                <div className="button-row">
                  <button className="btn btn-block" disabled={!eligible || !!blocker || busy} onClick={addToBatch}>
                    + Add to batch
                  </button>
                  <button className="btn btn-block btn-ghost" onClick={nextBeneficiary} disabled={busy}>
                    Next beneficiary
                  </button>
                </div>
              </>
            )}
            {blocker && account && <p className="hint text-warn">{blocker}</p>}
            {roles.isAgency && roles.agencyName && (
              <p className="hint">
                Recording as <strong>{roles.agencyName}</strong>
              </p>
            )}
            <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />
          </div>

          {batch.length > 0 && (
            <div className="card card-tight">
              <div className="label">Batch queue: {batch.length} waiting (not yet on-chain)</div>
              <ul className="batch-list">
                {batch.map((b, i) => (
                  <li key={`${b.nullifier}-${b.aidType}`}>
                    <code>{shortHash(b.nullifier)}</code>
                    <span className="badge">{aidLabel(decodeAidType(b.aidType))}</span>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setBatch((list) => list.filter((_, j) => j !== i))}
                      aria-label="Remove from batch"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button className="btn btn-primary btn-block" onClick={recordBatch} disabled={busy || !!blocker}>
                Record {batch.length} in one transaction
              </button>
              <p className="hint">One transaction for many records saves about 50% gas from 10 records up.</p>
            </div>
          )}

          <OnChainPanel
            campaignId={campaign?.id ?? null}
            nullifier={nullifier}
            aidType={aidType}
            normalized={normalized}
            cardHash={cardHash}
          />
        </section>
      </div>
    </div>
  );
}

/** The big green / red answer. Icon + words, so it doesn't rely on colour alone. */
function Verdict(props: {
  hasCampaign: boolean;
  hasSecret: boolean;
  hasId: boolean;
  idMode: IdMode;
  card: CardState;
  cardComplete: boolean;
  check: CheckState;
  existing?: ReceivedRecord;
  inBatch: boolean;
  aidType: string;
  myAccount: string | null;
}) {
  const { check, existing } = props;
  const aid = props.aidType ? aidLabel(decodeAidType(props.aidType)) : "";

  if (!props.hasCampaign) return <div className="verdict verdict-idle">Select a campaign to begin.</div>;
  if (!props.hasSecret) return <div className="verdict verdict-idle">Enter or load the campaign secret.</div>;
  if (!props.hasId)
    return (
      <div className="verdict verdict-idle">
        {props.idMode === "gov" ? "Type the beneficiary's ID number." : "Type the Relief ID card number."}
      </div>
    );
  if (props.idMode === "relief") {
    const card = props.card;
    if (!props.cardComplete) return <div className="verdict verdict-idle">Type all 16 characters of the card number.</div>;
    if (card.status === "error") return <div className="verdict verdict-bad">{card.message}</div>;
    if (card.status !== "done")
      return (
        <div className="verdict verdict-idle">
          <span className="spinner" aria-hidden="true" /> Looking up the Relief ID…
        </div>
      );
    if (!card.valid) {
      const [title, detail] =
        card.root === ZeroHash
          ? ["CARD NOT ENROLLED", "This card number is not in the registry. Check it, or enroll the person first."]
          : card.revoked
            ? ["CARD REVOKED", "This card was lost, replaced or revoked. Ask the person for their new card."]
            : [
                "WAITING FOR VOUCHES",
                `${card.vouches} of ${card.threshold} vouches so far. Another agency or community verifier must confirm this person.`,
              ];
      return (
        <div className={`verdict ${card.revoked || card.root === ZeroHash ? "verdict-bad" : "verdict-warn"}`} role="status">
          <div className="verdict-icon" aria-hidden="true">
            {card.revoked || card.root === ZeroHash ? "✕" : "⏳"}
          </div>
          <div>
            <div className="verdict-title">{title}</div>
            <div className="verdict-detail">{detail}</div>
          </div>
        </div>
      );
    }
  }
  if (check.status === "checking" || check.status === "idle")
    return (
      <div className="verdict verdict-idle">
        <span className="spinner" aria-hidden="true" /> Checking the registry…
      </div>
    );
  if (check.status === "error") return <div className="verdict verdict-bad">{check.message}</div>;

  if (existing) {
    const byMe = props.myAccount && existing.agency.toLowerCase() === props.myAccount.toLowerCase();
    return (
      <div className="verdict verdict-bad" role="status" aria-live="polite">
        <div className="verdict-icon" aria-hidden="true">
          ✕
        </div>
        <div>
          <div className="verdict-title">ALREADY RECEIVED</div>
          <div className="verdict-detail">
            {aid} by {existing.agencyName || "an agency"}
            {byMe ? " (you)" : ""} on {formatDateTime(existing.timestamp)}
          </div>
        </div>
      </div>
    );
  }
  if (props.inBatch) {
    return (
      <div className="verdict verdict-warn" role="status">
        <div className="verdict-icon" aria-hidden="true">
          ⏳
        </div>
        <div>
          <div className="verdict-title">IN YOUR BATCH</div>
          <div className="verdict-detail">Queued for {aid}, not yet recorded on-chain.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="verdict verdict-good" role="status" aria-live="polite">
      <div className="verdict-icon" aria-hidden="true">
        ✓
      </div>
      <div>
        <div className="verdict-title">ELIGIBLE</div>
        <div className="verdict-detail">Not yet served {aid} in this campaign.</div>
      </div>
    </div>
  );
}

/** Proof for the audience: exactly what is (and isn't) sent to the blockchain. */
function OnChainPanel(props: {
  campaignId: number | null;
  nullifier: string | null;
  aidType: string;
  normalized: string;
  cardHash: string | null;
}) {
  return (
    <details className="card card-tight onchain" open>
      <summary>What goes on-chain</summary>
      <div className="onchain-grid">
        <div>
          <div className="label">Stays on this device</div>
          <ul className="plain-list">
            <li>
              {props.cardHash ? "Card number" : "ID number"}: <code>{props.normalized ? "•".repeat(Math.min(props.normalized.length, 12)) : "-"}</code>
            </li>
            <li>
              Campaign secret: <code>••••••••</code>
            </li>
          </ul>
        </div>
        <div>
          <div className="label">Sent to the blockchain</div>
          <ul className="plain-list">
            <li>
              campaignId: <code>{props.campaignId ?? "-"}</code>
            </li>
            <li>
              aidType: <code>{props.aidType ? decodeAidType(props.aidType) : "-"}</code>
            </li>
            <li className="break">
              nullifier: <code>{props.nullifier ?? "-"}</code>
            </li>
            {props.cardHash && (
              <li className="break">
                card lookup (read only): <code>{props.cardHash}</code>
              </li>
            )}
          </ul>
        </div>
      </div>
      <p className="hint">
        nullifier = keccak256(abi.encode(secret, campaignId, normalizedId)). It is a one-way hash: without the
        secret, nobody can work out the ID from it. The eligibility check also sends only this hash. For a Relief ID,
        "normalizedId" is the card's on-chain root, so a replacement card gives the same nullifier.
      </p>
    </details>
  );
}
