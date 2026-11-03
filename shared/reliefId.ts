/**
 * Relief ID helpers: identity for people who have NO government ID at all.
 *
 * Instead of a national ID number, the person is given a random card number:
 *
 *     RID-7KQ2-M9XD-4HPA-TT3W        (16 Crockford base32 characters = 80 random bits)
 *
 * - Only cardHash = keccak256(abi.encode("ReliefChain:ReliefID", cardNumber)) goes on-chain.
 *   80 random bits can't be guessed, so nobody can enumerate card numbers from the chain.
 * - The card becomes valid once enough agencies / community verifiers have vouched for the
 *   person on-chain (ReliefRegistry.vouchThreshold).
 * - A dedupTag, a secret-keyed hash of the person's name, parent's name, village and birth
 *   decade, lets the contract refuse a second card for the same person without storing
 *   any of those details.
 * - At the Agency Desk the nullifier is computed from the card's on-chain *root* (the hash
 *   of the person's first card), so a replacement card gives the SAME nullifier.
 *
 * Like nullifier.ts, this file depends only on ethers and is shared by tests, scripts and frontend.
 */
import { AbiCoder, keccak256, randomBytes } from "ethers";
import { isValidCampaignSecret } from "./nullifier";

/** Crockford base32: no I, L, O or U, so cards are hard to misread. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LENGTH = 16; // 16 × 5 bits = 80 bits
const HASH_DOMAIN = "ReliefChain:ReliefID";
const DEDUP_DOMAIN = "ReliefChain:Dedup";

/** Create a new random card number, formatted as RID-XXXX-XXXX-XXXX-XXXX. */
export function generateReliefId(): string {
  const bytes = randomBytes(10); // 80 bits
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let body = "";
  for (let i = BODY_LENGTH - 1; i >= 0; i--) body += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return formatReliefId(body);
}

/**
 * Normalize a typed card number: uppercase, drop spaces/dashes and the optional "RID" prefix,
 * and fix the usual misreadings (O → 0, I/L → 1).
 *   "rid-7kq2 m9xd-4hpa-tt3w" -> "7KQ2M9XD4HPATT3W"
 */
export function normalizeReliefId(raw: string): string {
  return raw
    .trim()
    .replace(/[\s-]/g, "")
    .toUpperCase()
    .replace(/^RID/, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** True if `raw` normalizes to a complete 16-character card number. */
export function isValidReliefId(raw: string): boolean {
  const body = normalizeReliefId(raw);
  return body.length === BODY_LENGTH && [...body].every((ch) => ALPHABET.includes(ch));
}

/** "7KQ2M9XD4HPATT3W" -> "RID-7KQ2-M9XD-4HPA-TT3W" */
export function formatReliefId(raw: string): string {
  const body = normalizeReliefId(raw);
  return `RID-${body.match(/.{1,4}/g)?.join("-") ?? ""}`;
}

/** The value stored on-chain for a card: keccak256(abi.encode("ReliefChain:ReliefID", body)). */
export function hashReliefId(raw: string): string {
  if (!isValidReliefId(raw)) throw new Error("Relief ID must be 16 characters, e.g. RID-7KQ2-M9XD-4HPA-TT3W");
  return keccak256(AbiCoder.defaultAbiCoder().encode(["string", "string"], [HASH_DOMAIN, normalizeReliefId(raw)]));
}

/**
 * What the nullifier is computed from for a Relief ID holder (instead of a government ID number).
 * Uses the card's on-chain root, so lost-and-replaced cards keep the same nullifier.
 *   computeNullifier(campaignSecret, campaignId, reliefIdSubject(root))
 */
export function reliefIdSubject(root: string): string {
  return `RID:${root.toLowerCase()}`;
}

/** Details asked at enrollment. Nothing here is ever stored or sent; only the dedupTag is. */
export interface PersonDetails {
  fullName: string;
  parentName: string; // mother's or father's name
  village: string; // village, camp or neighbourhood
  birthYear: number; // an estimate is fine: only the decade is used
}

/**
 * Normalize a name so spelling details don't matter: no accents, no punctuation,
 * uppercase, and the words sorted ("Kumar  Ram" and "ram kumar" are the same).
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** 1987 -> 1980. People without documents often only know their age roughly. */
export function birthDecade(birthYear: number): number {
  return Math.floor(birthYear / 10) * 10;
}

/**
 * Secret-keyed fingerprint of a person, used only to block duplicate enrollment.
 * The enrollment secret (32 bytes, shared off-chain with enrollers) stops anyone from
 * hashing a list of known names and checking who is enrolled.
 */
export function computeDedupTag(enrollmentSecret: string, details: PersonDetails): string {
  if (!isValidCampaignSecret(enrollmentSecret)) {
    throw new Error("Enrollment secret must be a 0x-prefixed 32-byte hex string");
  }
  const name = normalizeName(details.fullName);
  const parent = normalizeName(details.parentName);
  const village = normalizeName(details.village);
  if (!name || !parent || !village) throw new Error("Name, parent's name and village are required");
  if (!Number.isInteger(details.birthYear) || details.birthYear < 1900 || details.birthYear > 2100) {
    throw new Error("Birth year must be a year such as 1987");
  }
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "string", "string", "string", "string", "uint256"],
    [enrollmentSecret, DEDUP_DOMAIN, name, parent, village, birthDecade(details.birthYear)],
  );
  return keccak256(encoded);
}
