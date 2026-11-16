/**
 * HCL GRAMMAR ORACLE + CONFORMANCE — the Groovy precedent, settled for HCL.
 *
 * Question: does the vendored wasm/tree-sitter-hcl.wasm (the exact grammar the
 * engine parses with) still match the upstream tree-sitter-hcl grammar? A stale
 * wasm silently makes every dispatch site in the analyzer dead.
 *
 * Enumerates the wasm's own node types and fields through the web-tree-sitter
 * Language API, then diffs both directions against the upstream
 * node-types.json at a pinned revision. No hand-maintained lists.
 */
import { writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { Parser, Language } from "web-tree-sitter"

const WASM = "<corpus-root>/backbencher-brain/wasm/tree-sitter-hcl.wasm"
const UPSTREAMS = [
  { label: "tree-sitter-grammars/tree-sitter-hcl", dir: "<corpus-root>/bb_tests/hcl/ts-grammars-hcl" },
]
const OUT = "<corpus-root>/bb_tests/hcl/out"

await Parser.init()
const lang = await Language.load(WASM)

const named = new Set<string>()
const anon = new Set<string>()
for (let i = 0; i < lang.nodeTypeCount; i++) {
  const t = lang.nodeTypeForId(i)
  if (lang.nodeTypeIsNamed(i)) named.add(t)
  else anon.add(t)
}
const fields = new Set<string>()
for (let i = 1; i <= lang.fieldCount; i++) fields.add(lang.fieldNameForId(i))

const reports: any[] = []
for (const up of UPSTREAMS) {
  const r: any = { label: up.label, dir: up.dir, found: existsSync(up.dir), rev: "", nodeTypesPath: null }
  if (r.found) {
    try {
      r.rev = execFileSync("git", ["-C", up.dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 12)
    } catch {
      r.rev = "unknown"
    }
    for (const rel of ["src/node-types.json", "node-types.json"]) {
      const p = `${up.dir}/${rel}`
      if (!existsSync(p)) continue
      r.nodeTypesPath = p
      const nt = JSON.parse((await import("node:fs")).readFileSync(p, "utf8")) as any[]
      // REAL fields are the keys of each entry's `fields` object. The other keys
      // present in node-types.json (`types`, `required`, `multiple`, `children`)
      // are SCHEMA keys, not grammar field names — reading them as fields is how
      // a false "3 missing fields" reading is manufactured.
      const upNamed = new Set<string>()
      const upFields = new Set<string>()
      for (const n of nt) {
        if (n.named) upNamed.add(n.type)
        for (const k of Object.keys(n.fields ?? {})) upFields.add(k)
        for (const t of n.subtypes ?? []) if (t.named) upNamed.add(t.type)
      }
      r.upstreamNamedCount = upNamed.size
      r.upstreamFields = [...upFields].sort()
      r.missingFromVendored = [...upNamed].filter((t) => !named.has(t)).sort()
      r.extraInVendored = [...named].filter((t) => !upNamed.has(t)).sort()
      r.fieldsMissingFromVendored = [...upFields].filter((f) => !fields.has(f)).sort()
      break
    }
  }
  reports.push(r)
}

const conforming = reports.every(
  (r) => r.found && r.missingFromVendored.length === 0 && r.extraInVendored.length === 0 && r.fieldsMissingFromVendored.length === 0,
)

const out = {
  wasm: WASM,
  wasmNodeTypeCount: lang.nodeTypeCount,
  wasmNamedCount: named.size,
  wasmFieldCount: lang.fieldCount,
  wasmNamed: [...named].sort(),
  wasmAnonymous: [...anon].sort(),
  wasmFields: [...fields].sort(),
  upstreams: reports,
  conforming,
  verdict: conforming
    ? "vendored wasm is current with upstream — no grammar repair needed (the Groovy case does NOT apply to HCL)"
    : "DRIFT — the vendored wasm must be repaired before any analyzer claim is trustworthy",
}
writeFileSync(`${OUT}/grammar-conformance.json`, JSON.stringify(out, null, 2) + "\n")

console.log(`vendored: ${lang.nodeTypeCount} types (${named.size} named), ${lang.fieldCount} fields -> [${[...fields].sort().join(", ")}]`)
for (const r of reports) {
  if (!r.found) {
    console.log(`### ${r.label}: NOT CLONED`)
    continue
  }
  console.log(`### ${r.label} @ ${r.rev}`)
  console.log(`  upstream named types      : ${r.upstreamNamedCount}`)
  console.log(`  MISSING from vendored     : ${r.missingFromVendored.length} ${JSON.stringify(r.missingFromVendored)}`)
  console.log(`  EXTRA in vendored         : ${r.extraInVendored.length} ${JSON.stringify(r.extraInVendored)}`)
  console.log(`  upstream real fields      : ${JSON.stringify(r.upstreamFields)}`)
  console.log(`  FIELDS MISSING            : ${r.fieldsMissingFromVendored.length} ${JSON.stringify(r.fieldsMissingFromVendored)}`)
}
console.log(`\nCONFORMING: ${conforming}`)
console.log(`VERDICT: ${out.verdict}`)
if (!conforming) process.exitCode = 1
