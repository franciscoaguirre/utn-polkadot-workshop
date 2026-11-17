#!/usr/bin/env bash
# Start a fresh local chain running OUR runtime, plus the Ethereum RPC adapter for Hardhat.
#
#   ./scripts/start-chain.sh            # uses the runtime you built with `cargo build`
#   ./scripts/start-chain.sh some.wasm  # or another runtime
#
# Polkadot RPC (PAPI):     ws://127.0.0.1:9944
# Ethereum RPC (Hardhat):  http://127.0.0.1:8545
# Stop both with Ctrl+C. Every start is a brand-new chain (block #0, fresh balances).
set -euo pipefail
source "$(dirname "$0")/common.sh"

wasm="${1:-$RUNTIME_WASM}"
if [[ ! -f "$wasm" ]]; then
  echo "No runtime found at $wasm"
  echo "Build it first:  cargo build --release -p workshop-runtime"
  exit 1
fi

mkdir -p "$ROOT/logs"
spec="$ROOT/logs/chain_spec.json"

echo "→ Creating a chain spec from $(basename "$wasm")"
chain-spec-builder -c "$spec" create --relay-chain paseo-local --para-id 1000 \
  --runtime "$wasm" named-preset development > "$ROOT/logs/chain-spec-builder.log" 2>&1

# A new chain means an old DAO deployment no longer exists.
rm -f "$ROOT/dao-address.json"

cleanup() {
  echo
  echo "→ Stopping"
  kill "${node_pid:-}" "${eth_pid:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "→ Starting polkadot-omni-node (one block per second). Log: logs/node.log"
polkadot-omni-node --chain "$spec" --dev --dev-block-time 1000 --tmp \
  --rpc-port 9944 > "$ROOT/logs/node.log" 2>&1 &
node_pid=$!

for _ in $(seq 1 60); do
  grep -q "Imported #1" "$ROOT/logs/node.log" 2>/dev/null && break
  if ! kill -0 "$node_pid" 2>/dev/null; then
    echo "✗ The node stopped. Last lines of logs/node.log:"; tail -20 "$ROOT/logs/node.log"; exit 1
  fi
  sleep 1
done

echo "→ Starting eth-rpc. Log: logs/eth-rpc.log"
eth-rpc --dev --node-rpc-url ws://127.0.0.1:9944 > "$ROOT/logs/eth-rpc.log" 2>&1 &
eth_pid=$!

for _ in $(seq 1 60); do
  curl -sf -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    http://127.0.0.1:8545 > /dev/null && break
  if ! kill -0 "$eth_pid" 2>/dev/null; then
    echo "✗ eth-rpc stopped. Last lines of logs/eth-rpc.log:"; tail -20 "$ROOT/logs/eth-rpc.log"; exit 1
  fi
  sleep 1
done

echo
echo "✅ Chain is running."
echo "   Polkadot RPC (PAPI):    ws://127.0.0.1:9944"
echo "   Ethereum RPC (Hardhat): http://127.0.0.1:8545"
echo "   Explorer: https://polkadot.js.org/apps/?rpc=ws%3A%2F%2F127.0.0.1%3A9944#/explorer"
echo "   Press Ctrl+C to stop."
wait "$node_pid"
