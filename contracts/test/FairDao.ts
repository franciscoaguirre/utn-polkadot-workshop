// End-to-end test of the FairDao stretch goal (needs the node + eth-rpc running).
// Run: npm run test:extras
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

const GOVERNANCE_ADDRESS = "0x0000000000000000000000000000000009000000";
const REMARK_HI = "0x0000086869"; // System.remark(b"hi")

describe("FairDao", async () => {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, first, second, third] = await viem.getWalletClients();
  const governance = await viem.getContractAt("IGovernance", GOVERNANCE_ADDRESS);

  const wait = async (hash: `0x${string}`) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
  };
  const balanceOf = (address: `0x${string}`) => publicClient.getBalance({ address });

  /** A FairDao whose members are the three other Hardhat accounts. */
  async function deployDao() {
    const dao = await viem.deployContract("FairDao", []);
    for (const member of [first, second, third]) {
      await wait(await dao.write.addMember([member.account.address]));
    }
    return dao;
  }

  it("refunds a removed member's contribution", async () => {
    const dao = await deployDao();
    await wait(await dao.write.fund({ value: parseEther("5"), account: first.account }));
    await wait(await dao.write.fund({ value: parseEther("2") }));
    assert.equal(await dao.read.contributions([first.account.address]), parseEther("5"));

    // The owner pays the fees, so the member gets back exactly what they put in.
    const before = await balanceOf(first.account.address);
    await wait(await dao.write.removeMember([first.account.address]));
    assert.equal((await balanceOf(first.account.address)) - before, parseEther("5"));
    assert.equal(await dao.read.contributions([first.account.address]), 0n);
    assert.equal(await balanceOf(dao.address), parseEther("2"));

    // A member who put nothing in can be removed too.
    await wait(await dao.write.removeMember([second.account.address]));
    assert.equal(await dao.read.memberCount(), 1n);
  });

  it("only casts its vote once more than half of the members voted", async () => {
    const dao = await deployDao();
    await wait(await dao.write.fund({ value: parseEther("3"), account: third.account }));

    const id = await governance.read.nextProposalId();
    await wait(await governance.write.propose([REMARK_HI]));

    // Nobody voted yet, then only 1 of 3: not enough.
    await assert.rejects(dao.write.castVote([id]), /no quorum/);
    await wait(await dao.write.vote([id, true], { account: first.account }));
    await assert.rejects(dao.write.castVote([id]), /no quorum/);

    // 2 of 3 voted: anyone may cast it now, the outcome is decided.
    await wait(await dao.write.vote([id, true], { account: second.account }));
    await wait(await dao.write.castVote([id]));
    assert.ok((await balanceOf(dao.address)) < parseEther("0.01"));

    // The treasury is frozen by governance, so a refund has to wait for `unlock`.
    await assert.rejects(dao.write.removeMember([third.account.address]), /treasury is frozen/);
  });
});
