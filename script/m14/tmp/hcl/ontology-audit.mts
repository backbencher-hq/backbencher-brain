/**
 * HCL RELATIONSHIP ONTOLOGY AUDIT — the master review's question:
 * "are ALL the applicable relationship types resolved, all of them, and nothing
 * unexplained?"
 *
 * Two halves, both measured:
 *   A. The BUILTIN/PROJECT split. `real-sql-analyzer.ts:1569` is the house
 *      precedent: a target in a global namespace is `uses`, a project symbol is
 *      `references`. HCL's reference roots divide exactly that way —
 *      var/local/module/data/<resource_type> are PROJECT addresses, while
 *      count/each/self/path/terraform are LANGUAGE BUILTINS that resolve to
 *      nothing in the index. This probe counts the split over the whole corpus.
 *   B. The UNEXPLAINED residue: every reference the analyzer publishes whose
 *      target is neither a project symbol declared in the same file nor a
 *      recognised builtin — the edges a reviewer would ask about.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { ASTEngine } from "/home/ishaq2321/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "/home/ishaq2321/backbencher-brain/src/ast/real-hcl-analyzer"

const REPOS = "/home/ishaq2321/bb_tests/hcl/repos"
const EXT = /\.(tf|tfvars|hcl|tofu)$/i

/** HCL's language-level iteration/context builtins. These are NOT declarations:
 *  `count.index` exists wherever a `count` argument does, and no file declares
 *  it. They are the `uses` class by the SQL precedent. */
const BUILTIN_ROOTS = new Set(["count", "each", "self", "path", "terraform"])
/** Terraform's PROJECT-scoped reference roots. Each resolves to a declaration in
 *  the module (var.X → `variable "X"`, local.X → `locals.X`, module.X →
 *  `module "X"`, data.T.N → `data "T" "N"`, <type>.<name> → `resource`/`data`). */
const PROJECT_ROOTS = new Set(["var", "local", "module", "data"])

const parser = await ASTEngine.getParser("hcl")
const analyzer = new RealHclAnalyzer()

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walkFiles(p)
    else if (EXT.test(e)) yield p
  }
}

const builtinEdges = new Map<string, number>()
const projectEdges = new Map<string, number>()
const otherRootEdges = new Map<string, number>()
/** A reference whose root is neither a builtin nor a known project root — the
 *  `<resource_type>.<name>` family, which IS a project address but is not
 *  enumerable without resolving it. */
const resourceEdges = new Map<string, number>()
const unresolvedSamples: { file: string; target: string }[] = []

let files = 0
let refTotal = 0
let relTotal = 0
const byType = new Map<string, number>()

for (const f of walkFiles(REPOS)) {
  const src = readFileSync(f, "utf8")
  if (src.length > 4_000_000) continue
  files++
  const rel = relative(REPOS, f)
  const tree = parser.parse(src)
  const res = analyzer.analyze(tree.rootNode as any, src, rel)
  // What this file actually DECLARES, so `project resolves here` is a measured
  // claim about this file and not an assumption about the module.
  const declared = new Set<string>()
  for (const s of res.symbols) {
    const addr = (s.metadata as any)?.hclAddress
    if (typeof addr === "string") declared.add(addr)
  }
  for (const r of res.relationships) {
    relTotal++
    byType.set(r.type as string, (byType.get(r.type as string) ?? 0) + 1)
    if (r.type !== "references") continue
    refTotal++
    const root = String(r.target).split(".")[0]
    if (BUILTIN_ROOTS.has(root)) builtinEdges.set(r.target, (builtinEdges.get(r.target) ?? 0) + 1)
    else if (PROJECT_ROOTS.has(root)) {
      projectEdges.set(r.target, (projectEdges.get(r.target) ?? 0) + 1)
      const name = String(r.target).split(".")[1]
      if (name && !declared.has(name)) {
        if (unresolvedSamples.length < 60) unresolvedSamples.push({ file: rel, target: r.target })
      }
    } else {
      resourceEdges.set(r.target, (resourceEdges.get(r.target) ?? 0) + 1)
      const parts = String(r.target).split(".")
      const owner = parts.slice(0, 2).join(".")
      if (!declared.has(owner) && !declared.has(parts[0])) {
        if (unresolvedSamples.length < 60) unresolvedSamples.push({ file: rel, target: r.target })
      }
    }
  }
  tree.delete?.()
}

const top = (m: Map<string, number>, n = 18) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
const out = {
  generatedAt: new Date().toISOString(),
  files,
  relationships: relTotal,
  references: refTotal,
  byRelationshipType: Object.fromEntries([...byType.entries()].sort((a, b) => b[1] - a[1])),
  split: {
    builtinUsesClass: { total: [...builtinEdges.values()].reduce((a, b) => a + b, 0), distinct: builtinEdges.size, top: Object.fromEntries(top(builtinEdges)) },
    projectReferencesClass: { total: [...projectEdges.values()].reduce((a, b) => a + b, 0), distinct: projectEdges.size, top: Object.fromEntries(top(projectEdges)) },
    resourceTypeFamily: { total: [...resourceEdges.values()].reduce((a, b) => a + b, 0), distinct: resourceEdges.size, top: Object.fromEntries(top(resourceEdges)) },
  },
  sqlPrecedent:
    "real-sql-analyzer.ts:1569 — `addRelationship(type === \"uses\" ? Uses : References, \"global\", target, …)`: a GLOBAL-namespace target is `uses`, a project symbol is `references`. HCL's count/each/self/path/terraform are exactly that global class, and the analyzer currently publishes them as `references`, i.e. as if they were declarations.",
  unresolvedSample: unresolvedSamples.slice(0, 40),
}
writeFileSync("/home/ishaq2321/bb_tests/hcl/out/ontology-audit.json", JSON.stringify(out, null, 2) + "\n")

console.log(`files=${files} relationships=${relTotal} references=${refTotal}`)
console.log(`by type: ${JSON.stringify(out.byRelationshipType)}`)
console.log(`\nBUILTIN (the \`uses\` class by the SQL precedent): ${out.split.builtinUsesClass.total} edges, ${out.split.builtinUsesClass.distinct} distinct`)
for (const [k, v] of top(builtinEdges, 10)) console.log(`   ${String(v).padStart(6)}  ${k}`)
console.log(`\nPROJECT-ROOT references: ${out.split.projectReferencesClass.total} edges, ${out.split.projectReferencesClass.distinct} distinct`)
console.log(`RESOURCE-TYPE family (<type>.<name>.<attr>): ${out.split.resourceTypeFamily.total} edges, ${out.split.resourceTypeFamily.distinct} distinct`)
console.log(`\nreferences whose target is NOT declared in the same file: ${unresolvedSamples.length} sampled (cross-file resolution is a project-level concern, documented)`)
for (const s of unresolvedSamples.slice(0, 8)) console.log(`   ${s.target}   ${s.file}`)
