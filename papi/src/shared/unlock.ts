// Shared class chain: take back the tokens you voted with, once voting has ended.
//
//   npm run unlock -- <proposal id>
import { api, client, report, requireMe } from "../lib.js";

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) {
  console.error("Usage: npm run unlock -- <proposal id>");
  process.exit(1);
}
const me = requireMe();

report(`You unlocked your vote on proposal #${id}`, await api.tx.Governance.unlock({ id }).createAndSubmit(me.signer));

client.destroy();
