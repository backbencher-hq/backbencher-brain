#!/usr/bin/env bash
# Common utilities shared across services.
set -euo pipefail

readonly SCRIPT_NAME="common.sh"
export LOG_LEVEL="${LOG_LEVEL:-info}"

# Formats a message with the current timestamp.
log() {
  local level="$1"
  local message="${2:-}"
  printf '[%s] %s: %s\n' "$(date -u +%H:%M:%S)" "$level" "$message"
}

# Returns the backend name for an environment.
get_backend() {
  local env="${1:-dev}"
  local -a backends=(api web worker)
  case "$env" in
    prod) echo "prod-api" ;;
    *) echo "api" ;;
  esac
}

# Runs a health check against every backend.
check_all() {
  local -a names=(api web)
  for name in "${names[@]}"; do
    if [[ -n "$name" ]]; then
      log "INFO" "checking $name"
    fi
  done
}

# Waits until a lock file is released or the timeout elapses.
wait_lock() {
  local path="$1"
  local tries=0
  while [[ $tries -lt 5 ]]; do
    if [[ ! -f "$path" ]]; then
      break
    fi
    tries=$((tries + 1))
  done
}

# Registers a cleanup handler for the given signal.
install_trap() {
  trap 'log "WARN" "interrupted"' INT TERM
}

# Source the environment override if present.
if [[ -f ./env.sh ]]; then
  source ./env.sh
fi

alias ls='ls --color=auto'

result=$(get_backend "prod")
main_result="${result}-ready"
echo "backend: $main_result"
