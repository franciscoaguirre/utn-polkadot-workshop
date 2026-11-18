// Shared class chain, instructor only: give an account tokens, using the sudo key.
//
//   MNEMONIC="<sudo secret phrase>" npm run fund -- <address> <tokens> [<address> <tokens> …]
//   npm run fund -- 5Grw…utQY 1000 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 1000
//
// Addresses can be Polkadot (5…) or Ethereum (0x…). This *sets* the free balance, it doesn't
// add to it.
import { MultiAddress } from "@polkadot-api/descriptors";
import { api, client, fmt, parseAddress, report, requireMe, tokens, who } from "../lib.js";

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) {
  console.error("Usage: npm run fund -- <address> <tokens> [<address> <tokens> …]");
  process.exit(1);
}
const me = requireMe();

const sudoKey = await api.query.Sudo.Key.getValue();
if (sudoKey !== me.address) {
  console.error(`✗ Only the sudo account (${sudoKey}) can fund accounts. MNEMONIC is ${me.address}.`);
  process.exit(1);
}

for (let i = 0; i < args.length; i += 2) {
  const address = parseAddress(args[i]);
  const amount = Number(args[i + 1]);
  if (!(amount > 0)) throw new Error(`"${args[i + 1]}" isn't a number of tokens`);
  const setBalance = api.tx.Balances.force_set_balance({ who: MultiAddress.Id(address), new_free: tokens(amount) });
  report(
    `${who(address)} (${args[i]}) now has ${fmt(tokens(amount))}`,
    await api.tx.Sudo.sudo({ call: setBalance.decodedCall }).createAndSubmit(me.signer),
  );
}

client.destroy();
