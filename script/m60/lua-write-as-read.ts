/**
 * M14 ONTOLOGY — LUA WAVE-2. Is a WRITE published as a READ?
 *
 * `emitNameRead` and `emitMemberRead` both exclude an assignment target with
 *
 *     if (pt === "assignment_statement" && this.isSameNode(parent.namedChild(0), node)) return
 *
 * `namedChild(0)` is the FIRST target. Lua's assignment statement takes a target
 * LIST, so `a, b = f(), g()` has two, and the second one is not excluded. The
 * claim under test is therefore concrete and falsifiable:
 *
 *   H1  a non-first assignment TARGET produces a `uses` edge (it is a write, and
 *       `uses` is defined as a name this scope READS), and
 *   H2  where the same name is also read on the right-hand side, the write adds a
 *       SECOND edge, so one read is published twice — which is the JSON lane's
 *       "emitted first-doc edges twice, invisibly" class.
 *
 * A/B ON A FIXTURE FIRST: three files that differ only in statement order and
 * arity, so the answer cannot be argued from reading. Then the corpus count.
 *
 * USAGE: npx tsx script/m60/lua-write-as-read.ts [--full]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.resolve(ROOT, process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]!
  : "validation/m60/lua/write-as-read.json")
const FULL = process.argv.includes("--full")

// ─────────────────────────────── A/B fixture: three shapes, one rule
const FIX = {
  // 1 target, 1 read: the baseline the exclusion was written for.
  "single": `local a, b = 1, 2\na = b\nreturn a\n`,
  // 2 targets, RHS read of the SECOND one. `b` is written at L1 and read at L1.
  "multi-swap": `local a, b = 1, 2\na, b = b, a\nreturn a\n`,
  // 2 targets where the second is never read: the pure write.
  "multi-write": `local a, b = 1, 2\na, b = 3, 4\nreturn a\n`,
  // 2 targets, one of them a MEMBER: the `references` twin of the same question.
  "multi-member": `local t = {}\nfunction t.reset() end\nt.a, t.reset = 1, 2\nreturn t\n`,
}
const fixDir = path.join("/tmp/opencode/lua-lane", "write-as-read")
mkdirSync(fixDir, { recursive: true })
const ab: Record<string, any> = {}
for (const [name, src] of Object.entries(FIX)) {
  const p = path.join(fixDir, `${name}.lua`)
  writeFileSync(p, src)
  const r: any = await parseFile(p, fixDir)
  ab[name] = {
    source: src.replace(/\n/g, " \\n "),
    edges: (r.relationships ?? [])
      .map((x: any) => `${String(x.type).toLowerCase()}:${x.source}->${x.target}@L${x.line_number}`)
      .filter((e: string) => !e.startsWith("contains") && !e.startsWith("imports")),
    all: (r.relationships ?? []).length,
  }
}

// ─────────────────────────────── corpus count, on the tree
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

interface Multi { file: string; line: number; targets: number; secondIsMember: boolean; text: string; secondTargetText: string }
const multis: Multi[] = []
/** Files whose ROOT is an ERROR: the bytes are not Lua. Edges derived from them
 * are edges about text that is not the language. Measured, not assumed. */
const rootErrorFiles: { file: string; spans: number }[] = []
/** DEFECT B population. `emitMemberRead` excludes a write with
 * `pt === "assignment_statement" && isSameNode(parent.namedChild(0), node)`, but
 * the measured tree puts every assignment target inside a `variable_list` child
 * (lua-grammar-shape.ts: `a = 1` is
 *   assignment_statement {name=identifier}
 *     variable_list {name=identifier}
 *       identifier "a"
 * so the node's PARENT is `variable_list` and no exclusion matches). Measured
 * consequence on a two-line fixture `local t = {} / t.reset = 1`, a pure WRITE:
 *   references: global -> reset @L2
 * So every assignment whose target is a qualified name publishes a `references`
 * edge for a member that was never read. These counters are the population. */
const writes = {
  assignmentStatements: 0,
  targetsTotal: 0,
  targetsIdentifier: 0,
  targetsMember: 0,
  memberTargetExamples: [] as string[],
  /** targets that are ALSO read on the right-hand side of the same statement —
   * the write is a duplicate of a read that is published anyway */
  memberTargetAlsoRead: 0,
}
const memberReads = { total: 0, examples: [] as string[] }

const files: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of tracked) files.push({ repo: e, rel, abs: path.join(dir, rel) })
}

const CAP = FULL ? files.length : 600
for (const f of files.slice(0, CAP)) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  let t: any
  try { t = parser.parse(text) } catch { continue }
  if (!t) continue
  const label = `${f.repo}/${f.rel}`
  const lines = text.split("\n")
  let rootErr = 0
  const v = (n: any) => {
    if (n.type === "ERROR") rootErr++
    if (n.type === "assignment_statement") {
      // The TARGET LIST is every named child before the `=`. tree-sitter-lua
      // exposes no field for it, so it is counted as: named children up to the
      // first one that starts at or after the `=` token's row.
      const eq = (n.text ?? "").indexOf("=")
      if (eq >= 0) {
        const eqIdx = n.startIndex + eq
        writes.assignmentStatements++
        const targets: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c.startIndex < eqIdx) targets.push(c)
        }
        writes.targetsTotal += targets.length
        // The RHS text, so "is this target also read" is a text question about a
        // span the tree already delimited — not a second parse.
        const rhsText = String(n.text ?? "").slice(eq + 1)
        for (const t of targets) {
          // A target is a `variable_list` child; descend one level to the real node.
          const leaf = t.type === "variable_list" ? t.namedChild(0) : t
          if (!leaf) continue
          if (leaf.type === "identifier") { writes.targetsIdentifier++; continue }
          if (leaf.type === "dot_index_expression" || leaf.type === "method_index_expression" || leaf.type === "bracket_index_expression") {
            writes.targetsMember++
            // The field's own name: what a `references` edge would be built on.
            let fld: any = null
            if (leaf.type === "bracket_index_expression") {
              const f = leaf.childForFieldName("field")
              fld = f && f.type === "string" ? null : f
            } else fld = leaf.namedChild(leaf.namedChildCount - 1)
            const nm = fld?.type === "identifier" ? String(fld.text) : null
            if (nm && rhsText.includes(nm)) writes.memberTargetAlsoRead++
            if (writes.memberTargetExamples.length < 25) {
              writes.memberTargetExamples.push(`${label}:${n.startPosition.row + 1} ${String(leaf.text).replace(/\s+/g, " ").slice(0, 50)}`)
            }
          }
        }
        if (targets.length >= 2) {
          const second = targets[1]
          multis.push({
            file: label, line: n.startPosition.row + 1, targets: targets.length,
            secondIsMember: second.type === "dot_index_expression" || second.type === "method_index_expression" || second.type === "bracket_index_expression",
            text: String(n.text ?? "").replace(/\s+/g, " ").slice(0, 80),
            secondTargetText: String(second.text ?? "").slice(0, 40),
          })
        }
      }
    }
    if (n.type === "dot_index_expression" || n.type === "method_index_expression" || n.type === "bracket_index_expression") {
      const p = n.parent
      const isWriteTarget = !!p && (p.type === "variable_list" ||
        (p.type === "assignment_statement" && !!p.childForFieldName("name")))
      if (!isWriteTarget) {
        memberReads.total++
        if (memberReads.examples.length < 10) {
          memberReads.examples.push(`${label}:${n.startPosition.row + 1} ${String(n.text).replace(/\s+/g, " ").slice(0, 50)}`)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) v(c) }
  }
  v(t.rootNode)
  // A root-level ERROR is one whose span covers the whole chunk.
  const root = t.rootNode
  const isRootErr = root.type === "ERROR" || (root.namedChildCount > 0 && root.namedChild(0)?.type === "ERROR" && root.namedChild(0).startIndex === 0)
  if (isRootErr || rootErr > 0) rootErrorFiles.push({ file: label, spans: rootErr })
}

const byTargets = new Map<number, number>()
for (const m of multis) byTargets.set(m.targets, (byTargets.get(m.targets) ?? 0) + 1)
const secondMember = multis.filter((m) => m.secondIsMember).length

const out = {
  schemaVersion: 1, kind: "lua-write-as-read",
  hypothesis: "a non-first assignment TARGET is published as `uses`/`references`, which is a WRITE, and where the name is also read on the RHS the read is published twice.",
  abFixture: ab,
  corpus: {
    filesScanned: CAP, drawMethod: `git ls-files '*.lua' per repo, sorted, first ${CAP} by path`,
    multiTargetAssignments: multis.length,
    byTargetCount: Object.fromEntries([...byTargets].sort((a, b) => a[0] - b[0])),
    secondTargetIsMember: secondMember,
    filesWithMultiTarget: new Set(multis.map((m) => m.file)).size,
    examples: multis.slice(0, 25),
  },
  rootErrorFiles: { count: rootErrorFiles.length, examples: rootErrorFiles.slice(0, 25) },
  writes,
  memberReads,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log("=== A/B FIXTURE (the `contains`/`imports` labels are filtered out) ===")
for (const [k, v] of Object.entries(ab)) {
  console.log(`${k}:`)
  for (const e of v.edges) console.log(`    ${e}`)
}
console.log("")
console.log(`corpus: ${multis.length} multi-target assignments in ${out.corpus.filesWithMultiTarget} files of ${CAP} scanned`)
console.log(`  by target count: ${JSON.stringify(out.corpus.byTargetCount)}`)
console.log(`  second target is a MEMBER (references twin): ${secondMember}`)
console.log(`root-ERROR files: ${rootErrorFiles.length} of ${CAP}`)
for (const r of rootErrorFiles.slice(0, 10)) console.log(`    ${r.file} (${r.spans} ERROR nodes)`)
console.log("")
console.log("=== DEFECT B POPULATION: a WRITE published as a `references` READ ===")
console.log(`assignment statements            ${writes.assignmentStatements}`)
console.log(`assignment targets total         ${writes.targetsTotal}`)
console.log(`  bare identifier targets        ${writes.targetsIdentifier}   (correctly not published)`)
console.log(`  QUALIFIED targets              ${writes.targetsMember}   (each publishes references for a member never read)`)
console.log(`  ...of which also read on RHS   ${writes.memberTargetAlsoRead}   (the write duplicates a read)`)
console.log(`genuine member reads             ${memberReads.total}`)
for (const e of writes.memberTargetExamples.slice(0, 10)) console.log(`    write: ${e}`)
console.log(`-> ${OUT}`)