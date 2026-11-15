#!/usr/bin/env bash
# BD3: a signal is not code and never names a caller. The pre-wave analyzer
# emitted `calls: EXIT -> log "WARN" "interrupted"` — a signal as the source and
# a whole command string, arguments included, as the target.

log() {
  echo "$1"
}

cleanup() {
  echo bye
}

trap 'log "WARN" interrupted' INT
trap cleanup EXIT
trap 'notify; cleanup' TERM
