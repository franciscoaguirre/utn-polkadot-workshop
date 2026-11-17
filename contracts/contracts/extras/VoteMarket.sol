// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IGovernance, GOVERNANCE_ADDRESS, ProposalStatus} from "../IGovernance.sol";

/// Pay token holders for voting a certain way ("bribes"). Real-world example: the Curve wars.
///
/// The buyer deploys it with a budget and a price per voted token. Anyone who voted the wanted
/// way claims `price × tokens voted` while voting is still open. The contract checks the vote
/// by *reading* it from the governance pallet: no trust needed. Votes can't be changed or
/// unlocked before voting ends, so paying early is safe.
///
/// Discussion: what does this do to governance? How would you design a pallet to resist it?
contract VoteMarket {
    IGovernance constant GOVERNANCE = IGovernance(GOVERNANCE_ADDRESS);

    address public immutable buyer;
    uint32 public immutable proposalId;
    bool public immutable wantedAye;
    /// Paid per 1 token (1e18 wei) voted.
    uint256 public immutable pricePerToken;
    mapping(address => bool) public claimed;

    event Paid(address indexed voter, uint256 amount);

    constructor(uint32 id, bool aye, uint256 price) payable {
        require(msg.value > 0, "send a budget");
        require(status(id) == ProposalStatus.Ongoing, "proposal is not open");
        buyer = msg.sender;
        proposalId = id;
        wantedAye = aye;
        pricePerToken = price;
    }

    function status(uint32 id) public view returns (ProposalStatus) {
        (bool exists,, uint8 rawStatus,,,) = GOVERNANCE.proposal(id);
        require(exists, "unknown proposal");
        return ProposalStatus(rawStatus);
    }

    /// Vote the wanted way in governance first, then call this to get paid.
    function claim() external {
        // TODO(stretch): pay a voter who voted the wanted way.
        //   - require voting is still Ongoing and the caller hasn't claimed
        //   - read the caller's vote: GOVERNANCE.voteOf(proposalId, msg.sender)
        //   - require they voted, in the wanted direction
        //   - payout = amount * pricePerToken / 1 ether; require the budget covers it
        //   - mark as claimed, then send the payout and emit Paid
    }

    /// After voting ends, the buyer takes back whatever is left.
    function withdrawLeftover() external {
        require(msg.sender == buyer, "only the buyer");
        require(status(proposalId) != ProposalStatus.Ongoing, "voting still open");
        (bool ok,) = buyer.call{value: address(this).balance}("");
        require(ok, "transfer failed");
    }
}
