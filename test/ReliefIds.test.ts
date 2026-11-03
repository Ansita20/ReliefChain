import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { encodeBytes32String } from "ethers";
import { computeNullifier, generateCampaignSecret } from "../shared/nullifier";
import { computeDedupTag, generateReliefId, hashReliefId, reliefIdSubject } from "../shared/reliefId";

const FOOD_KIT = encodeBytes32String("FOOD_KIT");
const ONE_DAY = 24 * 60 * 60;

/** Registry with one campaign, one agency and one community verifier. */
async function deployFixture() {
  const [admin, agency, verifier, verifier2, outsider] = await ethers.getSigners();
  const registry = await ethers.deployContract("ReliefRegistry", [admin.address]);

  const now = await time.latest();
  await registry.createCampaign("Flood Relief", "District 4", now - 60, now + 30 * ONE_DAY, [FOOD_KIT]);
  await registry.approveAgency(agency.address, "Agency A");
  await registry.approveVerifier(verifier.address, "Village Council");
  await registry.approveVerifier(verifier2.address, "Health Post");

  const enrollmentSecret = generateCampaignSecret();
  const card = generateReliefId();
  const cardHash = hashReliefId(card);
  const dedupTag = computeDedupTag(enrollmentSecret, {
    fullName: "Ram Kumar",
    parentName: "Sita Devi",
    village: "Riverside",
    birthYear: 1987,
  });

  return { registry, admin, agency, verifier, verifier2, outsider, enrollmentSecret, card, cardHash, dedupTag };
}

describe("ReliefRegistry: Relief IDs (people without government ID)", function () {
  describe("Verifiers and threshold", function () {
    it("lets a coordinator approve and remove community verifiers", async function () {
      const { registry, admin, outsider } = await loadFixture(deployFixture);
      await expect(registry.approveVerifier(outsider.address, "Teacher"))
        .to.emit(registry, "VerifierApproved")
        .withArgs(outsider.address, "Teacher", admin.address);
      expect(await registry.isVerifier(outsider.address)).to.equal(true);
      expect(await registry.verifierName(outsider.address)).to.equal("Teacher");

      await expect(registry.removeVerifier(outsider.address))
        .to.emit(registry, "VerifierRemoved")
        .withArgs(outsider.address, admin.address);
      expect(await registry.isVerifier(outsider.address)).to.equal(false);
    });

    it("validates verifier input and requires a coordinator", async function () {
      const { registry, agency, outsider } = await loadFixture(deployFixture);
      await expect(registry.approveVerifier(ethers.ZeroAddress, "X")).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(registry.approveVerifier(outsider.address, "")).to.be.revertedWithCustomError(registry, "EmptyName");
      await expect(registry.connect(agency).approveVerifier(outsider.address, "X")).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
      await expect(registry.connect(agency).removeVerifier(outsider.address)).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("starts at 2 vouches and lets a coordinator change it (but not to 0)", async function () {
      const { registry, admin, agency } = await loadFixture(deployFixture);
      expect(await registry.vouchThreshold()).to.equal(2n);
      await expect(registry.setVouchThreshold(3)).to.emit(registry, "VouchThresholdChanged").withArgs(3, admin.address);
      expect(await registry.vouchThreshold()).to.equal(3n);
      await expect(registry.setVouchThreshold(0)).to.be.revertedWithCustomError(registry, "InvalidThreshold");
      await expect(registry.connect(agency).setVouchThreshold(1)).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("Enrollment and vouching", function () {
    it("enrolls a card that becomes valid after enough independent vouches", async function () {
      const { registry, agency, verifier, cardHash, dedupTag } = await loadFixture(deployFixture);

      await expect(registry.connect(verifier).enrollReliefId(cardHash, dedupTag))
        .to.emit(registry, "ReliefIdEnrolled")
        .withArgs(cardHash, dedupTag, verifier.address)
        .and.to.emit(registry, "ReliefIdVouched")
        .withArgs(cardHash, cardHash, verifier.address, 1);

      let info = await registry.getReliefId(cardHash);
      expect(info.root).to.equal(cardHash);
      expect(info.enrolledBy).to.equal(verifier.address);
      expect(info.vouches).to.equal(1n);
      expect(info.valid).to.equal(false); // 1 of 2

      await expect(registry.connect(agency).vouchForReliefId(cardHash))
        .to.emit(registry, "ReliefIdVouched")
        .withArgs(cardHash, cardHash, agency.address, 2);
      info = await registry.getReliefId(cardHash);
      expect(info.valid).to.equal(true);
      expect(await registry.hasVouched(cardHash, agency.address)).to.equal(true);
      expect(await registry.dedupTagOwner(dedupTag)).to.equal(cardHash);
    });

    it("blocks the same voucher from counting twice", async function () {
      const { registry, verifier, cardHash, dedupTag } = await loadFixture(deployFixture);
      await registry.connect(verifier).enrollReliefId(cardHash, dedupTag);
      await expect(registry.connect(verifier).vouchForReliefId(cardHash))
        .to.be.revertedWithCustomError(registry, "AlreadyVouched")
        .withArgs(cardHash, verifier.address);
    });

    it("blocks enrolling the same person twice with a new card", async function () {
      const { registry, verifier, verifier2, enrollmentSecret, cardHash, dedupTag } = await loadFixture(deployFixture);
      await registry.connect(verifier).enrollReliefId(cardHash, dedupTag);

      // Same person at another enrollment point, details typed slightly differently.
      const sameTag = computeDedupTag(enrollmentSecret, {
        fullName: "KUMAR ram",
        parentName: "sita devi",
        village: "Riverside",
        birthYear: 1985,
      });
      await expect(registry.connect(verifier2).enrollReliefId(hashReliefId(generateReliefId()), sameTag))
        .to.be.revertedWithCustomError(registry, "PossibleDuplicatePerson")
        .withArgs(cardHash);
    });

    it("lets only a coordinator enroll without a dedup tag (genuine look-alike)", async function () {
      const { registry, admin, verifier } = await loadFixture(deployFixture);
      const card = hashReliefId(generateReliefId());
      await expect(registry.connect(verifier).enrollReliefId(card, ethers.ZeroHash)).to.be.revertedWithCustomError(
        registry,
        "MissingDedupTag",
      );
      await expect(registry.enrollReliefId(card, ethers.ZeroHash))
        .to.emit(registry, "ReliefIdEnrolled")
        .withArgs(card, ethers.ZeroHash, admin.address);
    });

    it("rejects an empty or already enrolled card, and outsiders", async function () {
      const { registry, verifier, outsider, cardHash, dedupTag, enrollmentSecret } = await loadFixture(deployFixture);
      await expect(registry.connect(verifier).enrollReliefId(ethers.ZeroHash, dedupTag)).to.be.revertedWithCustomError(
        registry,
        "InvalidReliefId",
      );
      await registry.connect(verifier).enrollReliefId(cardHash, dedupTag);
      const otherTag = computeDedupTag(enrollmentSecret, {
        fullName: "Other",
        parentName: "Person",
        village: "X",
        birthYear: 2000,
      });
      await expect(registry.connect(verifier).enrollReliefId(cardHash, otherTag))
        .to.be.revertedWithCustomError(registry, "ReliefIdExists")
        .withArgs(cardHash);
      await expect(registry.connect(outsider).enrollReliefId(hashReliefId(generateReliefId()), otherTag))
        .to.be.revertedWithCustomError(registry, "NotAVoucher")
        .withArgs(outsider.address);
      await expect(registry.connect(outsider).vouchForReliefId(cardHash)).to.be.revertedWithCustomError(
        registry,
        "NotAVoucher",
      );
    });

    it("cannot vouch for an unknown card", async function () {
      const { registry, agency, cardHash } = await loadFixture(deployFixture);
      await expect(registry.connect(agency).vouchForReliefId(cardHash))
        .to.be.revertedWithCustomError(registry, "ReliefIdNotFound")
        .withArgs(cardHash);
      const info = await registry.getReliefId(cardHash);
      expect(info.root).to.equal(ethers.ZeroHash);
      expect(info.valid).to.equal(false);
    });

    it("a removed verifier can no longer vouch", async function () {
      const { registry, verifier, verifier2, cardHash, dedupTag } = await loadFixture(deployFixture);
      await registry.connect(verifier).enrollReliefId(cardHash, dedupTag);
      await registry.removeVerifier(verifier2.address);
      await expect(registry.connect(verifier2).vouchForReliefId(cardHash)).to.be.revertedWithCustomError(
        registry,
        "NotAVoucher",
      );
    });

    it("applies a raised threshold to existing cards", async function () {
      const { registry, agency, verifier, cardHash, dedupTag } = await loadFixture(deployFixture);
      await registry.connect(verifier).enrollReliefId(cardHash, dedupTag);
      await registry.connect(agency).vouchForReliefId(cardHash);
      expect((await registry.getReliefId(cardHash)).valid).to.equal(true);
      await registry.setVouchThreshold(3);
      expect((await registry.getReliefId(cardHash)).valid).to.equal(false);
    });
  });

  describe("Revoking and replacing cards", function () {
    async function validCardFixture() {
      const f = await deployFixture();
      await f.registry.connect(f.verifier).enrollReliefId(f.cardHash, f.dedupTag);
      await f.registry.connect(f.agency).vouchForReliefId(f.cardHash);
      return f;
    }

    it("revokes a card with a reason", async function () {
      const { registry, admin, verifier2, cardHash } = await loadFixture(validCardFixture);
      await expect(registry.revokeReliefId(cardHash, "Fraud found"))
        .to.emit(registry, "ReliefIdRevoked")
        .withArgs(cardHash, admin.address, "Fraud found");
      const info = await registry.getReliefId(cardHash);
      expect(info.revoked).to.equal(true);
      expect(info.valid).to.equal(false);

      await expect(registry.connect(verifier2).vouchForReliefId(cardHash))
        .to.be.revertedWithCustomError(registry, "ReliefIdIsRevoked")
        .withArgs(cardHash);
      await expect(registry.revokeReliefId(cardHash, "again")).to.be.revertedWithCustomError(registry, "ReliefIdIsRevoked");
    });

    it("validates revocation input and role", async function () {
      const { registry, agency, cardHash } = await loadFixture(validCardFixture);
      await expect(registry.revokeReliefId(cardHash, "")).to.be.revertedWithCustomError(registry, "EmptyReason");
      await expect(registry.revokeReliefId(ethers.id("unknown"), "x")).to.be.revertedWithCustomError(
        registry,
        "ReliefIdNotFound",
      );
      await expect(registry.connect(agency).revokeReliefId(cardHash, "x")).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("replaces a lost card: same root, same vouches, same nullifier, old card dead", async function () {
      const { registry, admin, agency, verifier2, cardHash } = await loadFixture(validCardFixture);
      const campaignSecret = generateCampaignSecret();

      // The person received food with their first card.
      const nullifier = computeNullifier(campaignSecret, 1n, reliefIdSubject(cardHash));
      await registry.connect(agency).recordDistribution(1n, nullifier, FOOD_KIT);

      const newCardHash = hashReliefId(generateReliefId());
      await expect(registry.replaceReliefId(cardHash, newCardHash, "Card lost in flood"))
        .to.emit(registry, "ReliefIdReplaced")
        .withArgs(cardHash, newCardHash, cardHash, admin.address, "Card lost in flood");

      expect((await registry.getReliefId(cardHash)).valid).to.equal(false);
      const info = await registry.getReliefId(newCardHash);
      expect(info.root).to.equal(cardHash);
      expect(info.vouches).to.equal(2n);
      expect(info.valid).to.equal(true);

      // The new card leads to the same nullifier, so a second food kit is blocked.
      const again = computeNullifier(campaignSecret, 1n, reliefIdSubject(info.root));
      expect(again).to.equal(nullifier);
      await expect(registry.connect(agency).recordDistribution(1n, again, FOOD_KIT)).to.be.revertedWithCustomError(
        registry,
        "AlreadyReceived",
      );

      // Vouches are per person, so the original vouchers can't vouch again via the new card.
      await expect(registry.connect(agency).vouchForReliefId(newCardHash))
        .to.be.revertedWithCustomError(registry, "AlreadyVouched")
        .withArgs(cardHash, agency.address);
      await expect(registry.connect(verifier2).vouchForReliefId(newCardHash))
        .to.emit(registry, "ReliefIdVouched")
        .withArgs(newCardHash, cardHash, verifier2.address, 3);
    });

    it("validates replacement input and role", async function () {
      const { registry, agency, cardHash, verifier, enrollmentSecret } = await loadFixture(validCardFixture);
      const fresh = hashReliefId(generateReliefId());
      await expect(registry.replaceReliefId(cardHash, fresh, "")).to.be.revertedWithCustomError(registry, "EmptyReason");
      await expect(registry.replaceReliefId(cardHash, ethers.ZeroHash, "x")).to.be.revertedWithCustomError(
        registry,
        "InvalidReliefId",
      );
      await expect(registry.replaceReliefId(ethers.id("unknown"), fresh, "x")).to.be.revertedWithCustomError(
        registry,
        "ReliefIdNotFound",
      );

      const other = hashReliefId(generateReliefId());
      const otherTag = computeDedupTag(enrollmentSecret, { fullName: "B", parentName: "C", village: "D", birthYear: 1990 });
      await registry.connect(verifier).enrollReliefId(other, otherTag);
      await expect(registry.replaceReliefId(cardHash, other, "x"))
        .to.be.revertedWithCustomError(registry, "ReliefIdExists")
        .withArgs(other);

      await expect(registry.connect(agency).replaceReliefId(cardHash, fresh, "x")).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );

      await registry.revokeReliefId(cardHash, "fraud");
      await expect(registry.replaceReliefId(cardHash, fresh, "x")).to.be.revertedWithCustomError(
        registry,
        "ReliefIdIsRevoked",
      );
    });
  });
});
