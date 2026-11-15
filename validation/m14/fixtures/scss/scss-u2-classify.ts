/**
 * SCSS U2 CLASSIFIER — what the 861 "declared nowhere" targets actually ARE.
 *
 * ## The question this exists to answer
 *
 * `scss-incoming-audit.ts` splits the window's unresolved targets into U1 (declared in a
 * file outside the 600-file window — a sampling artifact, not a defect) and U2 (published
 * by NO file in the 4,433 walked). It measured U2 at 861 edges over 394 distinct names and
 * printed the top 40. A top-40 list is not a verdict: it contains, in one table, a CSS
 * custom property (`--color-border-default`), a Sass module path (`./placeholders`) and a
 * bare identifier (`card`), and those three have three different owners. Only one of them
 * is this lane's to repair, and the split cannot be read off a frequency list because the
 * largest single shape happens to be the one no analyzer could ever resolve.
 *
 * So this file classifies every U2 target by SHAPE and by the evidenceClass the producing
 * edge carries, and prints the cross-tabulation. The shapes:
 *
 *   MODULE-PATH   starts `.`, or contains `/`. This is the argument of `@use`/`@forward`/
 *                 `@import` — a filesystem path, not a declaration name. No symbol is
 *                 published under it, because a symbol named `./placeholders` would be a
 *                 name with no referent. Not lane-repairable: the edge is the import
 *                 itself, and its target is correct.
 *   CUSTOM-PROP   starts `--`. A CSS custom property read by `var(--x)`. Sass has no
 *                 scoping rule that binds these, so the read can cross files.
 *   BARE-IDENT    anything else: `card`, `modal`, `variables`, `icons`.
 *
 * ## What would make this a defect rather than a description
 *
 * A MODULE-PATH target is a defect ONLY if some file publishes a symbol the path could
 * have resolved to and the analyzer failed to name it. A BARE-IDENT target is a defect
 * only if the declaration is in the corpus and the analyzer missed it. So this file also
 * asks the counterfactual directly, per shape, over the whole 4,433-file dump:
 *
 *   - for MODULE-PATH, does any file publish a symbol whose name equals the path, or
 *     equals the path's basename? (a positive means the edge COULD have resolved)
 *   - for BARE-IDENT / CUSTOM-PROP, does any file publish the name at all? (U2 already
 *     answers no, so this is a belt-and-braces check on the U1 side instead: the count
 *     of same-file declarations of the name.)
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-u2-classify.ts <dump.ndjson> [windowSize]
 */
import { readFileSync } from "node:fs"

const DUMP = process.argv[2] ?? "/tmp/opencode/scss/scss-incoming-walk-full.ndjson"
const WINDOW = Number(process.argv[3] ?? 600)

type SymRec = { k: "s"; f: string; n: string; k2: string; q: string }
type EdgeRec = { k: "e"; f: string; t: string; s: string; g: string; c: number | null; ec: string }
type FileRec = { k: "file"; f: string; thrown?: boolean }

const syms: SymRec[] = []
const edges: EdgeRec[] = []
const files: FileRec[] = []
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (line.length === 0) continue
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    continue
  }
  if (o.k === "s") syms.push(o)
  else if (o.k === "e") edges.push(o)
  else if (o.k === "file") files.push(o)
}

const allFiles = files.filter((f) => !f.thrown).map((f) => f.f).sort()
const step = Math.max(1, Math.floor(allFiles.length / WINDOW))
const windowFiles = new Set(allFiles.filter((_, i) => i % step === 0).slice(0, WINDOW))

// Every name any walked file publishes, plus its basenames for the module-path
// counterfactual. `instances` counts declarations, `files` counts distinct files — the
// same two numbers the ambiguity split needs.
type Pub = { instances: number; fileSet: Set<string> }
const published = new Map<string, Pub>()
const basenames = new Map<string, Pub>()
function note(m: Map<string, Pub>, key: string, file: string): void {
  if (key.length === 0) return
  let e = m.get(key)
  if (!e) {
    e = { instances: 0, fileSet: new Set() }
    m.set(key, e)
  }
  e.instances++
  e.fileSet.add(file)
}
for (const s of syms) {
  note(published, s.n, s.f)
  if (s.q.length > 0) note(published, s.q, s.f)
  const segs = s.n.split("/")
  if (segs.length > 1) note(basenames, segs[segs.length - 1], s.f)
}
const symsByFile = new Map<string, Set<string>>()
for (const s of syms) {
  let set = symsByFile.get(s.f)
  if (!set) {
    set = new Set()
    symsByFile.set(s.f, set)
  }
  set.add(s.n)
  if (s.q.length > 0) set.add(s.q)
}

function shape(t: string): "MODULE-PATH" | "CUSTOM-PROP" | "BARE-IDENT" {
  if (t.startsWith("--")) return "CUSTOM-PROP"
  if (t.startsWith(".") || t.includes("/")) return "MODULE-PATH"
  return "BARE-IDENT"
}
function basename(t: string): string {
  const segs = t.split("/")
  return segs[segs.length - 1].replace(/\.(scss|sass|css)$/, "")
}

const windowEdges = edges.filter((e) => windowFiles.has(e.f))
const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

// cells[type][shape] = { edges, names: Map<string, number>, sameFileDeclared, pathResolvable }
type Cell = { edges: number; names: Map<string, number>; sameFileDeclared: number; pathResolvable: number }
const cells = new Map<string, Cell>()
function cell(type: string, sh: string): Cell {
  const byType = cells.get(type) ?? new Map<string, Cell>()
  let c = byType.get(sh)
  if (!c) {
    c = { edges: 0, names: new Map(), sameFileDeclared: 0, pathResolvable: 0 }
    byType.set(sh, c)
  }
  cells.set(type, byType)
  return c
}

const perTypeEC = new Map<string, Map<string, number>>()
for (const e of windowEdges) {
  let m = perTypeEC.get(e.t)
  if (!m) {
    m = new Map()
    perTypeEC.set(e.t, m)
  }
  m.set(e.ec, (m.get(e.ec) ?? 0) + 1)

  // U2 == resolves against NOTHING in the whole walked corpus.
  if (published.has(e.g)) continue
  const sh = shape(e.g)
  const c = cell(e.t, sh)
  c.edges++
  c.names.set(e.g, (c.names.get(e.g) ?? 0) + 1)
  const own = symsByFile.get(e.f)
  if (own?.has(e.g)) c.sameFileDeclared++
  if (sh === "MODULE-PATH") {
    const b = basename(e.g)
    if (published.has(e.g) || (b.length > 0 && (published.has(b) || basenames.has(b)))) c.pathResolvable++
  }
}

console.log(`scss U2 classification — dump ${DUMP}`)
console.log(`files walked ${allFiles.length}   window ${windowFiles.size}   window edges ${windowEdges.length}\n`)

console.log("U2 edges by type x target shape, with the two counterfactuals:")
console.log("type         shape         edges  distinct  declaredInOwnFile  pathResolvableBySomeSymbol")
console.log("-".repeat(100))
const totals = { edges: 0, sfp: 0, spr: 0 }
const byShapeTotals = new Map<string, number>()
for (const t of TYPES) {
  const byType = cells.get(t)
  if (!byType) continue
  for (const [sh, c] of [...byType.entries()].sort()) {
    totals.edges += c.edges
    totals.sfp += c.sameFileDeclared
    totals.spr += c.pathResolvable
    byShapeTotals.set(sh, (byShapeTotals.get(sh) ?? 0) + c.edges)
    console.log(
      `${t.padEnd(12)} ${sh.padEnd(13)} ${String(c.edges).padStart(5)} ${String(c.names.size).padStart(9)} ${String(c.sameFileDeclared).padStart(18)} ${String(c.pathResolvable).padStart(23)}`,
    )
  }
}
console.log("-".repeat(100))
console.log(`TOTAL U2 ${totals.edges}   declared in own file ${totals.sfp}   path-resolvable by some symbol ${totals.spr}`)
console.log("\nby shape:")
for (const [sh, n] of [...byShapeTotals.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${sh.padEnd(13)} ${String(n).padStart(5)}  ${((n / totals.edges) * 100).toFixed(1)}%`)
}

console.log("\ntop names per cell (all cells with >=1 edge, top 8 each):")
for (const t of TYPES) {
  const byType = cells.get(t)
  if (!byType) continue
  for (const [sh, c] of [...byType.entries()].sort()) {
    const top = [...c.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`  ${t}/${sh}: ` + top.map(([n, k]) => `${n}(${k})`).join("  "))
  }
}

console.log("\nevidenceClass per type over the whole window (which producing path each type comes from):")
for (const t of TYPES) {
  const m = perTypeEC.get(t)
  if (!m) continue
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`)
  console.log(`  ${t.padEnd(12)} ${parts.join("  ")}`)
}