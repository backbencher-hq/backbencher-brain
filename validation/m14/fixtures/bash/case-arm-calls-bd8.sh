#!/usr/bin/env bash
# BD8: a `case` arm's commands are ordinary calls. The pre-wave analyzer
# suppressed every command at case depth > 0 as "dispatch noise" — but an arm's
# PATTERN is a word/string node, never a `command`, so the filter never
# suppressed a pattern. It suppressed real work.

case "${1:-}" in
  install) apt-get install -y curl ;;
  remove)  apt-get remove -y curl ;;
  *)       echo "unknown: ${1:-}" ;;
esac
