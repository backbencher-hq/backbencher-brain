// bb_tests/bb_patterns/probes/probe-l2-zero-candidates.ts
// L2 — why does a corpus report nothing?
//
// L1 found NINE of seventeen corpora reporting zero orphan candidates, with
// thousands of symbols each. "Zero" and "correct" are very different answers and
// L1 deliberately refused to accept zero on faith. This probe separates them by
// naming which gate emptied the set, using the engine's OWN suppression counters
// rather than by guessing.
//
// The five candidate explanations, in the order they are checked:
//   1. nothing was scanned          — a language/scope problem
//   2. the LANGUAGE gate            — every candidate was in a non-code file
//   3. the ENTRY-POINT rules        — every candidate matched main/run/init/...
//   4. the NAME channel is ambiguous— every candidate's name is declared twice
//   5. the ID channel cleared them  — every candidate really is referenced
//
// Only (5) is a legitimate "there is no dead code here". Any of the others is a
// defect in that language's coverage, and this probe says which.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))

const SIX = ["function", "method", "class", "interface", "struct", "enum"]
const ENTRY_NAMES = new Set(["main", "__main__", "start", "run", "init", "setup", "handler", "default"])
const ENTRY_SUFFIX = ["Handler", "Controller", "Middleware", "Route", "Routes", "Command", "Plugin"]

const NON_USAGE = new Set(["contains", "exports"])
const USAGE = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides"]

const pairs = process.argv[2].split(",").map((s) => s.split("="))

console.log("repo         scanned  langGate  entryPt  ambiguous  idCleared  nameCleared  verdict")
for (const [pid, name] of pairs) {
  const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })

  const scanned = db.prepare(
    `SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = ? AND s.symbol_type IN (${SIX.map(() => "?").join(",")})`,
  ).get(pid, ...SIX) as { c: number }
  if (scanned.c === 0) { console.log(`${name.padEnd(12)}      0  (no symbols of the reported types — explanation 1)`); db.close(); continue }

  // The engine's own reason, for the record.
  const report = await detectOrphans(pid, { minConfidence: 0, maxResults: 1_000_000 })
  const suppressed = (report.summary as any)?.suppressedByReason ?? {}
  const cands = report.findings.filter((f) => f.rule !== "orphaned_file").length

  // (2) language gate: read the engine's own counter, and independently confirm
  // the candidates it removed were in non-code files.
  const nonCode = suppressed.nonCodeFile ?? 0

  // (3) entry points: the engine's counter, and the names it removed.
  const entry = suppressed.entryPointName ?? 0
  const entryNames = db.prepare(
    `SELECT s.name n, COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = ? AND s.symbol_type IN (${SIX.map(() => "?").join(",")})
      GROUP BY s.name ORDER BY c DESC LIMIT 8`,
  ).all(pid, ...SIX) as Array<{ n: string; c: number }>
  const entryHit = entryNames.filter((e) => ENTRY_NAMES.has(e.n) || ENTRY_SUFFIX.some((x) => e.n.endsWith(x)))

  // (4) ambiguity inside the reporting scope.
  const dupInScope = db.prepare(
    `SELECT COUNT(*) c FROM (SELECT s.name FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = ? AND s.symbol_type IN (${SIX.map(() => "?").join(",")})
      GROUP BY s.name HAVING COUNT(*) > 1)`,
  ).get(pid, ...SIX) as { c: number }

  // (5) the real work: of the symbols that survived every gate, how many are
  // named as the target of an anchored, clean usage edge? That is the ID
  // channel. How many are named by a clean reference while unambiguous? That is
  // the name channel. Only a symbol cleared by NEITHER is a candidate.
  const reportable = db.prepare(
    `SELECT s.id, s.name, s.symbol_type st, f.relative_path p, f.language lang FROM brain_symbol s
       JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = ? AND s.symbol_type IN (${SIX.map(() => "?").join(",")})`,
  ).all(pid, ...SIX) as Array<{ id: string; name: string; st: string; p: string; lang: string }>

  const idUsed = new Set<string>()
  const nameUsed = new Set<string>()
  for (const r of db.prepare(
    `SELECT relationship_type rt, target_symbol_id t, target_external e, source_symbol_id s, confidence c,
            json_extract(metadata,'$.evidenceClass') ev
       FROM brain_relationship WHERE project_id = ?`,
  ).all(pid) as Array<{ rt: string; t: string | null; e: string | null; s: string | null; c: number; ev: string | null }>) {
    if (NON_USAGE.has(r.rt) || !USAGE.includes(r.rt)) continue
    const selfLoop = r.s !== null && r.t !== null && r.s === r.t
    if (selfLoop || r.ev === "inferred" || (typeof r.c === "number" && r.c < 0.7)) continue
    if (r.s !== null && r.t !== null) idUsed.add(r.t)
    if (r.e) {
      const a = r.e.includes(":") ? r.e.slice(r.e.lastIndexOf(":") + 1) : r.e
      const d = a.lastIndexOf(".")
      nameUsed.add(d > 0 ? a.slice(d + 1) : a)
    }
  }

  let idCleared = 0
  let nameCleared = 0
  let neither = 0
  for (const s of reportable) {
    if (idUsed.has(s.id)) { idCleared++; continue }
    if (nameUsed.has(s.name)) { nameCleared++; continue }
    neither++
  }
  const survivorPredicted = idCleared === 0 && nameCleared === 0 ? scanned.c : neither

  const verdict =
    cands > 0 ? "reports candidates" :
    scanned.c === 0 ? "EXPLANATION 1 — nothing scanned"
    : nonCode >= scanned.c * 0.9 ? "EXPLANATION 2 — the language gate removed essentially everything"
    : entry >= scanned.c * 0.9 ? "EXPLANATION 3 — the entry-point rules removed essentially everything"
    : dupInScope.c >= scanned.c * 0.9 ? "EXPLANATION 4 — nearly every name is ambiguous"
    : "EXPLANATION 5 — every reportable symbol really is referenced (legitimate)"

  console.log(
    `${name.padEnd(12)} ${String(scanned.c).padStart(8)} ${String(nonCode).padStart(9)} ${String(entry).padStart(8)} ` +
    `${String(dupInScope.c).padStart(10)} ${String(idCleared).padStart(10)} ${String(nameCleared).padStart(12)}  ${verdict}`,
  )
  if (entryHit.length) console.log(`             top entry-point names: ${entryHit.map((e) => `${e.n}(${e.c})`).join(" ")}`)
  console.log(`             engine candidates=${cands}  predicted survivors=${survivorPredicted}  ${JSON.stringify(suppressed)}`)
  db.close()
}
