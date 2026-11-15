#!/usr/bin/env bash
# BD2: the script is the module, and it owns its top-level declarations.
# The pre-wave analyzer wrote the literal string "global" onto every top-level
# edge; isIndexArtifactName REJECTS that name, so those edges could never
# resolve to a stored symbol.

readonly SCRIPT_NAME="module-owner-bd2.sh"
export LOG_LEVEL=info

top_level_helper() {
  local inner=$1
  echo "$inner"
}

docker build -t demo .
top_level_helper "$LOG_LEVEL"
