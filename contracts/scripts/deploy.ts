// Deploy the DAO and have the first three Hardhat accounts join it.
// Run: npm run deploy
import { writeFileSync } from "node:fs";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [alice, bob, charlie] = await viem.getWalletClients();

const dao = await viem.deployContract("Dao");
console.log(`Dao deployed at ${dao.address}`);

for (const [member, amount] of [
  [alice, "10"],
  [bob, "5"],
  [charlie, "1"],
] as const) {
  const hash = await dao.write.join({ value: parseEther(amount), account: member.account });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ${member.account.address} joined with ${amount} tokens`);
}

// The PAPI scripts read this file to find the DAO.
writeFileSync("../dao-address.json", JSON.stringify({ address: dao.address }, null, 2) + "\n");
console.log("Saved the address to dao-address.json");
