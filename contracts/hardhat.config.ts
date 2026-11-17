import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: "0.8.28",
  networks: {
    // Our local chain, through the eth-rpc adapter (start it with `scripts/start-chain.sh`).
    local: {
      type: "http",
      url: "http://127.0.0.1:8545",
      // Hardhat's default dev accounts; they are funded in the chain's genesis.
      accounts: { mnemonic: "test test test test test test test test test test test junk" },
    },
  },
});
