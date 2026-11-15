#!/usr/bin/env bash
# Build a T2-scale reproduction copy of the workspace index inside our isolated
# BB_DATA_DIR: same project/rows, symbols raised from 310,423 to 1,283,638 so the
# per-symbol aggregate cost the known defect describes is exercised at the
# campaign's reference scale. The source index is only read (cp), never opened.
set -euo pipefail
REPO="/home/ishaq2321/mcp/backbencher-brain"
PID="1d3d57103be91b8f9716d70199fe28a3f39245d9"
SRC="$REPO/.bb-data/projects/$PID/brain.db"
DST_ROOT="$REPO/validation/tools/bb_health/bbdata/projects/$PID"
DST="$DST_ROOT/brain.db"
[ -f "$SRC" ] || { echo "missing source index: $SRC"; exit 1; }
case "$DST_ROOT" in
  "$REPO"/validation/tools/bb_health/bbdata/projects/*) ;;
  *) echo "refusing to remove unexpected path: $DST_ROOT"; exit 1;;
esac
if [ ! -f "$DST" ] || [ "${BB_REBUILD_SCALE:-0}" = "1" ]; then
  rm -rf "$DST_ROOT"
  mkdir -p "$DST_ROOT"
  cp "$SRC" "$DST"
  node - "$DST" "$PID" <<'NODE'
const Database = require("/home/ishaq2321/mcp/backbencher-brain/node_modules/better-sqlite3")
const [dbPath, pid] = process.argv.slice(2)
const db = new Database(dbPath)
const t0 = Date.now()
for (const t of ["bb_content_fts_symbol_insert", "bb_content_fts_symbol_update", "bb_content_fts_symbol_delete"]) {
  try { db.exec(`DROP TRIGGER IF EXISTS ${t}`) } catch {}
}
const cur = Number(db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid).c)
const want = Number(process.env.BB_TARGET_SYMBOLS ?? 1283638)
const add = Math.max(0, want - cur)
console.log(`symbols now=${cur} target=${want} inserting=${add}`)
if (add > 0) {
  const fileId = String(db.prepare("SELECT id FROM brain_file WHERE project_id=? LIMIT 1").get(pid).id)
  const sql = `INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, gravity_score)
    SELECT '${pid}:scale:'||v, '${pid}', '${fileId}', 'scaleFn'||v, 'scaleFn'||v,
           CASE v%4 WHEN 0 THEN 'function' WHEN 1 THEN 'class' WHEN 2 THEN 'method' ELSE 'property' END,
           v%500+1, v%500+2, 0.5
    FROM (WITH RECURSIVE c(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM c WHERE v < ${add}) SELECT v FROM c)`
  db.exec(sql)
}
db.exec("ANALYZE")
console.log(`symbols total=${db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid).c} buildMs=${Date.now() - t0}`)
db.close()
NODE
fi
ls -la "$DST"
