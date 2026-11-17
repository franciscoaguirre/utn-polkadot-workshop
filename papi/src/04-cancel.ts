// Part 3, after the upgrade: use the call you just added.
//
// `Governance.cancel` didn't exist when this project's types were generated. Regenerate them
// from the live chain first:
//   npm run papi:update
//   npm run cancel
import { alice, api, client, report } from "./lib.js";

const version = await api.constants.System.Version();
console.log(`Chain runs ${version.spec_name} v${version.spec_version}.`);

// PAPI compares this script's types with the chain's metadata. If `cancel` is missing on chain
// (the upgrade didn't happen) or it changed shape, we find out here instead of sending garbage.
const { compat } = await api.getStaticApis();
if (!compat.tx.Governance.cancel.isCompatible()) {
  console.error("✗ The chain has no compatible Governance.cancel. Did the upgrade go through?");
  process.exit(1);
}

const proposed = await api.tx.Governance.propose({
  call: api.tx.System.remark({ remark: new TextEncoder().encode("oops") }).decodedCall,
}).createAndSubmit(alice.signer);
report("Alice proposed something by mistake", proposed);
const [{ payload: { id } }] = api.event.Governance.Proposed.filter(proposed.events);

report(`Alice cancelled proposal #${id}`, await api.tx.Governance.cancel({ id }).createAndSubmit(alice.signer));
const proposal = await api.query.Governance.Proposals.getValue(id);
console.log(`Proposal #${id} status: ${proposal?.status.type}`);

client.destroy();
