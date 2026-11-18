// Turn the local development chain spec into the shared class chain's spec.
// Used by scripts/start-shared-chain.sh; you don't need to run it yourself.
//
//   tsx src/shared/chain-spec.ts <development spec> <shared-chain.config.json> <output spec>
//
// The development preset makes Alice the sudo key and funds the dev accounts and Hardhat's
// default accounts. Their secret phrases are public, so on a chain that other people can reach,
// anyone could use them. This replaces the sudo key and *all* balances with the config's.
import { readFileSync, writeFileSync } from "node:fs";
import { client, parseAddress, tokens } from "../lib.js";

const [specPath, configPath, outputPath] = process.argv.slice(2);
if (!outputPath) {
  console.error("Usage: tsx src/shared/chain-spec.ts <development spec> <config> <output spec>");
  process.exit(1);
}

type Config = { name?: string; sudo: string; balances: Record<string, number> };
const config: Config = JSON.parse(readFileSync(configPath, "utf8"));
const fail = (message: string): never => {
  console.error(`✗ ${configPath}: ${message}`);
  process.exit(1);
};

const toAccount = (address: string) => {
  try {
    return parseAddress(address);
  } catch (error) {
    return fail((error as Error).message);
  }
};

if (!config.sudo) fail('set "sudo" to your own Polkadot address (5…)');
const sudo = toAccount(config.sudo);

const balances = new Map<string, bigint>();
for (const [address, amount] of Object.entries(config.balances ?? {})) {
  if (!(typeof amount === "number" && amount > 0)) fail(`the balance of ${address} must be a number of tokens`);
  const account = toAccount(address);
  balances.set(account, (balances.get(account) ?? 0n) + tokens(amount));
}
if (!balances.has(sudo)) fail(`give the sudo account (${config.sudo}) a balance too, so it can pay fees`);

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const genesis = spec.genesis.runtimeGenesis.patch;
genesis.sudo.key = sudo;
// The amounts don't fit in a JSON number, but the node reads big integers fine.
genesis.balances.balances = [...balances].map(([account, amount]) => [account, `__${amount}__`]);
spec.name = config.name ?? "UTN workshop";
spec.id = "utn_workshop";

writeFileSync(outputPath, JSON.stringify(spec, null, 2).replace(/"__(\d+)__"/g, "$1") + "\n");
console.log(`Shared chain spec: sudo ${config.sudo}, ${balances.size} funded account(s).`);
// lib.ts opens a connection to a node on import; we don't need it here.
client.destroy();
