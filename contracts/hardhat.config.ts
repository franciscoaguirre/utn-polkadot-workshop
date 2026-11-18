import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

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
    // The class's shared chain (`scripts/start-shared-chain.sh`). Read from the environment:
    //   ETH_RPC_URL  the Ethereum RPC address your instructor shares
    //   MNEMONIC     your secret phrase, from `npm run account` in papi/
    shared: {
      type: "http",
      url: configVariable("ETH_RPC_URL"),
      accounts: { mnemonic: configVariable("MNEMONIC") },
    },
  },
});
