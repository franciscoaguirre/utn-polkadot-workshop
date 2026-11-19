# Instructor notes

This is a 2-hour online workshop for UTN students. They know Solidity and Ethereum, are new to Polkadot, and don't know Rust. They already had the lecture on Substrate, on pallets (kernel space) vs contracts (user space), and on Polkadot's architecture. This workshop makes that split something they *do*.

**The one idea to land:** a pallet is part of the chain itself. It can freeze tokens inside users' accounts, run code every block with no transaction, and act as Root. A contract can't do any of that. Contracts build products *on top of* what pallets provide, and the bridge between the two is a precompile. And because the runtime is just code the chain stores, the chain can vote to replace it while it keeps running.

## Before the session

- [ ] At least a week before, have the professors send students the README's **setup** section. The first build takes 15–40 minutes, and 8 GB machines need `CARGO_BUILD_JOBS=2`.
- [ ] Ask students to post a screenshot of `./scripts/check.sh` showing all ✅. Chase the ❌s before the day.
- [ ] Rehearse once on your own machine:
  - `./scripts/start-chain.sh`
  - `npm run watch`, then `npm run propose-and-vote`
  - Write Dao.sol, then `npm test` and `npm run deploy`
  - Write the cancel solution, bump `spec_version`, then build, `npm run upgrade` and `dao-vote`
  - `npm run papi:update`, then `npm run cancel`
- [ ] Reset your repo afterwards (`git stash` or `git checkout .`) so you can live-code from the starting state.
- [ ] If you'll use the class chain (next section): collect the students' addresses, write the config and rehearse it once with someone connecting from another network.

## The class chain

Besides everyone's own local chain, you can run **one chain for the whole class** on your machine, so students vote on the same proposals and join each other's DAOs (README: "Together: the class chain"). [`scripts/start-shared-chain.sh`](scripts/start-shared-chain.sh) runs the node and eth-rpc and publishes both through free Cloudflare quick tunnels. You don't need a server, a domain or open ports.

How it differs from the local chain:

- **No public keys.** Alice and the Hardhat accounts have public secret phrases, so they get nothing. The sudo key and every balance come from `shared-chain.config.json`, which isn't committed.
- **It keeps its state** in `shared-chain-data/` across restarts. `--reset` starts it again from block 0, and every DAO address becomes invalid.
- **Only safe RPC methods** are served (`--rpc-methods safe`), because the tunnel makes the RPC public.

### Before the day

1. Install `cloudflared` (`brew install cloudflared`; it's in the Nix shell too).
2. Make your own account. Students do the same and send you their two addresses (Polkadot `5…` and Ethereum `0x…`):
   ```bash
   cd papi && npm run account                  # new secret phrase
   MNEMONIC="…" npm run account                # its two addresses
   ```
3. Write the config. Give yourself the largest balance, so you can always outvote a bad proposal: governance runs anything as Root, including minting tokens or replacing the runtime. Equal balances for the students keep the token vote fair.
   ```bash
   cp shared-chain.config.example.json shared-chain.config.json   # then edit it
   ```
4. Start it once to check, with the runtime you'll use on the day:
   ```bash
   ./scripts/start-shared-chain.sh --runtime solutions/runtime/workshop_runtime_v1.compact.compressed.wasm
   ```
   Ports 9944 and 8545 are the same as the local chain's, so you can't run both at once. Students run their local chains on their own machines, so that only matters for you: stop your local chain before starting the class chain.

### On the day

- Start it. It prints the two public URLs and an explorer link ([dev.papi.how](https://dev.papi.how)), and saves the text for students in `shared-chain-data/for-students.txt`. **The URLs change every time the script starts**, so share them on the day.
- Late student? Fund them on the running chain. It sets the balance, it doesn't add to it:
  ```bash
  cd papi && MNEMONIC="<your phrase>" npm run fund -- 5Abc… 1000 0xabc… 1000
  ```
  Editing the config afterwards does nothing to a running chain. The script warns you about that.
- **The class upgrade.** Students upgrade their *own* chain in Part 3; only one runtime can be live on the class chain. Run one upgrade there for everyone to vote on. With `MNEMONIC` set, `npm run upgrade` makes you the proposer and doesn't vote for you, so vote yourself from another terminal:
  ```bash
  cd papi && MNEMONIC="<your phrase>" NODE_URL=ws://127.0.0.1:9944 npm run upgrade -- ../solutions/runtime/workshop_runtime_v2_cancel.compact.compressed.wasm
  ```
- Keep the laptop awake and plugged in (`caffeinate -dis` on macOS), on a cable if you can. If your machine sleeps, the class loses the chain.

## Agenda (120 min)

| Time | Part | You | Students |
|---|---|---|---|
| 0:00–0:10 | **0. Setup** | Share your screen with the three terminals. Start the chain and the watcher. | Same. Anyone stuck uses the prebuilt v1 runtime (see Fallbacks). |
| 0:10–0:35 | **1. Kernel space** | Guided read of `pallets/governance/src/lib.rs` with the Solidity↔FRAME table (README). Stop at the three 🔑 lines. Run `propose-and-vote`. | Read along, run the script, watch the hook enact the proposal. |
| 0:35–1:05 | **2. User space** | Show `IGovernance.sol` and the precompile address. Explain that it's not a contract and calls go into Rust. Live-code `vote` together, then let them do `castVote`. | Fill in `Dao.sol`, `npm test`, `npm run deploy`. |
| 1:05–1:45 | **3. Change the kernel** | Live-code `cancel` step by step: status → event → error → call. Then build, upgrade, DAO vote, and the 🚀 moment. | Same. Anyone with a broken build uses the prebuilt v2. |
| 1:45–2:00 | **Wrap-up** | Recap the kernel/user split. Discuss the one-vote-per-account limit and VoteMarket (bribes). Point to the stretch goals, including FairDao (the Part 2 DAO's flaws). If you run the class chain, this is where the class votes together. | Questions; stretch goals at home. |

The time sink is **Part 3's build**. An incremental runtime rebuild after the pallet change took about 35 s on a 128-core build server; expect several minutes on a laptop, and time it on yours when you rehearse. Start the build first, and explain `apply_authorized_upgrade` while it compiles.

## Talking points

**Part 1 — the pallet**
- Storage, calls, events and errors map one-to-one onto Solidity concepts (see the table in the README).
- **Freezes:** `T::Currency::extend_freeze` freezes tokens *in the voter's own account*. A Solidity contract would have to take custody of them. Show "free vs frozen" in the script output.
- **Freezes, not holds:** like OpenGov, a vote freezes tokens rather than holding them. Holds set tokens aside for one purpose and add up. Freezes overlap: the account keeps only its *biggest* vote frozen, so the same tokens can vote on many proposals at once. `unlock` shrinks the freeze to the biggest vote that's left (that's what the `VotedOn` storage is for).
- **Hooks:** `on_initialize` runs at the start of every block. On Ethereum you'd need a keeper bot (Chainlink Automation, Gelato).
- **Root:** `close` dispatches any call as the superuser. That's how `Balances.force_set_balance` can create tokens.
- **Weights** are the "gas" of pallets. Real pallets benchmark them; we use fixed numbers.
- **What's missing on purpose:** quorum, deposits, conviction, delegation, vote changes. Ask the students: what attacks does each prevent?

**Part 2 — the precompile**
- The address `0x…09000000` has no bytecode. pallet-revive sees the call and runs Rust (`pallets/governance/precompile/src/lib.rs`).
- `msg.sender` inside the pallet is the **DAO contract's account**. Every Ethereum address maps to a Polkadot account: the address followed by 12 bytes of `0xEE`.
- Amounts are in wei (18 decimals) for Solidity. The precompile converts them to the native token's 12 decimals.
- The test checks that the DAO's balance drops to about 0 after `castVote`: the tokens are frozen, not gone. A second test votes with the same treasury on two proposals at once, which works because freezes overlap. Point out `votingBalance`: Solidity's `address(this).balance` doesn't count frozen tokens.
- The DAO mixes two voting systems. Inside, it's a whitelist with one person, one vote. Outside, governance counts tokens. Ask the students: is it fair that a 2-vs-1 split inside the DAO puts the **whole** treasury on one side? What would a fairer DAO do?

**Part 3 — the upgrade**
- The proposal carries only a 32-byte hash, not 1.5 MB of code. `authorize_upgrade` is Root-only, and governance supplies the Root. `apply_authorized_upgrade` is free and anyone can call it, because the hash is already approved.
- `spec_version` must go up, or the chain rejects the code. The script catches this and explains it.
- The node binary (`polkadot-omni-node`) is generic and never changes. The *runtime* is the chain. That's the kernel being hot-swapped.
- PAPI's types come from metadata. After the upgrade the old watcher hits a `Governance.Cancelled` event it has no type for, and **refuses to decode it** instead of guessing (`Incompatible runtime entry`). `npm run papi:update` fixes it. This is a good moment to show PAPI's compatibility checks (see `04-cancel.ts`).

## Fallbacks

| Situation | What to do |
|---|---|
| A student's Rust build never worked | `./scripts/start-chain.sh solutions/runtime/workshop_runtime_v1.compact.compressed.wasm` covers Parts 0–2. For Part 3: `npm run upgrade -- ../solutions/runtime/workshop_runtime_v2_cancel.compact.compressed.wasm` |
| A student's `cancel` won't compile in time | `git apply solutions/pallet-governance/cancel.patch`, or use the prebuilt v2 as above |
| Intel Mac / ARM Linux / native Windows | No prebuilt binaries for these. Use WSL2 on Windows. On the others `setup.sh` builds the tools from source with `cargo install`, which takes a long time, so make sure it happens before the day. |
| A student restarted the chain mid-workshop | It's a fresh chain: they need to redeploy the DAO (`npm run deploy`) |
| The upgrade proposal was rejected | Someone voted NAY with more tokens. Run `npm run upgrade` again |

## Known limits (good discussion material)

- **One vote per account per proposal.** That's why a contract can't vote different directions for different members (no "delegation" contract in the extras).
- **Votes per account are capped.** `unlock` has to look at every other vote of the account to work out the new freeze, so `MaxVotesPerAccount` (64 in the runtime) keeps it bounded. OpenGov has the same kind of limit (`MaxVotes`).
- **Unbounded dispatch in the hook.** `on_initialize` runs passed calls without pre-checking that they fit in the block. That's fine for a workshop, not for production.

## Technical facts (verified while building this repo)

- Polkadot SDK `polkadot-stable2609-2` (umbrella crate 2609.3.0, pallet-revive 0.22.0). The prebuilt `polkadot-omni-node`, `eth-rpc` (0.25.0) and `chain-spec-builder` (21.0.0) come from that release, for Linux x86_64 and macOS arm64 only.
- `polkadot-omni-node --dev --dev-block-time 1000` simulates the relay chain's go-ahead signal. A parachain runtime upgrade applies about 2 blocks after `apply_authorized_upgrade`.
- `Cargo.lock` must stay committed. Without it, Cargo picks `alloy-trie` 0.9.9, which breaks pallet-revive 0.22.0 (it needs 0.9.5).
- The voting period is 60 blocks, about 1 minute at 1 block/s. Change it in `runtime/src/configs/mod.rs` (`GovernanceVotingPeriod`).
- The `target/` directory is about 6 GB after setup (runtime plus pallet tests).
