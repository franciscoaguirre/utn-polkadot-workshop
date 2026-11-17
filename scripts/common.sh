# Shared settings for the workshop scripts. Sourced, not run.
SDK_RELEASE="polkadot-stable2609-2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/bin"
RUNTIME_WASM="$ROOT/target/release/wbuild/workshop-runtime/workshop_runtime.compact.compressed.wasm"
export PATH="$BIN:$PATH"

# Building Polkadot SDK code needs ~2 GB of RAM per parallel job. Default to what fits.
build_jobs() {
  local mem_gb
  if [[ "$(uname)" == "Darwin" ]]; then
    mem_gb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
  else
    mem_gb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 / 1024 ))
  fi
  local jobs=$(( mem_gb / 2 ))
  (( jobs < 1 )) && jobs=1
  echo "${CARGO_BUILD_JOBS:-$jobs}"
}
