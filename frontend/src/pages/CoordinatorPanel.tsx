/**
 * Coordinator Panel: for the district disaster authority.
 * Create and close campaigns, hand out campaign secrets, approve/remove agencies,
 * and void wrongly recorded entries.
 */
import { useEffect, useMemo, useState } from "react";
import { ZeroAddress, isAddress, isHexString } from "ethers";
import { computeNullifier, generateCampaignSecret, isValidCampaignSecret } from "@shared/nullifier";
import { useWallet } from "../hooks/useWallet";
import { useCampaigns, campaignStatus, type CampaignInfo } from "../hooks/useCampaigns";
import { useRoles } from "../hooks/useRoles";
import { useTx } from "../hooks/useTx";
import { useRegistryEvents } from "../hooks/useRegistryEvents";
import { getReadContract, getWriteContract, registryInterface } from "../lib/contract";
import { STANDARD_AID_TYPES, aidLabel, decodeAidType, encodeAidType, toAidTypeLabel } from "../lib/aidTypes";
import { findVoidedRecordIds, type RegistryEvent } from "../lib/events";
import { formatDateTime, shortAddress, shortHash, timeAgo, toDateTimeLocal } from "../lib/format";
import { CampaignSelect } from "../components/CampaignSelect";
import { SecretInput } from "../components/SecretInput";
import { TxStatus } from "../components/TxStatus";

export function CoordinatorPanel() {
  const { account, appChainId, connect } = useWallet();
  const roles = useRoles(appChainId, account);
  const { campaigns, reload } = useCampaigns(appChainId);
  const { events } = useRegistryEvents(appChainId);
  const [newCampaignId, setNewCampaignId] = useState<number | null>(null);

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">District authority</span>
        <h1>Coordinator Panel</h1>
        <p className="lead">Manage campaigns, agencies and corrections. Every action is recorded publicly as an event.</p>
      </header>

      {!account ? (
        <div className="banner banner-info">
          <span>Connect the coordinator's wallet to make changes.</span>
          <button className="btn btn-sm btn-primary" onClick={connect}>
            Connect wallet
          </button>
        </div>
      ) : (
        roles.loaded &&
        !roles.isCoordinator && (
          <div className="banner banner-warn" role="alert">
            <strong>This wallet is not a coordinator.</strong> You can look around, but the contract will reject
            changes. (Locally, the coordinator is Hardhat account #0.)
          </div>
        )
      )}

      <div className="coord-grid">
        <CreateCampaign
          onCreated={(id) => {
            setNewCampaignId(id);
            reload();
          }}
        />
        <SecretTool campaigns={campaigns} preselect={newCampaignId} />
        <CampaignList campaigns={campaigns} onChanged={reload} />
        <Agencies events={events} />
        <VoidEntry campaigns={campaigns} events={events} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create campaign
// ---------------------------------------------------------------------------

function CreateCampaign({ onCreated }: { onCreated: (campaignId: number) => void }) {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [start, setStart] = useState(() => toDateTimeLocal(new Date()));
  const [end, setEnd] = useState(() => toDateTimeLocal(new Date(Date.now() + 30 * 86400_000)));
  const [selected, setSelected] = useState<string[]>([...STANDARD_AID_TYPES]);
  const [custom, setCustom] = useState("");

  const toggle = (label: string) =>
    setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));

  function addCustom() {
    const label = toAidTypeLabel(custom);
    if (label && !selected.includes(label)) setSelected((s) => [...s, label]);
    setCustom("");
  }

  const allLabels = [...STANDARD_AID_TYPES, ...selected.filter((l) => !STANDARD_AID_TYPES.includes(l))];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    const startTs = Math.floor(new Date(start).getTime() / 1000);
    const endTs = Math.floor(new Date(end).getTime() / 1000);
    const aidTypes = selected.map(encodeAidType);
    const args = [name.trim(), region.trim(), startTs, endTs, aidTypes] as const;

    const receipt = await run(
      "Create campaign",
      () => getReadContract(appChainId).createCampaign.staticCall(...args, { from: account }),
      async () => (await getWriteContract(appChainId)).createCampaign(...args),
    );
    if (!receipt) return;

    // Find the new campaign's ID in the transaction's events.
    for (const log of receipt.logs) {
      const parsed = registryInterface.parseLog(log);
      if (parsed?.name === "CampaignCreated") onCreated(Number(parsed.args.campaignId));
    }
    setName("");
    setRegion("");
  }

  return (
    <section className="card">
      <h2>Create campaign</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="c-name">Name</label>
          <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Flood Relief 2026" required />
        </div>
        <div className="field">
          <label htmlFor="c-region">Region</label>
          <input id="c-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Riverside District" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="c-start">Starts</label>
            <input id="c-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="c-end">Ends</label>
            <input id="c-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <span className="label">Aid types</span>
          <div className="chips">
            {allLabels.map((label) => (
              <button
                key={label}
                type="button"
                className={`chip ${selected.includes(label) ? "chip-on" : ""}`}
                aria-pressed={selected.includes(label)}
                onClick={() => toggle(label)}
              >
                {aidLabel(label)}
              </button>
            ))}
          </div>
          <div className="input-row">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Add another, e.g. Water"
              aria-label="Custom aid type"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <button type="button" className="btn btn-sm" onClick={addCustom} disabled={!toAidTypeLabel(custom)}>
              Add
            </button>
          </div>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy || !account || selected.length === 0}>
          Create campaign
        </button>
      </form>
      <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Campaign secret tool
// ---------------------------------------------------------------------------

function SecretTool({ campaigns, preselect }: { campaigns: CampaignInfo[]; preselect: number | null }) {
  const { appChainId } = useWallet();
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [secret, setSecret] = useState("");

  useEffect(() => {
    if (preselect !== null) {
      setCampaignId(preselect);
      setSecret(generateCampaignSecret());
    }
  }, [preselect]);

  const campaign = campaigns.find((c) => c.id === campaignId);

  function download() {
    if (!campaign) return;
    const content = JSON.stringify(
      { chainId: appChainId, campaignId: campaign.id, campaignName: campaign.name, campaignSecret: secret },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `reliefchain-campaign-${campaign.id}-secret.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card">
      <h2>Campaign secret</h2>
      <p className="hint">
        Generate the secret once per campaign and give it to approved agencies through a private channel
        (in person or an encrypted message). It is never sent to the blockchain. If you lose it, agencies can't
        check beneficiaries in that campaign.
      </p>
      <div className="field">
        <label htmlFor="s-campaign">For campaign</label>
        <CampaignSelect id="s-campaign" campaigns={campaigns} value={campaignId} onChange={setCampaignId} />
      </div>
      <button className="btn btn-block" onClick={() => setSecret(generateCampaignSecret())} disabled={!campaign}>
        Generate new secret
      </button>
      {secret && campaign && (
        <>
          <div className="secret-box mono break">{secret}</div>
          <div className="button-row">
            <button className="btn btn-primary btn-block" onClick={download}>
              Download secret file
            </button>
            <button className="btn btn-block" onClick={() => navigator.clipboard?.writeText(secret)}>
              Copy
            </button>
          </div>
          <p className="hint text-warn">
            Generating again creates a DIFFERENT secret. Only distribute one secret per campaign.
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Campaign list (close campaigns)
// ---------------------------------------------------------------------------

function CampaignList({ campaigns, onChanged }: { campaigns: CampaignInfo[]; onChanged: () => void }) {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();

  async function close(c: CampaignInfo) {
    if (!account || !window.confirm(`Close "${c.name}"? This cannot be undone.`)) return;
    await run(
      `Close campaign #${c.id}`,
      () => getReadContract(appChainId).closeCampaign.staticCall(c.id, { from: account }),
      async () => (await getWriteContract(appChainId)).closeCampaign(c.id),
    );
    onChanged();
  }

  return (
    <section className="card">
      <h2>Campaigns</h2>
      {campaigns.length === 0 && <p className="hint">No campaigns yet.</p>}
      <ul className="row-list">
        {campaigns.map((c) => {
          const status = campaignStatus(c);
          return (
            <li key={c.id}>
              <div>
                <strong>
                  #{c.id} {c.name}
                </strong>
                <div className="hint">
                  {c.region} · {c.aidLabels.map(aidLabel).join(", ")}
                </div>
                <div className="hint">Ends {formatDateTime(c.endTime)}</div>
              </div>
              <div className="row-actions">
                <span className={`status status-${status === "Active" ? "good" : "muted"}`}>{status}</span>
                {!c.closed && (
                  <button className="btn btn-sm btn-danger" onClick={() => close(c)} disabled={busy || !account}>
                    Close
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Agencies
// ---------------------------------------------------------------------------

function Agencies({ events }: { events: RegistryEvent[] }) {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");

  // Rebuild the current agency list from the event history.
  const agencies = useMemo(() => {
    const map = new Map<string, { address: string; name: string; active: boolean }>();
    for (const ev of events) {
      if (ev.kind === "AgencyApproved" && ev.agency) {
        map.set(ev.agency.toLowerCase(), { address: ev.agency, name: ev.name ?? "", active: true });
      }
      if (ev.kind === "AgencyRemoved" && ev.agency) {
        const a = map.get(ev.agency.toLowerCase());
        if (a) a.active = false;
      }
    }
    return [...map.values()];
  }, [events]);

  const validAddress = isAddress(address) && address !== ZeroAddress;

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!account || !validAddress) return;
    const receipt = await run(
      "Approve agency",
      () => getReadContract(appChainId).approveAgency.staticCall(address, name.trim(), { from: account }),
      async () => (await getWriteContract(appChainId)).approveAgency(address, name.trim()),
    );
    if (receipt) {
      setAddress("");
      setName("");
    }
  }

  async function remove(agency: string, agencyName: string) {
    if (!account || !window.confirm(`Remove "${agencyName}"? Its past records stay valid.`)) return;
    await run(
      "Remove agency",
      () => getReadContract(appChainId).removeAgency.staticCall(agency, { from: account }),
      async () => (await getWriteContract(appChainId)).removeAgency(agency),
    );
  }

  return (
    <section className="card">
      <h2>Agencies</h2>
      <form onSubmit={approve}>
        <div className="field">
          <label htmlFor="a-address">Wallet address</label>
          <input
            id="a-address"
            className="mono"
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
            placeholder="0x…"
            aria-invalid={address !== "" && !validAddress}
          />
          {address !== "" && !validAddress && <p className="hint text-bad">Not a valid address.</p>}
        </div>
        <div className="field">
          <label htmlFor="a-name">Agency name</label>
          <input id="a-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hope Foundation" />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy || !account || !validAddress || !name.trim()}>
          Approve agency
        </button>
      </form>

      <ul className="row-list">
        {agencies.map((a) => (
          <li key={a.address}>
            <div>
              <strong>{a.name}</strong>
              <div className="hint mono">{shortAddress(a.address)}</div>
            </div>
            <div className="row-actions">
              <span className={`status status-${a.active ? "good" : "muted"}`}>{a.active ? "Approved" : "Removed"}</span>
              {a.active && (
                <button className="btn btn-sm btn-danger" onClick={() => remove(a.address, a.name)} disabled={busy || !account}>
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Void a wrong entry
// ---------------------------------------------------------------------------

function VoidEntry({ campaigns, events }: { campaigns: CampaignInfo[]; events: RegistryEvent[] }) {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [aidType, setAidType] = useState("");
  const [nullifier, setNullifier] = useState("");
  const [reason, setReason] = useState("");
  const [current, setCurrent] = useState<{ agency: string; name: string; timestamp: number } | null>(null);
  // Optional helper: compute the hash from an ID (needs the campaign secret)
  const [secret, setSecret] = useState("");
  const [rawId, setRawId] = useState("");

  const campaign = campaigns.find((c) => c.id === campaignId);
  const validNullifier = isHexString(nullifier, 32);

  useEffect(() => {
    if (campaign && !campaign.aidTypes.includes(aidType)) setAidType(campaign.aidTypes[0] ?? "");
  }, [campaign, aidType]);

  // Look up the record that would be voided, so the coordinator can double-check.
  useEffect(() => {
    setCurrent(null);
    if (!campaign || !validNullifier || !aidType) return;
    let cancelled = false;
    (async () => {
      try {
        const c = getReadContract(appChainId);
        const [agency, ts] = await c.getDistribution(campaign.id, nullifier, aidType);
        if (cancelled || agency === ZeroAddress) return;
        setCurrent({ agency, name: await c.agencyName(agency), timestamp: Number(ts) });
      } catch {
        // ignore: the form still works, it just can't preview
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign, nullifier, validNullifier, aidType, appChainId, tx.stage]);

  // Recent still-valid distributions in this campaign, to pick from.
  const recent = useMemo(() => {
    const voided = findVoidedRecordIds(events);
    return events
      .filter((e) => e.kind === "DistributionRecorded" && e.campaignId === campaignId && !voided.has(e.id))
      .slice(-8)
      .reverse();
  }, [events, campaignId]);

  function computeFromId() {
    if (campaign && isValidCampaignSecret(secret) && rawId.trim()) {
      setNullifier(computeNullifier(secret, campaign.id, rawId));
      setRawId("");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account || !campaign || !validNullifier) return;
    if (!window.confirm("Void this entry? The person will be able to receive this aid type again.")) return;
    const args = [campaign.id, nullifier, aidType, reason.trim()] as const;
    const receipt = await run(
      "Void entry",
      () => getReadContract(appChainId).voidDistribution.staticCall(...args, { from: account }),
      async () => (await getWriteContract(appChainId)).voidDistribution(...args),
    );
    if (receipt) {
      setNullifier("");
      setReason("");
    }
  }

  return (
    <section className="card card-wide">
      <h2>Void a wrong entry</h2>
      <p className="hint">
        Use this when a distribution was recorded by mistake (e.g. wrong ID typed). The record is removed from the
        active registry, but the original entry and your reason stay in the public audit log forever.
      </p>
      <form onSubmit={submit}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="v-campaign">Campaign</label>
            <CampaignSelect id="v-campaign" campaigns={campaigns} value={campaignId} onChange={setCampaignId} />
          </div>
          <div className="field">
            <label htmlFor="v-aid">Aid type</label>
            <select id="v-aid" value={aidType} onChange={(e) => setAidType(e.target.value)} disabled={!campaign}>
              {campaign?.aidTypes.map((at) => (
                <option key={at} value={at}>
                  {aidLabel(decodeAidType(at))}
                </option>
              ))}
            </select>
          </div>
        </div>

        {campaign && recent.length > 0 && (
          <div className="field">
            <span className="label">Recent entries (tap to select)</span>
            <ul className="pick-list">
              {recent.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    className={`pick ${ev.nullifier === nullifier && ev.aidType === aidType ? "pick-on" : ""}`}
                    onClick={() => {
                      setNullifier(ev.nullifier!);
                      setAidType(ev.aidType!);
                    }}
                  >
                    <code>{shortHash(ev.nullifier!)}</code>
                    <span className="badge">{aidLabel(decodeAidType(ev.aidType!))}</span>
                    <span className="hint">{timeAgo(ev.timestamp)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="field">
          <label htmlFor="v-nullifier">Beneficiary hash (nullifier)</label>
          <input
            id="v-nullifier"
            className="mono"
            value={nullifier}
            onChange={(e) => setNullifier(e.target.value.trim())}
            placeholder="0x…"
            aria-invalid={nullifier !== "" && !validNullifier}
          />
        </div>

        <details className="subtle">
          <summary>…or compute it from an ID number</summary>
          <div className="field">
            <label htmlFor="campaign-secret">Campaign secret</label>
            <SecretInput value={secret} onChange={setSecret} />
          </div>
          <div className="input-row">
            <input
              value={rawId}
              onChange={(e) => setRawId(e.target.value)}
              placeholder="ID number"
              aria-label="ID number"
              autoComplete="off"
              spellCheck={false}
              className="mono"
            />
            <button type="button" className="btn btn-sm" onClick={computeFromId} disabled={!campaign || !isValidCampaignSecret(secret) || !rawId.trim()}>
              Compute
            </button>
          </div>
        </details>

        {validNullifier && campaign && (
          <p className={`hint ${current ? "" : "text-warn"}`}>
            {current
              ? `Active record: ${aidLabel(decodeAidType(aidType))} by ${current.name || shortAddress(current.agency)} on ${formatDateTime(current.timestamp)}`
              : "No active record for this hash and aid type."}
          </p>
        )}

        <div className="field">
          <label htmlFor="v-reason">Reason (public)</label>
          <input id="v-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong ID typed by volunteer" />
        </div>
        <button className="btn btn-danger btn-block" disabled={busy || !account || !campaign || !current || !reason.trim()}>
          Void entry
        </button>
      </form>
      <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />
    </section>
  );
}
