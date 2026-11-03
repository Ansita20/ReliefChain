/**
 * Seed demo data: one "Flood Relief Demo" campaign, 3 demo agencies, and some distributions.
 *
 *   npm run seed:local     (after deploy:local)
 *   npm run seed:sepolia   (after deploy:sepolia)
 *
 * The campaign secret is generated here and written ONLY to demo-secrets/ (git-ignored),
 * never to the chain. In real life the coordinator would hand it to agencies in person
 * or over an encrypted channel. Load that file in the Agency Desk to try the demo.
 *
 * It also sets up Relief IDs (for people without any government ID): a community verifier,
 * an enrollment secret (written to demo-secrets/ too) and two demo cards.
 *
 * The beneficiary IDs below are FAKE demo IDs. On a real deployment, raw IDs would
 * never appear in a script like this.
 */
import { ethers, network } from "hardhat";
import { encodeBytes32String } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { computeNullifier, generateCampaignSecret } from "../shared/nullifier";
import { computeDedupTag, hashReliefId, reliefIdSubject } from "../shared/reliefId";

const ROOT = path.join(__dirname, "..");
const AID_LABELS = ["FOOD_KIT", "CASH", "MEDICAL", "SHELTER"];
const aid = (label: string) => encodeBytes32String(label);

// Fictional agency names for the demo
const DEMO_AGENCY_NAMES = ["Sunrise Relief Trust", "Riverbank Aid Network", "Community Health Volunteers"];
const DEMO_VERIFIER_NAME = "Riverside Village Council";

// FAKE demo Relief ID cards (real ones come from generateReliefId()).
const VALID_CARD = "RID-7KQ2-M9XD-4HPA-TT3W"; // enrolled + vouched, already got a food kit
const PENDING_CARD = "RID-3NFB-W8RC-6YJE-2DQK"; // enrolled, waiting for a second vouch

async function main() {
  const deploymentFile = path.join(ROOT, "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found for "${network.name}". Run the deploy script first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const signers = await ethers.getSigners();
  const coordinator = signers[0];
  const registry = await ethers.getContractAt("ReliefRegistry", deployment.address, coordinator);

  console.log(`Seeding ReliefRegistry at ${deployment.address} on ${network.name}`);

  // ---- 1. Campaign: open from one hour ago until 30 days from now ----
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  await (
    await registry.createCampaign(
      "Flood Relief Demo",
      "Riverside District",
      now - 3600,
      now + 30 * 24 * 3600,
      AID_LABELS.map(aid),
    )
  ).wait();
  const campaignId = await registry.campaignCount();
  console.log(`Created campaign #${campaignId} "Flood Relief Demo"`);

  // ---- 2. Agencies ----
  // Local: Hardhat test accounts #1-#3 (their keys are printed by `npm run node`, import them into MetaMask).
  // Sepolia: we only hold one key, so the deployer is approved as an agency itself,
  //          plus any extra addresses listed in DEMO_AGENCY_ADDRESSES.
  let agencies: { address: string; name: string; signer?: (typeof signers)[number] }[];
  if (network.name === "sepolia") {
    const extra = (process.env.DEMO_AGENCY_ADDRESSES ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    agencies = [
      { address: coordinator.address, name: DEMO_AGENCY_NAMES[0], signer: coordinator },
      ...extra.slice(0, 2).map((address, i) => ({ address, name: DEMO_AGENCY_NAMES[i + 1] })),
    ];
  } else {
    agencies = DEMO_AGENCY_NAMES.map((name, i) => ({ address: signers[i + 1].address, name, signer: signers[i + 1] }));
  }

  for (const a of agencies) {
    await (await registry.approveAgency(a.address, a.name)).wait();
    console.log(`Approved agency "${a.name}" (${a.address})`);
  }

  // ---- 3. Campaign secret (off-chain only!) ----
  const secret = generateCampaignSecret();
  const { chainId } = await ethers.provider.getNetwork();
  const secretsDir = path.join(ROOT, "demo-secrets");
  fs.mkdirSync(secretsDir, { recursive: true });
  const secretFile = path.join(secretsDir, `${network.name}-campaign-${campaignId}.json`);
  fs.writeFileSync(
    secretFile,
    JSON.stringify(
      { chainId: Number(chainId), campaignId: Number(campaignId), campaignName: "Flood Relief Demo", campaignSecret: secret },
      null,
      2,
    ),
  );

  // ---- 4. Distributions (fake demo IDs) ----
  // [agencyIndex, beneficiary ID, aid type]
  const singles: [number, string, string][] = [
    [0, "1234-5678", "FOOD_KIT"], // <- used in the "try to get aid twice" demo moment
    [0, "1234-5678", "MEDICAL"],
    [1, "2345-6789", "FOOD_KIT"],
    [1, "2345-6789", "SHELTER"],
    [2, "3456-7890", "MEDICAL"],
    [2, "4567-8901", "CASH"],
    [0, "5678-9012", "CASH"],
  ];
  // One batch, to show recordBatch in the audit trail
  const batch: [number, string[], string] = [1, ["6789-0123", "7890-1234", "8901-2345", "9012-3456"], "FOOD_KIT"];

  let recorded = 0;
  for (const [agencyIndex, id, label] of singles) {
    const agency = agencies[agencyIndex] ?? agencies[0];
    const signer = agency.signer ?? coordinator; // on Sepolia, fall back to the deployer
    const nullifier = computeNullifier(secret, campaignId, id);
    await (await registry.connect(signer).recordDistribution(campaignId, nullifier, aid(label))).wait();
    recorded++;
  }

  const [batchAgencyIndex, batchIds, batchLabel] = batch;
  const batchSigner = agencies[batchAgencyIndex]?.signer ?? coordinator;
  await (
    await registry.connect(batchSigner).recordBatch(
      campaignId,
      batchIds.map((id) => computeNullifier(secret, campaignId, id)),
      batchIds.map(() => aid(batchLabel)),
    )
  ).wait();
  recorded += batchIds.length;

  console.log(`Recorded ${recorded} demo distributions (including one batch of ${batchIds.length}).`);

  // ---- 5. Relief IDs for people without government ID ----
  // Local: Hardhat account #4 is the community verifier. Sepolia: the deployer enrolls
  // (as coordinator), and the second vouch is left for a live demo.
  const verifierSigner = network.name === "sepolia" ? undefined : signers[4];
  if (verifierSigner) {
    await (await registry.approveVerifier(verifierSigner.address, DEMO_VERIFIER_NAME)).wait();
    console.log(`Approved community verifier "${DEMO_VERIFIER_NAME}" (${verifierSigner.address})`);
  }
  const enroller = verifierSigner ?? coordinator;

  const enrollmentSecret = generateCampaignSecret();
  const enrollmentFile = path.join(secretsDir, `${network.name}-enrollment.json`);
  fs.writeFileSync(enrollmentFile, JSON.stringify({ chainId: Number(chainId), enrollmentSecret }, null, 2));

  // Fictional people
  const validTag = computeDedupTag(enrollmentSecret, {
    fullName: "Asha Nadi",
    parentName: "Meera Nadi",
    village: "Riverside",
    birthYear: 1979,
  });
  const pendingTag = computeDedupTag(enrollmentSecret, {
    fullName: "Tomas Ferro",
    parentName: "Ana Ferro",
    village: "Riverside Camp 2",
    birthYear: 2001,
  });

  const validHash = hashReliefId(VALID_CARD);
  await (await registry.connect(enroller).enrollReliefId(validHash, validTag)).wait();
  const agencySigner = agencies[0].signer ?? coordinator;
  if (agencySigner.address !== enroller.address) {
    await (await registry.connect(agencySigner).vouchForReliefId(validHash)).wait();
  } else {
    console.log("(Skipped the second vouch: on this network the enroller and the agency are the same account.)");
  }
  await (await registry.connect(agencySigner).enrollReliefId(hashReliefId(PENDING_CARD), pendingTag)).wait();

  // The valid card holder already received a food kit: their nullifier comes from the card's root.
  if ((await registry.getReliefId(validHash)).valid) {
    const nullifier = computeNullifier(secret, campaignId, reliefIdSubject(validHash));
    await (await registry.connect(agencySigner).recordDistribution(campaignId, nullifier, aid("FOOD_KIT"))).wait();
  }
  console.log("Enrolled 2 demo Relief IDs.");
  console.log("\n================ DEMO INFO ================");
  console.log(`Campaign ID:      ${campaignId}`);
  console.log(`Campaign secret:  ${secret}`);
  console.log(`Secret file:      ${path.relative(ROOT, secretFile)}  (load this in the Agency Desk)`);
  console.log(`Already served:   ID 1234-5678 received FOOD_KIT and MEDICAL`);
  console.log(`Not yet served:   ID 1111-2222 (try it!)`);
  console.log(`Enrollment file:  ${path.relative(ROOT, enrollmentFile)}  (load this on the Relief IDs page)`);
  console.log(`Relief ID cards:  ${VALID_CARD}  valid, already received FOOD_KIT`);
  console.log(`                  ${PENDING_CARD}  waiting for a 2nd vouch (vouch as account #2 or #4)`);
  console.log("===========================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
