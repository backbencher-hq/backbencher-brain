/**
 * M14 ONTOLOGY — LUA. Label-shape and self-edge audit.
 *
 * ## Why this file exists
 *
 * The census answers "how many edges of each type", and a COUNT cannot see two of the
 * defects that matter most here:
 *
 *   1. A SELF-EDGE. `source === target` on a type relation states that a thing is
 *      related to itself. For `extends` that is not expressible in the language at
 *      all — no table is its own base — so every self-edge of a type relation is a
 *      fabricated edge, and a fabricated edge is what poisons `bb_graph`,
 *      `bb_impact` and `bb_migrate`. The census reported `extends` selfEdges = 2;
 *      this probe says WHICH two and on what source line.
 *
 *   2. A LABEL SHAPE that is not the shape the type is supposed to carry. A `uses`
 *      edge names a BARE name; a `references` edge names a MEMBER's own name; a
 *      `calls` edge names a CALLEE. An edge whose target is `a.b`, or contains a
 *      newline, or contains a space, is carrying a payload instead of a name, and
 *      every consumer that splits on `.` or looks the name up in a symbol table gets
 *      a miss it cannot explain. The census reported `references` labelShape as
 *      `{bare: 39399, other: 392, dotted: 90}` and had no way to say what those 482
 *      targets ARE.
 *
 * Both are cheap to measure and neither is measurable by reading the analyzer: they are
 * properties of the emitted SET, not of any one rule. That is why they live in a probe
 * and not in the analyzer.
 *
 * The third measurement is the placeholder literal. Rule R7 in
 * `validation/m60/ledger.json` forbids an edge endpoint equal to the literal
 * `unknown`. A corpus file may legitimately DECLARE a name `unknown`, in which case
 * the rule as written would convict a correct edge — so this probe counts them and
 * prints the source line, and the reader decides from the line rather than from the
 * count.
 *
 * Usage: npx tsx script/m60/lua-labelling-audit.ts [--cap N] [--out <path>]
 *        --cap bounds files PER REPO (default 0 = every tracked file).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const CAP = Number(arg("--cap", "0"))
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/labelling-audit.json")!)

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
/** The shape each type's TARGET is supposed to carry. A `uses` edge names a bare
 * name; `references` a member's own name; `calls` a callee name. `contains` and
 * `exports` are checked too — a `contains` target that is a path is as wrong as a
 * `uses` target that is one. */
const EXPECT_BARE: Record<Type, boolean> = {
  calls: true, uses: true, contains: true, imports: false, references: true,
  exports: true, extends: true, implements: true, overrides: true, instantiates: true,
}

const files: Array<{ repo: string; rel: string; abs: string }> = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of (CAP > 0 ? tracked.slice(0, CAP) : tracked)) files.push({ repo: e, rel, abs: path.join(dir, rel) })
}

interface SelfRow { occurrences: number; files: number; examples: string[] }
interface ShapeRow { occurrences: number; files: number; targets: Record<string, number>; examples: string[] }
const self = new Map<Type, SelfRow>(ALL_TYPES.map((t) => [t, { occurrences: 0, files: 0, examples: [] }]))
const shape = new Map<Type, ShapeRow>(ALL_TYPES.map((t) => [t, { occurrences: 0, files: 0, targets: {}, examples: [] }]))
const selfFiles = new Map<Type, Set<string>>(ALL_TYPES.map((t) => [t, new Set()]))
const shapeFiles = new Map<Type, Set<string>>(ALL_TYPES.map((t) => [t, new Set()]))
const placeholder: Array<{ type: string; side: string; label: string; line: number; sourceLine: string }> = []
const classify = (t: string): string => {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return "bare"
  if (t.includes("\n")) return "multiline"
  if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(t)) return "dotted"
  if (/^[A-Za-z_][A-Za-z0-9_]*:[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return "colon"
  if (t.includes("(") || t.includes(" ")) return "payload"
  return "other"
}

let parsed = 0
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let text: string
    try {
      if (statSync(f.abs).size > 512 * 1024) continue
      text = readFileSync(f.abs, "utf8")
    } catch { continue }
    let r: any
    try { r = await parseFile(f.abs, path.join(CR, f.repo)) } catch { continue }
    parsed++
    const lines = text.split("\n")
    for (const rel of r.relationships ?? []) {
      const t = String(rel?.type ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const src = String(rel?.source ?? "")
      const tgt = String(rel?.target ?? "")
      const ln = typeof rel?.line_number === "number" ? rel.line_number : 0
      if (src === tgt) {
        const row = self.get(t)!
        row.occurrences++
        selfFiles.get(t)!.add(label)
        if (row.examples.length < 20) row.examples.push(`${label}:${ln} ${src} -[${t}]-> ${tgt}  | ${(lines[ln - 1] ?? "").trim().slice(0, 100)}`)
      }
      if (src === "unknown" || tgt === "unknown") {
        if (placeholder.length < 40) placeholder.push({
          type: t, side: src === "unknown" ? "source" : "target", label, line: ln,
          sourceLine: (lines[ln - 1] ?? "").trim().slice(0, 100),
        })
      }
      const sh = classify(tgt)
      if (EXPECT_BARE[t] && sh !== "bare") {
        const row = shape.get(t)!
        row.occurrences++
        shapeFiles.get(t)!.add(label)
        row.targets[sh] = (row.targets[sh] ?? 0) + 1
        if (row.examples.length < 20) row.examples.push(`${label}:${ln} -[${t}]-> ${JSON.stringify(tgt).slice(0, 70)} (${sh})  | ${(lines[ln - 1] ?? "").trim().slice(0, 90)}`)
      }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

for (const t of ALL_TYPES) { self.get(t)!.files = selfFiles.get(t)!.size; shape.get(t)!.files = shapeFiles.get(t)!.size }

const out = {
  schemaVersion: 1,
  kind: "lua_labelling_audit",
  at: new Date().toISOString(),
  commit: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  corpus: { root: CR, filesParsed: parsed, capPerRepo: CAP, sampling: "every tracked *.lua, sorted, no cap" },
  selfEdges: Object.fromEntries([...self].map(([k, v]) => [k, v])),
  nonBareTargets: Object.fromEntries([...shape].map(([k, v]) => [k, v])),
  placeholderLiteralEndpoints: placeholder,
  reading: [
    "A self-edge on a TYPE relation is not expressible in the language, so every one listed here is a fabricated edge. A self-edge on `calls`/`uses` is different: `local f = function() f() end` really is self-referential, and the count is reported so the two are not conflated.",
    "`imports` is excluded from the bare check because its target is a module-path STRING by design (`kong.tools.ip`), and `exports` is included because its target is a name a chunk returns.",
  ],
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log(`labelling audit — ${parsed} files parsed through parseFile`)
console.log("")
console.log(`${"type".padEnd(14)}${"selfEdges".padStart(11)}${"files".padStart(8)}${"nonBareTgt".padStart(12)}${"files".padStart(8)}  shapes`)
for (const t of ALL_TYPES) {
  const s = self.get(t)!
  const h = shape.get(t)!
  console.log(
    `${t.padEnd(14)}${String(s.occurrences).padStart(11)}${String(s.files).padStart(8)}${String(h.occurrences).padStart(12)}${String(h.files).padStart(8)}  ${JSON.stringify(h.targets)}`,
  )
}
console.log("")
for (const [t, s] of self) {
  if (!s.occurrences || !["extends", "implements", "overrides", "instantiates", "contains", "exports"].includes(t)) continue
  console.log(`self-edges, ${t} (${s.occurrences} in ${s.files} files) — a type relation to itself is not expressible:`)
  for (const e of s.examples.slice(0, 8)) console.log(`  ${e}`)
}
for (const [t, h] of shape) {
  if (!h.occurrences) continue
  console.log(`non-bare targets, ${t} (${h.occurrences} in ${h.files} files):`)
  for (const e of h.examples.slice(0, 6)) console.log(`  ${e}`)
}
if (placeholder.length) {
  console.log(`placeholder-literal endpoints (rule R7): ${placeholder.length}`)
  for (const p of placeholder.slice(0, 10)) console.log(`  ${p.side} of a ${p.type} edge at ${p.label}:${p.line}  | ${p.sourceLine}`)
}
console.log(`\nartifact: ${path.relative(ROOT, OUT)}`)