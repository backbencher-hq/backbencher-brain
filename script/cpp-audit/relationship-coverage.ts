/**
 * relationship-coverage — the 14-value coverage ledger, with the three RULED values re-audited on
 * LANGUAGE semantics rather than on "the grammar cannot see it" (grammar is fixable; a ruling must
 * mean the C++ language has no such construct).
 *
 * WHAT IT PRODUCES, per canonical value:
 *   · the contract's own wording (quoted from src/ast/types.ts by the marker line it sits on),
 *   · the analyzer's OUTGOING emission sites (counted from real-cpp-analyzer.ts),
 *   · the whole-population edge count (the reconstruction gate's per-type table),
 *   · the two-repo population's edges + target resolution (validation/cpp-audit/census.json),
 *   · the disposition: EMITTED (outgoing measured) or RULED (language-semantic ruling + falsifier).
 *
 * AND, for the three ruled values, the NEAR-MISS CENSUS that makes the ruling an observation instead
 * of an assertion — every C++ construct that could be mistaken for the value, measured whole-corpus:
 *   decorates → attribute declarations and call expressions INSIDE attribute arguments;
 *   renders   → call expressions whose callee is a render verb (paint/draw/render/addWidget/…);
 *   mixes_in  → base clauses, multi-base clauses, and CRTP bases (base template specialized on the
 *               derived class itself — the C++ MIXIN IDIOM).
 * Each near-miss row is a construct the analyzer already types honestly (calls / extends); the ruled
 * value is what the construct would have to BE, and the language does not spell it.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.cpp-corpus/.corpus bun run script/cpp-audit/relationship-coverage.ts [--json=<p>] [--md=<p>]
 * (the corpus walk is the same admitted set the gate uses: 9 C++ spellings, 1 MiB cap)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const argOf = (f: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`${f}=`))
  return hit ? hit.slice(f.length + 1) : null
}
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".cpp-corpus", ".corpus")
const JSON_OUT = argOf("--json")
const MD_OUT = argOf("--md")
const EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".ipp", ".inl", ".cu"])
const SIZE_CAP = 1024 * 1024
const RENDER_VERB = /(?:^|::)(render|paint|draw|display|show|addWidget|addChild|createElement|mount)(?:$|[<(])/i

function walkFiles(dir: string, out: string[]): void {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules") continue
    const p = path.join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walkFiles(p, out)
    else if (st.isFile() && EXTS.has(path.extname(e).toLowerCase()) && st.size <= SIZE_CAP) out.push(p)
  }
}

interface NearMiss {
  decorates: { attributeSites: number; attributeCallArgs: number; samples: string[] }
  renders: { calls: number; byName: Record<string, number>; samples: string[] }
  mixesIn: { baseClauses: number; baseTypes: number; multiBaseClauses: number; crtpBases: number; samples: string[] }
}
const near: NearMiss = {
  decorates: { attributeSites: 0, attributeCallArgs: 0, samples: [] },
  renders: { calls: 0, byName: {}, samples: [] },
  mixesIn: { baseClauses: 0, baseTypes: 0, multiBaseClauses: 0, crtpBases: 0, samples: [] },
}
const BASE_NODE_TYPES = new Set(["type_identifier", "qualified_identifier", "template_type"])

/** A call expression anywhere under `node` (attribute arguments are call-shaped). */
function hasCall(node: any): any | null {
  if (node.type === "call_expression") return node
  for (const c of node.namedChildren ?? []) {
    const hit = hasCall(c)
    if (hit) return hit
  }
  return null
}
/** The CALLEE leaf of a call's function text: strip template arguments, then take the last
 *  `::`/`.`/`->` segment — `panel.addWidget` → addWidget, not the receiver `panel`. */
function leafOf(text: string): string {
  const cleaned = text.replace(/<[^<>]*>/g, "").trim()
  const seg = cleaned.split("::").pop()?.split("->").pop()?.split(".").pop() ?? cleaned
  const m = seg.match(/^([A-Za-z_]\w*)/)
  return m ? m[1] : seg
}

async function main(): Promise<void> {
  const files: string[] = []
  walkFiles(CR, files)
  let parsed = 0
  let errors = 0
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    let tree: any
    try {
      const parser: any = await ASTEngine.getParser("cpp")
      tree = parser.parse(text)
    } catch { errors++; continue }
    if (!tree) { errors++; continue }
    parsed++
    const rel = path.relative(CR, file)
    const stack: string[] = []
    const visit = (node: any): void => {
      const t = node.type
      const isClass = t === "class_specifier" || t === "struct_specifier" || t === "union_specifier"
      if (isClass) stack.push(String(node.childForFieldName("name")?.text ?? ""))
      if (t.startsWith("attribute")) {
        near.decorates.attributeSites++
        const call = hasCall(node)
        if (call) {
          near.decorates.attributeCallArgs++
          if (near.decorates.samples.length < 6) near.decorates.samples.push(`${rel}:${node.startPosition.row + 1} ${String(node.text).slice(0, 90).replace(/\s+/g, " ")}`)
        }
      }
      if (t === "base_class_clause") {
        near.mixesIn.baseClauses++
        const bases = (node.namedChildren ?? []).filter((c: any) => BASE_NODE_TYPES.has(c.type))
        near.mixesIn.baseTypes += bases.length
        if (bases.length > 1) near.mixesIn.multiBaseClauses++
        const derived = stack[stack.length - 1] ?? ""
        for (const b of bases) {
          if (b.type !== "template_type" || !derived) continue
          const args = (b.namedChildren ?? []).filter((c: any) => c.type === "template_argument_list")[0]
          const argNames = (args?.namedChildren ?? []).map((c: any) => leafOf(String(c.text)))
          if (argNames.includes(derived)) {
            near.mixesIn.crtpBases++
            if (near.mixesIn.samples.length < 6) near.mixesIn.samples.push(`${rel}:${b.startPosition.row + 1} ${String(node.text).slice(0, 100).replace(/\s+/g, " ")}`)
          }
        }
      }
      if (t === "call_expression") {
        const fn = node.childForFieldName("function")
        const leaf = leafOf(String(fn?.text ?? ""))
        if (RENDER_VERB.test(leaf) || RENDER_VERB.test(String(fn?.text ?? ""))) {
          near.renders.calls++
          near.renders.byName[leaf] = (near.renders.byName[leaf] ?? 0) + 1
          if (near.renders.samples.length < 6) near.renders.samples.push(`${rel}:${node.startPosition.row + 1} ${String(node.text).slice(0, 90).replace(/\s+/g, " ")}`)
        }
      }
      for (const c of node.namedChildren ?? []) visit(c)
      if (isClass) stack.pop()
    }
    visit(tree.rootNode)
    tree.delete()
  }

  // ── the ledger: contracts, emission sites, and the two measured populations ─────────────────────
  const analyzerSrc = readFileSync(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"), "utf8")
  const typesSrc = readFileSync(path.join(ROOT, "src/ast/types.ts"), "utf8")
  const contractOf = (member: string): string => {
    const i = typesSrc.indexOf(`  ${member} = "`)
    if (i < 0) return ""
    // the doc comment is the block above the member; take its last sentence before the member line
    const before = typesSrc.slice(0, i).split("\n")
    const block: string[] = []
    // the member line itself is the LAST element of `before`; above it: `*/`, the doc lines, `/**`
    for (let k = before.length - 2; k >= 0; k--) {
      const line = before[k].trim()
      if (line === "*/") continue
      if (line === "/**") break
      if (line.startsWith("*")) block.unshift(line.replace(/^\*\s?/, ""))
      else break
    }
    return block.filter(Boolean).slice(0, 3).join(" ").slice(0, 320)
  }
  const spec = JSON.parse(readFileSync(path.join(ROOT, "script/m14/spec/cpp-spec-table.json"), "utf8"))
  const census = JSON.parse(readFileSync(path.join(ROOT, "validation/cpp-audit/census.json"), "utf8"))
  const gatePath = path.join(ROOT, "validation/cpp-audit/whole-population/gate-index-default.json")
  const gate = JSON.parse(readFileSync(gatePath, "utf8"))
  const VALUES: Array<{ value: string; member: string }> = [
    { value: "calls", member: "Calls" }, { value: "extends", member: "Extends" },
    { value: "implements", member: "Implements" }, { value: "uses", member: "Uses" },
    { value: "imports", member: "Imports" }, { value: "exports", member: "Exports" },
    { value: "contains", member: "Contains" }, { value: "references", member: "References" },
    { value: "overrides", member: "Overrides" }, { value: "instantiates", member: "Instantiates" },
    { value: "decorates", member: "Decorates" }, { value: "renders", member: "Renders" },
    { value: "mixes_in", member: "MixesIn" }, { value: "part_of", member: "PartOf" },
  ]
  const emitted = new Set<string>((spec.applicableValues ?? []).map((v: any) => String(v.value ?? v)))
  const coverage = VALUES.map(({ value, member }) => {
    const sites = (analyzerSrc.match(new RegExp(`RelationshipType\\.${member}\\b`, "g")) ?? []).length
    const whole = gate.perType?.[value]?.edges ?? 0
    const two = census.perType?.[value]
    return {
      value,
      contract: contractOf(member),
      disposition: emitted.has(value) ? "EMITTED" : "RULED",
      outgoingEmissionSites: sites,
      wholePopulationEdges: whole,
      // the census stores per-type edges as an evidenceClass -> count map (no `edges` field)
      twoRepoEdges: two ? Object.values(two.evidenceClass ?? {}).reduce((a: number, b: any) => a + Number(b), 0) : 0,
      twoRepoFiles: two?.files ?? 0,
      twoRepoDistinctPairs: two?.distinctPairs ?? 0,
      evidenceTiers: two?.evidenceClass ?? null,
    }
  })
  const out = {
    schemaVersion: 1,
    instrument: "script/cpp-audit/relationship-coverage.ts",
    measuredAt: new Date().toISOString(),
    corpus: { root: path.relative(ROOT, CR), files: files.length, parsed, parseErrors: errors, population: "9 C++ spellings, 1 MiB cap" },
    coverage,
    nearMisses: near,
    populationEvidence: {
      wholePopulationGate: "validation/cpp-audit/whole-population/gate-index-default.json",
      twoRepoCensus: "validation/cpp-audit/census.json",
    },
    note: "The three RULED values are re-audited on LANGUAGE semantics: the nearMisses block counts every C++ construct that could be mistaken for them, and each is emitted by the analyzer under its honest value (attribute-argument calls are calls, base clauses are extends, render-verb calls are calls). A separate ruling text lives in script/m14/spec/cpp-spec-table.json and docs/analyzers/cpp.md.",
  }
  if (JSON_OUT) { const p = path.resolve(JSON_OUT); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(out, null, 2) + "\n") }
  if (MD_OUT) {
    const md = [
      "| value | disposition | emission sites | whole-pop edges | 2-repo edges | 2-repo files | 2-repo distinct pairs |",
      "|---|---|---|---|---|---|---|",
      ...coverage.map((c) => `| \`${c.value}\` | ${c.disposition} | ${c.outgoingEmissionSites} | ${c.wholePopulationEdges} | ${c.twoRepoEdges} | ${c.twoRepoFiles} | ${c.twoRepoDistinctPairs} |`),
      "",
      `near-miss census on ${parsed} parsed files (${errors} errors): attribute sites ${near.decorates.attributeSites}, attribute-argument calls ${near.decorates.attributeCallArgs}; render-verb calls ${near.renders.calls}; base clauses ${near.mixesIn.baseClauses} (${near.mixesIn.baseTypes} bases, ${near.mixesIn.multiBaseClauses} multi-base), CRTP bases ${near.mixesIn.crtpBases}.`,
    ].join("\n") + "\n"
    const p = path.resolve(MD_OUT); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, md)
  }
  console.log(JSON.stringify({ corpus: out.corpus, recent: coverage.slice(10), nearMisses: near }, null, 1).slice(0, 4000))
}

await main()
