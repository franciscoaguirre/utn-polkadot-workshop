# Kernel space meets user space: a Polkadot governance workshop

In this workshop you take a running blockchain and:

1. **Kernel space:** read a *pallet*, a piece of the chain's own code. Ours is a tiny governance system: anyone proposes, token holders vote, and when voting ends **the chain runs the winning proposal by itself, with superuser (Root) powers**.
2. **User space:** write a **Solidity DAO** that votes in that governance as one bloc. It's deployed with Hardhat, just like on Ethereum.
3. **Change the kernel:** add a feature to the pallet, rebuild the chain's code, and **vote your own upgrade into the running chain**. Your DAO votes too.

You'll drive and watch everything from TypeScript with [PAPI](https://papi.how).

```
 Hardhat (Dao.sol) ──► eth-rpc :8545 ─┐
                                      ▼
 ┌──────────────── the chain (polkadot-omni-node running our runtime) ────────────────┐
 │                                                                                    │
 │   pallet-revive          precompile at                 pallet-governance           │
 │   runs Dao.sol  ──────►  0x…09000000  ────────────►    propose / vote / unlock     │
 │   (user space)           (the bridge)                  + a hook every block        │
 │                                                        (kernel space, Rust)        │
 └────────────────────────────────────────────────────────────────────────────────────┘
                                      ▲
 PAPI scripts (TypeScript) ── ws://127.0.0.1:9944
```

---

## Before the workshop: setup (do this at home!)

Compiling the chain takes a while the first time, so **do this before the workshop**.

**You need**

- **macOS on Apple Silicon** or **Linux x86_64**. On Windows, use [WSL2](https://learn.microsoft.com/windows/wsl/install) with Ubuntu and follow the Linux steps. On other systems the script builds the tools from source, which is slow.
- **8 GB RAM or more** and **about 10 GB of free disk**.
- [Rust](https://rustup.rs) (`rustup`), [Node.js 22+](https://nodejs.org), `git` and `curl`.
  - On Linux (Ubuntu/Debian) you also need: `sudo apt install build-essential git clang curl libssl-dev protobuf-compiler`.
  - On macOS: `xcode-select --install`.

**Run**

```bash
git clone <this repo> utn-pallet-workshop
cd utn-pallet-workshop
./scripts/setup.sh    # 15–40 minutes, mostly compiling
./scripts/check.sh    # everything should be ✅
```

If `check.sh` shows a ❌ you can't fix, ask for help **before** the workshop.

> **Low on RAM?** If the build gets killed, limit parallelism: `CARGO_BUILD_JOBS=2 ./scripts/setup.sh`.

---

## During the workshop

Use **three terminals**, all in the repo folder.

### Part 0: start the chain (5 min)

```bash
# Terminal 1: the chain. Leave it running.
./scripts/start-chain.sh

# Terminal 2: a live view of governance. Leave it running.
cd papi && npm run watch
```

Every `start-chain.sh` starts a **brand-new chain** from block 0.

### Part 1: kernel space (25 min)

Open [`pallets/governance/src/lib.rs`](pallets/governance/src/lib.rs). It's written for Solidity developers. Find:

| Look for | It's like… |
|---|---|
| `#[pallet::storage]` `Proposals`, `Votes` | state variables / mappings |
| `#[pallet::call]` `propose`, `vote`, `unlock` | `external` functions |
| `ensure_signed(origin)?` | `msg.sender` |
| `ensure!(…, Error::<T>::…)` | `require` with a custom error |
| `T::Currency::hold(…)` in `vote` | 🔑 locking tokens **inside the voter's own account**, with no escrow |
| `on_initialize` in `#[pallet::hooks]` | 🔑 code that runs **every block, with nobody sending a transaction** |
| `call.dispatch(RawOrigin::Root.into())` in `close` | 🔑 running any call **as the superuser** |

The 🔑 rows are things a smart contract can't do. Now see them happen:

```bash
# Terminal 3
cd papi && npm run propose-and-vote
```

Alice proposes to create 1,000,000 tokens for an empty account (only Root can do that). Alice, Bob and Charlie vote. Watch terminal 2: about a minute later the pallet's hook closes the vote and runs the call. Nobody sends a transaction.

Read [`papi/src/02-propose-and-vote.ts`](papi/src/02-propose-and-vote.ts) to see how PAPI builds a call, wraps it in a proposal, and reads events and storage.

### Part 2: user space (30 min)

Your DAO is [`contracts/contracts/Dao.sol`](contracts/contracts/Dao.sol). Members deposit tokens for shares, vote inside the DAO, and then the DAO casts **one** vote in the chain's governance with all their weight.

It talks to the pallet through [`IGovernance.sol`](contracts/contracts/IGovernance.sol). That address isn't a contract: it's a *precompile* that calls straight into the pallet.

1. Fill in the two `TODO(workshop, part 2)` functions: `vote` and `castVote`.
2. Test against the live chain:
   ```bash
   cd contracts
   npm test
   ```
3. Deploy it, with three Hardhat accounts joining:
   ```bash
   npm run deploy
   ```

In the test output, notice the DAO's balance going to **0** after it votes. The tokens are still in the DAO's account, but held by the pallet until `unlock`.

### Part 3: change the kernel (35 min)

**3a. Add `cancel` to the pallet.** Follow the `TODO(workshop, part 3)` comments in `lib.rs`:

- a `Cancelled` status
- a `Cancelled` event
- a `NotProposer` error
- the `cancel` call

Then uncomment `mod cancel_tests;` near the top and run:

```bash
cargo test -p pallet-governance
```

Iterate until all tests pass. The compiler errors are your friend.

**3b. Build the new runtime.** In [`runtime/src/lib.rs`](runtime/src/lib.rs), change `spec_version: 1` to `spec_version: 2`. The chain only accepts an upgrade with a higher version. Then:

```bash
cargo build --release -p workshop-runtime
```

**3c. Vote it in.** The chain from Part 0 must still be running.

```bash
cd papi && npm run upgrade
```

The script proposes `System.authorize_upgrade(hash of your new runtime)`, and Alice and Bob vote. While it waits, make **your DAO** vote too, using the id the script prints:

```bash
cd contracts && PROPOSAL_ID=<id> npm run dao-vote
```

When voting ends, the hook approves it and the script uploads your code. Watch terminal 2: **🚀 RUNTIME UPGRADED**. The node never restarted.

**3d. Use your new call.** Your PAPI types were generated from the old runtime, so they don't know about `cancel` yet:

```bash
cd papi
npm run papi:update   # regenerate the types from the live chain
npm run cancel
```

> **Build broken?** Run the upgrade with the prebuilt solution instead:
> `npm run upgrade -- ../solutions/runtime/workshop_runtime_v2_cancel.compact.compressed.wasm`

### Stretch goals

[`contracts/contracts/extras/`](contracts/contracts/extras) has two more contracts built on top of governance:

- **PredictionMarket**: bet on whether a proposal passes. It settles by *reading* the pallet.
- **VoteMarket**: pay people to vote a certain way, and check their vote on chain. What does this do to governance?

Fill in their `TODO(stretch)` functions, then run `npm run test:extras` (about a minute).

Something to think about: the pallet allows **one vote per account**. Why can't a contract let each of its members vote a different way? How would you change the pallet?

---

## Solutions

[`solutions/`](solutions) has everything finished: `Dao.sol`, the extras, the `cancel` pallet code (`lib.rs` and `cancel.patch`), and a prebuilt v2 runtime. Try first!

## Troubleshooting

| Problem | Fix |
|---|---|
| Build killed / out of memory | `CARGO_BUILD_JOBS=2 cargo build --release -p workshop-runtime` |
| `✗ The chain rejected the code` | You forgot to bump `spec_version`, or it isn't higher than the running one. |
| `Address already in use` | Another chain is still running: stop it (Ctrl+C) or `pkill polkadot-omni-node; pkill eth-rpc`. |
| Hardhat says the DAO doesn't exist | The chain was restarted (fresh chain). Run `npm run deploy` again. |
| Watcher prints `Incompatible runtime entry` | The runtime was upgraded. Run `npm run papi:update`, then restart the watcher. |
| Rust build doesn't work at all | Start the chain from the prebuilt runtime: `./scripts/start-chain.sh solutions/runtime/workshop_runtime_v1.compact.compressed.wasm`. You can still do Parts 0–2, and Part 3 with the prebuilt v2. |
| Anything else | Check `logs/node.log` and `logs/eth-rpc.log`. |

## What's in the repo

```
pallets/governance/            the governance pallet (Rust): lib.rs, tests.rs, cancel_tests.rs
pallets/governance/precompile/ the Solidity <-> pallet bridge, and IGovernance.sol
runtime/                       the chain's code: the pallets put together (based on the parachain template)
contracts/                     Hardhat project: Dao.sol, extras, tests, deploy scripts
papi/                          PAPI scripts: watch, propose-and-vote, upgrade, cancel
scripts/                       setup.sh, check.sh, start-chain.sh
solutions/                     the answers
```

Built on Polkadot SDK `polkadot-stable2609-2`, PAPI v3 and Hardhat 3.
