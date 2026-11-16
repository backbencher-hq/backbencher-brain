#!/usr/bin/env bash
# Re-run the CANONICAL M59.O1 oracle (40 files/lang, all lanes) to prove the
# `Self`-resolution reclassification is narrow: only rows whose token is absent
# from a line that itself contains the `Self` keyword can move, so every other
# language's INCONSISTENT total must be unchanged.
cd <corpus-root>/mcp/backbencher-brain || exit 1
rm -f /tmp/o1canon.done
cp validation/m59/results/oracle-callsite.json /tmp/o1canon.prev.json
timeout 2400 bun script/m59/oracle-callsite.ts --files-per-lang=40 > /tmp/o1canon.log 2>&1
echo "rc=$?" >> /tmp/o1canon.log
touch /tmp/o1canon.done
