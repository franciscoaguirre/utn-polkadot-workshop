#!/usr/bin/env bash
# Am I ready for the workshop? Prints ✅ or ❌ for each requirement.
#   ./scripts/check.sh
set -uo pipefail
source "$(dirname "$0")/common.sh"
cd "$ROOT"

failures=0
check() {
  local label="$1"; shift
  if "$@" > /dev/null 2>&1; then
    echo "✅ $label"
  else
    echo "❌ $label"
    failures=$((failures + 1))
  fi
}
node_major() { node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; }

echo "Tools"
check "Rust toolchain from rust-toolchain.toml"        rustc --version
check "wasm32v1-none target installed"                 bash -c 'test -d "$(rustc --print sysroot)/lib/rustlib/wasm32v1-none"'
check "Node.js 22 or newer"                            node_major
check "polkadot-omni-node runs"                        polkadot-omni-node --version
check "eth-rpc runs"                                   eth-rpc --version
check "chain-spec-builder runs"                        chain-spec-builder --version
echo
echo "Builds"
check "runtime built (target/.../workshop_runtime.compact.compressed.wasm)" test -f "$RUNTIME_WASM"
check "contracts: npm dependencies installed"           test -d contracts/node_modules/hardhat
check "contracts: compiled"                             test -d contracts/artifacts
check "papi: npm dependencies installed"                test -d papi/node_modules/polkadot-api
check "papi: chain types generated"                     test -f papi/node_modules/@polkadot-api/descriptors/dist/index.js
echo
echo "Chain (only during the workshop, after ./scripts/start-chain.sh)"
if curl -sf -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 > /dev/null; then
  echo "✅ chain + eth-rpc are running"
else
  echo "➖ chain not running (that's fine before the workshop)"
fi

echo
if (( failures == 0 )); then
  echo "🎉 You're ready for the workshop."
else
  echo "Fix the ❌ items (./scripts/setup.sh does most of them), or ask for help before the workshop."
  exit 1
fi
