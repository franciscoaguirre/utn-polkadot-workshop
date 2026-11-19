// End-to-end test of the stretch contracts (needs the node + eth-rpc running).
// It waits for a real proposal to close, so it takes about a minute.
// Run: npm run test:extras
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

const GOVERNANCE_ADDRESS = "0x0000000000000000000000000000000009000000";
const REMARK_HI = "0x0000086869"; // System.remark(b"hi")
const APPROVED = 1;

describe("PredictionMarket and VoteMarket", async () => {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [alice, bob, charlie] = await viem.getWalletClients();
  const governance = await viem.getContractAt("IGovernance", GOVERNANCE_ADDRESS);

  const wait = async (hash: `0x${string}`) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
  };

  it("settle by reading the governance pallet", { timeout: 180_000 }, async () => {
    const id = await governance.read.nextProposalId();
    await wait(await governance.write.propose([REMARK_HI], { account: bob.account }));

    const market = await viem.deployContract("PredictionMarket", [id]);
    await wait(await market.write.bet([true], { value: parseEther("3"), account: alice.account }));
    await wait(await market.write.bet([false], { value: parseEther("1"), account: bob.account }));

    // The buyer pays 0.1 token per token voted aye, with a budget of 1 token.
    const voteMarket = await viem.deployContract("VoteMarket", [id, true, parseEther("0.1")], {
      value: parseEther("1"),
    });

    // Charlie votes aye with 2 tokens and gets paid 0.2.
    await wait(await governance.write.vote([id, true, parseEther("2")], { account: charlie.account }));
    await wait(await voteMarket.write.claim({ account: charlie.account }));
    assert.equal(
      await publicClient.getBalance({ address: voteMarket.address }),
      parseEther("0.8"),
    );

    // Bob votes nay and can't claim.
    await wait(await governance.write.vote([id, false, parseEther("1")], { account: bob.account }));
    await assert.rejects(voteMarket.write.claim({ account: bob.account }), /wanted way/);

    // Wait for the hook to close the proposal (2 aye vs 1 nay: approved).
    for (;;) {
      const [, , status] = await governance.read.proposal([id]);
      if (status !== 0) {
        assert.equal(status, APPROVED);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    // Alice bet on "pass" and takes the whole 4-token pot; Bob gets nothing.
    await wait(await market.write.claim({ account: alice.account }));
    assert.equal(await publicClient.getBalance({ address: market.address }), 0n);
    await assert.rejects(market.write.claim({ account: bob.account }), /nothing to claim/);

    // Voters unlock their frozen tokens; the buyer takes back the leftover budget.
    await wait(await governance.write.unlock([id], { account: charlie.account }));
    await wait(await voteMarket.write.withdrawLeftover());
    assert.equal(await publicClient.getBalance({ address: voteMarket.address }), 0n);
  });
});
