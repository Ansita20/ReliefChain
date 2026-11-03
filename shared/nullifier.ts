/**
 * Nullifier helpers: the privacy core of ReliefChain.
 *
 * A nullifier is a one-way fingerprint of "this person, in this campaign":
 *
 *     nullifier = keccak256(abi.encode(campaignSecret, campaignId, normalizedIdNumber))
 *
 * - It is computed on the volunteer's device. The raw ID never leaves it.
 * - campaignId is mixed in, so the same person gets a different nullifier in every
 *   campaign and cannot be tracked across disasters.
 * - campaignSecret is a random 32-byte value shared off-chain only with approved agencies.
 *   ID numbers have low entropy (e.g. only 10^8 possible 8-digit IDs), so without the
 *   secret anyone could hash every possible ID and compare against public on-chain data.
 *
 * This file has no dependencies besides ethers, so the same code is used by the tests,
 * the seed script and (as a copy) the frontend.
 */
import { AbiCoder, hexlify, isHexString, keccak256, randomBytes } from "ethers";

/**
 * Normalize an ID so small typing differences don't create different nullifiers.
 * Trims, removes all whitespace and dashes, and uppercases.
 *   "1234 5678" -> "12345678",  "ab-12 cd" -> "AB12CD"
 */
export function normalizeId(rawId: string): string {
  return rawId.trim().replace(/[\s-]/g, "").toUpperCase();
}

/** True if `secret` is a 0x-prefixed 32-byte hex string. */
export function isValidCampaignSecret(secret: string): boolean {
  return isHexString(secret, 32);
}

/** Create a new random campaign secret (32 bytes from a secure random source). */
export function generateCampaignSecret(): string {
  return hexlify(randomBytes(32));
}

/**
 * Compute the nullifier for one beneficiary in one campaign.
 * Matches Solidity: keccak256(abi.encode(bytes32 secret, uint256 campaignId, string id)).
 */
export function computeNullifier(campaignSecret: string, campaignId: bigint | number, rawId: string): string {
  if (!isValidCampaignSecret(campaignSecret)) {
    throw new Error("Campaign secret must be a 0x-prefixed 32-byte hex string");
  }
  const normalized = normalizeId(rawId);
  if (normalized.length === 0) {
    throw new Error("ID number is empty");
  }
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint256", "string"],
    [campaignSecret, campaignId, normalized],
  );
  return keccak256(encoded);
}
