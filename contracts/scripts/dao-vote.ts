// Make the DAO vote on a governance proposal.
// Its members vote inside the DAO (one member, one vote), then the DAO casts one combined
// vote with its whole treasury.
//   PROPOSAL_ID=3 npm run dao-vote
import { readFileSync } from "node:fs";
import { network } from "hardhat";

const id = Number(process.env.PROPOSAL_ID);
if (!Number.isInteger(id)) throw new Error("Set PROPOSAL_ID, e.g. `PROPOSAL_ID=3 npm run dao-vote`");
const { address } = JSON.parse(readFileSync("../dao-address.json", "utf8"));

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
// The members added by `npm run deploy`.
const [, first, second, third] = await viem.getWalletClients();
const dao = await viem.getContractAt("Dao", address);

const send = async (label: string, hash: `0x${string}`) => {
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✓ ${label}`);
};

await send("member 1 voted AYE inside the DAO", await dao.write.vote([id, true], { account: first.account }));
await send("member 2 voted AYE inside the DAO", await dao.write.vote([id, true], { account: second.account }));
await send("member 3 voted NAY inside the DAO", await dao.write.vote([id, false], { account: third.account }));
await send(`the DAO cast its vote on proposal #${id}`, await dao.write.castVote([id]));

const [ayes, nays] = await dao.read.ballots([id]);
console.log(`DAO ballot: ${ayes} aye vs ${nays} nay (members)`);
