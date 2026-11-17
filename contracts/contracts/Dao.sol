// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IGovernance, GOVERNANCE_ADDRESS} from "./IGovernance.sol";

/// A DAO that votes as one bloc in on-chain governance.
///
/// Members deposit tokens to get voting shares. For each governance proposal, members vote
/// inside the DAO; then anyone can tell the DAO to cast its vote: the DAO votes with all the
/// shares that took part, in the direction the majority of them chose.
///
/// The DAO lives in user space (a contract). The governance it votes in lives in kernel space
/// (a pallet). The bridge between them is the precompile at GOVERNANCE_ADDRESS.
contract Dao {
    IGovernance constant GOVERNANCE = IGovernance(GOVERNANCE_ADDRESS);

    /// Voting shares per member, in wei (1 wei deposited = 1 share).
    mapping(address => uint256) public shares;
    uint256 public totalShares;

    /// The DAO's internal ballot for each governance proposal.
    struct Ballot {
        uint256 ayes;
        uint256 nays;
        bool cast;
    }
    mapping(uint32 => Ballot) public ballots;
    mapping(uint32 => mapping(address => bool)) public hasVoted;

    event Joined(address indexed member, uint256 amount);
    event MemberVoted(uint32 indexed id, address indexed member, bool aye, uint256 weight);
    event VoteCast(uint32 indexed id, bool aye, uint256 amount);

    /// Deposit tokens and receive the same number of shares.
    function join() external payable {
        require(msg.value > 0, "send some tokens");
        shares[msg.sender] += msg.value;
        totalShares += msg.value;
        emit Joined(msg.sender, msg.value);
    }

    /// Members propose through the DAO: the proposer on chain will be the DAO itself.
    function propose(bytes calldata call) external returns (uint32 id) {
        require(shares[msg.sender] > 0, "not a member");
        id = GOVERNANCE.propose(call);
    }

    /// Vote inside the DAO on governance proposal `id`, with all your shares.
    function vote(uint32 id, bool aye) external {
        // TODO(workshop, part 2):
        //   1. Your weight is `shares[msg.sender]`; require it to be > 0 ("not a member").
        //   2. Require that you haven't voted on `id` yet (`hasVoted`) ("already voted").
        //   3. Require that the DAO hasn't cast its vote on `id` yet (`ballots[id].cast`).
        //   4. Mark that you voted, and add your weight to `ballots[id].ayes` or `.nays`.
        //   5. emit MemberVoted(id, msg.sender, aye, weight);
    }

    /// Cast the DAO's vote in on-chain governance. Anyone can call this.
    function castVote(uint32 id) external {
        // TODO(workshop, part 2):
        //   1. Require the vote wasn't cast already, and that ayes != nays ("no majority").
        //   2. Mark the ballot as cast.
        //   3. The DAO votes in the direction of the majority, with ALL the weight that took
        //      part (ayes + nays): call GOVERNANCE.vote(id, aye, amount).
        //      This line is the user-space -> kernel-space call!
        //   4. emit VoteCast(id, aye, amount);
    }

    /// After voting ended, release the DAO's held tokens. Anyone can call this.
    function unlock(uint32 id) external {
        GOVERNANCE.unlock(id);
    }
}
