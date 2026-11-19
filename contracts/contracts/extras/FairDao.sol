// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IGovernance, GOVERNANCE_ADDRESS} from "../IGovernance.sol";

/// The DAO from Part 2, with two of its problems fixed.
///
/// 1. The owner could remove a member who had put tokens in the treasury, and the member lost
///    them. Now the DAO remembers who put in what, and refunds a member when they're removed.
/// 2. Anyone could cast the DAO's vote, with the whole treasury, as soon as a single member had
///    voted. Now more than half of the members must have voted first (a quorum).
///
/// A DAO that takes part in on-chain governance with one combined vote for all its members.
///
/// - Membership is a whitelist kept by the owner (whoever deployed the DAO).
/// - Inside the DAO it's one person, one vote: every member counts the same.
/// - The DAO has a treasury that anyone can fund. When the DAO casts its vote in governance,
///   it votes with its whole treasury, in the direction most members chose. Governance freezes
///   the tokens it votes with, and freezes overlap, so the DAO can vote with the same treasury
///   on many proposals at once.
///
/// The DAO lives in user space (a contract). The governance it votes in lives in kernel space
/// (a pallet). The bridge between them is the precompile at GOVERNANCE_ADDRESS.
contract FairDao {
    IGovernance constant GOVERNANCE = IGovernance(GOVERNANCE_ADDRESS);

    address public owner;
    mapping(address => bool) public isMember;
    uint256 public memberCount;

    /// The DAO's internal ballot for each governance proposal: one vote per member.
    struct Ballot {
        uint256 ayes;
        uint256 nays;
        bool cast;
    }
    mapping(uint32 => Ballot) public ballots;
    mapping(uint32 => mapping(address => bool)) public hasVoted;

    /// How many tokens (in wei) each account has put in the treasury.
    mapping(address => uint256) public contributions;

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event Refunded(address indexed member, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event MemberVoted(uint32 indexed id, address indexed member, bool aye);
    event VoteCast(uint32 indexed id, bool aye, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "only the owner");
        _;
    }

    modifier onlyMember() {
        require(isMember[msg.sender], "not a member");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ------------------------------------------------------------------ membership

    function addMember(address member) external onlyOwner {
        require(!isMember[member], "already a member");
        isMember[member] = true;
        memberCount += 1;
        emit MemberAdded(member);
    }

    /// Remove a member and give them back what they put in the treasury.
    function removeMember(address member) external onlyOwner {
        require(isMember[member], "not a member");
        isMember[member] = false;
        memberCount -= 1;
        emit MemberRemoved(member);

        // TODO(stretch): give the member back what they put in the treasury.
        //   1. If `contributions[member]` is more than 0:
        //   2. Require that the DAO's balance covers it ("treasury is frozen: unlock first").
        //      Tokens frozen by governance don't show up in `address(this).balance`.
        //   3. Set their contribution to 0 *before* sending (why?), then send it:
        //        (bool sent,) = payable(member).call{value: refund}("");
        //      and require(sent, "refund failed").
        //   4. emit Refunded(member, refund);
    }

    // -------------------------------------------------------------------- treasury

    /// Anyone can add tokens to the treasury.
    function fund() external payable {
        contributions[msg.sender] += msg.value;
        emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        contributions[msg.sender] += msg.value;
        emit Funded(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- governance

    /// Members propose through the DAO: the proposer on chain will be the DAO itself.
    function propose(bytes calldata call) external onlyMember returns (uint32 id) {
        id = GOVERNANCE.propose(call);
    }

    /// Vote inside the DAO on governance proposal `id`. One member, one vote.
    function vote(uint32 id, bool aye) external onlyMember {
        require(!hasVoted[id][msg.sender], "already voted");
        require(!ballots[id].cast, "DAO vote already cast");

        hasVoted[id][msg.sender] = true;
        if (aye) {
            ballots[id].ayes += 1;
        } else {
            ballots[id].nays += 1;
        }
        emit MemberVoted(id, msg.sender, aye);
    }

    /// Cast the DAO's vote in on-chain governance. Anyone can call this.
    function castVote(uint32 id) external {
        Ballot storage ballot = ballots[id];
        require(!ballot.cast, "already cast");
        // TODO(stretch): require that more than half of the members voted ("no quorum").
        require(ballot.ayes != ballot.nays, "no majority");
        ballot.cast = true;

        bool aye = ballot.ayes > ballot.nays;
        // The whole treasury, including tokens frozen by votes on other proposals.
        // (`address(this).balance` leaves frozen tokens out, so it would be ~0 after a first vote.)
        uint256 amount = GOVERNANCE.votingBalance(address(this));
        require(amount > 0, "empty treasury");

        // The pallet freezes `amount` of the DAO's own balance until voting ends.
        GOVERNANCE.vote(id, aye, amount);
        emit VoteCast(id, aye, amount);
    }

    /// After voting ended, stop that vote from freezing the DAO's tokens. Anyone can call this.
    function unlock(uint32 id) external {
        GOVERNANCE.unlock(id);
    }
}
