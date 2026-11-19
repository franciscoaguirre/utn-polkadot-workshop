// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// The governance pallet, as seen from Solidity.
// It's not a contract: calls to this address go straight into the runtime (kernel space).
address constant GOVERNANCE_ADDRESS = 0x0000000000000000000000000000000009000000;

// Matches the pallet's `Status` enum: `ProposalStatus(status)` converts the `uint8`.
enum ProposalStatus {
    Ongoing,
    Approved,
    Rejected,
    Cancelled
}

/// All amounts are in wei (18 decimals), like `msg.value` and `address.balance`.
/// They must be a multiple of 10^6 wei, because the chain's native token has 12 decimals.
interface IGovernance {
    /// Propose a SCALE-encoded runtime call (build the bytes with PAPI). Returns the new id.
    function propose(bytes calldata call) external returns (uint32 id);

    /// Vote with `amount` of the caller's tokens. They stay in the caller's account, but are
    /// frozen (can't be spent) until `unlock` after voting ends. Freezes overlap, so the same
    /// tokens can vote on many proposals at once.
    function vote(uint32 id, bool aye, uint256 amount) external;

    /// After voting on `id` ended, stop that vote from freezing the caller's tokens. Tokens the
    /// caller's other votes still need stay frozen.
    function unlock(uint32 id) external;

    /// Read a proposal. `exists` is false for unknown ids.
    function proposal(uint32 id)
        external
        view
        returns (bool exists, address proposer, uint8 status, uint32 end, uint256 ayes, uint256 nays);

    /// Read `voter`'s vote on proposal `id`.
    function voteOf(uint32 id, address voter) external view returns (bool voted, bool aye, uint256 amount);

    /// How much `who` can vote with on any proposal: what it could spend if none of its tokens
    /// were frozen. `address(who).balance` leaves frozen tokens out, so after a first vote it
    /// would say ~0, even though freezes overlap and the same tokens can vote again.
    function votingBalance(address who) external view returns (uint256);

    /// The id the next proposal will get.
    function nextProposalId() external view returns (uint32);
}
