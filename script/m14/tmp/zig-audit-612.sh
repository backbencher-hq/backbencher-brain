#!/usr/bin/env bash
# The zig index audit: is the first pass's arm-to-arm index difference a property
# of the C1 rule, or of the machine?
#
# The two first-pass sweeps indexed zig 65 and 38 minutes apart on a shared
# machine (record: containment-612.before.json / containment-612.json). The nine
# smaller repos came out with IDENTICAL containment populations on both arms; zig
# did not (71,951 vs 80,352 containment edges, 954,423 vs 979,399 relationships,
# 22 vs 6 parse timeouts, 3,930s vs 2,275s wall). Every other repo entry carries
# the same probe numbers on both arms, so the reading that has to be excluded is
# "the C1 rule itself changed how many rows zig stores" — a rule that changes
# source/owner resolution can change the auto-contains dedupe population, so this
# is not a remote hypothesis, it is the thing to measure.
#
# Method: index the SAME pinned checkout (a private worktree at the corpus pin
# 738d2be9d6b6, so the shared corpus's brain.db and every record citing it stay
# untouched) once with each arm's build, back to back, recording the load average
# around each index. Both arms come from revisions: the after arm from this
# worktree, the before arm from /tmp/b612-prefix-arm (branch m14/612-prefix-arm
# @ 55010e77, whose store is built from the pre-C1 source — its dist bundle has no
# `enclosingStoreableIdByName`).
#
# Run:  bash script/m14/tmp/zig-audit-612.sh   (as a BACKGROUND process — a shell that
#       exits with the command kills the audit mid-index, which happened once)
# Out:  validation/m14/measurements/containment-zig-after-rerun-612.json
#       validation/m14/measurements/containment-zig-before-rerun-612.json
#       /tmp/zig-audit.log, /tmp/zig-audit.done
#
# One probe, not six: the audit is about the POPULATION (how many containment edges
# exist and their control-set tuple), which `contains-line-hint-612` reports. The
# other five probes re-measure rule behavior the canonical records already carry, and
# on zig they cost ~20 minutes per arm for no answer this experiment asks.
set -u
TREE=<corpus-root>/mcp/backbencher-brain/.merge-tmp
PRE=/tmp/b612-prefix-arm
PIN=/tmp/b612-zig-pinned
LOG=/tmp/zig-audit.log
PROBES=contains-line-hint-612

say() { printf '\n=== %s | %s | load=%s ===\n' "$(date -Is)" "$*" "$(cut -d' ' -f1-3 /proc/loadavg)" | tee -a "$LOG"; }

rm -f /tmp/zig-audit.done
: > "$LOG"
say "audit start (two runs: after build, then before build @55010e77)"

say "A1: after build, private pinned copy of zig"
python3 "$TREE/script/m14/tmp/containment-corpus-612.py" --arm after --probes "$PROBES" \
  --dir "zig=$PIN" --out "$TREE/validation/m14/measurements/containment-zig-after-rerun-612.json" zig >>"$LOG" 2>&1
echo "A1 exit=$?" | tee -a "$LOG"

say "B1: before build (pre-C1 bundle), same private pinned copy"
python3 "$TREE/script/m14/tmp/containment-corpus-612.py" --root "$PRE" --arm before --probes "$PROBES" \
  --dir "zig=$PIN" --out "$TREE/validation/m14/measurements/containment-zig-before-rerun-612.json" zig >>"$LOG" 2>&1
echo "B1 exit=$?" | tee -a "$LOG"

say "audit complete"
touch /tmp/zig-audit.done
