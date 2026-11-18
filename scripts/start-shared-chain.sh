#!/usr/bin/env bash
# Run the class's shared chain on this machine and publish it on the internet, so all students
# can vote on the same proposals and deploy their DAOs to it.
#
#   ./scripts/start-shared-chain.sh                    # start it (it keeps its state across restarts)
#   ./scripts/start-shared-chain.sh --reset            # delete it and start a new one from block 0
#   ./scripts/start-shared-chain.sh --no-tunnel        # don't publish it (e.g. on a VPS behind Caddy)
#   ./scripts/start-shared-chain.sh --runtime x.wasm   # runtime for a new chain (default: your build)
#
# Before the first run, write down who gets tokens:
#   cp shared-chain.config.example.json shared-chain.config.json   # then edit it
#
# Publishing uses free Cloudflare quick tunnels (no account needed): install `cloudflared`.
# Their URLs change every time this script starts, so share them on the day.
# Ports: 9944 and 8545, the same as the local chain, so stop that one first.
set -euo pipefail
source "$(dirname "$0")/common.sh"

reset=false
tunnel=true
wasm="$RUNTIME_WASM"
while (($#)); do
  case "$1" in
    --reset) reset=true ;;
    --no-tunnel) tunnel=false ;;
    --runtime) wasm="$2"; shift ;;
    *) echo "Unknown option: $1 (see the top of $0)"; exit 1 ;;
  esac
  shift
done

config="$ROOT/shared-chain.config.json"
data="$ROOT/shared-chain-data"
spec="$data/chain_spec.json"

if $tunnel && ! command -v cloudflared > /dev/null; then
  echo "✗ cloudflared isn't installed. It publishes the chain on the internet:"
  echo "    macOS: brew install cloudflared"
  echo "    Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  echo "  Or run with --no-tunnel if you publish the ports some other way."
  exit 1
fi

if $reset && [[ -d "$data" ]]; then
  echo "→ Deleting the shared chain in shared-chain-data/"
  rm -rf "$data"
fi
mkdir -p "$data"

if [[ ! -f "$spec" ]]; then
  if [[ ! -f "$config" ]]; then
    echo "✗ No shared-chain.config.json. Create it from the example and put your own addresses in it:"
    echo "    cp shared-chain.config.example.json shared-chain.config.json"
    exit 1
  fi
  if [[ ! -f "$wasm" ]]; then
    echo "✗ No runtime found at $wasm"
    echo "  Build it first (cargo build --release -p workshop-runtime), or pass --runtime <file.wasm>."
    exit 1
  fi
  echo "→ Creating a new shared chain from $(basename "$wasm") and shared-chain.config.json"
  chain-spec-builder -c "$data/development_spec.json" create --relay-chain paseo-local --para-id 1000 \
    --runtime "$wasm" named-preset development > "$data/chain-spec-builder.log" 2>&1
  (cd "$ROOT/papi" && npx tsx src/shared/chain-spec.ts "$data/development_spec.json" "$config" "$spec")
  rm "$data/development_spec.json"
elif [[ -f "$config" && "$config" -nt "$spec" ]]; then
  echo "⚠️  shared-chain.config.json changed after this chain was created. Changes only apply to a new"
  echo "   chain (--reset). To give tokens on the running chain: cd papi && npm run fund -- <address> <tokens>"
fi

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "→ Stopping"
  kill "${node_pid:-}" "${eth_pid:-}" "${rpc_tunnel_pid:-}" "${eth_tunnel_pid:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Unlike the local chain: the data stays in shared-chain-data/ (no --tmp), and only safe RPC
# methods are served, because the tunnel makes this node's RPC public. Archive mode keeps every
# block's state, which eth-rpc needs.
echo "→ Starting polkadot-omni-node (one block per second). Log: shared-chain-data/node.log"
polkadot-omni-node --chain "$spec" --dev --dev-block-time 1000 --base-path "$data/node" \
  --rpc-port 9944 --rpc-cors all --rpc-methods safe --rpc-max-connections 1000 \
  --state-pruning archive --blocks-pruning archive > "$data/node.log" 2>&1 &
node_pid=$!

for _ in $(seq 1 60); do
  grep -q "Imported #" "$data/node.log" 2>/dev/null && break
  if ! kill -0 "$node_pid" 2>/dev/null; then
    echo "✗ The node stopped. Last lines of shared-chain-data/node.log:"; tail -20 "$data/node.log"; exit 1
  fi
  sleep 1
done

echo "→ Starting eth-rpc. Log: shared-chain-data/eth-rpc.log"
eth-rpc --dev --node-rpc-url ws://127.0.0.1:9944 --rpc-port 8545 > "$data/eth-rpc.log" 2>&1 &
eth_pid=$!

for _ in $(seq 1 60); do
  curl -sf -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    http://127.0.0.1:8545 > /dev/null && break
  if ! kill -0 "$eth_pid" 2>/dev/null; then
    echo "✗ eth-rpc stopped. Last lines of shared-chain-data/eth-rpc.log:"; tail -20 "$data/eth-rpc.log"; exit 1
  fi
  sleep 1
done

node_url="ws://127.0.0.1:9944"
eth_url="http://127.0.0.1:8545"

if $tunnel; then
  # Wait for a quick tunnel to print its public URL.
  tunnel_url() {
    local log="$1" pid="$2" url=""
    for _ in $(seq 1 60); do
      url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$log" 2>/dev/null | head -1 || true)
      [[ -n "$url" ]] && { echo "$url"; return; }
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    echo "✗ The tunnel didn't start. Last lines of $log:" >&2; tail -20 "$log" >&2; exit 1
  }
  echo "→ Publishing through Cloudflare quick tunnels. Logs: shared-chain-data/tunnel-*.log"
  cloudflared tunnel --no-autoupdate --url http://127.0.0.1:9944 > "$data/tunnel-rpc.log" 2>&1 &
  rpc_tunnel_pid=$!
  cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8545 > "$data/tunnel-eth.log" 2>&1 &
  eth_tunnel_pid=$!
  rpc_https=$(tunnel_url "$data/tunnel-rpc.log" "$rpc_tunnel_pid")
  eth_url=$(tunnel_url "$data/tunnel-eth.log" "$eth_tunnel_pid")
  node_url="wss://${rpc_https#https://}"
fi

explorer="https://dev.papi.how/explorer#networkId=custom&endpoint=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$node_url")"

cat > "$data/for-students.txt" <<EOF
Join the class chain. In every terminal (papi/ and contracts/):

  export NODE_URL="$node_url"
  export ETH_RPC_URL="$eth_url"
  export MNEMONIC="<your secret phrase from \`npm run account\`>"

Explorer: $explorer
EOF

echo
echo "✅ The shared chain is running."
echo "   Polkadot RPC (PAPI):    $node_url"
echo "   Ethereum RPC (Hardhat): $eth_url"
echo "   Explorer:               $explorer"
echo
echo "   For your students (also saved in shared-chain-data/for-students.txt):"
echo
sed 's/^/   /' "$data/for-students.txt"
echo
if $tunnel; then
  echo "   It takes a few seconds before the tunnel URLs answer."
fi
echo "   Press Ctrl+C to stop. The chain keeps its state: run this script again to continue."
wait "$node_pid"
