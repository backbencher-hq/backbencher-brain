/**
 * Does the index run REPORT what happened to embeddings?
 *
 * Measured gap behind this gate:
 *
 *  - `backgroundEmbedMetrics` (queued/embedded/failed/skipped/dropped) is
 *    incremented in parallel-indexer.ts and read NOWHERE else — not in the CLI,
 *    not in the summary, not in `bb status`. A run can fail to embed every
 *    single vector and the user sees "✓ indexed N files".
 *
 *  - A single index can contain vectors from MORE THAN ONE model. Measured by
 *    co-agent 2: 100 rows `mock-1536d`/1536 plus 160 rows
 *    `local-word-vectors-v3`/50, written in one run after the provider died
 *    mid-run. `bb_ask` reads the index using the LAST model label, so the API
 *    vectors become invisible — and nothing says so at index time.
 *
 * Both are silent failures of the kind this repo's honesty gates exist to catch:
 * a real condition with no number and no line on screen.
 *
 * This gate is RED until the product reports them. That is intentional — see the
 * report requirements at the bottom.
 */

import { DatabaseSync } from "node:sqlite"
import { existsSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from "fs"
import { tmpdir, homedir } from "os"
import path from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")
const NODE_BIN = "/private/var/folders/4j/11tssyqj4kj0f8dfz06jsb700000gn/T/opencode/bb-runtime/node-v22.23.3-darwin-x64/bin"

let failures = 0
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok: ${name}`)
  else {
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
    failures++
  }
}

// ── 1. the summary must account for embeddings ───────────────────────────────
//
// NOTE ON METHOD: this gate's first version asserted on SOURCE TEXT —
// /embed(?:ded|Outcome|Coverage)\s*[?]?:/ — which is a guess at an identifier
// name, not a measurement. It stayed red after the feature was implemented and
// verified working end to end. Asserting on behaviour instead: run the CLI and
// require that it SAYS things about embeddings. A rename cannot make that pass,
// and a removed feature cannot make it pass either.
console.log("A1. the run summary accounts for embeddings")
const fxEarly = mkdtempSync(path.join(tmpdir(), "bb-embedrep-"))
writeFileSync(
  path.join(fxEarly, "a.ts"),
  "export function alpha(){return 1}\nexport class Beta{ go(){return alpha()} }\n",
)
const earlyOut = (() => {
  try {
    return execFileSync("node", [path.join(ROOT, "bin", "bb"), "index", fxEarly, "--no-setup"], {
      cwd: fxEarly,
      encoding: "utf8",
      env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: any) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
})()
check(
  "the CLI names the embedding model in use",
  /embeddings:\s*\S+/i.test(earlyOut) || /embedding model/i.test(earlyOut),
  earlyOut.split("\n").filter((l) => /embed/i.test(l)).join(" | ").slice(0, 240),
)
try { rmSync(fxEarly, { recursive: true, force: true }) } catch {}

// ── 2. a mixed-model index must be detectable and reported ────────────────────
console.log("\nA2. a multi-model index is detected rather than silently misread")

const fx = mkdtempSync(path.join(tmpdir(), "bb-embedmodels-"))
const dbDir = path.join(fx, ".bb-test")
writeFileSync(
  path.join(fx, "a.ts"),
  "export function alpha(){return 1}\nexport class Beta{ go(){return alpha()} }\n",
)

function runIndex(args: string[]): string {
  try {
    return execFileSync("node", [path.join(ROOT, "bin", "bb"), ...args], {
      cwd: fx,
      encoding: "utf8",
      env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, BB_DATA_DIR: dbDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: any) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
}

const out = runIndex(["index", fx, "--no-setup"])
check("a plain index run succeeds", /indexed|nothing to index/.test(out), out.slice(-200))

// Plant a second model by direct insert — the exact shape co-agent 2 measured.
//
// The index above ran with BB_DATA_DIR pointing at this fixture, so its database
// is under <dbDir>/projects/<id>/brain.db. Locate it there FIRST; the home
// directory is only a fallback. (The first version searched the home dir only,
// because it read process.env.BB_DATA_DIR — the parent's value — instead of the
// per-call override, and so silently skipped this check.)
let dbPath = ""
try {
  // Use the imported bindings. An earlier version called require("fs")/require("os")
  // inline, which throws inside an ES module — the catch swallowed it and the
  // gate reported "could not locate the database" for reasons that had nothing
  // to do with the database.
  const candidateDirs = [
    path.join(dbDir, "projects"),
    path.join(homedir(), ".bb", "projects"),
  ]
  for (const d of candidateDirs) {
    if (!existsSync(d)) continue
    for (const p of readdirSync(d)) {
      const cand = path.join(d, p, "brain.db")
      if (!existsSync(cand)) continue
      try {
        const db = new DatabaseSync(cand, { readOnly: true })
        const n = (db.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any).c
        db.close()
        if (n > 0) { dbPath = cand; break }
      } catch {}
    }
    if (dbPath) break
  }
} catch (e: any) {
  console.log(`  (db discovery threw: ${e?.message})`)
}

check("the index database was located for the mixed-model check", dbPath !== "", dbPath)

if (dbPath === "") {
  console.log(
    "  (could not locate the brain.db for this project — skipping the mixed-model check)",
  )
}

if (dbPath) {
  // Insert a second-model row directly, mirroring the measured incident.
  try {
    const db = new DatabaseSync(dbPath)
    const pid = (db.prepare("SELECT project_id p FROM brain_symbol LIMIT 1").get() as any)?.p
    const now = Date.now()
    const v1536 = JSON.stringify(new Array(1536).fill(0.01))
    const blob = Buffer.alloc(1536 * 4)
    const cols = db.prepare("PRAGMA table_info(brain_semantic_embedding)").all() as any[]
    const hasBlob = cols.some((c) => c.name === "embedding_blob")
    if (hasBlob) {
      db.prepare(
        `INSERT OR REPLACE INTO brain_semantic_embedding
         (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, embedding_blob, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run("mixed:probe", pid, "mixed:entity", "symbol", "mock-1536d", v1536, blob, 1536, "h", "{}", 0.7, now, now, now)
    } else {
      db.prepare(
        `INSERT OR REPLACE INTO brain_semantic_embedding
         (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run("mixed:probe", pid, "mixed:entity", "symbol", "mock-1536d", v1536, 1536, "h", "{}", 0.7, now, now, now)
    }
    const models = db
      .prepare("SELECT embedding_model m, vector_dimension d, COUNT(*) n FROM brain_semantic_embedding GROUP BY 1,2")
      .all() as any[]
    db.close()
    check(
      "the fixture really contains more than one embedding model",
      models.length > 1,
      `models=${JSON.stringify(models)}`,
    )
  } catch (e: any) {
    check("the fixture really contains more than one embedding model", false, e?.message)
  }

  // THE ASSERTION THAT MATTERS: a subsequent run must SAY SO.
  const out2 = runIndex(["index", fx, "--changed", "--no-setup"])
  // Match the product's actual wording, and accept the health path as an
  // alternative. This previously grepped for "more than one model" while the
  // implementation says "index holds N embedding models", so the gate stayed
  // red against working code. Match on the MEANING — a model count greater than
  // one — rather than one phrasing.
  const mentionsMixed =
    /index holds\s+[2-9]\d*\s+embedding models/i.test(out2) ||
    /(?:more than one|multiple)\s+(?:embedding\s+)?models?/i.test(out2) ||
    /index holds\s+[2-9]\d*\s+embedding models/i.test(runIndex(["health", fx]))
  check(
    "a mixed-model index is REPORTED, not silently misread by bb_ask",
    mentionsMixed,
    "no output names a second embedding model; `bb_ask` reads the index with the last " +
      "model label, so the other model's vectors become invisible with nothing on screen saying so. " +
      `Got: ${out2.split("\n").filter((l) => /embed|model/i.test(l)).join(" | ").slice(0, 200)}`,
  )
}

try { rmSync(fx, { recursive: true, force: true }) } catch {}

console.log(
  `\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`} — embedding outcome reporting`,
)
if (failures > 0) {
  console.log(
    "\nRequired product change (master-owned, src/ast/parallel-indexer.ts):",
  )
  console.log("  1. Put backgroundEmbedMetrics on the run summary (embedded/failed/skipped/dropped).")
  console.log("  2. After a run, count DISTINCT embedding_model values in brain_semantic_embedding;")
  console.log("     if > 1, say so and name each model and its share, because bb_ask will read the")
  console.log("     index with a single model label and silently ignore the rest.")
  console.log("  3. Surface both in the CLI summary (src/cli/index.ts).")
}
if (failures > 0) process.exitCode = 1
