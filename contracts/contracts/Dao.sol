// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IGovernance, GOVERNANCE_ADDRESS} from "./IGovernance.sol";

/// A DAO that takes part in on-chain governance with one combined vote for all its members.
///
/// - Membership is a whitelist kept by the owner (whoever deployed the DAO).
/// - Inside the DAO it's one person, one vote: every member counts the same.
/// - The DAO has a treasury that anyone can fund. When the DAO casts its vote in governance,
///   it votes with its whole (spendable) treasury, in the direction most members chose.
///
/// The DAO lives in user space (a contract). The governance it votes in lives in kernel space
/// (a pallet). The bridge between them is the precompile at GOVERNANCE_ADDRESS.
contract Dao {
    IGovernance constant GOVERNANCE = IGovernance(GOVERNANCE_ADDRESS);

    /// The native token has 12 decimals and Solidity amounts have 18, so governance only accepts
    /// multiples of 10^6 wei.
    uint256 constant WEI_PER_NATIVE_UNIT = 1e6;

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

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
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

    function removeMember(address member) external onlyOwner {
        require(isMember[member], "not a member");
        isMember[member] = false;
        memberCount -= 1;
        emit MemberRemoved(member);
    }

    // -------------------------------------------------------------------- treasury

    /// Anyone can add tokens to the treasury.
    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- governance

    /// Members propose through the DAO: the proposer on chain will be the DAO itself.
    function propose(bytes calldata call) external onlyMember returns (uint32 id) {
        id = GOVERNANCE.propose(call);
    }

    /// Vote inside the DAO on governance proposal `id`. One member, one vote.
    function vote(uint32 id, bool aye) external onlyMember {
        // TODO(workshop, part 2):
        //   1. Require that you haven't voted on `id` yet (`hasVoted`) ("already voted").
        //   2. Require that the DAO hasn't cast its vote on `id` yet (`ballots[id].cast`).
        //   3. Mark that you voted, and add 1 to `ballots[id].ayes` or `ballots[id].nays`.
        //   4. emit MemberVoted(id, msg.sender, aye);
    }

    /// Cast the DAO's vote in on-chain governance. Anyone can call this.
    function castVote(uint32 id) external {
        // TODO(workshop, part 2):
        //   1. Require the vote wasn't cast already, and that ayes != nays ("no majority").
        //   2. Mark the ballot as cast.
        //   3. The DAO votes in the direction most members chose, with its whole treasury:
        //        uint256 amount = address(this).balance - (address(this).balance % WEI_PER_NATIVE_UNIT);
        //      (require amount > 0), then call GOVERNANCE.vote(id, aye, amount).
        //      This line is the user-space -> kernel-space call!
        //   4. emit VoteCast(id, aye, amount);
    }

    /// After voting ended, release the DAO's held tokens. Anyone can call this.
    function unlock(uint32 id) external {
        GOVERNANCE.unlock(id);
    }
}
