// Part 1: governance from the outside.
// Alice proposes something only Root can do: creating tokens for Lucky out of thin air.
// Token holders vote, and when voting ends the chain itself enacts the result.
//   npm run propose-and-vote
import { MultiAddress } from "@polkadot-api/descriptors";
import { alice, api, bob, charlie, client, lucky, fmt, report, tokens, waitFor } from "./lib.js";

const balanceOf = async (address: string) => (await api.query.System.Account.getValue(address)).data;

console.log(`Lucky starts with ${fmt((await balanceOf(lucky.address)).free)}.\n`);

// 1. Build the call we want governance to run. We don't submit it: we wrap it in a proposal.
const mint = api.tx.Balances.force_set_balance({
  who: MultiAddress.Id(lucky.address),
  new_free: tokens(1_000_000),
});
console.log(`Call to propose: Balances.force_set_balance, encoded as ${(await mint.getEncodedData()).length} bytes`);

// 2. Propose it.
const proposed = await api.tx.Governance.propose({ call: mint.decodedCall }).createAndSubmit(alice.signer);
report("Alice proposed", proposed);
const [{ payload: { id, end } }] = api.event.Governance.Proposed.filter(proposed.events);
console.log(`  → proposal #${id}, voting ends at block #${end}\n`);

// 3. Vote. Each vote puts a hold on the voter's tokens.
for (const [voter, aye, amount] of [
  [alice, true, tokens(50)],
  [bob, true, tokens(100)],
  [charlie, false, tokens(30)],
] as const) {
  report(
    `${voter.name} voted ${aye ? "AYE" : "NAY"} with ${fmt(amount)}`,
    await api.tx.Governance.vote({ id, aye, amount }).createAndSubmit(voter.signer),
  );
}

const bobBalance = await balanceOf(bob.address);
console.log(`\nBob's tokens are still his, but held: free ${fmt(bobBalance.free)}, held ${fmt(bobBalance.reserved)}`);

// 4. Nobody needs to do anything now: the pallet's hook closes the vote at block `end`.
console.log(`\nWaiting for block #${end}… (the hook will enact the result, no transaction needed)`);
const status = await waitFor(async () => {
  const proposal = await api.query.Governance.Proposals.getValue(id);
  return proposal?.status.type === "Ongoing" ? undefined : proposal?.status.type;
});
console.log(`Proposal #${id}: ${status}`);
console.log(`Lucky now has ${fmt((await balanceOf(lucky.address)).free)}.\n`);

// 5. Voting is over: everyone takes their tokens back.
for (const voter of [alice, bob, charlie]) {
  report(`${voter.name} unlocked`, await api.tx.Governance.unlock({ id }).createAndSubmit(voter.signer));
}

client.destroy();
