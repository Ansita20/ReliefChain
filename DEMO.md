# ReliefChain: 5-minute live demo script

Goal: show the professor that (1) duplicates are blocked across agencies, (2) no personal data leaves the device, (3) the same person gets an unlinkable hash in another campaign, and (4) everything is publicly auditable.

---

## Before the demo (10 minutes beforehand)

1. **Fresh start:** `npm run dev:all`. Wait for `Ready! Open http://localhost:5173`.
2. **MetaMask**
   - Network `Hardhat Local` (RPC `http://127.0.0.1:8545`, chain ID `31337`) is selected.
   - Accounts #0 (Coordinator), #1 (Sunrise Relief Trust) and #2 (Riverbank Aid Network) are imported (keys in the README).
   - **Settings → Advanced → Clear activity tab data** (needed after every node restart).
3. **Browser tabs** (in this order):
   - Tab 1: `http://localhost:5173/#/dashboard`
   - Tab 2: `http://localhost:5173/#/desk`
   - Tab 3: `http://localhost:5173/#/coordinator`
4. In Tab 2 (Agency Desk), with MetaMask on **account #1**, click **Connect wallet**. Leave the secret and ID empty.
5. Have `demo-secrets/localhost-campaign-1.json` easy to find in the file picker.
6. Optional: zoom the browser to 125% so the back row can read it.

Demo IDs from the seed:

| ID | State |
|---|---|
| `1234-5678` | already received **Food kit** + **Medical** from Sunrise Relief Trust |
| `1111-2222` | not yet served |

---

## The script

### 0:00–0:30 · The problem (no screen needed)
> "After a flood, ten NGOs hand out food at the same time. They can't share beneficiary lists because it's personal data. So some families get three food kits and others get none. ReliefChain lets agencies ask 'has this person already had a food kit?' **without anyone ever seeing a name or an ID number**."

### 0:30–1:00 · Public dashboard (Tab 1)
- Point at the four numbers and the charts: *"Anyone can open this. No wallet, no login, no server. It's rebuilt live from the blockchain's event log."*
- Point at the live feed: *"Notice there are no names, only short hash prefixes like `0x9d27…`."*

### 1:00–1:45 · The volunteer checks someone (Tab 2)
1. Campaign: **Flood Relief Demo**. Aid type: **Food kit**.
2. Click **Load secret file** and pick `localhost-campaign-1.json`.
   > "This secret is shared privately with approved agencies only. I'll explain why in a second."
3. Type **`1234 5678`** (with a space).
   - 🔴 **ALREADY RECEIVED: Food kit by Sunrise Relief Trust on …**
   > "We typed it with a space; it was registered with a dash. The app normalizes the ID, so it still matches."
4. Open the **What goes on-chain** panel:
   > "The ID stays on this device. Only this 32-byte hash is sent. Without the secret, you can't turn the hash back into the ID."

### 1:45–2:45 · ⭐ "Try to get aid twice → blocked"
1. Clear the ID and type **`1111-2222`** → 🟢 **ELIGIBLE: not yet served**.
2. Click **Record distribution** and confirm in MetaMask.
   - The status shows *Transaction sent → Confirmed on-chain*.
   - The banner flips to 🔴 **ALREADY RECEIVED … by Sunrise Relief Trust (you)**.
3. **Switch MetaMask to account #2 (Riverbank Aid Network).** The page updates.
   > "Now this family walks to a *different* NGO across town and asks for another food kit."
4. Type **`1111-2222`** again → 🔴 **ALREADY RECEIVED: Food kit by Sunrise Relief Trust**. The *Record* button is disabled.
   > "Riverbank never saw Sunrise's list, yet the duplicate is caught. Even a modified app couldn't record it: the smart contract itself rejects it with `AlreadyReceived`, and our tests prove that."
5. Tap **Shelter** → 🟢 **ELIGIBLE**: *"Different aid types are tracked separately, so they can still get shelter."*

### 2:45–3:45 · ⭐ "Different campaign → different hash"
1. **Tab 3 (Coordinator)**, MetaMask on **account #0**. Create campaign: name `Earthquake Response`, keep the defaults, click **Create campaign**, confirm in MetaMask.
2. Back in **Tab 2**, in the *What goes on-chain* panel, type `1234-5678` and **read out the first characters of the nullifier** (e.g. `0x9d27…`).
3. Keep the same ID and the same secret, and switch only the campaign dropdown to **#2 Earthquake Response** → the nullifier changes completely (e.g. `0x5be1…`), and the verdict says 🟢 **ELIGIBLE**.
   > "Same person, same ID, but a different hash in each campaign. Someone reading the blockchain can't tell that the flood victim and the earthquake victim are the same person."
   > *(In real use each campaign also gets its own secret; we kept the secret the same here to show that the campaign ID alone changes the hash.)*

### 3:45–4:30 · Correction and audit trail
1. Tab 3 → **Void a wrong entry**:
   - Campaign *Flood Relief Demo*.
   - Tap the most recent entry in *Recent entries*.
   - Reason: `Wrong ID typed by volunteer`.
   - Click **Void entry** and confirm.
2. Tab 1 (Dashboard) → the live feed shows **↺ Voided … reason: "Wrong ID typed by volunteer"** and the counts drop by one.
   > "Mistakes can be corrected, but never silently: the original record and the reason stay public forever."

### Bonus (+1 min) · ⭐ "No ID documents at all"
1. Tab 2 (Agency Desk) → switch **Beneficiary has** to **Relief ID card (no documents)**.
2. Type `RID-3NFB-W8RC-6YJE-2DQK` → ⏳ **WAITING FOR VOUCHES: 1 of 2**.
   > "This person lost everything in the flood, including their ID. An agency enrolled them, but one agency alone isn't enough."
3. Switch MetaMask to account #4 (Riverside Village Council) → **Relief IDs** page → *Check and vouch* → type the card → **I know this person: vouch**.
4. Back on the Agency Desk, retype the card → ✓ **ELIGIBLE**. Try `RID-7KQ2-M9XD-4HPA-TT3W` with Food kit → ✕ **ALREADY RECEIVED**.
   > "The community vouches for the person on-chain, and from then on duplicate prevention works exactly as it does with an ID number. No name is ever stored."

### 4:30–5:00 · Why the secret, and honest limits
> "Why the secret? ID numbers are short. There are only 100 million 8-digit IDs, which a laptop can hash in minutes. Without a secret, anyone could reverse every hash. With a random 256-bit secret, that's impossible."
>
> "Limits: if the secret leaks, people in that campaign can be checked by brute force. A dishonest agency can still lie about what it physically handed out, though every record it signs is public. And this prevents duplicates; it doesn't find families who never reached a distribution point. Next steps would be zero-knowledge proofs and an offline mode."

Optional closer: show `docs/gas-comparison.md`. *"Batching 50 records in one transaction saves 58% gas."*

---

## If something goes wrong

| Problem | Quick fix |
|---|---|
| MetaMask transaction fails with a nonce error | Settings → Advanced → Clear activity tab data, then retry. |
| Red "Can't reach Hardhat Local" banner | The node stopped. Restart `npm run dev:all` (then clear MetaMask activity). |
| "Contract not found" | Restart `npm run dev:all` (it redeploys and reseeds). |
| MetaMask won't cooperate at all | Fall back to the tests: `npm test` shows the `DUPLICATE: blocks the same person…` and `different campaign` tests passing. Then show the dashboard (it needs no wallet). |
| `1111-2222` already shows red at the start | You rehearsed on the same node. Restart `npm run dev:all` for a clean chain, or use another new ID like `2222-3333`. |
