//! A tiny test runtime: just System, Balances and our Governance pallet.

use crate as pallet_governance;
use frame::{prelude::*, runtime::prelude::*, testing_prelude::*};

type Balance = u64;

#[frame_construct_runtime]
mod test_runtime {
	#[runtime::runtime]
	#[runtime::derive(
		RuntimeCall,
		RuntimeEvent,
		RuntimeError,
		RuntimeOrigin,
		RuntimeFreezeReason,
		RuntimeHoldReason,
		RuntimeSlashReason,
		RuntimeLockId,
		RuntimeTask,
		RuntimeViewFunction
	)]
	pub struct Test;

	#[runtime::pallet_index(0)]
	pub type System = frame_system;
	#[runtime::pallet_index(1)]
	pub type Balances = pallet_balances;
	#[runtime::pallet_index(2)]
	pub type Governance = pallet_governance;
}

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
	type Block = MockBlock<Test>;
	type AccountData = pallet_balances::AccountData<Balance>;
}

#[derive_impl(pallet_balances::config_preludes::TestDefaultConfig)]
impl pallet_balances::Config for Test {
	type Balance = Balance;
	type AccountStore = System;
	type RuntimeFreezeReason = RuntimeFreezeReason;
	type FreezeIdentifier = RuntimeFreezeReason;
	type MaxFreezes = VariantCountOf<RuntimeFreezeReason>;
}

pub const VOTING_PERIOD: u64 = 10;

impl pallet_governance::Config for Test {
	type Currency = Balances;
	type RuntimeFreezeReason = RuntimeFreezeReason;
	type VotingPeriod = ConstU64<VOTING_PERIOD>;
	type MaxCallLength = ConstU32<1024>;
	type MaxProposalsPerBlock = ConstU32<2>;
	type MaxVotesPerAccount = ConstU32<3>;
}

pub const ALICE: u64 = 1;
pub const BOB: u64 = 2;
pub const CHARLIE: u64 = 3;
/// Starting balance of every test account.
pub const INITIAL: Balance = 1_000;

pub fn new_test_ext() -> TestState {
	let mut storage = frame_system::GenesisConfig::<Test>::default().build_storage().unwrap();
	pallet_balances::GenesisConfig::<Test> {
		balances: vec![(ALICE, INITIAL), (BOB, INITIAL), (CHARLIE, INITIAL)],
		..Default::default()
	}
	.assimilate_storage(&mut storage)
	.unwrap();
	let mut ext: TestState = storage.into();
	// Events are only recorded from block 1 onwards.
	ext.execute_with(|| System::set_block_number(1));
	ext
}

/// Produce blocks (running every pallet's hooks) until block `n`.
pub fn run_to_block(n: u64) {
	System::run_to_block::<AllPalletsWithSystem>(n);
}
