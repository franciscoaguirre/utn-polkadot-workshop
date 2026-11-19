// Shared class chain: vote on a proposal with your own tokens.
//
//   npm run vote -- <proposal id> <aye|nay> <tokens>
//   npm run vote -- 3 aye 100
//
// Your tokens stay in your account but are frozen until you `npm run unlock -- <id>` after
// voting ends. Freezes overlap, so the same tokens can vote on other proposals meanwhile.
import { api, client, fmt, report, requireMe, tokens } from "../lib.js";

const [idText, direction, amountText] = process.argv.slice(2);
const id = Number(idText);
const amount = Number(amountText);
if (!Number.isInteger(id) || !["aye", "nay"].includes(direction) || !(amount > 0)) {
  console.error("Usage: npm run vote -- <proposal id> <aye|nay> <tokens>   e.g. npm run vote -- 3 aye 100");
  process.exit(1);
}
const me = requireMe();
const aye = direction === "aye";

report(
  `You voted ${aye ? "AYE" : "NAY"} on proposal #${id} with ${fmt(tokens(amount))}`,
  await api.tx.Governance.vote({ id, aye, amount: tokens(amount) }).createAndSubmit(me.signer),
);
const proposal = await api.query.Governance.Proposals.getValue(id);
if (proposal) {
  console.log(`Proposal #${id} now: aye ${fmt(proposal.ayes)} vs nay ${fmt(proposal.nays)}, ends at block #${proposal.end}`);
}
console.log(`When voting ends, take your tokens back:  npm run unlock -- ${id}`);

client.destroy();
