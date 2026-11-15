// bb_tests/bb_patterns/probes/probe-p7-godclass-scaling.mjs
// P7 — how the god-class rule's cost scales, and what a rewrite buys.
//
// P6 established the plan: the shipped query resolves
// `m.owner_symbol_id = s.id` with
//
//     SEARCH m USING INDEX brain_sym_proj_type_idx (project_id=?) LEFT-JOIN
//
// i.e. it does NOT use brain_symbol_owner_idx, which exists for exactly that
// predicate. The member count therefore costs |candidate types| x |all symbols
// in the project| row visits. On backbencher-brain (45,018 symbols) that is
// ~158M visits and it did not finish in 10 minutes, on the default path of a
// tool whose includeAntiPatterns defaults to true.
//
// Rather than quote one unbounded number, this measures the shipped query and
// four rewrites across every real repository available, and checks the
// rewrites return the SAME rows before any of them is proposed as a fix.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const TYPES = "'class','interface','struct','trait','enum'"

const shipped = `
  SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, COUNT(m.id) AS members
  FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
  LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id AND m.project_id = s.project_id
  WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
  GROUP BY s.id HAVING COUNT(m.id) > 10 ORDER BY members DESC`

const rewrites = [
  ["B no redundant m.project_id", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, COUNT(m.id) AS members
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    GROUP BY s.id HAVING COUNT(m.id) > 10 ORDER BY members DESC`, 1],
  ["C correlated COUNT over owner index", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line,
           (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) AS members
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
      AND (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) > 10
    ORDER BY members DESC`, 1],
  ["D pre-aggregate members then join", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, agg.members
    FROM (SELECT owner_symbol_id AS oid, COUNT(*) AS members FROM brain_symbol
           WHERE owner_symbol_id IS NOT NULL GROUP BY owner_symbol_id HAVING COUNT(*) > 10) agg
    JOIN brain_symbol s ON s.id = agg.oid
    JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    ORDER BY agg.members DESC`, 1],
  ["E pre-aggregate scoped to project", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, agg.members
    FROM (SELECT owner_symbol_id AS oid, COUNT(*) AS members FROM brain_symbol
           WHERE project_id = ? AND owner_symbol_id IS NOT NULL GROUP BY owner_symbol_id HAVING COUNT(*) > 10) agg
    JOIN brain_symbol s ON s.id = agg.oid
    JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    ORDER BY agg.members DESC`, 2],
]

const REPOS = [
  ["lodash", "d039ac4f840b536081414d0fc287a1e3fd7e80ee"],
  ["rake", "46899d917deda24dd6a87aa99272878828b5cc94"],
  ["luarocks", "59a0901a13fcda04595a0813f3770598b4b9f633"],
  ["clyde", "833a9b16d03d794e6d3c93c6faace310b2fab523"],
  ["mojo", "ca5208e8e9ec7e310da7a799655bf5dcdfb1a3d4"],
  ["rebar3", "f213db69a303c1cc62a974e69eaeb81d6f2da47d"],
  ["ripgrep", "98957b6e63fb89df308a2d264c8e4d86a0eebf9a"],
  ["clojure", "78cdd571a4cbfa21b686996fbb9167230d68fea0"],
  ["backbencher", "818db37d8f54173ad1357ab24627373da2e9418c"],
]

// Wall-clock ceiling for the SHIPPED query only, so the sweep terminates on the
// large repos instead of hanging. The rewrite timings are all bounded.
const SHIPPED_CAP_MS = Number(process.env.BB_SHIPPED_CAP_MS ?? 20000)

const open = (pid) => new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })

const keyOf = (rows) => rows.map((r) => `${r.name}@${r.members}`).sort().join("|")

console.log("repo\tsymbols\tclasses\tshipped\t" + rewrites.map((r) => r[0].split(" ")[0]).join("\t") + "\tagree")
for (const [label, pid] of REPOS) {
  const db = open(pid)
  const syms = db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(pid).c
  const classes = db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND symbol_type IN (${TYPES})`).get(pid).c

  let shippedMs = -1
  let shippedRows = 0
  let shippedErr = ""
  {
    const t0 = process.hrtime.bigint()
    // A child process is the only way to bound a runaway statement: better-sqlite3
    // runs SQLite on the same thread, so an in-process timer cannot fire.
    const { execFileSync } = await import("node:child_process")
    const { fileURLToPath } = await import("node:url")
    // fileURLToPath, not new URL(...).pathname: this directory contains a space
    // ("Default Project") and pathname leaves it percent-encoded, so the child
    // was spawned against a path that does not exist and every run reported
    // "command failed" instead of a timing. That mistake produced a full sweep
    // of meaningless numbers before it was caught.
    const child = fileURLToPath(new URL("./_one.mjs", import.meta.url))
    try {
      const out = execFileSync(process.execPath, [child, pid, "shipped"], { timeout: SHIPPED_CAP_MS, encoding: "utf8" })
      const parsed = JSON.parse(out)
      shippedMs = parsed.ms
      shippedRows = parsed.n
    } catch (e) {
      shippedMs = -1
      shippedErr = e.killed || e.signal === "SIGTERM" ? `>${SHIPPED_CAP_MS / 1000}s` : String(e.message).slice(0, 40)
    }
    void t0
  }

  const times = []
  const keys = []
  for (const [, sql, nparams] of rewrites) {
    const params = nparams === 2 ? [pid, pid] : [pid]
    const t0 = process.hrtime.bigint()
    const rows = db.prepare(sql).all(...params)
    times.push((Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0))
    keys.push(keyOf(rows))
  }
  const agree = keys.every((k) => k === keys[0]) ? "rewrites agree" : "REWrites DISAGREE"
  console.log(`${label}\t${syms}\t${classes}\t${shippedMs < 0 ? shippedErr : shippedMs + "ms/" + shippedRows + "r"}\t${times.join("\t")}\t${agree}`)
  db.close()
}
