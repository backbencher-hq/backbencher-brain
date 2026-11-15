#!/usr/bin/env bash
# ZIG — §8 item 37. The shared arbiter publishes a FALSE verdict on its SECOND run.
#
# ## The defect, in the smallest corpus that shows it
#
# `script/m14/ontology-coverage-gate.ts` walks the corpus through `resumableWalk`, which
# appends each walked path to `validation/m14/measurements/walk-<lang>.txt` and SKIPS any
# path a previous run recorded. The edge tally (`observed`) is accumulated INSIDE the
# walk's `run` callback, in memory. So a resumed file contributes its PATH to the
# checkpoint and its EDGES to nothing:
#
#   run 1   walk: 2/2 files (100.0%)  newly walked 2, resumed 0   ->  emitted 6/10, exit 0
#   run 2   walk: 2/2 files (100.0%)  newly walked 0, resumed 2   ->  emitted 0/10, exit 1
#
# Both runs cover 100.0% of the same two files. Run 2 calls `calls`, `uses`, `contains`,
# `imports`, `references` and `exports` RULED-SOUND or RULED-UNJUSTIFIED — a claim that
# the construct does not occur in the corpus, derived from a tally that was never
# populated because no file was parsed. Two of them (imports, exports) additionally lose
# their table ruling and fall through to the SPEC's prose, which is the downgrade the
# gate's own header warns about.
#
# The checkpoint is gitignored (`.gitignore:274 validation/m14/measurements/walk-*.txt`),
# so a fresh clone starts clean and run 1 is right. Every SUBSEQUENT run on the same
# machine is wrong, and the corpus is unchanged between them.
#
# ## Why this is not mine to fix
#
# Both files are shared machinery (workstream §8): `script/m14/ontology-coverage-gate.ts`
# and `script/m14/resumable-walk.ts`. The minimum safe repair is in the gate and is small:
# when `walkStats.walked === 0 && walkStats.alreadyDone > 0`, refuse to publish the
# `emitted` column — the per-file data it would need was never recorded — and exit
# non-zero naming that, rather than deriving rulings from an empty accumulator. The
# full repair is to persist each file's per-type counts in the checkpoint line and
# replay them on resume.
#
# ## Usage
#
#   bash validation/m14/fixtures/zig/arbiter-resume-repro.sh
#
# Builds its own two-repo corpus root under /tmp, so it measures nothing about the real
# corpus and depends on nothing outside this lane. ~1 minute. Both runs' full verdicts go
# to `arbiter-resume-repro.out`.

set -u
ROOT="${1:-/tmp/opencode/zig-gate-root}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/measurements/arbiter-resume-repro.out"
REPO="$(cd "$HERE/../../../.." && pwd)"

run_gate() {
  local label="$1"
  echo "===== $label ====="
  local log
  log="$(mktemp)"
  ( cd "$REPO" && BB_CORPUS_ROOT="$ROOT" npx tsx script/m14/ontology-coverage-gate.ts zig ) >"$log" 2>&1
  local code=$?
  grep -v '^\[INFO\]' "$log"
  echo "EXIT=$code"
  rm -f "$log"
}

rm -rf "$ROOT"
mkdir -p "$ROOT/r1/src" "$ROOT/r2/src"
(
  cd "$ROOT/r1"
  git init -q .
  printf 'const std = @import("std");\npub fn main() void { std.debug.print("hi\\n", .{}); }\npub fn build() u32 { return 1; }\n' > src/a.zig
  git add -A && git -c user.email=a@b -c user.name=c commit -qm x
)
(
  cd "$ROOT/r2"
  git init -q .
  printf 'const std = @import("std");\npub const S = struct { pub fn make() S { return .{}; } };\npub fn run() void { std.debug.assert(true); }\n' > src/b.zig
  git add -A && git -c user.email=a@b -c user.name=c commit -qm x
)

# The checkpoint path the gate derives from LANG, removed so run 1 is a true first run.
CKPT="$REPO/validation/m14/measurements/walk-zig.txt"
cp -f "$CKPT" "$CKPT.bak" 2>/dev/null || true
rm -f "$CKPT"

{
  echo "# arbiter-resume-repro — script/m14/ontology-coverage-gate.ts, lang zig"
  echo "# corpus root $ROOT — 2 files, built by this script"
  echo
  run_gate "RUN 1 (no checkpoint)"
  echo
  run_gate "RUN 2 (checkpoint already records every file, same corpus, same command)"
} | tee "$OUT"

[ -f "$CKPT.bak" ] && mv -f "$CKPT.bak" "$CKPT"
rm -rf "$ROOT"
echo
echo "wrote $OUT"
