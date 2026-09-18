
The e2e script should be written in TypeScript as a subcommand in the SDK. It first checks that two `ckb`(`ckb run` and `ckb miner`) processes are running. If they are not, Report errors. Follow the "Quick start on a local devnet" section in `sdk/README.md` to implement the script.

Rules:
* The private key that holds assets is `d00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc`.
* Use `code_hash = Data2` to refer to all deployed binaries. Update all code if necessary.
* Use the parameters `--vote-duration 5 --vote-window 5 --challenge-time 1`.
* Do not use `sleep` to wait for the previous step. Instead, query the transaction or the tip (block number).
* Write a subcommand, `dao-deposit`, and use this step in the script. What happens on-chain:
    1. A new output cell is created with:
        - Capacity: the deposit amount.
        - Lock script: the user's lock script (for example, secp256k1 sighash).
        - Type script: the DAO type script (`code_hash = DAO_TYPE_HASH`, `hash_type = Type`, `args = []`).
        - Data: 8 bytes of zeros (`[0u8; 8]`), which marks the cell as deposited.
    2. The transaction includes the DAO cell dep, resolved from the genesis block `tx[0] output[2]`.
    3. The cell is now locked under the DAO type script. It can only be spent through the DAO prepare/withdraw process.
* Gracefully shut down both ckb processes when the script exits, whether normally or abnormally.
* Do not require ckb-cli. If it becomes necessary, ask me to confirm.
* Don't include the step `receive-grant` 
* The config file specified by `--config` is stored as `./devnet.config`.
* If there is any bug in sdk, fix it
* If any step require extra script or subcommand, add it.


Run `bun run src/cli/index.ts e2e` to start; the command takes no parameters, so any required parameters must be set in advance. Run it successfully to complete this task.
