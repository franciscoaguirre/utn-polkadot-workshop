// Deploy the DAO: the first Hardhat account is the owner, it whitelists the next three as
// members and puts 16 tokens in the treasury.
// Run: npm run deploy
import { writeFileSync } from "node:fs";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [owner, ...others] = await viem.getWalletClients();
const members = others.slice(0, 3);

const send = async (label: string, hash: `0x${string}`) => {
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ✓ ${label}`);
};

const dao = await viem.deployContract("Dao", [], { account: owner.account });
console.log(`Dao deployed at ${dao.address} (owner ${owner.account.address})`);

for (const member of members) {
  await send(
    `added member ${member.account.address}`,
    await dao.write.addMember([member.account.address], { account: owner.account }),
  );
}
await send(
  "funded the treasury with 16 tokens",
  await dao.write.fund({ value: parseEther("16"), account: owner.account }),
);

// The PAPI scripts and `npm run dao-vote` read this file to find the DAO.
writeFileSync("../dao-address.json", JSON.stringify({ address: dao.address }, null, 2) + "\n");
console.log("Saved the address to dao-address.json");
