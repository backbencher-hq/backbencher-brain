#!/usr/bin/env bash
# Final Phase B evidence sweep for bb_edit. Every command runs on lane fixtures with
# a lane-local data dir; the shared index and the repo's own fixture trees are never
# written by these runs.
set -u
cd "$(git rev-parse --show-toplevel)"
export BB_DATA_DIR="$PWD/validation/tools/bb_edit/bbdata"
export BB_NO_AUTO_REFRESH=1
OUT="validation/tools/bb_edit/artifacts/final-sweep"
mkdir -p "$OUT"
run() {
  local name="$1"; shift
  echo "=== $name" | tee -a "$OUT/status.tsv"
  "$@" > "$OUT/$name.log" 2>&1
  local code=$?
  echo -e "$name\texit=$code" | tee -a "$OUT/status.tsv"
}
run probe-import-pruning npx tsx validation/tools/bb_edit/work/probe-import-pruning.ts
run probe-format npx tsx validation/tools/bb_edit/work/probe-format.ts
run probe-collision npx tsx validation/tools/bb_edit/work/probe-collision.ts
run probe-delete-warn npx tsx validation/tools/bb_edit/work/probe-delete-warn.ts
run probe-validate npx tsx validation/tools/bb_edit/work/probe-validate.ts
run probe-matrix npx tsx validation/tools/bb_edit/work/probe-matrix.ts
run probe-wire npx tsx validation/tools/bb_edit/work/probe-mcp.ts
run m13-unit npx tsx script/m13/verify-edit-unit.ts
run m13-rename npx tsx script/m13/verify-edit-rename.ts
run m13-mask npx tsx script/m13/verify-edit-mask.ts
run m13-body npx tsx script/m13/verify-edit-body.ts
run m13-boundary npx tsx script/m13/verify-edit-boundary.ts
run m13-atomicity npx tsx script/m13/verify-edit-atomicity.ts
run m13-freshness npx tsx script/m13/verify-edit-freshness.ts
run m13-integration npx tsx script/m13/verify-edit-integration.ts
run m13-e2e npx tsx script/m13/verify-edit-e2e.ts
run m13-corpus npx tsx script/m13/verify-edit-corpus.ts
run m13-honesty npx tsx script/m13/verify-edit-honesty.ts
run m13-docs npx tsx script/m13/verify-edit-docs.ts
run m13-batch npx tsx script/m13/verify-edit-batch.ts
run m15-classification npx tsx script/m15/verify-edit-classification.ts
run m15-crossfile npx tsx script/m15/verify-edit-crossfile.ts
run m15-e2e-docs npx tsx script/m15/verify-edit-e2e-docs.ts
run m15-mask npx tsx script/m15/verify-edit-mask.ts
run m15-regex npx tsx script/m15/verify-edit-regex.ts
run legacy-verify-edit npx tsx script/verify-edit.ts
run m16-real-repo npx tsx script/m16/verify-edit-real-repo.ts
echo DONE | tee -a "$OUT/status.tsv"
