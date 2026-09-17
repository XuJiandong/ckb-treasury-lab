
Your task is to implement an SDK, including an API library and a CLI for the voting system. The SDK should be in solution1/sdk folder.

An example project is available under ~/projects/ckb-vote-poc/sdk. This `ckb-vote-poc` is an old, abandoned implementation, but you can refer to its project structure and its usage of `@ckb-ccc/shell`, as well as how its CLI is designed and how config are used.

Before implementing, study the CCC documentation at ../knowledge/ccc.md.

The basic idea is to construct valid transactions and send them to CKB nodes. The SDK should cover the following operations:
- create config cell
- create proposal cell
- cast vote
- counting vote
- transfer proposal cell into finalized proposal cell
- transfer finalized proposal cell into passed proposal cell
- challenge a finalized cell
- and others

The SDK should cover following queries:
- find all related vote cell
- find all related counting cell
- find all proposal cell/finalized proposal cell/passed proposal cell
- and others

Rules:
* Implemented in Type Script
* Only support bun(v1.4.2)
* must use `@ckb-ccc/shell`
* No test is needed
* concise comments

