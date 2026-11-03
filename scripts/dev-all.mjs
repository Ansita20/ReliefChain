/**
 * One command to run the whole project locally:
 *
 *     npm run dev:all
 *
 * 1. starts a local Hardhat blockchain node (http://127.0.0.1:8545)
 * 2. waits until it answers
 * 3. deploys ReliefRegistry and seeds the "Flood Relief Demo" campaign
 * 4. starts the frontend (http://localhost:5173)
 *
 * Press Ctrl+C once to stop everything.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = path.join(ROOT, "frontend");
const RPC = "http://127.0.0.1:8545";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];

function log(msg) {
  console.log(`\x1b[36m[dev-all]\x1b[0m ${msg}`);
}

/** Start a long-running process; its output is prefixed so you can tell them apart. */
function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, env: process.env });
  const prefix = (line) => `\x1b[90m[${name}]\x1b[0m ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => {
      for (const line of data.toString().split("\n")) if (line.trim()) console.log(prefix(line));
    });
  }
  child.on("exit", (code) => {
    if (!stopping) {
      log(`${name} exited (code ${code}). Stopping everything.`);
      stop(1);
    }
  });
  children.push(child);
  return child;
}

/** Run a one-off command and stop if it fails. */
function run(name, args, cwd = ROOT) {
  log(`${name}…`);
  const result = spawnSync(npm, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    log(`${name} failed.`);
    stop(1);
  }
}

async function rpcIsUp() {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

async function main() {
  if (await rpcIsUp()) {
    log(`Something is already running on ${RPC}. Stop it first (or use the separate npm scripts).`);
    process.exit(1);
  }

  if (!existsSync(path.join(FRONTEND, "node_modules"))) {
    run("Installing frontend dependencies (first run only)", ["install"], FRONTEND);
  }

  log("Starting local blockchain node…");
  start("node", npm, ["run", "node"], ROOT);

  for (let i = 0; i < 60 && !(await rpcIsUp()); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await rpcIsUp())) {
    log("The node did not start within 30 seconds.");
    stop(1);
  }

  run("Deploying ReliefRegistry", ["run", "deploy:local"]);
  run("Seeding demo data", ["run", "seed:local"]);

  log("Starting frontend…");
  start("web", npm, ["run", "dev"], FRONTEND);

  log("");
  log("Ready! Open http://localhost:5173");
  log("MetaMask: add network 'Hardhat Local' (RPC http://127.0.0.1:8545, chain ID 31337)");
  log("and import the test private keys printed above by the node (account #0 = coordinator,");
  log("#1-#3 = demo agencies). Load the secret file from demo-secrets/ in the Agency Desk.");
  log("Press Ctrl+C to stop.");
}

main();
