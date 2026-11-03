/** About: the problem, the nullifier design and the threat model in plain language. */
export function About() {
  return (
    <div className="page prose">
      <header className="page-header">
        <span className="eyebrow">How it works</span>
        <h1>About ReliefChain</h1>
        <p className="lead">A shared, tamper-proof registry that stops duplicate aid without sharing anyone's identity.</p>
      </header>

      <section className="card">
        <h2>The problem</h2>
        <p>
          After a disaster, many NGOs and government agencies hand out aid at the same time. For privacy reasons they
          can't share their beneficiary lists with each other. The result: some families receive the same food kit
          three times while others get nothing.
        </p>
        <p>
          ReliefChain lets every approved agency ask one question:{" "}
          <em>"Has this person already received this type of aid in this campaign?"</em> without anyone ever seeing
          a name or an ID number.
        </p>
      </section>

      <section className="card">
        <h2>How it works: nullifiers</h2>
        <ol className="steps">
          <li>
            <strong>The volunteer types the ID number</strong> into the Agency Desk. It is cleaned up first (spaces and
            dashes removed, uppercase) so <code>1234 5678</code> and <code>1234-5678</code> count as the same person.
          </li>
          <li>
            <strong>The browser turns it into a fingerprint</strong>, called a <em>nullifier</em>:
            <pre className="formula">nullifier = keccak256(abi.encode(campaignSecret, campaignId, normalizedId))</pre>
            This is a one-way hash: easy to compute, practically impossible to reverse.
          </li>
          <li>
            <strong>Only the nullifier goes to the blockchain.</strong> The smart contract remembers "nullifier X got
            FOOD_KIT from Agency A at 14:05" and refuses a second FOOD_KIT for the same nullifier.
          </li>
        </ol>

        <h3>Why the campaign ID is mixed in</h3>
        <p>
          The same person produces a <em>different</em> nullifier in every campaign. So someone watching the blockchain
          can't link "the person helped after the 2025 flood" to "the person helped after the 2026 earthquake".
        </p>

        <h3>Why there is a campaign secret</h3>
        <p>
          ID numbers are short and predictable. An 8-digit ID has only 100 million possibilities, which a laptop can
          hash in minutes. Without a secret, an attacker could hash every possible ID and match them against the public
          nullifiers. The campaign secret is a random 256-bit value shared <strong>off-chain</strong>, only with
          approved agencies. Without it, guessing is hopeless.
        </p>
      </section>

      <section className="card">
        <h2>How the smart contract works</h2>
        <p>
          <code>ReliefRegistry</code> is one small Solidity contract. It stores, for each campaign, a table of{" "}
          <em>nullifier + aid type → (agency, time)</em>. Three roles decide who may do what.
        </p>
        <ol className="flow">
          <li className="flow-step">
            <span className="badge flow-who">Coordinator</span>
            <h3>Set up</h3>
            <p>
              Creates a campaign (name, region, time window, aid types) and approves NGO wallets as agencies with{" "}
              <code>approveAgency</code>.
            </p>
          </li>
          <li className="flow-step">
            <span className="badge flow-who">Agency browser</span>
            <h3>Hash</h3>
            <p>The volunteer types the ID. The browser turns it into a nullifier. The ID itself never leaves the device.</p>
          </li>
          <li className="flow-step">
            <span className="badge flow-who">Anyone · free</span>
            <h3>Check</h3>
            <p>
              <code>hasReceived(campaign, nullifier, aidType)</code> is a read call: no wallet, no gas, instant answer.
            </p>
          </li>
          <li className="flow-step">
            <span className="badge flow-who">Agency · transaction</span>
            <h3>Record</h3>
            <p>
              <code>recordDistribution</code> (or <code>recordBatch</code>) stores the record and emits a public event
              the dashboard reads.
            </p>
          </li>
        </ol>

        <h3>What the contract checks before it records anything</h3>
        <ul className="checks">
          <li>The sender's wallet has the agency role</li>
          <li>The campaign exists, isn't closed, and is inside its time window</li>
          <li>The aid type belongs to this campaign</li>
          <li className="check-reject">
            No record yet for this nullifier + aid type. Otherwise it reverts with <code>AlreadyReceived</code>,
            naming the agency and time of the first record.
          </li>
        </ul>
        <p className="hint">
          A batch is all-or-nothing: one duplicate rolls back the whole batch. A coordinator can void a mistaken record
          (with a reason); the original stays in the event log forever.
        </p>
      </section>

      <section className="card">
        <h2>What is on-chain, and what is not</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Where it lives</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Name, ID number</td>
                <td>Nowhere. Typed into one device's memory, then discarded.</td>
              </tr>
              <tr>
                <td>Campaign secret</td>
                <td>Coordinator and approved agencies only (off-chain)</td>
              </tr>
              <tr>
                <td>Nullifier (hash)</td>
                <td>On-chain, public</td>
              </tr>
              <tr>
                <td>Aid type, agency, time</td>
                <td>On-chain, public</td>
              </tr>
              <tr>
                <td>Counts per aid type / agency</td>
                <td>On-chain, public</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>People without any government ID: Relief IDs</h2>
        <ol className="steps">
          <li>
            <strong>Enroll.</strong> An agency or community verifier (village head, health worker, teacher) gives the
            person a card with a random number like <code>RID-7KQ2-M9XD-4HPA-TT3W</code>. Only its hash goes on-chain.
          </li>
          <li>
            <strong>No double enrollment.</strong> The person's name, parent's name, village and birth decade are
            hashed on the device with a secret enrollment key into a <em>dedup tag</em>. The contract refuses a second
            card with the same tag, without ever seeing the details.
          </li>
          <li>
            <strong>Community vouching.</strong> The card only works after enough <em>different</em> agencies or
            verifiers vouch for the person (2 by default, set by the coordinator). Every vouch is signed and public.
          </li>
          <li>
            <strong>Use it like an ID.</strong> At the Agency Desk, choose "Relief ID card" and type the number. The
            nullifier is computed from the card's on-chain <em>root</em>, so if a lost card is replaced, the new card
            gives the same nullifier and the person still can't collect aid twice.
          </li>
        </ol>
      </section>

      <section className="card">
        <h2>Threat model: honest limits</h2>
        <ul className="threats">
          <li>
            <strong>If the campaign secret leaks</strong>, whoever has it can brute-force IDs and find out whether a
            specific known person received aid in that campaign. Mitigation: share secrets carefully, use a new secret
            per campaign, keep campaigns short.
          </li>
          <li>
            <strong>A malicious approved agency</strong> could record fake distributions or skip recording real ones.
            The contract can't see what physically happens. Mitigation: every record is signed by the agency's wallet
            and publicly visible, coordinators can remove agencies and void entries, and auditors can compare counts.
          </li>
          <li>
            <strong>People without ID documents</strong> get a <a href="#/relief-ids">Relief ID</a>: a random card
            number that agencies and community verifiers vouch for on-chain. It is only as strong as the vouchers: a
            group of colluding vouchers could create fake people. Every vouch is public and signed, so this can be
            audited, and coordinators can revoke cards and remove verifiers. The duplicate check uses name, parent's
            name, village and birth decade, so a person who gives very different details could still enroll twice.
          </li>
          <li>
            <strong>The coordinator is trusted.</strong> They decide who is an agency and can void entries. All of
            this is public, but it is still a central role.
          </li>
          <li>
            <strong>What ReliefChain does NOT solve:</strong> people who never reach a distribution point are
            invisible to it. It prevents duplicates; it doesn't find the people who were missed.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Future work</h2>
        <ul>
          <li>Zero-knowledge proofs, so even the nullifier reveals nothing about the agency or time.</li>
          <li>Offline mode: check against a cached list in the field, sync when back online.</li>
          <li>Relief IDs as zero-knowledge credentials, so even the card's root never appears in a nullifier input.</li>
        </ul>
      </section>
    </div>
  );
}
