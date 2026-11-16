#!/bin/bash
# script/m14/tmp/dt-proxicall-extent.sh — proxicall's FULL EXTENT, in chunks.
#
# WHY CHUNKED. proxicall's dart corpus is 2,211 files. A single-process
# `--sample 2300` run dies in the documented web-tree-sitter heap-death mode
# (returns EMPTY trees; the harness's parsed-but-empty guard refuses the
# fabricated 0/0 row), reproduced twice (rot 4 and rot 10). The measurement is
# therefore taken as successive draws over a PRIVATE cold pool (M14_WORK_ENV),
# so each draw consumes FRESH files deterministically and the union of the
# chunks is the whole corpus.
#
# `BB_F5_SHOW_FILES=1` prints every drawn path, which is what makes the union
# checkable from the logs instead of asserted.
cd <corpus-root>/mcp/backbencher-brain || exit 1
# BB_M14_WORK is the harness's work-root env (M14_WORK_ENV is a DIFFERENT
# constant name for the same idea — the pool file is <work root>/m14-f5-cold-pool.json).
export BB_M14_WORK=/tmp/dt-depth-work
export BB_F5_SHOW_FILES=1
for i in 1 2 3 4 5; do
  log=/tmp/dt-proxicall-chunk$i.log
  # --lane-batch makes the runner a CHILD SLICE, which turns the lane journal ON
  # (useJournal = CHILD_SLICE || resume || willBatch) — and the journal's state
  # key ignores the chunk index, so chunk 2 RESUMED chunk 1's row and only one
  # of the five chunks was ever measured. A scoped probe run must drop the row
  # between chunks: the journal exists to make a crashed SWEEP resumable, not to
  # make a fresh chunk look already done.
  rm -f /tmp/dt-depth-work/m14-f5-lane-journal*.json
  echo "### proxicall sample=500 chunk$i start $(date +%T)" > "$log"
  bun script/m14/differential.ts --repo proxicall --sample 500 --lane-batch=14/24 >> "$log" 2>&1
  echo "### exit=$? end $(date +%T)" >> "$log"
done
echo "DONE $(date +%T)" > /tmp/dt-proxicall-extent.done
