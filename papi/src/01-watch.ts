// Part 0/1: a live view of governance. Keep this running in its own terminal.
//   npm run watch
import { api, client, fmt, who } from "./lib.js";

/** Turn the stored call bytes back into something readable, e.g. "System.authorize_upgrade". */
async function describeCall(callData: Uint8Array): Promise<string> {
  try {
    const { decodedCall } = await api.txFromCallData(callData);
    return `${decodedCall.type}.${decodedCall.value.type}`;
  } catch {
    // e.g. the call was encoded for an older runtime
    return `${callData.length} bytes of call data`;
  }
}

async function printProposals(blockNumber: number) {
  const entries = await api.query.Governance.Proposals.getEntries();
  const open = entries.filter((e) => e.value.status.type === "Ongoing");
  if (open.length === 0) return;
  console.log(`\n  Open proposals at block #${blockNumber}:`);
  for (const { keyArgs: [id], value: p } of open.sort((a, b) => a.keyArgs[0] - b.keyArgs[0])) {
    console.log(
      `   #${id} ${await describeCall(p.call)} by ${who(p.proposer)}` +
        ` | aye ${fmt(p.ayes)} vs nay ${fmt(p.nays)} | ends in ${p.end - blockNumber} blocks`,
    );
  }
}

async function describeEvent(event: { type: string; value: any }): Promise<string> {
  const { type, value } = event.value;
  switch (type) {
    case "Proposed":
      return `📜 #${value.id} proposed by ${who(value.proposer)}, voting ends at block #${value.end}`;
    case "Voted":
      return `🗳  #${value.id}: ${who(value.voter)} voted ${value.aye ? "AYE" : "NAY"} with ${fmt(value.amount)} (now held)`;
    case "Approved":
      return `✅ #${value.id} APPROVED, call dispatched as Root: ${value.result.success ? "ok" : `failed ${JSON.stringify(value.result.value)}`}`;
    case "Rejected":
      return `❌ #${value.id} rejected`;
    case "Unlocked":
      return `🔓 #${value.id}: ${who(value.voter)} unlocked ${fmt(value.amount)}`;
    default:
      return `   Governance.${type} ${JSON.stringify(value)}`;
  }
}

const version = await api.constants.System.Version();
console.log(`Connected to ${version.spec_name} v${version.spec_version}. Watching governance…`);

let warnedAboutTypes = false;

client.finalizedBlock$.subscribe(async (block) => {
  try {
    const events = await api.query.System.Events.getValue({ at: block.hash });
    for (const { event } of events) {
      if (event.type === "Governance") console.log(`#${block.number} ${await describeEvent(event)}`);
      if (event.type === "System" && event.value.type === "CodeUpdated") {
        const { spec_version } = await api.constants.System.Version({ at: block.hash });
        console.log(`#${block.number} 🚀 RUNTIME UPGRADED: now spec_version ${spec_version}`);
      }
    }
    if (block.number % 10 === 0) await printProposals(block.number);
  } catch (error) {
    // After a runtime upgrade, the chain can emit things this script's types (generated from
    // the old metadata in `.papi/`) don't know about. PAPI refuses to guess instead of
    // decoding them wrongly.
    if (!warnedAboutTypes) {
      warnedAboutTypes = true;
      console.log(
        `#${block.number} ⚠️  ${(error as Error).message}.\n` +
          "   The runtime changed in a way this script's types don't cover.\n" +
          "   Run `npm run papi:update` and restart the watcher.",
      );
    }
  }
});
