#!/usr/bin/env bash
# Measure the indexer scaling curve: one fresh-BB_DATA_DIR full index per tier,
# wall clock around `bb index`, plus the phase log the CLI already prints.
#
# Fresh data dir per run is load-bearing: a warm store would skip parsing and
# the curve would measure nothing.
#
# Usage:
#   script/perf/measure-curve.sh 25 50 100            # tiers
#   script/perf/measure-curve.sh --label before 25 50 # label the run set
#   script/perf/measure-curve.sh --repeat 3 25 50      # 3 samples per tier
set -euo pipefail

export PATH="$HOME/.local/node/bin:$PATH"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIX="$REPO_ROOT/.perf-fixtures/bb-scale"
LOGDIR="$REPO_ROOT/.perf-fixtures/logs"
mkdir -p "$LOGDIR"

LABEL="run"
REPEAT=1
TIERS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --repeat) REPEAT="$2"; shift 2 ;;
    *) TIERS+=("$1"); shift ;;
  esac
done
if [ "${#TIERS[@]}" -eq 0 ]; then TIERS=(25 50 100 200); fi

cd "$REPO_ROOT"
BB="$REPO_ROOT/bin/bb"

echo "== machine =="
system_profiler SPHardwareDataType 2>/dev/null | sed -n 's/^\(Model Name\|Chip\|Total Number of Cores\|Memory\): */\1: /p' || true
echo "cores: $(sysctl -n hw.ncpu)  loadavg: $(sysctl -n vm.loadavg | tr -d '{}' | xargs)"
echo "node: $(node -v)"

for n in "${TIERS[@]}"; do
  dir="$FIX/n$n"
  if [ ! -d "$dir" ]; then
    echo "n$n: no fixture pool (run script/perf/make-pools.sh)" >&2
    continue
  fi
  r=1
  while [ "$r" -le "$REPEAT" ]; do
    dd="$LOGDIR/dd-$LABEL-n$n-r$r"
    rm -rf "$dd"
    mkdir -p "$dd"
    log="$LOGDIR/$LABEL-n$n-r$r.log"
    start=$(python3 -c 'import time;print(time.time())')
    BB_DATA_DIR="$dd" BB_LOG_LEVEL=warn "$BB" index "$dir" --no-setup > "$log" 2>&1 || {
      echo "n$n r$r: index FAILED, see $log" >&2
      tail -5 "$log" >&2
    }
    end=$(python3 -c 'import time;print(time.time())')
    secs=$(python3 -c "print(f'{$end-$start:.2f}')")
    files=$(ls "$dir" | wc -l | tr -d ' ')
    # The summary line is the only one carrying "N symbols, M relationships, …";
    # grepping the words separately also matches the breakdown line's
    # "parsed 0 symbols", which is why this anchors on the summary shape.
    read -r _f syms rels < <(grep -o 'indexed [0-9,]* files, [0-9,]* symbols, [0-9,]* relationships' "$log" | tail -1 | sed 's/indexed //; s/ files,//; s/ symbols,//; s/ relationships//')
    res=$(grep -o 'resolved in [0-9]*ms' "$log" | tail -1 | grep -o '[0-9]*' || echo "-")
    enr=$(grep -o 'Enriched [0-9,]* relationships ([0-9,]* patterns) in [0-9]*ms' "$log" | tail -1 | sed 's/.*) in //; s/ms//' || echo "-")
    enr_n=$(grep -o 'Enriched [0-9,]* relationships' "$log" | tail -1 | grep -o '[0-9,]*' | tr -d , || echo "-")
    pat=$(grep -o 'patterns) in' "$log" | tail -1 >/dev/null && grep -o '([0-9,]* patterns)' "$log" | tail -1 | tr -d '(,)' | sed 's/ patterns//' || echo "-")
    gra=$(grep -o 'gravity in [0-9]*ms' "$log" | tail -1 | grep -o '[0-9]*' || echo "-")
    tnt=$(grep -o 'taint([0-9]*ms)' "$log" | tail -1 | grep -o '[0-9]*' || echo "-")
    ana=$(grep -o 'ANALYZE) in [0-9]*ms' "$log" | tail -1 | grep -o '[0-9]*' || echo "-")
    dang=$(grep -o '"danglingSources":[0-9]*' "$log" | tail -1 | grep -o '[0-9]*' || echo "-")
    load=$(sysctl -n vm.loadavg | tr -d '{}' | xargs | cut -d' ' -f1)
    printf 'tier=%-4s rep=%s files=%-4s secs=%-7s syms=%-6s rels=%-7s resolve_ms=%-6s enrich_ms=%-6s gravity_ms=%-5s taint_ms=%-5s analyze_ms=%-5s dangling=%-6s patterns=%-6s load1=%s\n' \
      "$n" "$r" "$files" "$secs" "${syms:-?}" "${rels:-?}" "$res" "$enr" "$gra" "$tnt" "$ana" "$dang" "$pat" "$load"
    echo "  db: $dd   log: $log"
    r=$((r + 1))
  done
done
