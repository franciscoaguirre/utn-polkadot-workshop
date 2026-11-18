// Shared helpers for the workshop scripts: connect, dev accounts, formatting.
import { existsSync, readFileSync } from "node:fs";
import { AccountId, Binary, createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { getTxCreator } from "polkadot-api/tx-creator";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import { workshop } from "@polkadot-api/descriptors";

export const NODE_URL = process.env.NODE_URL ?? "ws://127.0.0.1:9944";

/** One connection to the chain, and a typed API generated from its metadata (`.papi/`). */
export const client = createClient(getWsProvider(NODE_URL));
export const api = client.getTypedApi(workshop);

// ----------------------------------------------------------------------------- accounts

const deriveFrom = (phrase: string) => sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(phrase)));
const derive = deriveFrom(DEV_PHRASE);
const accountIdCodec = AccountId();

type KeyPair = ReturnType<typeof derive>;
export type Account = ReturnType<typeof keyAccount>;

function keyAccount(name: string, keyPair: KeyPair) {
  return {
    name,
    address: accountIdCodec.dec(keyPair.publicKey),
    signer: getTxCreator(keyPair.publicKey, "Sr25519", keyPair.sign),
  };
}

/** A well-known dev account (//Alice, //Bob, ...) that can sign transactions. */
const devAccount = (name: string) => keyAccount(name, derive(`//${name}`));

export const alice = devAccount("Alice");
export const bob = devAccount("Bob");
export const charlie = devAccount("Charlie");
/** Not funded at genesis: a clean slate for demos. */
export const lucky = devAccount("Lucky");

/**
 * You, on the shared class chain: the account of the secret phrase in the MNEMONIC environment
 * variable (create one with `npm run account`). Hardhat uses the same phrase for your Ethereum
 * account. For local tests, MNEMONIC can also be a dev account like `//Alice`.
 */
export const me = (() => {
  const phrase = process.env.MNEMONIC?.trim();
  if (!phrase) return undefined;
  if (phrase.startsWith("//")) return devAccount(phrase.slice(2));
  try {
    return keyAccount("You", deriveFrom(phrase)(""));
  } catch {
    console.error("✗ MNEMONIC isn't a valid secret phrase. Check that you copied all 12 words.");
    process.exit(1);
  }
})();

/** `me`, or stop the script with a hint if MNEMONIC isn't set. */
export function requireMe(): Account {
  if (me) return me;
  console.error('✗ Set your secret phrase first:  export MNEMONIC="word1 word2 …"');
  console.error("  No account yet? Create one with `npm run account`.");
  process.exit(1);
}

/**
 * An account typed by a person: a Polkadot address (5…), or an Ethereum address (0x…),
 * which becomes its Polkadot account.
 */
export function parseAddress(text: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(text)) return ethToPolkadot(text);
  try {
    return accountIdCodec.dec(accountIdCodec.enc(text));
  } catch {
    throw new Error(`"${text}" is neither a Polkadot address (5…) nor an Ethereum address (0x…)`);
  }
}

/**
 * An Ethereum address (a contract, or a Hardhat account) as a Polkadot account:
 * the 20 address bytes followed by 12 bytes of 0xEE.
 */
export function ethToPolkadot(ethAddress: string): string {
  const bytes = new Uint8Array(32).fill(0xee);
  bytes.set(Binary.fromHex(ethAddress), 0);
  return accountIdCodec.dec(bytes);
}

/** The DAO deployed by `npm run deploy` in `contracts/`, if any. */
export function daoAccount(): string | undefined {
  const file = new URL("../../dao-address.json", import.meta.url);
  if (!existsSync(file)) return undefined;
  return ethToPolkadot(JSON.parse(readFileSync(file, "utf8")).address);
}

const names = new Map([alice, bob, charlie, lucky].map((a) => [a.address, a.name]));
/** A short, human name for an account. */
export function who(address: string): string {
  if (names.has(address)) return names.get(address)!;
  if (address === me?.address) return "you";
  if (address === daoAccount()) return "DAO";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ---------------------------------------------------------------------------- formatting

/** The native token has 12 decimals. */
export const UNIT = 1_000_000_000_000n;
export const tokens = (n: number) => BigInt(Math.round(n * 1000)) * (UNIT / 1000n);
export const fmt = (planck: bigint) => `${Number(planck) / Number(UNIT)} UNIT`;

/** Print what a transaction did, and stop the script if it failed. */
export function report(label: string, result: { ok: boolean; events: any[]; dispatchError?: any }) {
  const interesting = result.events
    .filter((e) => !["Balances", "TransactionPayment", "System"].includes(e.type))
    .map((e) => `${e.type}.${e.value.type}`);
  if (!result.ok) {
    console.error(`✗ ${label} failed:`, JSON.stringify(result.dispatchError, bigintReplacer));
    process.exit(1);
  }
  console.log(`✓ ${label}${interesting.length ? `  [${interesting.join(", ")}]` : ""}`);
}

export const bigintReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** Resolve after the next finalized block for which `check` returns a value. */
export function waitFor<T>(check: () => Promise<T | undefined>): Promise<T> {
  return new Promise((resolve, reject) => {
    const subscription = client.finalizedBlock$.subscribe(async () => {
      try {
        const value = await check();
        if (value !== undefined) {
          subscription.unsubscribe();
          resolve(value);
        }
      } catch (error) {
        subscription.unsubscribe();
        reject(error);
      }
    });
  });
}
