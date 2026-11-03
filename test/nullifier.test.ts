import { expect } from "chai";
import { ethers } from "hardhat";
import {
  computeNullifier,
  generateCampaignSecret,
  isValidCampaignSecret,
  normalizeId,
} from "../shared/nullifier";

describe("Nullifier helpers (off-chain)", function () {
  const secret = generateCampaignSecret();

  it("normalizes spaces, dashes and case", function () {
    expect(normalizeId(" 1234 5678 ")).to.equal("12345678");
    expect(normalizeId("1234-5678")).to.equal("12345678");
    expect(normalizeId("ab-12\tcd")).to.equal("AB12CD");
  });

  it("gives the same nullifier for differently formatted versions of one ID", function () {
    expect(computeNullifier(secret, 1n, "1234 5678")).to.equal(computeNullifier(secret, 1n, "1234-5678"));
  });

  it("gives different nullifiers for different campaigns", function () {
    expect(computeNullifier(secret, 1n, "12345678")).to.not.equal(computeNullifier(secret, 2n, "12345678"));
  });

  it("gives different nullifiers for different secrets", function () {
    const other = generateCampaignSecret();
    expect(computeNullifier(secret, 1n, "12345678")).to.not.equal(computeNullifier(other, 1n, "12345678"));
  });

  it("validates the secret and the ID", function () {
    expect(isValidCampaignSecret(secret)).to.equal(true);
    expect(isValidCampaignSecret("0x1234")).to.equal(false);
    expect(() => computeNullifier("not-a-secret", 1n, "123")).to.throw(/secret/);
    expect(() => computeNullifier(secret, 1n, " - - ")).to.throw(/empty/);
  });

  it("matches Solidity's keccak256(abi.encode(secret, campaignId, id)) exactly", async function () {
    // The helper contract is test-only: calling it on a real network would leak the ID to the RPC node.
    const helper = await ethers.deployContract("NullifierTestHelper");
    for (const [campaignId, id] of [
      [1n, "12345678"],
      [7n, "AB12CD"],
      [123456789n, "X"],
    ] as const) {
      expect(await helper.computeNullifier(secret, campaignId, id)).to.equal(computeNullifier(secret, campaignId, id));
    }
  });
});
