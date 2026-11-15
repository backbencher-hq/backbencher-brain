#!/usr/bin/env bash
# Index-lock behaviour through the REAL MCP stdio door. ONE bash invocation holds the
# holder and the MCP server child in the same pid namespace; a holder started in a
# different tool call is in a different namespace and is therefore (correctly) judged
# dead by the lock — that boundary is itself worth recording.
set -u
cd "$(dirname "$0")/../../../.."
export BB_DATA_DIR="$PWD/validation/tools/bb_index/bbdata"
export BB_NO_AUTO_REFRESH=1
FIXTURE="$PWD/validation/tools/bb_index/work/vendor-fixture"
AUD="$PWD/validation/tools/bb_index/audit"
PID="$(ls "$BB_DATA_DIR/projects" | grep 069354f5)"
LOCK="$BB_DATA_DIR/projects/$PID/.index.lock"
mkdir -p "$AUD"

probe() { # cases-file out-name [env-prefix]
  npx tsx validation/tools/bb_index/probe-mcp.ts "$FIXTURE" "$1" "$AUD/$2" > "$AUD/$2.log" 2>&1
  node -e '
const j=require(process.argv[1]);
for(const c of j.cases) console.log("  ->", c.label, "| isError="+c.isError, "| "+c.ms+"ms |", String(c.text||c.protocolError||"").replace(/\s+/g," ").slice(0,300))
' "$AUD/$2"
}

cat > /tmp/case-refuse.json <<'JSON'
[
 {"label":"file mode while live holder","arguments":{"path":"src/main.ts"}},
 {"label":"dir mode with a changed candidate while live holder","setup":{"write":{"path":"src/main.ts","content":"import { formatVendored } from \"./vendor/format\"\nexport function MAIN_FN(x: number): number {\n  return formatVendored(x) + 2\n}\n"}},"arguments":{"path":".","mode":"dir"}}
]
JSON
cat > /tmp/case-one.json <<'JSON'
[{"label":"file mode","arguments":{"path":"src/main.ts"}}]
JSON

echo "== A. LIVE holder (same pid namespace) =="
npx tsx validation/tools/bb_index/work/hold-lock.ts "$PID" > /tmp/holder-live.log 2>&1 &
HOLDER_WRAPPER=$!
for i in $(seq 1 60); do grep -q LOCKED /tmp/holder-live.log 2>/dev/null && break; sleep 0.5; done
grep LOCKED /tmp/holder-live.log
echo "lockfile: $(cat "$LOCK" 2>/dev/null)"
probe /tmp/case-refuse.json door-lock-live.json

echo "== B. holder SIGKILLed -> stale lock reclaimed =="
pkill -9 -f "hold-lock.ts $PID" 2>/dev/null
kill -9 "$HOLDER_WRAPPER" 2>/dev/null
sleep 1
echo "stale lockfile present: $(test -f "$LOCK" && echo yes || echo no) :: $(cat "$LOCK" 2>/dev/null)"
probe /tmp/case-one.json door-lock-stale.json

echo "== C. malformed lock payload, fresh (grace window raised so staleness cannot race the MCP start) -> refused =="
printf '{}' > "$LOCK"
BB_INDEX_LOCK_GRACE_MS=600000 probe /tmp/case-one.json door-lock-malformed-fresh.json
echo "  lockfile after refusal: $(cat "$LOCK" 2>/dev/null)"

echo "== D. malformed lock payload, aged past the default 10s grace -> reclaimed =="
printf '{}' > "$LOCK"
touch -d '-20 seconds' "$LOCK"
probe /tmp/case-one.json door-lock-malformed-old.json

echo "== E. FOREIGN-HOST lock, fresh -> refused (named host + TTL remedy) =="
printf '{"schemaVersion":2,"pid":999999,"host":"other-machine","token":"t","startedAt":%s,"kind":"index"}' "$(date +%s000)" > "$LOCK"
probe /tmp/case-one.json door-lock-foreign-fresh.json

echo "== F. FOREIGN-HOST lock, aged past the 24h TTL -> reclaimed =="
printf '{"schemaVersion":2,"pid":999999,"host":"other-machine","token":"t","startedAt":%s,"kind":"index"}' "$(date +%s000)" > "$LOCK"
touch -d '-25 hours' "$LOCK"
probe /tmp/case-one.json door-lock-foreign-old.json

echo "== G. FUTURE-SCHEMA lock, fresh -> refused =="
printf '{"schemaVersion":99,"pid":999999,"host":"pop-os","token":"t","startedAt":%s,"kind":"index"}' "$(date +%s000)" > "$LOCK"
probe /tmp/case-one.json door-lock-future-fresh.json

echo "== H. successful run leaves no lockfile of its own =="
echo "lockfile present after G: $(test -f "$LOCK" && echo yes || echo no) (future-schema lock stays by design)"
echo "LOCK MATRIX DONE"
