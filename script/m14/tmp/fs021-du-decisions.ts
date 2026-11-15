// FS021 — the two remaining decisions on the DU / alias class, each tested before it is
// taken, because both change a name the M12 ground truth and the fixture contract pin.
//
// DECISION 1: should a `union_type_defn` be SymbolKind.Union rather than Enum?
//   The engine HAS a `union` kind and twelve lanes use it. F#'s DU is a tagged union
//   whose case resolution depends on payload arity — `if Circle r x` destructures it —
//   so an `enum` publishes a shape the language does not have. Zig's lane makes the
//   same distinction (`union_declaration` -> Union) in the same family. The question
//   is what the REPLACEMENT breaks, measured rather than assumed: the M12 differential's
//   121 pinned facts, and the symbol kinds any consumer keys on.
//
// DECISION 2: should the PHANTOM enum_member on an alias be removed?
//   Measured population: an `enum_member` whose sole case is the type being aliased.
//   The discriminator that is SOUND (not a guess) is the type abbreviation's own
//   grammar: `type X = Y` has NO `union_type_case` payload and its case name resolves
//   to a type. A one-case DU is a legal spelling of the same tree, so removing the
//   member unconditionally would delete real DU cases. This probe measures both
//   directions so the number at risk is a number.
//
// Run: bun script/m14/tmp/fs021-du-decisions.ts [--repo fsharp] [--limit 400]
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = parseInt(argOf("--limit") ?? "400")
const EXT = (argOf("--ext") ?? "fs,fsi,fsx").split(",")
const REPO = argOf("--repo") ?? "fsharp"

function walk(dir: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj") continue
    const p = path.join(dir, n)
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1).toLowerCase())) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))

  // DECISION 1: what would a union -> Union reclass change?
  const gt = JSON.parse(fs.readFileSync(path.join(ROOT, "validation/m12/ground-truth/fsharp.json"), "utf8"))
  const gtKinds = new Map<string, number>()
  const walkGt = (o: any) => {
    if (Array.isArray(o)) return o.forEach(walkGt)
    if (o && typeof o === "object") {
      if (o.kind) gtKinds.set(String(o.kind), (gtKinds.get(String(o.kind)) ?? 0) + 1)
      Object.values(o).forEach(walkGt)
    }
  }
  walkGt(gt)

  let files = 0
  let duTotal = 0, duPayload = 0, duNoPayload = 0, duMultiCase = 0
  const caseKinds = new Map<string, number>()
  const aliasCandidates: any[] = []
  const st0: any[] = []
  void st0

  for (const file of walk(path.join(CORPUS_ROOT, REPO), EXT, [], LIMIT)) {
    let src: string
    try { src = fs.readFileSync(file, "utf8") } catch { continue }
    files++
    const rel = path.relative(CORPUS_ROOT, file)
    let tree: any
    try { tree = parser.parse(src) } catch { continue }
    const collect = (root: any, type: string, out: any[] = []): any[] => {
      const stack: any[] = [root]
      while (stack.length) { const n = stack.pop(); if (n.type === type) out.push(n); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) } }
      return out
    }
    const declaredTypes = new Set<string>()
    for (const td of collect(tree.rootNode, "type_definition")) {
      if (collect(td, "type_extension").length) continue
      const tn = collect(td, "type_name")[0]
      if (tn) { const id = collect(tn, "identifier")[0]; if (id) declaredTypes.add(id.text) }
    }
    for (const ud of collect(tree.rootNode, "union_type_defn")) {
      duTotal++
      const cases = collect(ud, "union_type_case")
      const withPayload = cases.filter((c) => c.namedChildCount > 1).length
      if (withPayload) duPayload += withPayload
      if (cases.length > 1) duMultiCase++
      if (cases.length === 1 && withPayload === 0) {
        duNoPayload++
        const rhs = collect(cases[0], "identifier")[0]?.text ?? "?"
        const tn = collect(ud, "type_name")[0]
        const own = tn ? collect(tn, "identifier")[0]?.text : undefined
        if (declaredTypes.has(rhs) && rhs !== own) {
          aliasCandidates.push({ file: rel, line: cases[0].startPosition.row + 1, type: own, rhs, why: "the case names a type declared in THIS file and is not the type's own name" })
        }
      }
      for (const c of cases) { const k = c.namedChildCount > 1 ? "case-with-payload" : "case-no-payload"; caseKinds.set(k, (caseKinds.get(k) ?? 0) + 1) }
    }
    tree.delete()
  }

  console.log(`FS021 — the two DU decisions, over ${files} files of ${REPO}\n`)
  console.log(`DECISION 1 — union_type_defn -> SymbolKind.Union instead of Enum`)
  console.log(`  discriminated unions in the corpus                       ${duTotal}`)
  console.log(`    of those, a single case with NO payload                 ${duNoPayload}   <- includes every alias`)
  console.log(`    multi-case                                              ${duMultiCase}`)
  console.log(`  DU cases in total                                         ${[...caseKinds.values()].reduce((a, b) => a + b, 0)}  (${[...caseKinds.entries()].map(([k, v]) => `${k} ${v}`).join(", ")})`)
  console.log(`  a DU case's payload is load-bearing: \`if Circle r x\` destructures it, and the`)
  console.log(`  F# language spec gives DU cases no shared ordinal. An \`enum\` publishes an ordinal.`)
  console.log(`  the engine has a \`union\` kind; zig's lane uses it for the same construct.`)
  console.log(`\n  WHAT A RECLASSIFICATION COSTS, measured from the pinned ground truth:`)
  for (const [k, v] of [...gtKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(4)} facts with kind=${k}`)
  console.log(`  => the M12 differential's 121 facts are pinned against the CURRENT mapping, so a`)
  console.log(`     reclassification is a CONTRACT change: it needs the ground truth re-audited and`)
  console.log(`     re-emitted, not a silent edit. NOT TAKEN in this round; filed with the cost above.\n`)

  console.log(`DECISION 2 — the phantom enum_member on an alias`)
  console.log(`  aliases separable by in-file evidence (case names another type declared here): ${aliasCandidates.length}`)
  for (const a of aliasCandidates.slice(0, 10)) console.log(`     ${a.file.split("/").pop()}:${a.line}  type ${a.type} = ${a.rhs}`)
  console.log(`\n  RULING: the ${aliasCandidates.length} are provable IN-FILE, so the member they mint is a`)
  console.log(`  fabrication with a mechanical test (the case names a type this file declares and`)
  console.log(`  is not the type's own name). The ${duNoPayload - aliasCandidates.length} ambiguous cases stay DU readings,`)
  console.log(`  because the same test cannot be run on them without guessing.`)
  console.log(`  NOT TAKEN in this round either: the discriminator is name-based, and the honesty`)
  console.log(`  contract's §3 forbids a heuristic class presented as a fact. Filed with the test.`)
}
void main()
