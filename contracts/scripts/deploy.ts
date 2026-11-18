// Deploy the DAO.
//
// Local chain:  the first Hardhat account is the owner, it whitelists the next three as members
//               and puts 16 tokens in the treasury.
//   npm run deploy
//
// Shared class chain: you are the owner. Your classmates' Ethereum addresses are the members.
//   MEMBERS=0xabc…,0xdef… TREASURY=16 npm run deploy:shared
import { writeFileSync } from "node:fs";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const [owner, ...others] = await viem.getWalletClients();

let members: `0x${string}`[];
if (networkName === "local") {
  members = others.slice(0, 3).map((wallet) => wallet.account.address);
} else {
  members = (process.env.MEMBERS ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean) as `0x${string}`[];
  const invalid = members.filter((address) => !/^0x[0-9a-fA-F]{40}$/.test(address));
  if (members.length === 0 || invalid.length > 0) {
    throw new Error(
      "Set MEMBERS to your DAO members' Ethereum addresses, separated by commas " +
        "(e.g. MEMBERS=0xabc…,0xdef…)" +
        (invalid.length > 0 ? `. Not Ethereum addresses: ${invalid.join(", ")}` : ""),
    );
  }
}
const treasury = process.env.TREASURY ?? "16";

const send = async (label: string, hash: `0x${string}`) => {
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ✓ ${label}`);
};

const dao = await viem.deployContract("Dao", [], { account: owner.account });
console.log(`Dao deployed at ${dao.address} (owner ${owner.account.address})`);

for (const member of members) {
  await send(`added member ${member}`, await dao.write.addMember([member], { account: owner.account }));
}
await send(
  `funded the treasury with ${treasury} tokens`,
  await dao.write.fund({ value: parseEther(treasury), account: owner.account }),
);

// The PAPI scripts and `npm run dao-vote` read this file to find the DAO.
writeFileSync("../dao-address.json", JSON.stringify({ address: dao.address }, null, 2) + "\n");
console.log("Saved the address to dao-address.json");
if (networkName !== "local") {
  console.log(`Share it with your members: they vote with DAO=${dao.address}`);
}
