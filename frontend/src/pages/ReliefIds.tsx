/**
 * Relief IDs: identity for people who have no government ID at all.
 *
 * 1. Enroll: an agency or community verifier asks a few questions (name, parent's name,
 *    village, rough birth year), generates a random card number and enrolls its hash.
 *    The answers are turned into a secret-keyed dedupTag ON THIS DEVICE, so the contract
 *    can refuse a second card for the same person without ever seeing their details.
 * 2. Vouch: other agencies / verifiers who know the person confirm them on-chain.
 *    Once enough have vouched, the card works at the Agency Desk like an ID number.
 * 3. Coordinators manage verifiers and the vouch threshold, and revoke or replace cards.
 */
import { useEffect, useMemo, useState } from "react";
import { ZeroHash, isAddress } from "ethers";
import { generateCampaignSecret, isValidCampaignSecret } from "@shared/nullifier";
import {
  computeDedupTag,
  formatReliefId,
  generateReliefId,
  hashReliefId,
  isValidReliefId,
} from "@shared/reliefId";
import { useWallet } from "../hooks/useWallet";
import { useRoles } from "../hooks/useRoles";
import { useTx } from "../hooks/useTx";
import { useRegistryEvents } from "../hooks/useRegistryEvents";
import { getReadContract, getWriteContract } from "../lib/contract";
import { friendlyError } from "../lib/errors";
import type { RegistryEvent } from "../lib/events";
import { formatDateTime, shortAddress, shortHash } from "../lib/format";
import { SecretInput } from "../components/SecretInput";
import { TxStatus } from "../components/TxStatus";

export function ReliefIds() {
  const { account, appChainId, connect } = useWallet();
  const roles = useRoles(appChainId, account);
  const { events } = useRegistryEvents(appChainId);
  const canVouch = roles.isAgency || roles.isVerifier || roles.isCoordinator;

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">For people without documents</span>
        <h1>Relief IDs</h1>
        <p className="lead">
          No government ID? Issue a Relief ID card that the community vouches for on-chain. It then works at the
          Agency Desk exactly like an ID number, and no personal details are stored anywhere.
        </p>
      </header>

      {!account ? (
        <div className="banner banner-info">
          <span>Connect an agency, community verifier or coordinator wallet to enroll or vouch.</span>
          <button className="btn btn-sm btn-primary" onClick={connect}>
            Connect wallet
          </button>
        </div>
      ) : (
        roles.loaded &&
        !canVouch && (
          <div className="banner banner-warn" role="alert">
            <strong>This wallet can't enroll or vouch.</strong> Ask a coordinator to approve it as an agency or a
            community verifier.
          </div>
        )
      )}
      {roles.isVerifier && roles.verifierName && (
        <p className="hint">
          Acting as community verifier <strong>{roles.verifierName}</strong>
        </p>
      )}

      <div className="coord-grid">
        <Enroll isCoordinator={roles.isCoordinator} />
        <CheckAndVouch events={events} />
      </div>

      <h2 className="section-title">Coordinator tools</h2>
      <div className="coord-grid">
        <EnrollmentSecretTool />
        <Verifiers events={events} />
        <Threshold />
        <RevokeOrReplace />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enroll a person
// ---------------------------------------------------------------------------

function Enroll({ isCoordinator }: { isCoordinator: boolean }) {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();
  const [secret, setSecret] = useState(""); // memory only
  const [fullName, setFullName] = useState("");
  const [parentName, setParentName] = useState("");
  const [village, setVillage] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [skipDedup, setSkipDedup] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const details = { fullName, parentName, village, birthYear: Number(birthYear) };
  let dedupTag: string | null = null;
  let detailsError: string | null = null;
  if (skipDedup && isCoordinator) dedupTag = ZeroHash;
  else if (isValidCampaignSecret(secret) && fullName && parentName && village && birthYear) {
    try {
      dedupTag = computeDedupTag(secret, details);
    } catch (err) {
      detailsError = (err as Error).message;
    }
  }

  async function enroll(e: React.FormEvent) {
    e.preventDefault();
    if (!account || !dedupTag) return;
    const card = generateReliefId();
    const cardHash = hashReliefId(card);
    const tag = dedupTag;
    const receipt = await run(
      "Enroll Relief ID",
      () => getReadContract(appChainId).enrollReliefId.staticCall(cardHash, tag, { from: account }),
      async () => (await getWriteContract(appChainId)).enrollReliefId(cardHash, tag),
    );
    if (!receipt) return;
    setIssued(card);
    // Forget the person's details as soon as they are no longer needed.
    setFullName("");
    setParentName("");
    setVillage("");
    setBirthYear("");
    setSkipDedup(false);
  }

  return (
    <section className="card">
      <h2>1. Enroll a person</h2>
      <p className="hint">
        These answers never leave this device. They are only hashed with the enrollment secret into a duplicate check,
        so the same person can't get two cards. An estimated birth year is fine: only the decade is used.
      </p>
      <form onSubmit={enroll}>
        <div className="field">
          <label htmlFor="enroll-secret">Enrollment secret</label>
          <SecretInput id="enroll-secret" kind="enrollment" value={secret} onChange={setSecret} />
        </div>
        <div className="field">
          <label htmlFor="e-name">Full name</label>
          <input id="e-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="e-parent">Mother's or father's name</label>
          <input id="e-parent" value={parentName} onChange={(e) => setParentName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="e-village">Village / camp</label>
            <input id="e-village" value={village} onChange={(e) => setVillage(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="e-year">Birth year (estimate)</label>
            <input
              id="e-year"
              inputMode="numeric"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="1987"
              autoComplete="off"
            />
          </div>
        </div>
        {isCoordinator && (
          <label className="field field-inline">
            <input type="checkbox" checked={skipDedup} onChange={(e) => setSkipDedup(e.target.checked)} />
            Skip the duplicate check (a genuinely different person whose details match someone else's)
          </label>
        )}
        {detailsError && <p className="hint text-bad">{detailsError}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !account || !dedupTag}>
          Generate card and enroll
        </button>
      </form>
      <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />

      {issued && (
        <IssuedCard
          card={issued}
          note="Another agency or community verifier must vouch for it before it can be used."
          onDone={() => setIssued(null)}
        />
      )}
    </section>
  );
}

/** The new card number, shown once so it can be written or printed on the person's card. */
function IssuedCard({ card, note, onDone }: { card: string; note: string; onDone: () => void }) {
  function print() {
    const w = window.open("", "_blank", "width=420,height=300");
    if (!w) return;
    w.document.write(
      `<!doctype html><title>Relief ID</title><body style="font-family:system-ui;padding:24px">` +
        `<div style="border:2px solid #222;border-radius:12px;padding:20px;max-width:340px">` +
        `<div style="font-size:12px;letter-spacing:.1em">RELIEFCHAIN · RELIEF ID</div>` +
        `<div style="font:700 22px ui-monospace,monospace;margin:14px 0">${card}</div>` +
        `<div style="font-size:12px">Show this card at any aid distribution point. Keep it safe; if lost, ask a coordinator for a replacement.</div>` +
        `</div></body>`,
    );
    w.document.close();
    w.print();
  }

  return (
    <div className="card card-tight">
      <div className="label">Relief ID issued</div>
      <div className="secret-box mono">{card}</div>
      <p className="hint text-warn">
        Write or print this number on the person's card now. It is NOT stored anywhere and can't be shown again. {note}
      </p>
      <div className="button-row">
        <button className="btn btn-primary btn-block" onClick={print}>
          Print card
        </button>
        <button className="btn btn-block btn-ghost" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check a card and vouch for it
// ---------------------------------------------------------------------------

interface CardInfo {
  root: string;
  enrolledBy: string;
  enrolledAt: number;
  revoked: boolean;
  vouches: number;
  valid: boolean;
  threshold: number;
  iVouched: boolean;
}

function CheckAndVouch({ events }: { events: RegistryEvent[] }) {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();
  const [raw, setRaw] = useState("");
  const [info, setInfo] = useState<CardInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const cardHash = isValidReliefId(raw) ? hashReliefId(raw) : null;
  const names = useNames(events);

  useEffect(() => {
    setInfo(null);
    setError(null);
    if (!cardHash) return;
    let cancelled = false;
    (async () => {
      try {
        const c = getReadContract(appChainId);
        const [r, threshold] = await Promise.all([c.getReliefId(cardHash), c.vouchThreshold()]);
        const iVouched = account && r.root !== ZeroHash ? await c.hasVouched(r.root, account) : false;
        if (cancelled) return;
        setInfo({
          root: r.root,
          enrolledBy: r.enrolledBy,
          enrolledAt: Number(r.enrolledAt),
          revoked: r.revoked,
          vouches: Number(r.vouches),
          valid: r.valid,
          threshold: Number(threshold),
          iVouched,
        });
      } catch (err) {
        if (!cancelled) setError(friendlyError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardHash, appChainId, account, tick]);

  async function vouch() {
    if (!account || !cardHash) return;
    await run(
      "Vouch for Relief ID",
      () => getReadContract(appChainId).vouchForReliefId.staticCall(cardHash, { from: account }),
      async () => (await getWriteContract(appChainId)).vouchForReliefId(cardHash),
    );
    setTick((t) => t + 1);
  }

  // Who vouched, from the public event log (grouped by person, so replacement cards are included).
  const vouchers = useMemo(
    () => (info ? events.filter((e) => e.kind === "ReliefIdVouched" && rootOf(events, e.cardHash) === info.root) : []),
    [events, info],
  );

  return (
    <section className="card">
      <h2>2. Check and vouch</h2>
      <p className="hint">
        Vouch only for people you personally know, or whose identity community members confirm in front of you. Every
        vouch is signed by your wallet and public forever.
      </p>
      <div className="field">
        <label htmlFor="v-card">Relief ID card number</label>
        <input
          id="v-card"
          className="input-lg mono"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="RID-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error && <p className="hint text-bad">{error}</p>}
      {info && info.root === ZeroHash && <p className="hint text-bad">This card number is not enrolled.</p>}
      {info && info.root !== ZeroHash && (
        <>
          <ul className="plain-list">
            <li>
              Status:{" "}
              <span className={`status status-${info.valid ? "good" : "muted"}`}>
                {info.revoked ? "Revoked" : info.valid ? "Valid" : "Waiting for vouches"}
              </span>
            </li>
            <li>
              Vouches: <strong>{info.vouches}</strong> of {info.threshold} needed
            </li>
            <li>
              Card issued by {names(info.enrolledBy)} on {formatDateTime(info.enrolledAt)}
            </li>
            {vouchers.length > 0 && <li>Vouched by: {vouchers.map((v) => names(v.actor)).join(", ")}</li>}
            <li className="break">
              Person root: <code>{shortHash(info.root)}</code>
            </li>
          </ul>
          <button
            className="btn btn-primary btn-block"
            onClick={vouch}
            disabled={busy || !account || info.revoked || info.iVouched}
          >
            {info.iVouched ? "You already vouched for this person" : "I know this person: vouch"}
          </button>
        </>
      )}
      <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />
    </section>
  );
}

/** Follow ReliefIdReplaced events back to the person's first card. */
function rootOf(events: RegistryEvent[], cardHash?: string): string | undefined {
  let current = cardHash;
  for (let guard = 0; guard < 50 && current; guard++) {
    const replaced = events.find((e) => e.kind === "ReliefIdReplaced" && e.newCardHash === current);
    if (!replaced) return current;
    current = replaced.cardHash;
  }
  return current;
}

/** Address -> agency or verifier name, from the event log. */
function useNames(events: RegistryEvent[]) {
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) {
      if ((e.kind === "AgencyApproved" || e.kind === "VerifierApproved") && e.agency && e.name) {
        map.set(e.agency.toLowerCase(), e.name);
      }
    }
    return (addr?: string) => (addr ? (map.get(addr.toLowerCase()) ?? shortAddress(addr)) : "-");
  }, [events]);
}

// ---------------------------------------------------------------------------
// Coordinator: enrollment secret
// ---------------------------------------------------------------------------

function EnrollmentSecretTool() {
  const { appChainId } = useWallet();
  const [secret, setSecret] = useState("");

  function download() {
    const content = JSON.stringify({ chainId: appChainId, enrollmentSecret: secret }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "reliefchain-enrollment-secret.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card">
      <h2>Enrollment secret</h2>
      <p className="hint">
        Generate this ONCE for the whole registry (not per campaign) and give it privately to everyone who enrolls
        people. If it changes, the duplicate check can no longer recognize people enrolled before.
      </p>
      <button className="btn btn-block" onClick={() => setSecret(generateCampaignSecret())}>
        Generate enrollment secret
      </button>
      {secret && (
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
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Coordinator: community verifiers
// ---------------------------------------------------------------------------

function Verifiers({ events }: { events: RegistryEvent[] }) {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const validAddress = isAddress(address);

  // Latest state per verifier, from the event log.
  const verifiers = useMemo(() => {
    const map = new Map<string, { address: string; name: string; active: boolean }>();
    for (const e of events) {
      if (!e.agency) continue;
      const key = e.agency.toLowerCase();
      if (e.kind === "VerifierApproved") map.set(key, { address: e.agency, name: e.name ?? "", active: true });
      if (e.kind === "VerifierRemoved") {
        const v = map.get(key);
        if (v) v.active = false;
      }
    }
    return [...map.values()];
  }, [events]);

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    const receipt = await run(
      "Approve verifier",
      () => getReadContract(appChainId).approveVerifier.staticCall(address, name.trim(), { from: account }),
      async () => (await getWriteContract(appChainId)).approveVerifier(address, name.trim()),
    );
    if (receipt) {
      setAddress("");
      setName("");
    }
  }

  async function remove(verifier: string, verifierName: string) {
    if (!account || !window.confirm(`Remove ${verifierName}? They will no longer be able to vouch.`)) return;
    await run(
      "Remove verifier",
      () => getReadContract(appChainId).removeVerifier.staticCall(verifier, { from: account }),
      async () => (await getWriteContract(appChainId)).removeVerifier(verifier),
    );
  }

  return (
    <section className="card">
      <h2>Community verifiers</h2>
      <p className="hint">
        Village heads, health workers or teachers who know local people. They can enroll and vouch, but not record aid.
      </p>
      <form onSubmit={approve}>
        <div className="field">
          <label htmlFor="ver-address">Wallet address</label>
          <input
            id="ver-address"
            className="mono"
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
            placeholder="0x…"
            aria-invalid={address !== "" && !validAddress}
          />
          {address !== "" && !validAddress && <p className="hint text-bad">Not a valid address.</p>}
        </div>
        <div className="field">
          <label htmlFor="ver-name">Name</label>
          <input id="ver-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Riverside Village Council" />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy || !account || !validAddress || !name.trim()}>
          Approve verifier
        </button>
      </form>
      <ul className="row-list">
        {verifiers.map((v) => (
          <li key={v.address}>
            <div>
              <strong>{v.name}</strong>
              <div className="hint mono">{shortAddress(v.address)}</div>
            </div>
            <div className="row-actions">
              <span className={`status status-${v.active ? "good" : "muted"}`}>{v.active ? "Approved" : "Removed"}</span>
              {v.active && (
                <button className="btn btn-sm btn-danger" onClick={() => remove(v.address, v.name)} disabled={busy || !account}>
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
// Coordinator: vouch threshold
// ---------------------------------------------------------------------------

function Threshold() {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();
  const [current, setCurrent] = useState<number | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    getReadContract(appChainId)
      .vouchThreshold()
      .then((t: bigint) => setCurrent(Number(t)))
      .catch(() => setCurrent(null));
  }, [appChainId, tx.stage]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    const n = Number(value);
    await run(
      "Set vouch threshold",
      () => getReadContract(appChainId).setVouchThreshold.staticCall(n, { from: account }),
      async () => (await getWriteContract(appChainId)).setVouchThreshold(n),
    );
  }

  return (
    <section className="card">
      <h2>Vouch threshold</h2>
      <p className="hint">
        How many distinct agencies / verifiers must confirm a person (the enroller counts as one). Currently{" "}
        <strong>{current ?? "…"}</strong>. Higher is harder to fake but slower to enroll.
      </p>
      <form onSubmit={save} className="input-row">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 2))}
          placeholder="2"
          aria-label="New vouch threshold"
        />
        <button className="btn btn-primary" disabled={busy || !account || !Number(value)}>
          Save
        </button>
      </form>
      <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Coordinator: revoke or replace a card
// ---------------------------------------------------------------------------

function RevokeOrReplace() {
  const { account, appChainId } = useWallet();
  const { tx, run, reset, busy } = useTx();
  const [raw, setRaw] = useState("");
  const [reason, setReason] = useState("");
  const [newCard, setNewCard] = useState<string | null>(null);
  const cardHash = isValidReliefId(raw) ? hashReliefId(raw) : null;

  async function revoke() {
    if (!account || !cardHash) return;
    if (!window.confirm(`Revoke ${formatReliefId(raw)}? The card will stop working.`)) return;
    await run(
      "Revoke Relief ID",
      () => getReadContract(appChainId).revokeReliefId.staticCall(cardHash, reason.trim(), { from: account }),
      async () => (await getWriteContract(appChainId)).revokeReliefId(cardHash, reason.trim()),
    );
  }

  async function replace() {
    if (!account || !cardHash) return;
    const card = generateReliefId();
    const newHash = hashReliefId(card);
    const receipt = await run(
      "Replace lost card",
      () => getReadContract(appChainId).replaceReliefId.staticCall(cardHash, newHash, reason.trim(), { from: account }),
      async () => (await getWriteContract(appChainId)).replaceReliefId(cardHash, newHash, reason.trim()),
    );
    if (receipt) {
      setNewCard(card);
      setRaw("");
      setReason("");
    }
  }

  return (
    <section className="card">
      <h2>Revoke or replace a card</h2>
      <p className="hint">
        <strong>Replace</strong> a lost card: the person keeps their vouches and the same nullifier, so they still
        can't claim aid twice. <strong>Revoke</strong> a stolen or fraudulent card.
      </p>
      <div className="field">
        <label htmlFor="r-card">Card number</label>
        <input
          id="r-card"
          className="mono"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="RID-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="field">
        <label htmlFor="r-reason">Reason (public)</label>
        <input id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Card lost in flood" />
      </div>
      <div className="button-row">
        <button className="btn btn-primary btn-block" onClick={replace} disabled={busy || !account || !cardHash || !reason.trim()}>
          Issue replacement
        </button>
        <button className="btn btn-danger btn-block" onClick={revoke} disabled={busy || !account || !cardHash || !reason.trim()}>
          Revoke
        </button>
      </div>
      <TxStatus tx={tx} chainId={appChainId} onDismiss={reset} />
      {newCard && (
        <IssuedCard
          card={newCard}
          note="It keeps the person's vouches and works right away; the old card no longer works."
          onDone={() => setNewCard(null)}
        />
      )}
    </section>
  );
}
