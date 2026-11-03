/**
 * Aid types are stored on-chain as bytes32 labels, e.g. encodeBytes32String("FOOD_KIT").
 */
import { decodeBytes32String, encodeBytes32String } from "ethers";

export const STANDARD_AID_TYPES = ["FOOD_KIT", "CASH", "MEDICAL", "SHELTER"];

const FRIENDLY: Record<string, string> = {
  FOOD_KIT: "Food kit",
  CASH: "Cash",
  MEDICAL: "Medical",
  SHELTER: "Shelter",
};

export function encodeAidType(label: string): string {
  return encodeBytes32String(label);
}

/** bytes32 -> "FOOD_KIT" (falls back to the hex if it isn't a valid string). */
export function decodeAidType(bytes32: string): string {
  try {
    return decodeBytes32String(bytes32);
  } catch {
    return bytes32.slice(0, 10) + "…";
  }
}

/** "FOOD_KIT" -> "Food kit"; custom labels are shown as-is. */
export function aidLabel(label: string): string {
  return FRIENDLY[label] ?? label;
}

/** Turn user input like "water bottles" into a valid label "WATER_BOTTLES" (max 31 bytes). */
export function toAidTypeLabel(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 31);
}
