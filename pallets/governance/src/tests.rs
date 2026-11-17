//! Unit tests for the governance pallet.
//! Run them with: `cargo test -p pallet-governance`

use crate::{mock::*, EndingAt, Error, Event, HoldReason, Proposals, Status, Vote, Votes};
use frame::{
	deps::sp_io,
	testing_prelude::*,
	traits::fungible::{Inspect, InspectHold},
};

/// A storage key that only Root can write, through `System::set_storage`.
const KEY: &[u8] = b":workshop:";

/// A call that needs Root to succeed: proof that a passed proposal really runs as Root.
fn set_storage_call(value: &[u8]) -> Box<RuntimeCall> {
	Box::new(RuntimeCall::System(frame_system::Call::set_storage {
		items: vec![(KEY.to_vec(), value.to_vec())],
	}))
}

fn stored_value() -> Option<Vec<u8>> {
	sp_io::storage::get(KEY).map(|bytes| bytes.to_vec())
}

fn held(who: u64) -> u64 {
	Balances::balance_on_hold(&HoldReason::Vote.into(), &who)
}

fn last_event() -> RuntimeEvent {
	System::events().pop().expect("an event was emitted").event
}

#[test]
fn propose_stores_a_proposal_and_schedules_its_end() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"hi")));

		let proposal = Proposals::<Test>::get(0).expect("proposal 0 exists");
		assert_eq!(proposal.proposer, ALICE);
		assert_eq!(proposal.end, 1 + VOTING_PERIOD);
		assert_eq!(proposal.ayes, 0);
		assert_eq!(proposal.nays, 0);
		assert_eq!(proposal.status, Status::Ongoing);
		assert_eq!(EndingAt::<Test>::get(1 + VOTING_PERIOD).into_inner(), vec![0]);
		assert_eq!(
			last_event(),
			Event::Proposed { id: 0, proposer: ALICE, end: 1 + VOTING_PERIOD }.into()
		);

		// Ids increase by one.
		assert_ok!(Governance::propose(RuntimeOrigin::signed(BOB), set_storage_call(b"yo")));
		assert!(Proposals::<Test>::get(1).is_some());
	});
}

#[test]
fn propose_requires_a_signed_origin() {
	new_test_ext().execute_with(|| {
		assert_noop!(
			Governance::propose(RuntimeOrigin::none(), set_storage_call(b"hi")),
			BadOrigin
		);
	});
}

#[test]
fn too_many_proposals_ending_in_the_same_block_is_rejected() {
	new_test_ext().execute_with(|| {
		// MaxProposalsPerBlock is 2 in the mock.
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"1")));
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"2")));
		assert_noop!(
			Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"3")),
			Error::<Test>::TooManyProposals
		);
	});
}

#[test]
fn vote_holds_tokens_and_updates_the_tally() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"hi")));

		assert_ok!(Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 300));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(CHARLIE), 0, false, 100));

		let proposal = Proposals::<Test>::get(0).unwrap();
		assert_eq!((proposal.ayes, proposal.nays), (300, 100));
		assert_eq!(Votes::<Test>::get(0, BOB), Some(Vote { aye: true, amount: 300 }));

		// The tokens never leave Bob's account, but he can't spend them.
		assert_eq!(held(BOB), 300);
		assert_eq!(Balances::total_balance(&BOB), INITIAL);
		assert_eq!(Balances::balance(&BOB), INITIAL - 300);

		assert_eq!(
			last_event(),
			Event::Voted { id: 0, voter: CHARLIE, aye: false, amount: 100 }.into()
		);
	});
}

#[test]
fn vote_on_unknown_proposal_fails() {
	new_test_ext().execute_with(|| {
		assert_noop!(
			Governance::vote(RuntimeOrigin::signed(BOB), 42, true, 10),
			Error::<Test>::ProposalNotFound
		);
	});
}

#[test]
fn voting_twice_is_rejected() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"hi")));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 10));
		assert_noop!(
			Governance::vote(RuntimeOrigin::signed(BOB), 0, false, 10),
			Error::<Test>::AlreadyVoted
		);
	});
}

#[test]
fn cannot_vote_with_more_than_you_have() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"hi")));
		assert_noop!(
			Governance::vote(RuntimeOrigin::signed(BOB), 0, true, INITIAL * 2),
			TokenError::FundsUnavailable
		);
	});
}

#[test]
fn zero_amount_vote_is_rejected() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"hi")));
		assert_noop!(
			Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 0),
			Error::<Test>::ZeroAmount
		);
	});
}

#[test]
fn passing_proposal_is_enacted_as_root_by_the_hook() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"hi")));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 300));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(CHARLIE), 0, false, 100));

		// Nothing happens before the deadline...
		run_to_block(VOTING_PERIOD);
		assert_eq!(stored_value(), None);
		assert_eq!(Proposals::<Test>::get(0).unwrap().status, Status::Ongoing);

		// ...and at the deadline the hook enacts it, with nobody sending a transaction.
		run_to_block(1 + VOTING_PERIOD);
		assert_eq!(stored_value(), Some(b"hi".to_vec()));
		assert_eq!(Proposals::<Test>::get(0).unwrap().status, Status::Approved);
		assert!(EndingAt::<Test>::get(1 + VOTING_PERIOD).is_empty());
		System::assert_has_event(Event::Approved { id: 0, result: Ok(()) }.into());
	});
}

#[test]
fn ties_and_majority_nays_are_rejected_and_not_enacted() {
	new_test_ext().execute_with(|| {
		// A tie.
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"tie")));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 100));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(CHARLIE), 0, false, 100));
		// No votes at all.
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"none")));

		run_to_block(1 + VOTING_PERIOD);
		assert_eq!(stored_value(), None);
		assert_eq!(Proposals::<Test>::get(0).unwrap().status, Status::Rejected);
		assert_eq!(Proposals::<Test>::get(1).unwrap().status, Status::Rejected);
		System::assert_has_event(Event::Rejected { id: 0 }.into());
		System::assert_has_event(Event::Rejected { id: 1 }.into());
	});
}

#[test]
fn a_failing_call_still_closes_the_proposal() {
	new_test_ext().execute_with(|| {
		// Root can't transfer more than Alice has: the call itself will fail.
		let call = Box::new(RuntimeCall::Balances(pallet_balances::Call::force_transfer {
			source: ALICE,
			dest: BOB,
			value: INITIAL * 10,
		}));
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), call));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 1));

		run_to_block(1 + VOTING_PERIOD);
		assert_eq!(Proposals::<Test>::get(0).unwrap().status, Status::Approved);
		let approved = System::events().into_iter().any(|record| {
			matches!(record.event, RuntimeEvent::Governance(Event::Approved { id: 0, result: Err(_) }))
		});
		assert!(approved, "Approved event with an error result");
	});
}

#[test]
fn voting_after_the_deadline_fails() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"hi")));
		run_to_block(1 + VOTING_PERIOD);
		assert_noop!(
			Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 10),
			Error::<Test>::VotingClosed
		);
	});
}

#[test]
fn unlock_releases_tokens_only_after_the_vote_ends() {
	new_test_ext().execute_with(|| {
		assert_ok!(Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(b"hi")));
		assert_ok!(Governance::vote(RuntimeOrigin::signed(BOB), 0, true, 300));

		assert_noop!(
			Governance::unlock(RuntimeOrigin::signed(BOB), 0),
			Error::<Test>::VotingNotOver
		);

		run_to_block(1 + VOTING_PERIOD);
		assert_ok!(Governance::unlock(RuntimeOrigin::signed(BOB), 0));
		assert_eq!(held(BOB), 0);
		assert_eq!(Balances::balance(&BOB), INITIAL);
		assert_eq!(Votes::<Test>::get(0, BOB), None);
		assert_eq!(last_event(), Event::Unlocked { id: 0, voter: BOB, amount: 300 }.into());

		// Unlocking twice doesn't work.
		assert_noop!(Governance::unlock(RuntimeOrigin::signed(BOB), 0), Error::<Test>::NoVote);
	});
}

#[test]
fn proposals_too_large_are_rejected() {
	new_test_ext().execute_with(|| {
		// MaxCallLength is 1024 bytes in the mock.
		assert_noop!(
			Governance::propose(RuntimeOrigin::signed(ALICE), set_storage_call(&[0u8; 2048])),
			Error::<Test>::CallTooLong
		);
	});
}
