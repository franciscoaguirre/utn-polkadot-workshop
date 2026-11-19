# UTN Workshop: Governance Pallet × Solidity DAO × PAPI

## Context

This is a 2-hour online workshop for UTN students. They know Solidity and Ethereum, are new to Polkadot, and don't know Rust. They have already had a lecture on Substrate, on pallets as "kernel space" vs contracts as "user space", and on Polkadot's architecture. The workshop makes that split hands-on.

Students meet a deliberately minimal **OpenGov-style governance pallet** (kernel space). It is exposed to Solidity through a **pallet-revive precompile**. They write a **DAO contract** in Hardhat (user space) that casts one combined vote for its members among many token holders. They drive and observe everything with **PAPI**.

The finale ties it all together. Students add a feature to the pallet (`cancel`), rebuild the runtime, and **vote their own upgrade into the running chain**. The chain swaps code live and PAPI sees the new call.

Cross-chain and a shared Paseo demo are out of scope (backburner). Students build the repo before the session because of compile times. The folder is currently empty and not a git repo.

## Decisions made with the user

- **Contract ↔ pallet direction:** contract → pallet via a custom precompile.
- **The pallet is simulated:** teaching-sized, not production.
- **Governance pallet scope:** strictly minimal.
  - `propose(call)`, `vote(id, aye, amount)` with a balance **freeze** (like OpenGov, so one account can vote on many proposals at once), `unlock(id)`.
  - An `on_initialize` hook enacts passing proposals (ayes > nays) as Root.
  - No quorum, deposit, tracks, conviction, delegation, or vote changes.
- **Contracts:** Solidity compiled and deployed with **Hardhat**, running on the **EVM backend** of pallet-revive.
  - The default exercise is a DAO.
  - Stretch menu: vote delegation, a prediction market on a referendum, proposal crowdfunding, a vote market.
- **Student pallet exercise (v2):** add `cancel(id)`.
  - The proposer cancels an ongoing proposal.
  - It touches a new call, an error, an event, a storage change and the `EndingAt` cleanup, with tests provided.
- **Proposals:** a proposal is any encoded `RuntimeCall`. The upgrade is just `System.authorize_upgrade(code_hash)` followed by an unsigned, feeless `System.apply_authorized_upgrade(code)`.

## Technical base (from research, verify in step 1)

- **polkadot-sdk:** pin to `polkadot-stable2609-2` (latest release, 2026-11-12, pallet-revive 0.22.0).
- **Node (decided by the step 1 test):**
  - **Preferred: prebuilt `polkadot-omni-node`** running a runtime based on the **parachain template**, with pallet-revive added. Launch with `polkadot-omni-node --chain chain_spec.json --dev --dev-block-time 1000`.
    - Students only build the runtime.
    - It teaches "the node is a generic shell; the runtime is the chain."
    - Regular blocks mean the hook's deadline arrives with no transactions sent.
    - Use **asset-hub-westend** as the reference for wiring revive: Ethereum tx extension, `UncheckedExtrinsic`, and `impl_runtime_apis_plus_revive_traits!`.
  - **Fallback: fork the revive dev-node** (`substrate/frame/revive/dev-node/{node,runtime}`, standalone, `--consensus manual-seal-1000`). Students would then also compile the node in pre-work.
- **`eth-rpc`:** needed either way, since Hardhat requires Ethereum JSON-RPC.
  - Pin it to the same SDK release as the runtime.
  - Prefer a prebuilt release binary if one exists; otherwise `cargo install pallet-revive-eth-rpc` in pre-work.
- **Precompile pattern:** copy `substrate/frame/vesting/precompiles/` (`pallet-vesting-precompiles`).
  - Each call does `sol!("IGovernance.sol")`, uses `AddressMatcher::Fixed`, sets `HAS_CONTRACT_INFO = false`, charges weight, runs an `ensure_mutable` check, then calls the pallet with `RawOrigin::Signed(env.caller().account_id())`.
- **Runtime config:** `type Precompiles = (GovernancePrecompile<Self>,)`, `AutoMap = true` (no `map_account` step), and `AllowEVMBytecode` (on by default).
- **Freezes:** follow the `pallet-conviction-voting` (OpenGov) idea with the `fungible` traits: `#[pallet::composite_enum] FreezeReason { Vote }` and `fungible::MutateFreeze`. One freeze per account, sized to its biggest vote, so votes on different proposals overlap. A bounded `VotedOn` list per account lets `unlock` recompute it.
- **Root dispatch:** follow `pallet-sudo` (`dispatch_bypass_filter(RawOrigin::Root.into())`). Store the call as `BoundedVec<u8, MaxCallLen>` and decode it at enactment.
- **Ethereum RPC:** the `eth-rpc` adapter (`pallet-revive-eth-rpc`) runs on `:8545` for Hardhat.
  - Fund the Hardhat default mnemonic accounts in the genesis preset. They map to AccountId32 as `h160 ++ 0xEE×12`.
- **PAPI v3 (`polkadot-api` 3.3.x):**
  - Use `getWsProvider` from `polkadot-api/ws` and `getTxCreator` from `polkadot-api/tx-creator` with `@polkadot-labs/hdkd`.
  - Transactions use `createAndSubmit` / `createSubmitAndWatch`.
  - Call bytes come from `getStaticApis().tx.System.authorize_upgrade({ code_hash }).getCallData()`.
  - After the upgrade, generate the v2 typed API with `papi add next --wasm <path>`.

## Repo layout

```
README.md                       student guide: pre-work, then the 4 parts
INSTRUCTOR.md                   timing, talking points (Solidity↔FRAME mapping), fallbacks
docs/superpowers/specs/2026-11-17-utn-governance-workshop-design.md
rust-toolchain.toml  Cargo.toml (workspace, polkadot-sdk pinned)
runtime/                        parachain-template runtime + Revive + Governance + precompile;
                                genesis preset funds Alice.. & Hardhat accounts (node = prebuilt omni-node;
                                node/ crate only if we fall back to the revive dev-node)
pallets/governance/
  src/lib.rs                    v1, heavily commented ("≈ Solidity" notes on storage/calls/events/errors)
  src/tests.rs, src/mock.rs     includes #[ignore]d cancel tests the students un-ignore
  precompile/src/lib.rs, IGovernance.sol
contracts/                      Hardhat project
  contracts/IGovernance.sol     interface + fixed precompile address
  contracts/Dao.sol             skeleton with TODOs
  contracts/extras/             stretch skeletons (Delegation, PredictionMarket, Crowdfund, VoteMarket)
  ignition or scripts/deploy.ts, hardhat.config.ts (network "local" → :8545)
papi/                           TypeScript scripts (pnpm, PAPI v3)
  src/lib.ts                    client, dev accounts, helpers
  01-watch.ts                   live view: proposals, tallies, events, spec_version
  02-propose-and-vote.ts        propose System.remark_with_event, Alice/Bob vote, watch enactment
  03-upgrade.ts                 hash wasm → propose authorize_upgrade → (vote) → apply_authorized_upgrade
  04-try-cancel.ts              uses v2 descriptors to call Governance.cancel
solutions/                      finished Dao.sol, extras, and pallet v2 (cancel) diff
scripts/setup.sh, scripts/check.sh   pre-work install/build + ✅/❌ readiness checklist
```

## Implementation steps

1. **Scaffold.** Run `git init`, confirm the stable2609-2 crate versions, and commit the design doc.
2. **Test the toolchain before anything else.** Build a parachain-template runtime with pallet-revive, no governance yet.
   - Run it on the prebuilt `polkadot-omni-node --dev --dev-block-time 1000`.
   - Get `eth-rpc` from the release assets, or use `cargo install`.
   - Confirm all of the following:
     - (a) Hardhat deploys and calls a hello-world contract through `eth-rpc`, using the genesis-funded Hardhat accounts.
     - (b) `sudo(System.authorize_upgrade)` + `apply_authorized_upgrade` with a `spec_version + 1` wasm upgrades the live chain.
     - (c) `eth-rpc` keeps working after that upgrade.
   - If everything passes, keep the omni-node design. If (b) fails, switch to the forked revive dev-node.
   - Report the result to the user, and record the build times.
3. **Governance pallet v1, test-first.**
   - Storage: `NextId`, `Proposals`, `Votes`, `EndingAt`.
   - Calls and the hook as designed; `Config` exposes `VotingPeriod`, `MaxCallLen`, `MaxProposalsPerBlock`, `MaxVotesPerAccount`.
   - Unit tests cover: propose, vote freezes, the same tokens voting on several proposals, double-vote rejected, pass enacts as Root, reject doesn't, unlock only after end.
4. **Cancel exercise.**
   - Write the full `cancel` solution in `solutions/`.
   - In v1, leave a commented `// TODO(workshop)` stub plus `#[ignore]` tests.
   - Verify that the solution makes the tests pass.
5. **Precompile + runtime wiring.**
   - `IGovernance.sol` declares `propose(bytes) returns (uint32)`, `vote(uint32,bool,uint256)`, `unlock(uint32)`, and the views `proposal(uint32) returns (status, end, ayes, nays)` and `votingBalance(address)`.
   - Register it in the runtime.
   - Test that a contract account's balance can be frozen. (This is unverified in research and is the key risk.)
6. **Hardhat project.** Write the interface, the DAO skeleton and solution, and the extras skeletons and solutions. Add a deploy script and a test that runs against the local node.
7. **PAPI scripts.** Write scripts 01–04, generate and commit `.papi` descriptors, and run `papi` as `postinstall`.
8. **Upgrade rehearsal.** Run the full loop end to end: build v2 with `spec_version` + 1, have the DAO and Alice vote on `authorize_upgrade`, let the hook enact it, call `apply_authorized_upgrade`, and confirm with PAPI that `Governance.cancel` exists.
9. **Pre-work + docs.**
   - `setup.sh` / `check.sh` (Rust, wasm target, builds, pnpm deps, descriptors).
   - The README walkthrough.
   - INSTRUCTOR.md with a minute-by-minute agenda (below), the Solidity↔FRAME cheat sheet, and the fallback of prebuilt v2 wasm in `solutions/` for anyone whose build fails.

## Workshop agenda (draft)

| Time | Part | Students do |
|---|---|---|
| 0:00–0:10 | Setup check | `check.sh`, start node + eth-rpc, run `01-watch.ts` |
| 0:10–0:35 | 1. Kernel space | Guided read of the pallet. `02-propose-and-vote.ts`: watch tokens get frozen and the hook enact a remark |
| 0:35–1:05 | 2. User space | Fill in `Dao.sol`, deploy with Hardhat, members vote in the DAO, the DAO votes in governance |
| 1:05–1:40 | 3. Change the kernel | Implement `cancel`, `cargo test`, build v2 wasm, `03-upgrade.ts` via governance, `04-try-cancel.ts` |
| 1:40–2:00 | Stretch / wrap-up | Extras menu, recap of kernel vs user space |

## Verification

- `cargo test -p pallet-governance`: v1 tests pass. With the solution applied and tests un-ignored, the cancel tests pass.
- Run the precompile and runtime integration tests.
- `npx hardhat test --network local` against a running node passes, including the DAO casting its vote through the precompile.
- PAPI scripts 01–04 run end to end on a fresh chain. After step 03, the spec_version increments and step 04's `cancel` succeeds.
- Do a clean-clone dry run of `setup.sh` + `check.sh`, and record the build times and disk usage for INSTRUCTOR.md.

## Implementation notes (2026-11-17)

What changed from the plan while building, and why:

- **The node is omni-node.** The step-2 test passed on prebuilt `polkadot-omni-node --dev`: Hardhat via `eth-rpc`, a live `authorize_upgrade` + `apply_authorized_upgrade`, and `eth-rpc` still working after the upgrade. The revive dev-node fallback was not needed.
- **Prebuilt binaries cover Linux x86_64 and macOS arm64 only.** `setup.sh` falls back to `cargo install` on other platforms. Builds run out of memory on 8 GB machines with default parallelism, so `setup.sh` sets the job count from available RAM.
- **`Cargo.lock` is committed and pins `alloy-trie` 0.9.5.** pallet-revive 0.22.0 does not compile against 0.9.9.
- **Cancel tests are a commented-out module (`cancel_tests.rs`), not `#[ignore]`.** Ignored tests must still compile, and they reference items students haven't written yet.
- **The precompile uses wei amounts (18 decimals)** and converts them to native units, so Solidity code never deals with two unit systems.
- **Only two stretch contracts: PredictionMarket and VoteMarket.** The pallet's one-vote-per-account rule rules out a delegation contract, and with no proposal deposit there is nothing to crowdfund. Both limits are written up as discussion points in INSTRUCTOR.md.
- **VoteMarket pays a fixed price while voting is open.** Pro-rata payment after the vote ends would break, because `unlock` deletes the vote record.
- **Prebuilt v1 and v2 runtimes are in `solutions/runtime/`** as fallbacks for broken builds.
- **The PAPI project uses `moduleResolution: bundler`.** Under `node16`, the generated descriptor types silently resolved to `any`.
- **The voting period is 60 blocks**, about 1 minute with `--dev-block-time 1000`.
- **The DAO uses a whitelist and one person, one vote** (changed after review). The owner (the deployer) adds and removes members, and each member counts once. The DAO votes in governance with its whole treasury, in the majority's direction. Anyone can fund the treasury.
- **Votes freeze tokens instead of holding them** (changed after review), like OpenGov. Freezes overlap, so one account (the DAO included) can vote with the same tokens on many proposals at once. Solidity's `address(this).balance` leaves frozen tokens out, so the precompile has a `votingBalance(address)` view the DAO votes with.
