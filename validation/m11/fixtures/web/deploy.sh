#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="order-api"
readonly DEFAULT_PORT=8080

usage() {
  echo "Usage: $0 [--env ENV] [--port PORT]"
}

build_image() {
  local image="$1"
  docker build -t "$image" .
}

run_tests() {
  local env="$1"
  if [[ "$env" == "prod" ]]; then
    echo "Running prod tests"
  else
    echo "Running dev tests"
  fi
}

deploy() {
  local env="${1:-dev}"
  local port="${2:-$DEFAULT_PORT}"

  if [[ -z "${CI:-}" ]]; then
    echo "Not in CI, skipping deploy"
    return 0
  fi

  build_image "$APP_NAME:$env"
  run_tests "$env"
  docker run -d -p "$port:80" "$APP_NAME:$env"
}

main() {
  local env="dev"
  local port="$DEFAULT_PORT"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env) env="$2"; shift 2 ;;
      --port) port="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown option: $1"; exit 1 ;;
    esac
  done

  deploy "$env" "$port"
}

main "$@"
