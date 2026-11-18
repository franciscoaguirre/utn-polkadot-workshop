#!/usr/bin/env bash
# Pre-work: run this BEFORE the workshop. It takes a while (mostly compiling Rust).
#
#   ./scripts/setup.sh
#
# It installs the pinned Rust toolchain, downloads the Polkadot binaries into ./bin,
# builds our runtime, and installs the JavaScript dependencies.
# Then run ./scripts/check.sh: everything should be ✅.
set -euo pipefail
source "$(dirname "$0")/common.sh"
cd "$ROOT"

step() { echo; echo "━━ $*"; }

step "1/4 Rust"
if command -v rustup > /dev/null; then
  # rust-toolchain.toml pins the version, the wasm target and rust-src; this installs them.
  rustup show active-toolchain > /dev/null 2>&1 || rustup toolchain install
elif [[ -n "${IN_NIX_SHELL:-}" ]] && command -v rustc > /dev/null; then
  echo "Using the toolchain from the Nix shell (flake.nix)."
else
  echo "Rust is not installed. Install it from https://rustup.rs, open a new terminal, and re-run this script."
  echo "(On Nix/NixOS, run \`nix develop\` first instead.)"
  exit 1
fi
rustc --version

step "2/4 Polkadot binaries ($SDK_RELEASE)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) suffix="" ; sha="sha256sum" ;;
  Darwin-arm64) suffix="-aarch64-apple-darwin" ; sha="shasum -a 256" ;;
  *) suffix="unsupported" ;;
esac
mkdir -p "$BIN"
for tool in polkadot-omni-node eth-rpc chain-spec-builder; do
  if [[ -x "$BIN/$tool" ]] && "$BIN/$tool" --version > /dev/null 2>&1; then
    echo "✓ $tool already in bin/"
    continue
  fi
  if command -v "$tool" > /dev/null && "$tool" --version > /dev/null 2>&1; then
    echo "✓ $tool already installed ($(command -v "$tool"))"
    continue
  fi
  if [[ "$suffix" == "unsupported" ]]; then
    crate="$tool"
    [[ "$tool" == "eth-rpc" ]] && crate="pallet-revive-eth-rpc"
    [[ "$tool" == "chain-spec-builder" ]] && crate="staging-chain-spec-builder"
    echo "No prebuilt $tool for $(uname -s) $(uname -m). Building it from source (slow)…"
    cargo install --locked --root "$ROOT" -j "$(build_jobs)" "$crate@$(
      case "$tool" in polkadot-omni-node) echo 0.25.0;; eth-rpc) echo 0.25.0;; chain-spec-builder) echo 21.0.0;; esac
    )"
    continue
  fi
  url="https://github.com/paritytech/polkadot-sdk/releases/download/$SDK_RELEASE/$tool$suffix"
  echo "↓ $tool"
  curl -fL --progress-bar -o "$BIN/$tool$suffix" "$url"
  curl -fsSL -o "$BIN/$tool$suffix.sha256" "$url.sha256"
  (cd "$BIN" && $sha -c "$tool$suffix.sha256" > /dev/null) || { echo "✗ checksum mismatch for $tool"; exit 1; }
  rm "$BIN/$tool$suffix.sha256"
  [[ -n "$suffix" ]] && mv "$BIN/$tool$suffix" "$BIN/$tool"
  chmod +x "$BIN/$tool"
done

step "3/4 Building the runtime (the first build takes 10-30+ minutes)"
jobs=$(build_jobs)
echo "Using $jobs parallel jobs (set CARGO_BUILD_JOBS to change; each needs ~2 GB of RAM)."
cargo build --release -p workshop-runtime -j "$jobs"
echo "Running the pallet's tests too (this also pre-builds them for the workshop)…"
cargo test -p pallet-governance -j "$jobs"

step "4/4 JavaScript dependencies"
(cd contracts && npm ci && npx hardhat compile)
(cd papi && npm ci)

echo
echo "✅ Setup finished. Now run ./scripts/check.sh"
