//! Tests for the `cancel` call you add in part 3 of the workshop.
//! Enable them by uncommenting `mod cancel_tests;` in `lib.rs`, then run:
//! `cargo test -p pallet-governance`

use crate::{mock::*, EndingAt, Error, Event, FreezeReason, Proposals, Status};
use frame::{deps::sp_io, testing_prelude::*, traits::fungible::InspectFreeze};

const KEY: &[u8] = b":workshop:";

fn set_storage_call() -> Box<RuntimeCall> {
	Box::new(RuntimeCall::System(frame_system::Call::set_storage {
		items: vec![(KEY.to_vec(), b"hi".to_vec())],
	}))
}

#[test]
fn proposer_can_cancel_an_ongoing_proposal() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call()));

		assert_ok!(Governance::cancel(RuntimeOrigin::signed(ALICE), 0));

		assert_eq!(Proposals::<Test>::get(0).unwrap().status, Status::Cancelled);
		System::assert_last_event(Event::Cancelled { id: 0 }.into());
	});
}

#[test]
fn cancelled_proposal_is_not_enacted_even_with_ayes() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call()));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 500));
		assert_ok!(Governance::cancel(RuntimeOrigin::signed(ALICE), 0));

		// The hook no longer has anything to do at the proposal's end.
		assert!(EndingAt::<Test>::get(1 + VOTING_PERIOD).is_empty());

		run_to_block(1 + VOTING_PERIOD);
		assert_eq!(sp_io::storage::get(KEY), None);
		assert_eq!(Proposals::<Test>::get(0).unwrap().status, Status::Cancelled);
	});
}

#[test]
fn voters_can_unlock_right_after_a_cancel() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call()));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 500));
		assert_ok!(Governance::cancel(RuntimeOrigin::signed(ALICE), 0));

		assert_ok!(Governance::unlock(RuntimeOrigin::signed(BOB), 0));
		assert_eq!(Balances::balance_frozen(&FreezeReason::Vote.into(), &BOB), 0);
	});
}

#[test]
fn only_the_proposer_can_cancel() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call()));
		assert_noop!(
			Governance::cancel(RuntimeOrigin::signed(BOB), 0),
			Error::<Test>::NotProposer
		);
	});
}

#[test]
fn cannot_cancel_a_finished_proposal() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call()));
		run_to_block(1 + VOTING_PERIOD);
		assert_noop!(
			Governance::cancel(RuntimeOrigin::signed(ALICE), 0),
			Error::<Test>::VotingClosed
		);
	});
}

#[test]
fn cannot_cancel_an_unknown_proposal() {
	new_test_ext().execute_with(|| {
		assert_noop!(
			Governance::cancel(RuntimeOrigin::signed(ALICE), 7),
			Error::<Test>::ProposalNotFound
		);
	});
}
