//! # Governance precompile
//!
//! Makes `pallet-governance` callable from Solidity at a fixed address
//! (`0x0000000000000000000000000000000009000000`), using the `IGovernance.sol` interface.
//!
//! A precompile is the bridge between user space (contracts) and kernel space (pallets):
//! when a contract calls this address, pallet-revive runs the Rust below instead of EVM
//! bytecode. We decode the Solidity ABI call, call into the pallet *as the calling contract*
//! (its account is the `origin`), and ABI-encode the result.
//!
//! You don't need to change this file in the workshop.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::{format, vec::Vec};
use alloy_core::{primitives, sol_types::SolCall};
use codec::DecodeLimit;
use core::{marker::PhantomData, num::NonZero};
use frame::{
	deps::frame_support::weights::Weight,
	prelude::{frame_system, DispatchError, Get, SaturatedConversion},
};
use pallet_governance::{BalanceOf, ProposalId, Proposals, RuntimeCallOf, Votes};
use pallet_revive::{
	precompiles::{AddressMatcher, Error, Ext, Precompile, RuntimeCosts, H160},
	AddressMapper,
};

alloy_core::sol!("IGovernance.sol");
use IGovernance::IGovernanceCalls;

/// The precompile's address is `0x00000000000000000000000000000000` ++ `0900` ++ `0000`.
pub const GOVERNANCE_PRECOMPILE_ID: u16 = 0x0900;

/// How deeply nested a proposed call may be (protects against stack overflows when decoding).
const MAX_CALL_DECODE_DEPTH: u32 = 64;

pub struct GovernancePrecompile<T>(PhantomData<T>);

impl<T> Precompile for GovernancePrecompile<T>
where
	T: pallet_revive::Config + pallet_governance::Config,
{
	type T = T;
	type Interface = IGovernanceCalls;
	const MATCHER: AddressMatcher =
		AddressMatcher::Fixed(NonZero::new(GOVERNANCE_PRECOMPILE_ID).unwrap());
	const HAS_CONTRACT_INFO: bool = false;

	fn call(
		_address: &[u8; 20],
		input: &Self::Interface,
		env: &mut impl Ext<T = Self::T>,
	) -> Result<Vec<u8>, Error> {
		let db = <T as frame_system::Config>::DbWeight::get();
		match input {
			// ---------------------------------------------------------------- writes
			IGovernanceCalls::propose(IGovernance::proposeCall { call }) => {
				charge(env, Weight::from_parts(20_000_000, 2_000) + db.reads_writes(2, 3))?;
				ensure_mutable(env)?;
				let who = caller::<T>(env)?;

				let call = RuntimeCallOf::<T>::decode_all_with_depth_limit(
					MAX_CALL_DECODE_DEPTH,
					&mut &call[..],
				)
				.map_err(|_| revert("propose: bytes are not a valid runtime call"))?;
				let id = pallet_governance::Pallet::<T>::do_propose(who, call)
					.map_err(|e| dispatch_revert("propose", e))?;

				Ok(IGovernance::proposeCall::abi_encode_returns(&id))
			},
			IGovernanceCalls::vote(IGovernance::voteCall { id, aye, amount }) => {
				charge(env, Weight::from_parts(30_000_000, 4_000) + db.reads_writes(4, 4))?;
				ensure_mutable(env)?;
				let who = caller::<T>(env)?;
				let amount = wei_to_native::<T>(amount)?;

				pallet_governance::Pallet::<T>::vote(
					frame_system::RawOrigin::Signed(who).into(),
					*id,
					*aye,
					amount,
				)
				.map_err(|e| dispatch_revert("vote", e))?;
				Ok(Vec::new())
			},
			IGovernanceCalls::unlock(IGovernance::unlockCall { id }) => {
				charge(env, Weight::from_parts(25_000_000, 4_000) + db.reads_writes(3, 2))?;
				ensure_mutable(env)?;
				let who = caller::<T>(env)?;

				pallet_governance::Pallet::<T>::unlock(
					frame_system::RawOrigin::Signed(who).into(),
					*id,
				)
				.map_err(|e| dispatch_revert("unlock", e))?;
				Ok(Vec::new())
			},

			// ----------------------------------------------------------------- reads
			IGovernanceCalls::proposal(IGovernance::proposalCall { id }) => {
				charge(env, db.reads(1))?;
				let result = match Proposals::<T>::get(id) {
					Some(proposal) => IGovernance::proposalReturn {
						exists: true,
						proposer: to_address::<T>(&proposal.proposer),
						// `as u8` gives the variant's position, matching `ProposalStatus`.
						status: proposal.status as u8,
						end: proposal.end.saturated_into::<u32>(),
						ayes: native_to_wei::<T>(proposal.ayes),
						nays: native_to_wei::<T>(proposal.nays),
					},
					None => IGovernance::proposalReturn {
						exists: false,
						proposer: primitives::Address::ZERO,
						status: 0,
						end: 0,
						ayes: primitives::U256::ZERO,
						nays: primitives::U256::ZERO,
					},
				};
				Ok(IGovernance::proposalCall::abi_encode_returns(&result))
			},
			IGovernanceCalls::voteOf(IGovernance::voteOfCall { id, voter }) => {
				charge(env, db.reads(1))?;
				let voter = env.to_account_id(&H160::from_slice(voter.as_slice()));
				let result = match Votes::<T>::get(id, &voter) {
					Some(vote) => IGovernance::voteOfReturn {
						voted: true,
						aye: vote.aye,
						amount: native_to_wei::<T>(vote.amount),
					},
					None => IGovernance::voteOfReturn {
						voted: false,
						aye: false,
						amount: primitives::U256::ZERO,
					},
				};
				Ok(IGovernance::voteOfCall::abi_encode_returns(&result))
			},
			IGovernanceCalls::nextProposalId(_) => {
				charge(env, db.reads(1))?;
				let next: ProposalId = pallet_governance::NextProposalId::<T>::get();
				Ok(IGovernance::nextProposalIdCall::abi_encode_returns(&next))
			},
		}
	}
}

// -------------------------------------------------------------------------- helpers

/// Precompiles are not metered automatically: charge before doing the work.
fn charge<T: pallet_revive::Config>(env: &mut impl Ext<T = T>, weight: Weight) -> Result<(), Error> {
	env.frame_meter_mut().charge_weight_token(RuntimeCosts::Precompile(weight))?;
	Ok(())
}

/// Reject state changes from `staticcall` (view context) and `delegatecall`.
fn ensure_mutable<T: pallet_revive::Config>(env: &impl Ext<T = T>) -> Result<(), Error> {
	if env.is_read_only() {
		return Err(pallet_revive::Error::<T>::StateChangeDenied.into());
	}
	if env.is_delegate_call() {
		return Err(pallet_revive::Error::<T>::PrecompileDelegateDenied.into());
	}
	Ok(())
}

/// `msg.sender` as a Polkadot account: a contract's or a user's.
fn caller<T: pallet_revive::Config>(env: &impl Ext<T = T>) -> Result<T::AccountId, Error> {
	env.caller()
		.account_id()
		.cloned()
		.map_err(|_| revert("caller has no account"))
}

fn to_address<T: pallet_revive::Config>(account: &T::AccountId) -> primitives::Address {
	primitives::Address::from(<T as pallet_revive::Config>::AddressMapper::to_address(account).0)
}

/// Solidity amounts use 18 decimals (wei); the native token has fewer.
fn wei_to_native<T>(wei: &primitives::U256) -> Result<BalanceOf<T>, Error>
where
	T: pallet_revive::Config + pallet_governance::Config,
{
	let ratio = primitives::U256::from(<T as pallet_revive::Config>::NativeToEthRatio::get());
	if !(wei % ratio).is_zero() {
		return Err(revert(&format!("amount must be a multiple of {ratio} wei")));
	}
	let native: u128 = (wei / ratio).try_into().map_err(|_| revert("amount too large"))?;
	native.try_into().map_err(|_| revert("amount too large"))
}

fn native_to_wei<T>(native: BalanceOf<T>) -> primitives::U256
where
	T: pallet_revive::Config + pallet_governance::Config,
{
	let ratio = primitives::U256::from(<T as pallet_revive::Config>::NativeToEthRatio::get());
	primitives::U256::from(native.saturated_into::<u128>()).saturating_mul(ratio)
}

fn revert(message: &str) -> Error {
	Error::Revert(format!("Governance: {message}").into())
}

/// Turn a pallet error like `Module { message: Some("AlreadyVoted") }` into a readable revert.
fn dispatch_revert(context: &str, error: DispatchError) -> Error {
	let reason = match error {
		DispatchError::Module(module_error) => module_error.message.unwrap_or("module error").into(),
		other => format!("{other:?}"),
	};
	revert(&format!("{context} failed: {reason}"))
}
