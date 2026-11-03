import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox"; // ethers, chai matchers, gas reporter, coverage, typechain
import * as dotenv from "dotenv";

// Load secrets (RPC URL, private key) from the .env file. Never commit .env!
dotenv.config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },

  networks: {
    // `npx hardhat node` starts this network on http://127.0.0.1:8545
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    // Sepolia is only configured when both values are present in .env,
    // so tests and local runs work without any secrets.
    ...(SEPOLIA_RPC_URL && PRIVATE_KEY
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`],
            chainId: 11155111,
          },
        }
      : {}),
  },

  // Optional: lets `npx hardhat verify` publish the source code on Etherscan.
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
  },

  // Run `npm run test:gas` to print a gas table for every contract function.
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: process.env.REPORT_GAS_FILE || undefined,
    noColors: Boolean(process.env.REPORT_GAS_FILE),
    excludeContracts: ["NullifierTestHelper"],
  },
};

export default config;
