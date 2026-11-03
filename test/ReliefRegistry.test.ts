import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { encodeBytes32String } from "ethers";
import { computeNullifier, generateCampaignSecret } from "../shared/nullifier";

// Aid type labels are stored on-chain as bytes32
const FOOD_KIT = encodeBytes32String("FOOD_KIT");
const CASH = encodeBytes32String("CASH");
const MEDICAL = encodeBytes32String("MEDICAL");
const SHELTER = encodeBytes32String("SHELTER");
const AID_TYPES = [FOOD_KIT, CASH, MEDICAL, SHELTER];

const ONE_DAY = 24 * 60 * 60;

/**
 * Fresh contract with one active campaign and two approved agencies.
 * loadFixture snapshots this state so every test starts from the same point quickly.
 */
async function deployFixture() {
  const [admin, agencyA, agencyB, outsider, coordinator2] = await ethers.getSigners();

  const registry = await ethers.deployContract("ReliefRegistry", [admin.address]);

  const now = await time.latest();
  await registry.createCampaign("Flood Relief", "District 4", now - 60, now + 30 * ONE_DAY, AID_TYPES);
  const campaignId = 1n;

  await registry.approveAgency(agencyA.address, "Agency A");
  await registry.approveAgency(agencyB.address, "Agency B");

  const secret = generateCampaignSecret();
  const alice = computeNullifier(secret, campaignId, "1234-5678");
  const bob = computeNullifier(secret, campaignId, "8765 4321");

  return { registry, admin, agencyA, agencyB, outsider, coordinator2, campaignId, secret, alice, bob, now };
}

describe("ReliefRegistry", function () {
  // ---------------------------------------------------------------------
  describe("Deployment & roles", function () {
    it("gives the deployer admin and coordinator roles", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await registry.isCoordinator(admin.address)).to.equal(true);
    });

    it("rejects a zero admin address", async function () {
      const factory = await ethers.getContractFactory("ReliefRegistry");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("lets the admin add a second coordinator", async function () {
      const { registry, coordinator2, outsider } = await loadFixture(deployFixture);
      await registry.grantRole(await registry.COORDINATOR_ROLE(), coordinator2.address);
      await expect(registry.connect(coordinator2).approveAgency(outsider.address, "New NGO"))
        .to.emit(registry, "AgencyApproved")
        .withArgs(outsider.address, "New NGO", coordinator2.address);
    });

    it("approves an agency with a name and emits an event", async function () {
      const { registry, admin, outsider } = await loadFixture(deployFixture);
      await expect(registry.approveAgency(outsider.address, "Relief NGO"))
        .to.emit(registry, "AgencyApproved")
        .withArgs(outsider.address, "Relief NGO", admin.address);
      expect(await registry.isAgency(outsider.address)).to.equal(true);
      expect(await registry.agencyName(outsider.address)).to.equal("Relief NGO");
    });

    it("rejects approving the zero address or an empty name", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(registry.approveAgency(ethers.ZeroAddress, "X")).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress",
      );
      await expect(registry.approveAgency(outsider.address, "")).to.be.revertedWithCustomError(registry, "EmptyName");
    });

    it("removes an agency, which can then no longer record", async function () {
      const { registry, admin, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      await expect(registry.removeAgency(agencyA.address))
        .to.emit(registry, "AgencyRemoved")
        .withArgs(agencyA.address, admin.address);
      expect(await registry.isAgency(agencyA.address)).to.equal(false);
      await expect(registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(agencyA.address, await registry.AGENCY_ROLE());
    });

    it("keeps a removed agency's past records and name", async function () {
      const { registry, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await registry.removeAgency(agencyA.address);
      expect(await registry.hasReceived(campaignId, alice, FOOD_KIT)).to.equal(true);
      expect(await registry.agencyName(agencyA.address)).to.equal("Agency A");
    });

    it("blocks non-coordinators from all coordinator actions", async function () {
      const { registry, agencyA, outsider, campaignId, alice } = await loadFixture(deployFixture);
      const COORDINATOR_ROLE = await registry.COORDINATOR_ROLE();
      // An approved agency is still not a coordinator.
      const asAgency = registry.connect(agencyA);
      const now = await time.latest();

      await expect(asAgency.createCampaign("X", "Y", now, now + ONE_DAY, AID_TYPES))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(agencyA.address, COORDINATOR_ROLE);
      await expect(asAgency.approveAgency(outsider.address, "Me")).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
      await expect(asAgency.removeAgency(agencyA.address)).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
      await expect(asAgency.closeCampaign(campaignId)).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
      await expect(asAgency.voidDistribution(campaignId, alice, FOOD_KIT, "typo")).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("blocks an agency from granting itself the coordinator role", async function () {
      const { registry, agencyA } = await loadFixture(deployFixture);
      await expect(
        registry.connect(agencyA).grantRole(await registry.COORDINATOR_ROLE(), agencyA.address),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  // ---------------------------------------------------------------------
  describe("Campaigns", function () {
    it("creates a campaign with correct details and event", async function () {
      const { registry, admin, now } = await loadFixture(deployFixture);
      await expect(registry.createCampaign("Cyclone", "Coast", now, now + ONE_DAY, [FOOD_KIT, CASH]))
        .to.emit(registry, "CampaignCreated")
        .withArgs(2n, "Cyclone", "Coast", now, now + ONE_DAY, [FOOD_KIT, CASH], admin.address);

      const c = await registry.getCampaign(2n);
      expect(c.name).to.equal("Cyclone");
      expect(c.region).to.equal("Coast");
      expect(c.closed).to.equal(false);
      expect(c.aidTypes).to.deep.equal([FOOD_KIT, CASH]);
      expect(await registry.campaignCount()).to.equal(2n);
      expect(await registry.isAidTypeInCampaign(2n, CASH)).to.equal(true);
      expect(await registry.isAidTypeInCampaign(2n, SHELTER)).to.equal(false);
    });

    it("validates campaign input", async function () {
      const { registry, now } = await loadFixture(deployFixture);
      await expect(registry.createCampaign("", "R", now, now + 1, AID_TYPES)).to.be.revertedWithCustomError(
        registry,
        "EmptyName",
      );
      await expect(registry.createCampaign("N", "R", now, now, AID_TYPES)).to.be.revertedWithCustomError(
        registry,
        "InvalidTimeWindow",
      );
      await expect(registry.createCampaign("N", "R", now, now + 1, [])).to.be.revertedWithCustomError(
        registry,
        "NoAidTypes",
      );
      await expect(registry.createCampaign("N", "R", now, now + 1, [FOOD_KIT, FOOD_KIT]))
        .to.be.revertedWithCustomError(registry, "InvalidAidType")
        .withArgs(FOOD_KIT);
      await expect(registry.createCampaign("N", "R", now, now + 1, [ethers.ZeroHash]))
        .to.be.revertedWithCustomError(registry, "InvalidAidType")
        .withArgs(ethers.ZeroHash);
    });

    it("reverts for unknown campaign IDs", async function () {
      const { registry, agencyA, alice } = await loadFixture(deployFixture);
      await expect(registry.getCampaign(0n)).to.be.revertedWithCustomError(registry, "CampaignNotFound").withArgs(0n);
      await expect(registry.getCampaign(99n)).to.be.revertedWithCustomError(registry, "CampaignNotFound");
      await expect(registry.closeCampaign(99n)).to.be.revertedWithCustomError(registry, "CampaignNotFound");
      await expect(
        registry.connect(agencyA).recordDistribution(99n, alice, FOOD_KIT),
      ).to.be.revertedWithCustomError(registry, "CampaignNotFound");
      expect(await registry.isCampaignActive(0n)).to.equal(false);
      expect(await registry.isCampaignActive(99n)).to.equal(false);
    });

    it("closes a campaign, which blocks recording", async function () {
      const { registry, admin, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      await expect(registry.closeCampaign(campaignId))
        .to.emit(registry, "CampaignClosed")
        .withArgs(campaignId, admin.address);
      expect(await registry.isCampaignActive(campaignId)).to.equal(false);
      await expect(registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT))
        .to.be.revertedWithCustomError(registry, "CampaignIsClosed")
        .withArgs(campaignId);
      await expect(
        registry.connect(agencyA).recordBatch(campaignId, [alice], [FOOD_KIT]),
      ).to.be.revertedWithCustomError(registry, "CampaignIsClosed");
    });

    it("cannot close a campaign twice", async function () {
      const { registry, campaignId } = await loadFixture(deployFixture);
      await registry.closeCampaign(campaignId);
      await expect(registry.closeCampaign(campaignId)).to.be.revertedWithCustomError(registry, "CampaignIsClosed");
    });

    it("blocks recording before the start time and after the end time", async function () {
      const { registry, agencyA, alice, now } = await loadFixture(deployFixture);
      const start = now + ONE_DAY;
      const end = now + 2 * ONE_DAY;
      await registry.createCampaign("Future", "R", start, end, AID_TYPES);
      const futureId = 2n;
      const nullifier = alice; // any non-zero hash works for this check

      expect(await registry.isCampaignActive(futureId)).to.equal(false);
      await expect(registry.connect(agencyA).recordDistribution(futureId, nullifier, FOOD_KIT))
        .to.be.revertedWithCustomError(registry, "CampaignNotActive")
        .withArgs(futureId, start, end);

      await time.increaseTo(start);
      expect(await registry.isCampaignActive(futureId)).to.equal(true);
      await registry.connect(agencyA).recordDistribution(futureId, nullifier, FOOD_KIT);

      await time.increaseTo(end + 1);
      expect(await registry.isCampaignActive(futureId)).to.equal(false);
      await expect(
        registry.connect(agencyA).recordDistribution(futureId, nullifier, CASH),
      ).to.be.revertedWithCustomError(registry, "CampaignNotActive");
    });
  });

  // ---------------------------------------------------------------------
  describe("Recording distributions", function () {
    it("records a distribution and emits an event", async function () {
      const { registry, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      const tx = registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await expect(tx).to.emit(registry, "DistributionRecorded");

      const ts = await time.latest();
      await expect(tx)
        .to.emit(registry, "DistributionRecorded")
        .withArgs(campaignId, alice, FOOD_KIT, agencyA.address, ts);

      expect(await registry.hasReceived(campaignId, alice, FOOD_KIT)).to.equal(true);
      const [agency, timestamp] = await registry.getDistribution(campaignId, alice, FOOD_KIT);
      expect(agency).to.equal(agencyA.address);
      expect(timestamp).to.equal(ts);
    });

    it("DUPLICATE: blocks the same person getting the same aid twice (even from another agency)", async function () {
      const { registry, agencyA, agencyB, campaignId, alice } = await loadFixture(deployFixture);
      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      const firstTs = await time.latest();

      // Same agency again
      await expect(registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT))
        .to.be.revertedWithCustomError(registry, "AlreadyReceived")
        .withArgs(campaignId, alice, FOOD_KIT, agencyA.address, firstTs);

      // A different agency: this is the real-world double-dipping case
      await expect(
        registry.connect(agencyB).recordDistribution(campaignId, alice, FOOD_KIT),
      ).to.be.revertedWithCustomError(registry, "AlreadyReceived");
    });

    it("DUPLICATE: catches the same ID typed with different spacing/dashes/case", async function () {
      const { registry, agencyA, agencyB, campaignId, secret } = await loadFixture(deployFixture);
      const typedByA = computeNullifier(secret, campaignId, "ab-12 34");
      const typedByB = computeNullifier(secret, campaignId, "  AB1234 ");
      expect(typedByA).to.equal(typedByB);

      await registry.connect(agencyA).recordDistribution(campaignId, typedByA, CASH);
      await expect(
        registry.connect(agencyB).recordDistribution(campaignId, typedByB, CASH),
      ).to.be.revertedWithCustomError(registry, "AlreadyReceived");
    });

    it("allows the same person to receive a DIFFERENT aid type", async function () {
      const { registry, agencyA, agencyB, campaignId, alice } = await loadFixture(deployFixture);
      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await expect(registry.connect(agencyB).recordDistribution(campaignId, alice, MEDICAL)).to.emit(
        registry,
        "DistributionRecorded",
      );
      expect(await registry.hasReceived(campaignId, alice, FOOD_KIT)).to.equal(true);
      expect(await registry.hasReceived(campaignId, alice, MEDICAL)).to.equal(true);
      expect(await registry.hasReceived(campaignId, alice, CASH)).to.equal(false);
    });

    it("allows the same person in a DIFFERENT campaign (different nullifier)", async function () {
      const { registry, agencyA, campaignId, secret, alice, now } = await loadFixture(deployFixture);
      await registry.createCampaign("Earthquake", "District 9", now, now + 30 * ONE_DAY, AID_TYPES);
      const campaign2 = 2n;

      // Same person, same secret, same ID, only the campaign differs -> different hash
      const aliceInCampaign2 = computeNullifier(secret, campaign2, "1234-5678");
      expect(aliceInCampaign2).to.not.equal(alice);

      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await registry.connect(agencyA).recordDistribution(campaign2, aliceInCampaign2, FOOD_KIT);

      // And the campaign-1 hash says nothing about campaign 2
      expect(await registry.hasReceived(campaign2, alice, FOOD_KIT)).to.equal(false);
    });

    it("blocks an unauthorized (never approved) account", async function () {
      const { registry, outsider, campaignId, alice } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).recordDistribution(campaignId, alice, FOOD_KIT))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, await registry.AGENCY_ROLE());
      await expect(
        registry.connect(outsider).recordBatch(campaignId, [alice], [FOOD_KIT]),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("blocks a coordinator who is not also an agency from recording", async function () {
      const { registry, admin, campaignId, alice } = await loadFixture(deployFixture);
      await expect(
        registry.connect(admin).recordDistribution(campaignId, alice, FOOD_KIT),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects an aid type that is not part of the campaign", async function () {
      const { registry, agencyA, alice, now } = await loadFixture(deployFixture);
      await registry.createCampaign("Food only", "R", now, now + ONE_DAY, [FOOD_KIT]);
      await expect(registry.connect(agencyA).recordDistribution(2n, alice, CASH))
        .to.be.revertedWithCustomError(registry, "AidTypeNotInCampaign")
        .withArgs(2n, CASH);
    });

    it("rejects the zero nullifier", async function () {
      const { registry, agencyA, campaignId } = await loadFixture(deployFixture);
      await expect(
        registry.connect(agencyA).recordDistribution(campaignId, ethers.ZeroHash, FOOD_KIT),
      ).to.be.revertedWithCustomError(registry, "InvalidNullifier");
    });
  });

  // ---------------------------------------------------------------------
  describe("Batch recording", function () {
    it("records a whole batch", async function () {
      const { registry, agencyA, campaignId, alice, bob } = await loadFixture(deployFixture);
      await expect(registry.connect(agencyA).recordBatch(campaignId, [alice, bob, alice], [FOOD_KIT, FOOD_KIT, CASH]))
        .to.emit(registry, "DistributionRecorded")
        .withArgs(campaignId, bob, FOOD_KIT, agencyA.address, (ts: bigint) => ts > 0n);
      expect(await registry.hasReceived(campaignId, alice, FOOD_KIT)).to.equal(true);
      expect(await registry.hasReceived(campaignId, bob, FOOD_KIT)).to.equal(true);
      expect(await registry.hasReceived(campaignId, alice, CASH)).to.equal(true);
      expect(await registry.totalByAgency(campaignId, agencyA.address)).to.equal(3n);
    });

    it("reverts the WHOLE batch if it contains a duplicate inside it", async function () {
      const { registry, agencyA, campaignId, alice, bob } = await loadFixture(deployFixture);
      await expect(
        registry.connect(agencyA).recordBatch(campaignId, [alice, bob, alice], [FOOD_KIT, FOOD_KIT, FOOD_KIT]),
      )
        .to.be.revertedWithCustomError(registry, "AlreadyReceived")
        .withArgs(campaignId, alice, FOOD_KIT, agencyA.address, (ts: bigint) => ts > 0n);

      // All-or-nothing: bob was NOT recorded either
      expect(await registry.hasReceived(campaignId, alice, FOOD_KIT)).to.equal(false);
      expect(await registry.hasReceived(campaignId, bob, FOOD_KIT)).to.equal(false);
      expect(await registry.totalByAidType(campaignId, FOOD_KIT)).to.equal(0n);
    });

    it("reverts the batch if one entry was already recorded earlier", async function () {
      const { registry, agencyA, agencyB, campaignId, alice, bob } = await loadFixture(deployFixture);
      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await expect(
        registry.connect(agencyB).recordBatch(campaignId, [bob, alice], [FOOD_KIT, FOOD_KIT]),
      ).to.be.revertedWithCustomError(registry, "AlreadyReceived");
      expect(await registry.hasReceived(campaignId, bob, FOOD_KIT)).to.equal(false);
    });

    it("rejects empty and mismatched batches", async function () {
      const { registry, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      await expect(registry.connect(agencyA).recordBatch(campaignId, [], [])).to.be.revertedWithCustomError(
        registry,
        "EmptyBatch",
      );
      await expect(
        registry.connect(agencyA).recordBatch(campaignId, [alice], [FOOD_KIT, CASH]),
      ).to.be.revertedWithCustomError(registry, "ArrayLengthMismatch");
    });

    it("rejects a batch with an invalid aid type or zero nullifier", async function () {
      const { registry, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      await expect(
        registry.connect(agencyA).recordBatch(campaignId, [alice], [encodeBytes32String("TOYS")]),
      ).to.be.revertedWithCustomError(registry, "AidTypeNotInCampaign");
      await expect(
        registry.connect(agencyA).recordBatch(campaignId, [ethers.ZeroHash], [FOOD_KIT]),
      ).to.be.revertedWithCustomError(registry, "InvalidNullifier");
    });
  });

  // ---------------------------------------------------------------------
  describe("Voiding", function () {
    it("voids a wrong entry, then allows it to be re-recorded", async function () {
      const { registry, admin, agencyA, agencyB, campaignId, alice } = await loadFixture(deployFixture);
      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);

      await expect(registry.voidDistribution(campaignId, alice, FOOD_KIT, "Typo in ID number"))
        .to.emit(registry, "DistributionVoided")
        .withArgs(campaignId, alice, FOOD_KIT, agencyA.address, admin.address, "Typo in ID number");

      expect(await registry.hasReceived(campaignId, alice, FOOD_KIT)).to.equal(false);
      expect(await registry.totalByAidType(campaignId, FOOD_KIT)).to.equal(0n);
      expect(await registry.totalByAgency(campaignId, agencyA.address)).to.equal(0n);

      // Re-record (by a different agency this time)
      await registry.connect(agencyB).recordDistribution(campaignId, alice, FOOD_KIT);
      expect(await registry.hasReceived(campaignId, alice, FOOD_KIT)).to.equal(true);
      const [agency] = await registry.getDistribution(campaignId, alice, FOOD_KIT);
      expect(agency).to.equal(agencyB.address);
      expect(await registry.totalByAidType(campaignId, FOOD_KIT)).to.equal(1n);
      expect(await registry.totalByAgency(campaignId, agencyB.address)).to.equal(1n);
    });

    it("cannot void something that was never recorded (or already voided)", async function () {
      const { registry, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      await expect(registry.voidDistribution(campaignId, alice, FOOD_KIT, "x"))
        .to.be.revertedWithCustomError(registry, "DistributionNotFound")
        .withArgs(campaignId, alice, FOOD_KIT);

      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await registry.voidDistribution(campaignId, alice, FOOD_KIT, "x");
      await expect(registry.voidDistribution(campaignId, alice, FOOD_KIT, "x")).to.be.revertedWithCustomError(
        registry,
        "DistributionNotFound",
      );
    });

    it("requires a reason and an existing campaign", async function () {
      const { registry, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await expect(registry.voidDistribution(campaignId, alice, FOOD_KIT, "")).to.be.revertedWithCustomError(
        registry,
        "EmptyReason",
      );
      await expect(registry.voidDistribution(42n, alice, FOOD_KIT, "x")).to.be.revertedWithCustomError(
        registry,
        "CampaignNotFound",
      );
    });

    it("can still void after the campaign is closed (audit correction)", async function () {
      const { registry, agencyA, campaignId, alice } = await loadFixture(deployFixture);
      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await registry.closeCampaign(campaignId);
      await expect(registry.voidDistribution(campaignId, alice, FOOD_KIT, "fraud found in audit")).to.emit(
        registry,
        "DistributionVoided",
      );
    });
  });

  // ---------------------------------------------------------------------
  describe("Totals (counts only, no personal data)", function () {
    it("counts per aid type and per agency", async function () {
      const { registry, agencyA, agencyB, campaignId, alice, bob } = await loadFixture(deployFixture);
      await registry.connect(agencyA).recordDistribution(campaignId, alice, FOOD_KIT);
      await registry.connect(agencyB).recordDistribution(campaignId, bob, FOOD_KIT);
      await registry.connect(agencyB).recordDistribution(campaignId, bob, SHELTER);

      expect(await registry.totalByAidType(campaignId, FOOD_KIT)).to.equal(2n);
      expect(await registry.totalByAidType(campaignId, SHELTER)).to.equal(1n);
      expect(await registry.totalByAgency(campaignId, agencyA.address)).to.equal(1n);
      expect(await registry.totalByAgency(campaignId, agencyB.address)).to.equal(2n);

      const [types, counts] = await registry.getTotalsByAidType(campaignId);
      expect(types).to.deep.equal(AID_TYPES);
      expect(counts).to.deep.equal([2n, 0n, 0n, 1n]);
    });
  });
});
