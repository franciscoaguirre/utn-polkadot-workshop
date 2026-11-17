// Part 3: upgrade the running chain through governance.
//
//   npm run upgrade                 # uses the runtime you just built with `cargo build`
//   npm run upgrade -- path/to.wasm # or any other runtime wasm
//
// 1. propose `System.authorize_upgrade(hash of the new runtime)`
// 2. vote (here: Alice and Bob; the DAO can join in from Hardhat: see the printed command)
// 3. the hook enacts it: the chain now accepts exactly that code
// 4. anyone uploads the code with `System.apply_authorized_upgrade` (free of charge)
// 5. a couple of blocks later the chain runs the new runtime, without restarting the node
import { readFileSync } from "node:fs";
import { blake2b } from "@noble/hashes/blake2.js";
import { Binary } from "polkadot-api";
import { alice, api, bob, client, fmt, report, tokens, waitFor } from "./lib.js";

const DEFAULT_WASM = new URL(
  "../../target/release/wbuild/workshop-runtime/workshop_runtime.compact.compressed.wasm",
  import.meta.url,
);
const wasmPath = process.argv[2] ?? DEFAULT_WASM;

const code = new Uint8Array(readFileSync(wasmPath));
const code_hash = Binary.toHex(blake2b(code, { dkLen: 32 }));
const before = await api.constants.System.Version();
console.log(`Chain runs ${before.spec_name} v${before.spec_version}.`);
console.log(`New runtime: ${(code.length / 1024).toFixed(0)} KiB, hash ${code_hash}\n`);

// 1. Propose. The proposal only carries the 32-byte hash, not the 1.5 MB of code.
const authorize = api.tx.System.authorize_upgrade({ code_hash });
const proposed = await api.tx.Governance.propose({ call: authorize.decodedCall }).createAndSubmit(alice.signer);
report("Alice proposed System.authorize_upgrade", proposed);
const [{ payload: { id, end } }] = api.event.Governance.Proposed.filter(proposed.events);
console.log(`  → proposal #${id}, voting ends at block #${end}`);
console.log(`  The DAO can vote too:  cd contracts && PROPOSAL_ID=${id} npm run dao-vote\n`);

// 2. Vote.
for (const [voter, amount] of [
  [alice, tokens(100)],
  [bob, tokens(100)],
] as const) {
  report(
    `${voter.name} voted AYE with ${fmt(amount)}`,
    await api.tx.Governance.vote({ id, aye: true, amount }).createAndSubmit(voter.signer),
  );
}

// 3. Wait for the hook.
console.log(`\nWaiting for block #${end}…`);
const status = await waitFor(async () => {
  const proposal = await api.query.Governance.Proposals.getValue(id);
  return proposal?.status.type === "Ongoing" ? undefined : proposal?.status.type;
});
if (status !== "Approved") {
  console.error(`Proposal #${id} was ${status}: no upgrade.`);
  process.exit(1);
}
const authorized = await api.query.System.AuthorizedUpgrade.getValue();
console.log(`Proposal #${id} approved. The chain now accepts code with hash ${authorized?.code_hash}`);

// 4. Upload the code. Any account may do it, and it's free.
const applied = await api.tx.System.apply_authorized_upgrade({ code }).createAndSubmit(bob.signer);
if (applied.events.some((e) => e.type === "System" && e.value.type === "RejectedInvalidAuthorizedUpgrade")) {
  console.error("✗ The chain rejected the code. Did you increase `spec_version` in runtime/src/lib.rs?");
  process.exit(1);
}
report("Bob uploaded the new runtime", applied);

// 5. Parachains switch code a block or two later.
const after = await waitFor(async () => {
  const version = await api.constants.System.Version();
  return version.spec_version > before.spec_version ? version : undefined;
});
console.log(`\n🚀 The chain now runs ${after.spec_name} v${after.spec_version}. The node never restarted.`);
console.log(`Unlock your votes:  Governance.unlock(${id})  (from Alice and Bob)`);
console.log(`New calls aren't in this script's types yet: run \`npm run papi:update\`, then \`npm run cancel\`.`);

client.destroy();
