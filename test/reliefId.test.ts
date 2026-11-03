import { expect } from "chai";
import { generateCampaignSecret } from "../shared/nullifier";
import {
  birthDecade,
  computeDedupTag,
  formatReliefId,
  generateReliefId,
  hashReliefId,
  isValidReliefId,
  normalizeName,
  normalizeReliefId,
  reliefIdSubject,
} from "../shared/reliefId";

describe("Relief ID helpers (off-chain)", function () {
  const secret = generateCampaignSecret();
  const person = { fullName: "Ram Kumar", parentName: "Sita Devi", village: "Riverside", birthYear: 1987 };

  it("generates well-formed, unique card numbers", function () {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = generateReliefId();
      expect(id).to.match(/^RID-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
      expect(isValidReliefId(id)).to.equal(true);
      ids.add(id);
    }
    expect(ids.size).to.equal(200);
  });

  it("normalizes case, spacing, the RID prefix and misread letters", function () {
    expect(normalizeReliefId("rid-7kq2 m9xd-4hpa-tt3w")).to.equal("7KQ2M9XD4HPATT3W");
    expect(normalizeReliefId("7KQ2-M9XD-4HPA-TT3W")).to.equal("7KQ2M9XD4HPATT3W");
    expect(normalizeReliefId("O0IL")).to.equal("0011");
    expect(formatReliefId("7kq2m9xd4hpatt3w")).to.equal("RID-7KQ2-M9XD-4HPA-TT3W");
    expect(hashReliefId("rid 7KQ2 M9XD 4HPA TT3W")).to.equal(hashReliefId("RID-7KQ2-M9XD-4HPA-TT3W"));
  });

  it("rejects incomplete or invalid card numbers", function () {
    expect(isValidReliefId("RID-7KQ2-M9XD")).to.equal(false);
    expect(isValidReliefId("RID-7KQ2-M9XD-4HPA-TT3U")).to.equal(false); // U is not in the alphabet
    expect(() => hashReliefId("RID-1234")).to.throw(/16 characters/);
  });

  it("gives a stable, namespaced nullifier subject for a card root", function () {
    const root = hashReliefId("RID-7KQ2-M9XD-4HPA-TT3W");
    expect(reliefIdSubject(root)).to.equal(`RID:${root.toLowerCase()}`);
    expect(reliefIdSubject(root.toUpperCase().replace("0X", "0x"))).to.equal(reliefIdSubject(root));
  });

  it("normalizes names: accents, punctuation, case and word order don't matter", function () {
    expect(normalizeName("  Kumar,  ram ")).to.equal("KUMAR RAM");
    expect(normalizeName("José  Núñez")).to.equal(normalizeName("nunez jose"));
    expect(birthDecade(1987)).to.equal(1980);
  });

  it("gives the same dedup tag for the same person written differently", function () {
    const a = computeDedupTag(secret, person);
    const b = computeDedupTag(secret, { fullName: "KUMAR Ram", parentName: "sita-devi", village: "riverside ", birthYear: 1983 });
    expect(a).to.equal(b);
  });

  it("gives different dedup tags for different people or secrets", function () {
    const a = computeDedupTag(secret, person);
    expect(computeDedupTag(secret, { ...person, parentName: "Gita Devi" })).to.not.equal(a);
    expect(computeDedupTag(secret, { ...person, birthYear: 1995 })).to.not.equal(a);
    expect(computeDedupTag(generateCampaignSecret(), person)).to.not.equal(a);
  });

  it("validates the enrollment secret and details", function () {
    expect(() => computeDedupTag("0x12", person)).to.throw(/secret/);
    expect(() => computeDedupTag(secret, { ...person, village: " - " })).to.throw(/required/);
    expect(() => computeDedupTag(secret, { ...person, birthYear: 87 })).to.throw(/year/);
  });
});
