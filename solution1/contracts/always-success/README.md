# always-success

Return success, only.

## What the script does

On the CKB VM the contract is three instructions and nothing else:

```asm
_start:
    li   a0, 0      # exit code 0 -> success
    li   a7, 93     # SYS_EXIT
    ecall
```
