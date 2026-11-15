#!/usr/bin/env bash
# Repro for the dir-mode deletion guard, on an isolated fixture and data dir.
# BEFORE: a dir reindex inferred deletion from walk absence and purged vendor/.
# AFTER:  a row is deleted only when the file is gone from disk, and vendor is walked
#         because discovery indexes it. The index must equal the tree: 3 files, 3 files.
set -u
cd "$(dirname "$0")/../../../.."
export BB_DATA_DIR="$PWD/validation/tools/bb_index/bbdata"
export BB_NO_AUTO_REFRESH=1
FIX="$PWD/validation/tools/bb_index/work/vendor-fixture"
AUD="$PWD/validation/tools/bb_index/audit"
mkdir -p "$FIX/src/vendor" "$FIX/vendor/lib"
write_tree() {
  printf 'import { formatVendored } from "./vendor/format"\nexport function MAIN_FN(x: number): number {\n  return formatVendored(x)\n}\n' > "$FIX/src/main.ts"
  printf 'export function formatVendored(x: number): string {\n  return String(x)\n}\n' > "$FIX/src/vendor/format.ts"
  printf 'export function VENDORED_HELPER_SYM(x: number): number {\n  return x + 1\n}\n' > "$FIX/vendor/lib/helper.ts"
}
write_tree
PID="$(npx tsx -e 'import { getProjectId } from "./src/cli/index"; console.log(getProjectId(process.argv[1]))' "$FIX" 2>/dev/null | tail -1)"
rm -rf "$BB_DATA_DIR/projects/$PID"
echo "== index the tree (full CLI door) =="
npx tsx src/cli/index.ts index "$FIX" > "$AUD/vendor-full-index.log" 2>&1 || { echo "INDEX FAILED"; tail -5 "$AUD/vendor-full-index.log"; exit 1; }
npx tsx validation/tools/bb_index/work/dbstate.ts "$FIX" VENDORED > "$AUD/vendor-state-before-dir.json" 2>/dev/null
echo "index before dir reindex: $(grep -c '"name"' "$AUD/vendor-state-before-dir.json") symbol matches; $(grep '"files"' "$AUD/vendor-state-before-dir.json" | head -1)"
cat > /tmp/case-vendor-fix.json <<'JSON'
[{"label":"dir reindex of the project root after editing one file (vendor tree present)","setup":{"write":{"path":"src/main.ts","content":"import { formatVendored } from \"./vendor/format\"\nexport function MAIN_FN(x: number): number {\n  return formatVendored(x) + 1\n}\n"}},"arguments":{"path":".","mode":"dir"}}]
JSON
npx tsx validation/tools/bb_index/probe-mcp.ts "$FIX" /tmp/case-vendor-fix.json "$AUD/door-vendor-after-fix.json" > "$AUD/door-vendor-after-fix.log" 2>&1
echo "dir answer: $(node -e 'const j=require(process.argv[1]); const t=j.cases[0].text; console.log(t.replace(/\s+/g," ").slice(0,300))' "$AUD/door-vendor-after-fix.json")"
npx tsx validation/tools/bb_index/work/dbstate.ts "$FIX" VENDORED > "$AUD/vendor-state-after-dir.json" 2>/dev/null
echo "index after dir reindex: $(cat "$AUD/vendor-state-after-dir.json" | tr -d '\n' | head -c 700)"
node -e '
const before=require(process.argv[1]); const after=require(process.argv[2]); const door=require(process.argv[3]);
const ans=JSON.parse(door.cases[0].text);
const ok = after.files === 3 && after.matches.length === 2 && ans.deleted === 0;
console.log(JSON.stringify({beforeFiles:before.files, afterFiles:after.files, vendorMatchesAfter:after.matches.map((m:any)=>m.name), dirAnswer:{candidates:ans.candidates,processed:ans.processed,deleted:ans.deleted,outcome:ans.outcome}, PASS: ok}, null, 1));
process.exit(ok?0:1)' "$AUD/vendor-state-before-dir.json" "$AUD/vendor-state-after-dir.json" "$AUD/door-vendor-after-fix.json"
