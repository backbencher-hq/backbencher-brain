// ts-label-coverage.mjs — VERIFY_TS10: which of the ten relationship types does
// the shared differential actually COMPARE for typescript?
//
// A DERIVATION finding is a type the analyzer emits and the differential never
// audits — "stored and compared against nothing" (ONTOLOGY-WORKSTREAM.md Part 1).
// There are 100 of these across 34 lanes; this script answers the question for
// one lane, and it answers it by READING THE HARNESS'S OWN ALLOWLIST rather than
// by trusting a doc, because the allowlist is a 400-line conditional and its
// comments describe intents that drift from its code.
//
// The expression is EXTRACTED from script/m14/differential.ts, never copied, so
// this cannot believe a label is admitted when the harness drops it — the same
// discipline script/m14/verify-label-coverage.ts applies.
//
// NO REGEX: the expression is extracted with a bracket/quote-aware scanner over
// the source text, which is not a pattern match.
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const LANG = process.argv[2] ?? "typescript"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
]

function extractAllowlistExpr(src) {
  const MARK = '.filter((r: any) => ["extends", "implements", "instantiates"'
  const at = src.indexOf(MARK)
  if (at < 0) throw new Error("allowlist marker not found — differential.ts changed shape")
  const bodyStart = src.indexOf("=>", at) + 2
  let depth = 0
  let inStr = null
  let inLine = false
  let inBlock = false
  for (let i = bodyStart; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) { if (c === "\n") inLine = false; continue }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++ } continue }
    if (inStr) { if (c === "\\") { i++; continue } if (c === inStr) inStr = null; continue }
    if (c === "/" && n === "/") { inLine = true; i++; continue }
    if (c === "/" && n === "*") { inBlock = true; i++; continue }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue }
    if (c === "[" || c === "(" || c === "{") { depth++; continue }
    if (c === "]" || c === ")" || c === "}") {
      depth--
      if (depth === 0 && c === "]") return src.slice(bodyStart, i + 1)
    }
  }
  throw new Error("allowlist expression end not found")
}

const src = readFileSync(join(ROOT, "script/m14/differential.ts"), "utf8")
const expr = extractAllowlistExpr(src)
const admitted = new Set(new Function("lang", `return ${expr}`)(LANG))
console.log(`typescript label coverage — lang=${LANG}`)
console.log(`allowlist extracted from script/m14/differential.ts (${expr.length} chars, evaluated, not copied)`)
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`\n${pad("type", 14)}verdict`)
console.log("-".repeat(64))
const derivation = []
for (const t of ALL_TYPES) {
  const ok = admitted.has(t)
  if (!ok) derivation.push(t)
  console.log(`${pad(t, 14)}${ok ? "COMPARED by the differential" : "DERIVATION — emitted, never audited"}`)
}
console.log(`\nadmitted: ${[...admitted].sort().join(" ")}`)
console.log(`DERIVATION findings for ${LANG}: ${derivation.length} ${derivation.length ? "-> " + derivation.join(" ") : ""}`)

// Which truth builders exist for this language on the oracle side? Read from the
// differential's own import list, again by string search, never by regex.
const oracles = new Set()
for (const line of src.split("\n")) {
  if (!line.includes("from \"./oracles/") && !line.includes("from './oracles/")) continue
  const at = line.indexOf("oracles/")
  const tail = line.slice(at + "oracles/".length)
  const name = tail.split("\"")[0].split("'")[0].trim()
  if (name.length) oracles.add(name)
}
const relevant = [...oracles].filter((n) => n.includes(LANG)).sort()
console.log(`\noracle modules under script/m14/oracles/ named for this language (${relevant.length}):`)
for (const r of relevant) console.log(`  ${r}`)
const unused = relevant.filter((r) => {
  const sym = r.split("-")[1]
  return sym ? !src.includes(`derive${sym[0].toUpperCase()}${sym.slice(1)}`) : false
})
if (unused.length) console.log(`  (no derive* symbol found in differential.ts for: ${unused.join(" ")})`)