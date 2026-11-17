// End-to-end test of the DAO against the local chain (needs the node + eth-rpc running).
// Run: npm test
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
  const [alice, bob, charlie] = await viem.getWalletClients();
  const governance = await viem.getContractAt("IGovernance", GOVERNANCE_ADDRESS);

  const wait = async (hash: `0x${string}`) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  };

  it("members vote inside the DAO and the DAO votes in governance", async () => {
    const dao = await viem.deployContract("Dao");

    await wait(await dao.write.join({ value: parseEther("10"), account: alice.account }));
    await wait(await dao.write.join({ value: parseEther("5"), account: bob.account }));
    await wait(await dao.write.join({ value: parseEther("1"), account: charlie.account }));

    // Propose through the DAO: the precompile returns the new proposal id.
    const { result: id } = await dao.simulate.propose([REMARK_HI], { account: alice.account });
    await wait(await dao.write.propose([REMARK_HI], { account: alice.account }));

    const [exists, proposer, status] = await governance.read.proposal([id]);
    assert.equal(exists, true);
    assert.equal(proposer.toLowerCase(), dao.address.toLowerCase());
    assert.equal(status, ProposalStatus.Ongoing);

    // Alice and Charlie say aye (11), Bob says nay (5).
    await wait(await dao.write.vote([id, true], { account: alice.account }));
    await wait(await dao.write.vote([id, false], { account: bob.account }));
    await wait(await dao.write.vote([id, true], { account: charlie.account }));

    const balanceBefore = await publicClient.getBalance({ address: dao.address });
    await wait(await dao.write.castVote([id]));

    // The pallet saw one aye vote of 16 tokens, from the DAO.
    const [, , , , ayes, nays] = await governance.read.proposal([id]);
    assert.equal(ayes, parseEther("16"));
    assert.equal(nays, 0n);
    const [voted, aye, amount] = await governance.read.voteOf([id, dao.address]);
    assert.deepEqual([voted, aye, amount], [true, true, parseEther("16")]);

    // The tokens are held inside the DAO's own account: still there, but not spendable.
    const balanceAfter = await publicClient.getBalance({ address: dao.address });
    console.log(`      DAO balance before vote: ${balanceBefore}, after: ${balanceAfter}`);
  });

  it("reverts with the pallet's error name", async () => {
    const dao = await viem.deployContract("Dao");
    await wait(await dao.write.join({ value: parseEther("1"), account: alice.account }));
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
