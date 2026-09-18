/* Linker script for the `always-success` script.
 *
 * The stock RISC-V layout spreads the ELF headers, the text and the
 * `.riscv.attributes` metadata blob over page-aligned segments, which costs
 * several hundred bytes of file space that the CKB VM never looks at: it only
 * walks `PT_LOAD` program headers. This script therefore
 *
 *   * emits a single read/execute `PT_LOAD` segment (no `PT_GNU_STACK`, no
 *     `PT_RISCV_ATTRIBUTES`),
 *   * discards the attribute/comment/unwind metadata sections, and
 *   * keeps the conventional `0x10000` load address of the CKB toolchain.
 *
 * Combined with `--nmagic` (no page alignment) the resulting ELF is exactly
 * the 64 byte header, one 56 byte program header and the ten bytes of
 * `_start`.
 */
ENTRY(_start)

PHDRS
{
  text PT_LOAD FLAGS(5); /* R + X */
}

SECTIONS
{
  . = 0x10000;
  .text : { *(.text._start) *(.text .text.*) } :text
  /DISCARD/ : { *(.riscv.attributes) *(.eh_frame) *(.comment) *(.note*) }
}
