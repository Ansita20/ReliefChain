/**
 * Deploy ReliefRegistry.
 *
 *   Local:    npm run node          (in one terminal)
 *             npm run deploy:local  (in another)
 *   Sepolia:  npm run deploy:sepolia  (needs SEPOLIA_RPC_URL and PRIVATE_KEY in .env)
 *
 * The deployer becomes admin + coordinator.
 * The address is saved to deployments/<network>.json, and the address + ABI are copied
 * into the frontend so it knows where the contract lives on each chain.
 */
import { ethers, network, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..");
const FRONTEND_CONTRACTS_DIR = path.join(ROOT, "frontend", "src", "contracts");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network:  ${network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address} (balance ${ethers.formatEther(balance)} ETH)`);

  const registry = await ethers.deployContract("ReliefRegistry", [deployer.address]);
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const receipt = await registry.deploymentTransaction()!.wait();

  console.log(`ReliefRegistry deployed at ${address} (block ${receipt!.blockNumber})`);

  const deployment = {
    network: network.name,
    chainId: Number(chainId),
    address,
    deployBlock: receipt!.blockNumber, // the frontend reads events starting from this block
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  // 1) Save for the seed script and for our records
  const deploymentsDir = path.join(ROOT, "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(deploymentsDir, `${network.name}.json`), JSON.stringify(deployment, null, 2));

  // 2) Give the frontend the ABI and the address for this chain
  fs.mkdirSync(FRONTEND_CONTRACTS_DIR, { recursive: true });
  const artifact = await artifacts.readArtifact("ReliefRegistry");
  fs.writeFileSync(
    path.join(FRONTEND_CONTRACTS_DIR, "ReliefRegistry.abi.json"),
    JSON.stringify(artifact.abi, null, 2),
  );

  const addressesFile = path.join(FRONTEND_CONTRACTS_DIR, "deployments.json");
  const all = fs.existsSync(addressesFile) ? JSON.parse(fs.readFileSync(addressesFile, "utf8")) : {};
  all[String(chainId)] = { address, deployBlock: receipt!.blockNumber, network: network.name };
  fs.writeFileSync(addressesFile, JSON.stringify(all, null, 2));

  console.log("Saved deployment info for the frontend.");

  if (network.name === "sepolia") {
    console.log(`\nEtherscan: https://sepolia.etherscan.io/address/${address}`);
    console.log(`Verify with: npx hardhat verify --network sepolia ${address} ${deployer.address}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
