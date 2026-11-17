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
        // TODO(stretch): accept a bet while the proposal is still Ongoing.
        //   - require msg.value > 0 and status(proposalId) == ProposalStatus.Ongoing
        //   - add msg.value to betOnPass/betOnFail and totalOnPass/totalOnFail
        //   - emit Bet(msg.sender, pass, msg.value)
    }

    /// After the proposal is decided, collect your winnings.
    /// If it was cancelled, or nobody bet on the winning side, everyone gets their bets back.
    function claim() external {
        // TODO(stretch): pay out once the proposal is decided.
        //   - read the result with status(proposalId); require it is not Ongoing
        //   - Approved: winners on "pass" split the pot (totalOnPass + totalOnFail) pro rata
        //   - Rejected: same for "fail"
        //   - Cancelled, or nobody on the winning side: refund the bets
        //   - zero the caller's bets BEFORE sending (why?), then send with msg.sender.call{value: ...}("")
    }
}
