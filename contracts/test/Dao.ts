// End-to-end test of the DAO against the local chain (needs the node + eth-rpc running).
// Run: npm test   (the chain must be running: ./scripts/start-chain.sh)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

const GOVERNANCE_ADDRESS = "0x0000000000000000000000000000000009000000";

// A SCALE-encoded `System.remark(b"hi")` call: [pallet index 0, call index 0, length 2*4, "hi"].
// In the workshop you build these bytes with PAPI instead.
const REMARK_HI = "0x0000086869";

enum ProposalStatus {
  Ongoing,
  Approved,
  Rejected,
  Cancelled,
}

describe("Dao", async () => {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, alice, bob, charlie, outsider] = await viem.getWalletClients();
  const governance = await viem.getContractAt("IGovernance", GOVERNANCE_ADDRESS);

  const wait = async (hash: `0x${string}`) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  };

  /** A DAO with Alice, Bob and Charlie as members and `treasury` tokens to vote with. */
  async function deployDao(treasury: string) {
    const dao = await viem.deployContract("Dao", [], { account: owner.account });
    for (const member of [alice, bob, charlie]) {
      await wait(await dao.write.addMember([member.account.address], { account: owner.account }));
    }
    await wait(await dao.write.fund({ value: parseEther(treasury), account: owner.account }));
    return dao;
  }

  it("only the owner manages the whitelist, and only members vote", async () => {
    const dao = await deployDao("1");
    assert.equal(await dao.read.memberCount(), 3n);
    await assert.rejects(
      dao.write.addMember([outsider.account.address], { account: alice.account }),
      /only the owner/,
    );
    await assert.rejects(dao.write.vote([0, true], { account: outsider.account }), /not a member/);
    await assert.rejects(dao.write.propose([REMARK_HI], { account: outsider.account }), /not a member/);
  });

  it("one member, one vote: the majority decides how the whole treasury votes", async () => {
    const dao = await deployDao("16");

    // Propose through the DAO: the precompile returns the new proposal id.
    const { result: id } = await dao.simulate.propose([REMARK_HI], { account: alice.account });
    await wait(await dao.write.propose([REMARK_HI], { account: alice.account }));

    const [exists, proposer, status] = await governance.read.proposal([id]);
    assert.equal(exists, true);
    assert.equal(proposer.toLowerCase(), dao.address.toLowerCase());
    assert.equal(status, ProposalStatus.Ongoing);

    // Two members say aye, one says nay. Each counts once.
    await wait(await dao.write.vote([id, true], { account: alice.account }));
    await wait(await dao.write.vote([id, false], { account: bob.account }));
    await wait(await dao.write.vote([id, true], { account: charlie.account }));
    await assert.rejects(dao.write.vote([id, true], { account: alice.account }), /already voted/);
    const [ayes, nays] = await dao.read.ballots([id]);
    assert.deepEqual([ayes, nays], [2n, 1n]);

    await wait(await dao.write.castVote([id]));

    // The pallet saw one aye vote with the DAO's whole treasury.
    const [, , , , governanceAyes, governanceNays] = await governance.read.proposal([id]);
    assert.equal(governanceAyes, parseEther("16"));
    assert.equal(governanceNays, 0n);
    const [voted, aye, amount] = await governance.read.voteOf([id, dao.address]);
    assert.deepEqual([voted, aye, amount], [true, true, parseEther("16")]);

    // The tokens are frozen inside the DAO's own account: still there, but not spendable.
    // (A freeze may also cover the existential deposit, so that tiny bit can be left over.)
    assert.ok((await publicClient.getBalance({ address: dao.address })) < parseEther("0.01"));
    assert.equal(await governance.read.votingBalance([dao.address]), parseEther("16"));
  });

  it("freezes overlap: the DAO votes with its whole treasury on two proposals at once", async () => {
    const dao = await deployDao("8");
    const first = await governance.read.nextProposalId();
    await wait(await dao.write.propose([REMARK_HI], { account: alice.account }));
    await wait(await dao.write.propose([REMARK_HI], { account: alice.account }));
    const second = first + 1;

    for (const id of [first, second]) {
      await wait(await dao.write.vote([id, true], { account: alice.account }));
      await wait(await dao.write.vote([id, true], { account: bob.account }));
      await wait(await dao.write.castVote([id]));
    }

    // Both proposals got all 8 tokens, although the DAO only has 8.
    for (const id of [first, second]) {
      const [, , , , ayes] = await governance.read.proposal([id]);
      assert.equal(ayes, parseEther("8"));
    }
  });

  it("a tie means the DAO doesn't vote", async () => {
    const dao = await deployDao("1");
    const id = await governance.read.nextProposalId();
    await wait(await dao.write.propose([REMARK_HI], { account: alice.account }));
    await wait(await dao.write.vote([id, true], { account: alice.account }));
    await wait(await dao.write.vote([id, false], { account: bob.account }));
    await assert.rejects(dao.write.castVote([id]), /no majority/);
  });

  it("reverts with the pallet's error name", async () => {
    await assert.rejects(
      governance.write.vote([999_999, true, parseEther("1")], { account: alice.account }),
      /ProposalNotFound/,
    );
  });

  it("users can also vote directly through the precompile", async () => {
    const id = await governance.read.nextProposalId();
    await wait(await governance.write.propose([REMARK_HI], { account: bob.account }));
    await wait(await governance.write.vote([id, false, parseEther("2")], { account: bob.account }));
    const [, , , , ayes, nays] = await governance.read.proposal([id]);
    assert.deepEqual([ayes, nays], [0n, parseEther("2")]);
  });
});
