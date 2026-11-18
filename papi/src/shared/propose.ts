// Shared class chain: propose something for the whole class to vote on.
//
//   npm run propose -- "Pizza for everyone"
//
// The proposal is `System.remark(message)`: if it's approved, the chain runs it as Root and the
// watcher shows it. It does nothing else, so it's harmless and anyone can try it.
// (Not `remark_with_event`: that one needs a signed origin, and Root isn't one.)
// For a runtime upgrade, use `npm run upgrade` (with MNEMONIC set, you are the proposer).
import { api, client, report, requireMe } from "../lib.js";

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error('Usage: npm run propose -- "your message"');
  process.exit(1);
}
const me = requireMe();

const remark = api.tx.System.remark({ remark: new TextEncoder().encode(message) });
const proposed = await api.tx.Governance.propose({ call: remark.decodedCall }).createAndSubmit(me.signer);
report(`You proposed: "${message}"`, proposed);
const [{ payload: { id, end } }] = api.event.Governance.Proposed.filter(proposed.events);
console.log(`  → proposal #${id}, voting ends at block #${end}`);
console.log(`  Everyone can vote:  npm run vote -- ${id} aye <tokens>`);
console.log(`  DAOs can vote too:  cd contracts && PROPOSAL_ID=${id} VOTE=aye npm run dao-vote:shared`);

client.destroy();
