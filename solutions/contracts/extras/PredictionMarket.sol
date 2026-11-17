// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IGovernance, GOVERNANCE_ADDRESS, ProposalStatus} from "../IGovernance.sol";

/// Bet on whether a governance proposal will pass.
///
/// It never votes: it only *reads* kernel-space state through the precompile to settle.
/// Winners split the whole pot in proportion to their bets.
contract PredictionMarket {
    IGovernance constant GOVERNANCE = IGovernance(GOVERNANCE_ADDRESS);

    uint32 public immutable proposalId;
    mapping(address => uint256) public betOnPass;
    mapping(address => uint256) public betOnFail;
    uint256 public totalOnPass;
    uint256 public totalOnFail;

    event Bet(address indexed bettor, bool pass, uint256 amount);
    event Claimed(address indexed bettor, uint256 amount);

    constructor(uint32 id) {
        require(status(id) == ProposalStatus.Ongoing, "proposal is not open");
        proposalId = id;
    }

    /// The proposal's current status, read from the governance pallet.
    function status(uint32 id) public view returns (ProposalStatus) {
        (bool exists,, uint8 rawStatus,,,) = GOVERNANCE.proposal(id);
        require(exists, "unknown proposal");
        return ProposalStatus(rawStatus);
    }

    /// Bet `msg.value` that the proposal will (`pass = true`) or won't pass.
    function bet(bool pass) external payable {
        require(msg.value > 0, "send some tokens");
        require(status(proposalId) == ProposalStatus.Ongoing, "betting closed");
        if (pass) {
            betOnPass[msg.sender] += msg.value;
            totalOnPass += msg.value;
        } else {
            betOnFail[msg.sender] += msg.value;
            totalOnFail += msg.value;
        }
        emit Bet(msg.sender, pass, msg.value);
    }

    /// After the proposal is decided, collect your winnings.
    /// If it was cancelled, or nobody bet on the winning side, everyone gets their bets back.
    function claim() external {
        ProposalStatus result = status(proposalId);
        require(result != ProposalStatus.Ongoing, "not decided yet");

        uint256 pot = totalOnPass + totalOnFail;
        uint256 payout;
        if (result == ProposalStatus.Approved && totalOnPass > 0) {
            payout = (betOnPass[msg.sender] * pot) / totalOnPass;
        } else if (result == ProposalStatus.Rejected && totalOnFail > 0) {
            payout = (betOnFail[msg.sender] * pot) / totalOnFail;
        } else {
            payout = betOnPass[msg.sender] + betOnFail[msg.sender];
        }
        betOnPass[msg.sender] = 0;
        betOnFail[msg.sender] = 0;
        require(payout > 0, "nothing to claim");

        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "transfer failed");
        emit Claimed(msg.sender, payout);
    }
}
