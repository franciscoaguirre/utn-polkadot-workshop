//! # Governance pallet
//!
//! The smallest token-voting governance we could write. Any account can propose *any* call,
//! token holders vote by freezing tokens, and when the voting period ends the chain itself runs
//! the call with **Root** (superuser) privileges if more tokens voted aye than nay.
//!
//! That last part is what a smart contract can never do: a contract has no Root, no access to
//! other pallets' privileged calls, and nothing runs unless someone sends a transaction.
//!
//! ## Reading guide for Solidity developers
//!
//! | Solidity                         | FRAME (this file)                                 |
//! |----------------------------------|---------------------------------------------------|
//! | state variables                  | `#[pallet::storage]` items                        |
//! | `external` functions             | `#[pallet::call]` functions ("extrinsics")        |
//! | `msg.sender`                     | `let who = ensure_signed(origin)?;`               |
//! | `require(cond, "msg")`           | `ensure!(cond, Error::<T>::Something);`           |
//! | custom errors                    | `#[pallet::error]` enum                           |
//! | `event` / `emit`                 | `#[pallet::event]` / `Self::deposit_event(..)`    |
//! | constructor arguments, constants | `#[pallet::config]` (set by the runtime)          |
//! | `onlyOwner`                      | origins, e.g. `ensure_root(origin)?`              |
//! | — (needs a keeper bot)           | `#[pallet::hooks]` `on_initialize`: runs every block |
//!
//! ## What it deliberately does NOT have
//!
//! No quorum, no proposal deposit, no tracks, no conviction, no delegation, no changing your
//! vote. Smart contracts built on top can add those.
//!
//! ## Why freezes (and not holds)
//!
//! Like OpenGov, a vote *freezes* tokens instead of holding them. A hold sets tokens aside for
//! one purpose, so tokens held for proposal A can't also vote on proposal B. Freezes overlap:
//! the account must keep its *largest* vote's worth of tokens, no matter how many proposals it
//! voted on. With 100 tokens you can vote 100 on A **and** 100 on B at the same time.

#![cfg_attr(not(feature = "std"), no_std)]

pub use pallet::*;

#[cfg(test)]
mod mock;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod cancel_tests;

#[frame::pallet]
pub mod pallet {
	use frame::{
		prelude::*,
		traits::{
			fungible::{Inspect, MutateFreeze},
		},
	};

	extern crate alloc;
	use alloc::boxed::Box;

	/// Proposals are numbered 0, 1, 2, ...
	pub type ProposalId = u32;

	/// The balance type of the token used for voting.
	pub type BalanceOf<T> =
		<<T as Config>::Currency as Inspect<<T as frame_system::Config>::AccountId>>::Balance;

	/// The "full" call type of the runtime: any call of any pallet.
	pub type RuntimeCallOf<T> = <T as frame_system::Config>::RuntimeCall;

	// -------------------------------------------------------------------------------------
	// Configuration: what the runtime must give this pallet. ~ constructor arguments.
	// -------------------------------------------------------------------------------------

	#[pallet::config]
	pub trait Config: frame_system::Config {
		/// The token used for voting. We need to be able to read balances and freeze tokens.
		type Currency: Inspect<Self::AccountId>
			+ MutateFreeze<Self::AccountId, Id = Self::RuntimeFreezeReason>;

		/// The runtime's list of "reasons why tokens can be frozen". Ours is `FreezeReason::Vote`.
		type RuntimeFreezeReason: From<FreezeReason>;

		/// How many blocks a proposal is open for voting.
		#[pallet::constant]
		type VotingPeriod: Get<BlockNumberFor<Self>>;

		/// The biggest call (in bytes) that can be proposed.
		#[pallet::constant]
		type MaxCallLength: Get<u32>;

		/// How many proposals can end in the same block (keeps `on_initialize` bounded).
		#[pallet::constant]
		type MaxProposalsPerBlock: Get<u32>;

		/// How many votes one account can have at the same time (keeps `unlock` bounded).
		#[pallet::constant]
		type MaxVotesPerAccount: Get<u32>;
	}

	#[pallet::pallet]
	pub struct Pallet<T>(_);

	/// Why tokens are frozen by this pallet. Wallets show this next to the frozen amount.
	#[pallet::composite_enum]
	pub enum FreezeReason {
		/// Tokens frozen because they were used to vote.
		#[codec(index = 0)]
		Vote,
	}

	// -------------------------------------------------------------------------------------
	// Types stored on chain. ~ Solidity structs.
	// -------------------------------------------------------------------------------------

	/// Where a proposal is in its life.
	#[derive(Encode, Decode, MaxEncodedLen, TypeInfo, Clone, Copy, PartialEq, Eq, Debug)]
	pub enum Status {
		/// Voting is open.
		Ongoing,
		/// More ayes than nays: the call was dispatched.
		Approved,
		/// Not more ayes than nays: the call was not dispatched.
		Rejected,
		/// The proposer withdrew it before voting ended.
		Cancelled,
	}

	#[derive(
		Encode, Decode, MaxEncodedLen, TypeInfo, CloneNoBound, PartialEqNoBound, DebugNoBound,
	)]
	#[scale_info(skip_type_params(T))]
	pub struct Proposal<T: Config> {
		/// Who proposed it.
		pub proposer: T::AccountId,
		/// The SCALE-encoded call to run as Root if the proposal passes.
		pub call: BoundedVec<u8, T::MaxCallLength>,
		/// The block in which voting closes and the result is enacted.
		pub end: BlockNumberFor<T>,
		/// Tokens voting in favour.
		pub ayes: BalanceOf<T>,
		/// Tokens voting against.
		pub nays: BalanceOf<T>,
		pub status: Status,
	}

	/// One account's vote on one proposal.
	#[derive(Encode, Decode, MaxEncodedLen, TypeInfo, Clone, PartialEq, Eq, Debug)]
	pub struct Vote<Balance> {
		pub aye: bool,
		/// How many tokens this vote freezes.
		pub amount: Balance,
	}

	// -------------------------------------------------------------------------------------
	// Storage. ~ Solidity state variables.
	// -------------------------------------------------------------------------------------

	/// The id the next proposal will get. ~ `uint32 public nextProposalId;`
	#[pallet::storage]
	pub type NextProposalId<T> = StorageValue<_, ProposalId, ValueQuery>;

	/// All proposals, by id. ~ `mapping(uint32 => Proposal) public proposals;`
	#[pallet::storage]
	pub type Proposals<T: Config> = StorageMap<_, Blake2_128Concat, ProposalId, Proposal<T>>;

	/// Who voted what. ~ `mapping(uint32 => mapping(address => Vote)) public votes;`
	#[pallet::storage]
	pub type Votes<T: Config> = StorageDoubleMap<
		_,
		Blake2_128Concat,
		ProposalId,
		Blake2_128Concat,
		T::AccountId,
		Vote<BalanceOf<T>>,
	>;

	/// The proposals each account has a vote on, until it unlocks them. `unlock` reads this to
	/// work out how many tokens must stay frozen. ~ `mapping(address => uint32[]) votedOn;`
	#[pallet::storage]
	pub type VotedOn<T: Config> = StorageMap<
		_,
		Blake2_128Concat,
		T::AccountId,
		BoundedVec<ProposalId, T::MaxVotesPerAccount>,
		ValueQuery,
	>;

	/// Which proposals end in which block, so the hook only looks at the ones that matter.
	#[pallet::storage]
	pub type EndingAt<T: Config> = StorageMap<
		_,
		Twox64Concat,
		BlockNumberFor<T>,
		BoundedVec<ProposalId, T::MaxProposalsPerBlock>,
		ValueQuery,
	>;

	// -------------------------------------------------------------------------------------
	// Events and errors. ~ Solidity events and custom errors.
	// -------------------------------------------------------------------------------------

	#[pallet::event]
	#[pallet::generate_deposit(pub(super) fn deposit_event)]
	pub enum Event<T: Config> {
		/// A new proposal is open for voting until block `end`.
		Proposed { id: ProposalId, proposer: T::AccountId, end: BlockNumberFor<T> },
		/// Someone voted.
		Voted { id: ProposalId, voter: T::AccountId, aye: bool, amount: BalanceOf<T> },
		/// A proposal passed and its call was dispatched as Root. `result` says whether the call
		/// itself succeeded.
		Approved { id: ProposalId, result: DispatchResult },
		/// A proposal did not pass.
		Rejected { id: ProposalId },
		/// A voter's vote no longer freezes their tokens.
		Unlocked { id: ProposalId, voter: T::AccountId, amount: BalanceOf<T> },
		/// The proposer cancelled a proposal.
		Cancelled { id: ProposalId },
	}

	#[pallet::error]
	pub enum Error<T> {
		/// There is no proposal with that id.
		ProposalNotFound,
		/// The encoded call is longer than `MaxCallLength`.
		CallTooLong,
		/// Too many proposals already end in that block. Try again next block.
		TooManyProposals,
		/// Voting on this proposal has closed.
		VotingClosed,
		/// This account already voted on this proposal.
		AlreadyVoted,
		/// You can't vote with 0 tokens.
		ZeroAmount,
		/// You can't vote with more tokens than you have.
		InsufficientBalance,
		/// This account has `MaxVotesPerAccount` votes already. Unlock some first.
		TooManyVotes,
		/// The proposal is still open, so your tokens are still needed.
		VotingNotOver,
		/// This account has no vote (or already unlocked it) on this proposal.
		NoVote,
		/// The stored call could not be decoded (e.g. the runtime changed under it).
		UndecodableCall,
		/// Only the proposer can do this.
		NotProposer,
	}

	// -------------------------------------------------------------------------------------
	// Hooks: code the chain runs by itself. No Solidity equivalent!
	// -------------------------------------------------------------------------------------

	#[pallet::hooks]
	impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
		/// Runs at the start of every block, before any transaction.
		fn on_initialize(now: BlockNumberFor<T>) -> Weight {
			let mut weight = T::DbWeight::get().reads_writes(1, 1);
			for id in EndingAt::<T>::take(now) {
				weight = weight.saturating_add(Self::close(id));
			}
			weight
		}
	}

	// -------------------------------------------------------------------------------------
	// Calls: what users (and contracts, through the precompile) can do.
	// ~ Solidity `external` functions.
	//
	// Weights are what a call costs (time + proof size). Real pallets measure them with
	// benchmarks; for the workshop we use simple fixed numbers.
	// -------------------------------------------------------------------------------------

	#[pallet::call]
	impl<T: Config> Pallet<T> {
		/// Propose `call`. If it passes, it runs with Root privileges.
		#[pallet::call_index(0)]
		#[pallet::weight(Weight::from_parts(20_000_000, 2_000) + T::DbWeight::get().reads_writes(2, 3))]
		pub fn propose(origin: OriginFor<T>, call: Box<RuntimeCallOf<T>>) -> DispatchResult {
			// ~ msg.sender (and fails if the transaction wasn't signed).
			let proposer = ensure_signed(origin)?;
			Self::do_propose(proposer, *call).map(|_| ())
		}

		/// Vote on proposal `id` with `amount` tokens. The tokens stay in your account but are
		/// frozen (can't be spent) until you `unlock` them after voting ends. The same tokens
		/// can vote on other proposals at the same time.
		#[pallet::call_index(1)]
		#[pallet::weight(Weight::from_parts(30_000_000, 4_000) + T::DbWeight::get().reads_writes(5, 5))]
		pub fn vote(
			origin: OriginFor<T>,
			id: ProposalId,
			aye: bool,
			amount: BalanceOf<T>,
		) -> DispatchResult {
			let voter = ensure_signed(origin)?;

			// ~ require(...) checks.
			let mut proposal = Proposals::<T>::get(id).ok_or(Error::<T>::ProposalNotFound)?;
			ensure!(proposal.status == Status::Ongoing, Error::<T>::VotingClosed);
			ensure!(!Votes::<T>::contains_key(id, &voter), Error::<T>::AlreadyVoted);
			ensure!(!amount.is_zero(), Error::<T>::ZeroAmount);
			// Tokens frozen for other votes count too: freezes overlap.
			ensure!(amount <= T::Currency::total_balance(&voter), Error::<T>::InsufficientBalance);

			VotedOn::<T>::try_mutate(&voter, |ids| ids.try_push(id))
				.map_err(|_| Error::<T>::TooManyVotes)?;

			// Kernel-space power: freeze tokens *inside the voter's own account*.
			// A Solidity contract could only do this by taking custody of the tokens.
			// There is one `Vote` freeze per account, as big as its biggest vote, so
			// `extend_freeze` only ever makes it bigger.
			T::Currency::extend_freeze(&FreezeReason::Vote.into(), &voter, amount)?;

			if aye {
				proposal.ayes = proposal.ayes.saturating_add(amount);
			} else {
				proposal.nays = proposal.nays.saturating_add(amount);
			}
			Proposals::<T>::insert(id, proposal);
			Votes::<T>::insert(id, &voter, Vote { aye, amount });

			Self::deposit_event(Event::Voted { id, voter, aye, amount });
			Ok(())
		}

		/// After voting on `id` has ended, stop that vote from freezing your tokens. Tokens that
		/// your other votes still need stay frozen.
		#[pallet::call_index(2)]
		#[pallet::weight(
			Weight::from_parts(25_000_000, 4_000)
				+ T::DbWeight::get().reads_writes(4 + T::MaxVotesPerAccount::get() as u64, 4)
		)]
		pub fn unlock(origin: OriginFor<T>, id: ProposalId) -> DispatchResult {
			let voter = ensure_signed(origin)?;

			let proposal = Proposals::<T>::get(id).ok_or(Error::<T>::ProposalNotFound)?;
			ensure!(proposal.status != Status::Ongoing, Error::<T>::VotingNotOver);
			let vote = Votes::<T>::take(id, &voter).ok_or(Error::<T>::NoVote)?;

			let mut voted_on = VotedOn::<T>::get(&voter);
			voted_on.retain(|other| *other != id);

			// The freeze must cover the biggest vote that is left.
			let still_needed = voted_on
				.iter()
				.filter_map(|other| Votes::<T>::get(other, &voter))
				.map(|other_vote| other_vote.amount)
				.max()
				.unwrap_or_else(Zero::zero);
			if still_needed.is_zero() {
				T::Currency::thaw(&FreezeReason::Vote.into(), &voter)?;
				VotedOn::<T>::remove(&voter);
			} else {
				T::Currency::set_freeze(&FreezeReason::Vote.into(), &voter, still_needed)?;
				VotedOn::<T>::insert(&voter, voted_on);
			}

			Self::deposit_event(Event::Unlocked { id, voter, amount: vote.amount });
			Ok(())
		}

		/// Withdraw your own proposal while it is still open. Voters can then `unlock` right away.
		#[pallet::call_index(3)]
		#[pallet::weight(Weight::from_parts(20_000_000, 2_000) + T::DbWeight::get().reads_writes(2, 2))]
		pub fn cancel(origin: OriginFor<T>, id: ProposalId) -> DispatchResult {
			let who = ensure_signed(origin)?;

			let mut proposal = Proposals::<T>::get(id).ok_or(Error::<T>::ProposalNotFound)?;
			ensure!(proposal.proposer == who, Error::<T>::NotProposer);
			ensure!(proposal.status == Status::Ongoing, Error::<T>::VotingClosed);

			proposal.status = Status::Cancelled;
			let end = proposal.end;
			Proposals::<T>::insert(id, proposal);
			EndingAt::<T>::mutate(end, |ids| ids.retain(|x| *x != id));

			Self::deposit_event(Event::Cancelled { id });
			Ok(())
		}
	}

	// -------------------------------------------------------------------------------------
	// Internal functions. ~ Solidity `internal` functions.
	// They are `pub` so the precompile (another crate) can call them too.
	// -------------------------------------------------------------------------------------

	impl<T: Config> Pallet<T> {
		/// Store a new proposal and return its id.
		pub fn do_propose(
			proposer: T::AccountId,
			call: RuntimeCallOf<T>,
		) -> Result<ProposalId, DispatchError> {
			let call: BoundedVec<u8, T::MaxCallLength> =
				call.encode().try_into().map_err(|_| Error::<T>::CallTooLong)?;

			let end = frame_system::Pallet::<T>::block_number().saturating_add(T::VotingPeriod::get());
			let id = NextProposalId::<T>::get();

			EndingAt::<T>::try_mutate(end, |ids| ids.try_push(id))
				.map_err(|_| Error::<T>::TooManyProposals)?;
			Proposals::<T>::insert(
				id,
				Proposal {
					proposer: proposer.clone(),
					call,
					end,
					ayes: Zero::zero(),
					nays: Zero::zero(),
					status: Status::Ongoing,
				},
			);
			NextProposalId::<T>::put(id.saturating_add(1));

			Self::deposit_event(Event::Proposed { id, proposer, end });
			Ok(id)
		}

		/// Count the votes on `id` and, if it passed, dispatch its call as Root.
		/// Called by `on_initialize`. Returns the weight used.
		fn close(id: ProposalId) -> Weight {
			let mut weight = T::DbWeight::get().reads_writes(1, 1);
			let Some(mut proposal) = Proposals::<T>::get(id) else { return weight };
			// A proposal that is no longer ongoing (e.g. cancelled) is skipped.
			if proposal.status != Status::Ongoing {
				return weight;
			}

			if proposal.ayes > proposal.nays {
				proposal.status = Status::Approved;
				let result = match RuntimeCallOf::<T>::decode(&mut &proposal.call[..]) {
					Ok(call) => {
						weight = weight.saturating_add(call.get_dispatch_info().call_weight);
						// THE kernel-space moment: run any call as the superuser.
						call.dispatch(frame_system::RawOrigin::Root.into())
							.map(|_| ())
							.map_err(|error| error.error)
					},
					Err(_) => Err(Error::<T>::UndecodableCall.into()),
				};
				Self::deposit_event(Event::Approved { id, result });
			} else {
				proposal.status = Status::Rejected;
				Self::deposit_event(Event::Rejected { id });
			}
			Proposals::<T>::insert(id, proposal);
			weight
		}
	}
}
