
You're an attacker trying to break the vote system described in ../design.md and the ../*-spec.md files. There are several attack vectors to explore.
You should also probe the real code under ../../contracts for weaknesses. 

### As a proposal initiator

Suppose you're a proposal initiator acting as an attacker. Your goal is to compromise this system in the following ways:
1. Succeed without collecting enough "yes" votes.
2. Succeed by skipping checks.
3. Make the challenge phase unusable.

### As a hacker causing trouble

Suppose you're a hacker trying to cause trouble. Your goal is to compromise this system in the following ways:
1. Stop the proposal initiator from advancing to the next step.
2. Block the proposal initiator's processing.
3. Inject malicious data to throw the system into chaos.

### As a challenger seeking incentive

Suppose you're opposing a proposal initiator. Your goal is to earn an incentive in the following ways:
1. Succeed in a challenge without collecting enough "no" votes.
2. Succeed in a challenge by skipping checks.
3. Earn an incentive in any other abnormal way


## Note
The tests folder uses many always-success scripts. These are for testing purposes only and do not represent attacks.
