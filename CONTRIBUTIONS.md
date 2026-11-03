# Contributions

ReliefChain was built by two team members. Each owns one half of the smart contract **and** the matching part of the website, so both of us worked on the blockchain and the frontend.

| | Member A | Member B |
|---|---|---|
| **Name** | Ansita Singh ([@Ansita20](https://github.com/Ansita20)) | [@kavya-tantuvay](https://github.com/kavya-tantuvay) |
| **Theme** | Core aid distribution and duplicate prevention | Relief IDs, live dashboard and app shell |

---

## Member A: core aid distribution and duplicate prevention

Member A owns how aid is recorded on-chain and how the same person is stopped from claiming twice.

### Blockchain

**`contracts/ReliefRegistry.sol`** (the distribution half):
- Roles and access control: coordinator and agency roles.
- Campaigns: `createCampaign`, `closeCampaign`, `getCampaign`, `isCampaignActive`.
- Agencies: `approveAgency`, `removeAgency`, `isAgency`, `isCoordinator`.
- Recording aid: `recordDistribution`, `recordBatch`, `voidDistribution`.
- Lookups: `hasReceived`, `getDistribution`, `getTotalsByAidType`.

**Other files:**

| File | What it does |
|---|---|
| `shared/nullifier.ts` | Turns a beneficiary ID and the campaign secret into a one-way hash (the "nullifier"), so no personal data goes on-chain |
| `contracts/test/NullifierTestHelper.sol` | Checks that the on-chain hash matches the off-chain one |
| `test/ReliefRegistry.test.ts` | Tests for campaigns, agencies, recording, batches, voids and duplicates |
| `test/nullifier.test.ts` | Tests for the hashing function |
| `scripts/deploy.ts` | Deploys the contract and saves its address for the website |
| `scripts/gasComparison.ts`, `docs/gas-comparison.md` | Gas cost of single vs batch recording |
| `hardhat.config.ts` | Compiler and network setup |

### Website

| File | What it does |
|---|---|
| `frontend/src/pages/AgencyDesk.tsx` | Where agency volunteers check eligibility and record aid |
| `frontend/src/pages/CoordinatorPanel.tsx` | Coordinator tools: campaigns, agencies, voiding entries |
| `frontend/src/components/SecretInput.tsx` | Campaign secret input |
| `frontend/src/components/CampaignSelect.tsx` | Campaign picker |
| `frontend/src/components/TxStatus.tsx` | Shows transaction progress |
| `frontend/src/hooks/useTx.ts` | Sends transactions and tracks their state |
| `frontend/src/hooks/useCampaigns.ts` | Loads campaigns from the chain |
| `frontend/src/hooks/useRoles.ts` | Works out whether the wallet is a coordinator or agency |
| `frontend/src/lib/contract.ts` | Connects the website to the deployed contract |
| `frontend/src/lib/errors.ts` | Turns contract errors into plain messages |
| `frontend/src/lib/aidTypes.ts` | The list of aid types (food kit, cash, …) |

---

## Member B: Relief IDs, live dashboard and app shell

Member B owns support for people with **no government ID**, the live public dashboard, and the parts of the app every page uses.

### Blockchain

**`contracts/ReliefRegistry.sol`** (the Relief ID half):
- Verifiers: `approveVerifier`, `removeVerifier`, `isVerifier`.
- Vouching rules: `setVouchThreshold`.
- Relief ID lifecycle: `enrollReliefId`, `vouchForReliefId`, `revokeReliefId`, `replaceReliefId`, `getReliefId`.

**Other files:**

| File | What it does |
|---|---|
| `shared/reliefId.ts` | Generates and checks Relief ID card numbers (`RID-XXXX-…`) and their hashes |
| `test/ReliefIds.test.ts` | Tests for enrolment, vouching, revoking and replacing Relief IDs |
| `test/reliefId.test.ts` | Tests for card number generation and checking |
| `scripts/seed.ts` | Fills the local chain with demo campaigns, agencies and Relief IDs |
| `scripts/dev-all.mjs` | One command that starts the chain, deploys, seeds and opens the website |

### Website

| File | What it does |
|---|---|
| `frontend/src/pages/ReliefIds.tsx` | Issue, vouch for, check and revoke Relief ID cards |
| `frontend/src/pages/Dashboard.tsx` | Live public dashboard: charts and activity feed |
| `frontend/src/pages/About.tsx` | Explains the project and its limits |
| `frontend/src/lib/events.ts`, `frontend/src/hooks/useRegistryEvents.ts` | Read on-chain events for the dashboard and feed |
| `frontend/src/hooks/useWallet.tsx`, `frontend/src/components/WalletButton.tsx` | MetaMask wallet connection |
| `frontend/src/lib/chains.ts`, `frontend/src/hooks/useChainHealth.ts`, `frontend/src/components/NetworkBanner.tsx` | Network setup and "wrong network / chain offline" warnings |
| `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/hooks/useHashRoute.ts` | App layout and page navigation |
| `frontend/src/hooks/useColorScheme.ts`, `frontend/src/lib/format.ts` | Light/dark mode and number/date formatting |
| `frontend/index.html`, `frontend/vite.config.ts` | Website entry page and build setup |

---

## Shared

| File | Split |
|---|---|
| `frontend/src/styles.css` | Each member styled their own pages |
| `README.md` | Each member wrote the sections on their own part |
| `DEMO.md` | Presented together: Member A runs the Agency Desk and Coordinator steps, Member B runs the Relief ID and Dashboard steps |

## How the two halves connect

1. Member A's `shared/nullifier.ts` hashes a person's ID so the contract can catch duplicates.
2. For people without an ID, Member B's Relief ID card stands in as the ID. Once enough verifiers vouch for a card, the Agency Desk (Member A) accepts it like any other ID, and the same duplicate check applies.
3. Every distribution Member A's code records shows up on Member B's live dashboard.
