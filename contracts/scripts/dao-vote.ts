// Make the DAO vote on a governance proposal.
// Its members vote inside the DAO (one member, one vote), then the DAO casts one combined
// vote with its whole treasury.
//
// Local chain: the three members added by `npm run deploy` vote, then the DAO casts its vote.
//   PROPOSAL_ID=3 npm run dao-vote
//
// Shared class chain: you vote as one member. Once enough members voted, anyone casts the
// DAO's vote. DAO is the DAO's address (default: the one in dao-address.json, if you deployed it).
//   DAO=0x… PROPOSAL_ID=3 VOTE=aye npm run dao-vote:shared
//   DAO=0x… PROPOSAL_ID=3 CAST=1 npm run dao-vote:shared
// After voting ends, take the DAO's tokens back:
//   DAO=0x… PROPOSAL_ID=3 UNLOCK=1 npm run dao-vote:shared
import { existsSync, readFileSync } from "node:fs";
import { network } from "hardhat";

const id = Number(process.env.PROPOSAL_ID);
if (!process.env.PROPOSAL_ID?.trim() || !Number.isInteger(id)) throw new Error("Set PROPOSAL_ID, e.g. `PROPOSAL_ID=3 npm run dao-vote`");
const address =
  process.env.DAO ??
  (existsSync("../dao-address.json") ? JSON.parse(readFileSync("../dao-address.json", "utf8")).address : undefined);
if (!address) throw new Error("Set DAO to the DAO's address (DAO=0x…), or deploy one with `npm run deploy`");

const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const dao = await viem.getContractAt("Dao", address);

const send = async (label: string, hash: `0x${string}`) => {
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✓ ${label}`);
};
const showBallot = async () => {
  const [ayes, nays, cast] = await dao.read.ballots([id]);
  console.log(`DAO ballot on #${id}: ${ayes} aye vs ${nays} nay (members)${cast ? ", cast" : ""}`);
};

if (networkName === "local") {
  // The members added by `npm run deploy`.
  const [, first, second, third] = await viem.getWalletClients();
  await send("member 1 voted AYE inside the DAO", await dao.write.vote([id, true], { account: first.account }));
  await send("member 2 voted AYE inside the DAO", await dao.write.vote([id, true], { account: second.account }));
  await send("member 3 voted NAY inside the DAO", await dao.write.vote([id, false], { account: third.account }));
  await send(`the DAO cast its vote on proposal #${id}`, await dao.write.castVote([id]));
  await showBallot();
} else if (process.env.UNLOCK) {
  await send(`the DAO unlocked its tokens from proposal #${id}`, await dao.write.unlock([id]));
} else if (process.env.CAST) {
  await send(`the DAO cast its vote on proposal #${id}`, await dao.write.castVote([id]));
  await showBallot();
} else {
  const vote = process.env.VOTE;
  if (vote !== "aye" && vote !== "nay") throw new Error("Set VOTE=aye or VOTE=nay (or CAST=1, or UNLOCK=1)");
  await send(`you voted ${vote.toUpperCase()} inside the DAO`, await dao.write.vote([id, vote === "aye"]));
  await showBallot();
  console.log(`When most members have voted, cast the DAO's vote:  DAO=${address} PROPOSAL_ID=${id} CAST=1 npm run dao-vote:shared`);
}
