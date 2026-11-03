import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The app reads from the local Hardhat node through "/rpc" on its own origin.
// Same-origin requests avoid browser CORS / local-network blocks, and also let a phone
// on the same Wi-Fi use the app (run `npm run dev -- --host`).
const LOCAL_NODE_PROXY = {
  target: "http://127.0.0.1:8545",
  changeOrigin: true,
  rewrite: () => "/",
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The nullifier code lives in ../shared so the SAME file is used by the
      // contract tests, the seed script and this frontend.
      "@shared": path.resolve(import.meta.dirname, "../shared"),
    },
    // Make ../shared/nullifier.ts use this app's copy of ethers (one copy in the bundle).
    dedupe: ["ethers"],
  },
  build: {
    // ethers + recharts make one ~900 kB bundle; fine for this demo app.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: { "/rpc": LOCAL_NODE_PROXY },
  },
  preview: {
    proxy: { "/rpc": LOCAL_NODE_PROXY },
  },
});
