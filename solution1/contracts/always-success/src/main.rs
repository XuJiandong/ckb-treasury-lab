//! The `always-success` lock script.
//!
//! The script carries no rule of its own: every invocation exits with the
//! success code. That makes it a good candidate for the smallest possible
//! on-chain code cell, so this crate is deliberately freestanding - no
//! `ckb-std`, no allocator, no logging and no formatting machinery. The
//! release profile and the `Makefile` add LTO, section garbage collection and
//! a strip pass on top of that.
//!
//! On `riscv64` (the CKB VM) the whole contract is the three instructions of
//! `_start` below (set the exit code, set the syscall number, `ecall`). The
//! `library` / `test` configurations keep an ordinary Rust entry point so the
//! crate can still be linked into native harnesses.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(any(feature = "library", test)), no_main)]

/// The rule of the script: always succeed.
///
/// This is the entry point used when the crate is linked as a library (native
/// tests and simulators). The freestanding CKB VM build does not call it -
/// `_start` returns the same value without any Rust prologue - but keeping it
/// makes the `library` feature meaningful.
#[cfg(any(feature = "library", test))]
pub fn program_entry() -> i8 {
    0
}

#[cfg(all(target_arch = "riscv64", not(any(feature = "library", test))))]
mod freestanding {
    use core::panic::PanicInfo;

    // CKB VM entry point: exit(0).
    //
    // The VM jumps to the ELF entry symbol (`_start`) on a fresh stack, so
    // `a0` holds the exit code and `a7` the CKB `exit` syscall number (93).
    // Writing the sequence in assembly keeps the compiler from emitting a
    // function prologue or any other bookkeeping.
    //
    // `li a0, 0` is two bytes that the VM's zero-initialised registers would
    // make redundant, but this is a lock script: spelling the success code out
    // costs almost nothing and does not depend on unspecified entry state.
    core::arch::global_asm!(
        ".globl _start",
        ".section .text._start, \"ax\", @progbits",
        "_start:",
        "li a0, 0",
        "li a7, 93",
        "ecall",
    );

    /// Reaching a panic means the script failed; exit with a non-zero code.
    #[panic_handler]
    fn panic(_: &PanicInfo) -> ! {
        unsafe {
            core::arch::asm!("li a0, 1", "li a7, 93", "ecall", options(noreturn));
        }
    }
}
