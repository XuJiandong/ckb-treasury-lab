# We cannot use $(shell pwd), which will return unix path format on Windows,
# making it hard to use.
cur_dir = $(dir $(abspath $(firstword $(MAKEFILE_LIST))))

TOP := $(shell cd "$(cur_dir)"; while [ ! -f scripts/find_clang ] && [ ! -e .git ] && [ "$$PWD" != "/" ]; do cd ..; done; pwd)
ifeq ($(shell ls "$(TOP)/scripts/find_clang" 2>/dev/null),)
$(error scripts/find_clang not found; please run make from a workspace root containing scripts/find_clang (or use standalone-contract))
endif

# This contract exists to succeed, nothing else: its only goal is to be the
# smallest possible code cell. The flags below spell that out for this crate
# only - the other contracts keep their own Makefiles untouched.
#
# The workspace top level exports `CUSTOM_RUSTFLAGS=-C debug-assertions`, which
# is why `FULL_RUSTFLAGS` below is spelled out in full instead of appending
# `$(CUSTOM_RUSTFLAGS)`: the unnecessary debug-assertions have to go.
#
# * `debug-assertions=no` drops the `debug!`/format machinery.
# * `opt-level=z`, `lto=fat` and `codegen-units=1` shrink and inline.
# * `panic=abort` plus `force-unwind-tables=no` keep the panic path down to the
#   `exit` syscall and remove `.eh_frame`.
# * `strip=symbols` and `--gc-sections` drop everything unreferenced.
# * `--nmagic` stops the linker from padding every section up to a page
#   boundary, and `-T always-success.ld` replaces the stock multi-segment
#   layout with a single loadable segment (see that file for the details).
# RUSTFLAGS that are less likely to be tweaked by developers. Most likely
# one would want to keep the default values here.
FULL_RUSTFLAGS := -C target-feature=+zba,+zbb,+zbc,+zbs \
	-C opt-level=z -C lto=fat -C embed-bitcode=yes -C codegen-units=1 \
	-C panic=abort -C force-unwind-tables=no -C strip=symbols \
	-C debug-assertions=no -C link-arg=--gc-sections -C link-arg=--nmagic \
	-C link-arg=-T -C link-arg=$(cur_dir)always-success.ld
# Additional cargo args to append here. For example, one can use
# make test CARGO_ARGS="-- --nocapture" so as to inspect data emitted to
# stdout in unit tests
CARGO_ARGS :=
MODE := release
# Tweak this to change the clang version to use for building C code. By default
# we use a bash script with some heuristics to find clang in current system.
CLANG := $(shell $(TOP)/scripts/find_clang)
AR := $(subst clang,llvm-ar,$(CLANG))
OBJCOPY := $(subst clang,llvm-objcopy,$(CLANG))
# When this is set to some value, the generated binaries will be copied over
BUILD_DIR :=
# Generated binaries to copy. By convention, a Rust crate's directory name will
# likely match the crate name, which is also the name of the final binary.
# However if this is not the case, you can tweak this variable. As the name hints,
# more than one binary is supported here.
BINARIES := $(notdir $(shell pwd))

ifeq (release,$(MODE))
	MODE_ARGS := --release
endif

default: build test

build:
	RUSTFLAGS="$(FULL_RUSTFLAGS)" TARGET_CC="$(CLANG)" TARGET_AR="$(AR)" \
		cargo build --target=riscv64imac-unknown-none-elf $(MODE_ARGS) $(CARGO_ARGS)
	@set -eu; \
	for binary in $(BINARIES); do \
		target=$(TOP)/target/riscv64imac-unknown-none-elf/$(MODE)/$$binary; \
		$(OBJCOPY) --strip-debug --strip-all --strip-sections $$target $$target.stripped; \
		mv $$target.stripped $$target; \
		if [ "x$(BUILD_DIR)" != "x" ]; then \
			echo "Copying binary $$binary to build directory"; \
			cp $$target $(TOP)/$(BUILD_DIR); \
		fi \
	done

# test, check, clippy and fmt here are provided for completeness,
# there is nothing wrong invoking cargo directly instead of make.
test:
	cargo test $(CARGO_ARGS)

check:
	cargo check $(CARGO_ARGS)

clippy:
	cargo clippy $(CARGO_ARGS)

fmt:
	cargo fmt $(CARGO_ARGS)

# Arbitrary cargo command is supported here. For example:
#
# make cargo CARGO_CMD=expand CARGO_ARGS="--ugly"
#
# Invokes:
# cargo expand --ugly
CARGO_CMD :=
cargo:
	cargo $(CARGO_CMD) $(CARGO_ARGS)

clean:
	cargo clean

prepare:
	rustup target add riscv64imac-unknown-none-elf

.PHONY: build test check clippy fmt cargo clean prepare
