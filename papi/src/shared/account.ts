// Shared class chain: your account.
//
//   npm run account   # without MNEMONIC: create a new secret phrase
//                     # with MNEMONIC set: show your addresses and balances
//
// One secret phrase gives you two accounts:
// - a Polkadot account, which signs the PAPI scripts (`npm run vote`, …)
// - an Ethereum account, which Hardhat uses to deploy and call contracts
// The instructor needs both addresses to send you tokens.
import { generateMnemonic } from "@polkadot-labs/hdkd-helpers";
import { mnemonicToAccount } from "viem/accounts";
import { NODE_URL, api, client, ethToPolkadot, fmt, me } from "../lib.js";

const phrase = process.env.MNEMONIC?.trim();

if (!phrase) {
  const mnemonic = generateMnemonic(128);
  console.log("A new account, just for you.\n");
  console.log("Your secret phrase. Keep it private: anyone who has it controls your tokens.\n");
  console.log(`  ${mnemonic}\n`);
  console.log("Use it in every terminal (papi/ and contracts/):\n");
  console.log(`  export MNEMONIC="${mnemonic}"\n`);
  console.log("Then run `npm run account` again to see the addresses to send to your instructor.");
  client.destroy();
} else {
  const ethereum = phrase.startsWith("//") ? undefined : mnemonicToAccount(phrase).address;
  console.log(`Polkadot account (PAPI):    ${me!.address}`);
  if (ethereum) {
    console.log(`Ethereum account (Hardhat): ${ethereum}`);
  }

  console.log(`\nBalances on ${NODE_URL}:`);
  const show = async (label: string, address: string) => {
    const { data } = await api.query.System.Account.getValue(address);
    console.log(`  ${label}: free ${fmt(data.free)}, frozen ${fmt(data.frozen)}`);
  };
  const showAll = async () => {
    await show("Polkadot", me!.address);
    if (ethereum) await show("Ethereum", ethToPolkadot(ethereum));
  };
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 15_000).unref());
  if ((await Promise.race([showAll(), timeout])) === "timeout") {
    console.log("  (couldn't reach the chain: is NODE_URL right, and is the chain running?)");
  }
  client.destroy();
}
