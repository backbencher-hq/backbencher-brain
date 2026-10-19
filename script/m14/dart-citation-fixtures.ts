/**
 * DART CITATION CLAIMS — the FLAG-ON half of the contract, plus the drift and identity probes.
 *
 * Task-26 item 2. The fixture runner cannot set a per-fixture environment flag, so the committed
 * default state (flag OFF, byte-identical output) is pinned by
 * `validation/m14/fixtures/dart/citation-claims` in the normal suite, and THIS probe pins the flag-ON
 * behaviour and the two properties that keep the emission honest:
 *
 *   DRIFT     the analyzer's literal vocabulary copy (`DART_CITATION_ROOTS`) must equal the committed
 *             `DART_SDK_CORE.roots` in script/m14/citations.ts, exactly (both directions) — a name
 *             added or removed in one place without the other fails here (cpp precedent).
 *   IDENTITY  flag-OFF output must equal flag-ON output with ONLY the claim keys removed: the
 *             emission may not change a single edge, target, line, confidence or other metadata field.
 *             And flag-OFF must contain no claim metadata at all.
 *   CLAIM     listed annotation => `languageNamespace:[name]` + `languageNamespacePolicy:"strict-absent"`;
 *             unlisted annotation => unmarked; listed capitalized type use => claim; listed LOWERCASE
 *             vocabulary name used as a bare member read => UNMARKED (the type-shaped narrowing: a
 *             member read named `target` is not a dart:core symbol).
 *   INVARIANT every claimed row: name is in the vocabulary, policy present, and the row is either an
 *             annotation row or a capitalized type-shaped target.
 *
 * Exit: 0 pass · 3 a probe failed. Read-only; lane-owned instrument.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer, DART_CITATION_ROOTS } from "../../src/ast/real-dart-analyzer"
import { DART_SDK_CORE } from "./citations"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const FIXTURE = path.join(ROOT, "validation", "m14", "fixtures", "dart", "citation-claims.dart")
const src = readFileSync(FIXTURE, "utf8")
const parser = await getParser("dart")
const failures: string[] = []

// ---- DRIFT: the literal copy must equal the committed vocabulary (exact, both directions) -------
{
  const committed = new Set(DART_SDK_CORE.roots)
  const copied = DART_CITATION_ROOTS
  const missingInCopy = [...committed].filter((n) => !copied.has(n))
  const extraInCopy = [...copied].filter((n) => !committed.has(n))
  if (missingInCopy.length || extraInCopy.length) {
    failures.push(`DRIFT: committed vocabulary vs analyzer copy — missing in copy ${JSON.stringify(missingInCopy)}, extra in copy ${JSON.stringify(extraInCopy)}`)
  } else {
    console.log(`drift PASS — ${copied.size} roots, analyzer copy == ${DART_SDK_CORE.id}`)
  }
}

async function run(flag: boolean): Promise<any[]> {
  const prev = process.env.BB_DART_CITATION
  if (flag) process.env.BB_DART_CITATION = "1"
  else delete process.env.BB_DART_CITATION
  try {
    const tree = parser.parse(src)!
    const result: any = await new RealDartAnalyzer().analyze(tree.rootNode, src, "fixtures/dart/citation-claims.dart")
    return [...(result?.relationships ?? [])].map((r: any) => ({ ...r, metadata: { ...(r.metadata ?? {}) } }))
  } finally {
    if (prev === undefined) delete process.env.BB_DART_CITATION
    else process.env.BB_DART_CITATION = prev
  }
}

const off = await run(false)
const on = await run(true)

// ---- IDENTITY: off has no claims; on minus claim keys == off (structural) -----------------------
const claimsOf = (rows: any[]) => rows.filter((r) => r.metadata && (r.metadata.languageNamespace !== undefined || r.metadata.languageNamespacePolicy !== undefined))
const offClaims = claimsOf(off)
if (offClaims.length > 0) failures.push(`IDENTITY: flag OFF still emitted ${offClaims.length} claim row(s)`)
const strippedOn = on.map((r: any) => {
  const md = { ...(r.metadata ?? {}) }
  delete md.languageNamespace
  delete md.languageNamespacePolicy
  return { ...r, metadata: md }
})
if (JSON.stringify(strippedOn) !== JSON.stringify(off)) {
  failures.push("IDENTITY: flag-ON output differs from flag-OFF beyond the claim metadata (edges/targets/lines/other metadata changed)")
} else {
  console.log(`identity PASS — ${off.length} row(s); ${claimsOf(on).length} claim row(s); only claim keys differ`)
}

// ---- CLAIM: the four named shapes -------------------------------------------------------------
const find = (rows: any[], type: string, target: string) => rows.find((r) => r.type === type && String(r.target) === target)
const expectClaim = (rows: any[], type: string, target: string, note: string) => {
  const r = find(rows, type, target)
  if (!r) { failures.push(`CLAIM: row not found ${type} -> ${target} (${note})`); return }
  const ns = r.metadata?.languageNamespace
  if (!Array.isArray(ns) || ns.length !== 1 || ns[0] !== target) failures.push(`CLAIM: ${type} -> ${target} languageNamespace != ["${target}"] (got ${JSON.stringify(ns)})`)
  if (r.metadata?.languageNamespacePolicy !== "strict-absent") failures.push(`CLAIM: ${type} -> ${target} missing languageNamespacePolicy:"strict-absent" (got ${JSON.stringify(r.metadata?.languageNamespacePolicy)})`)
}
const expectUnmarked = (rows: any[], type: string, target: string, note: string) => {
  const r = find(rows, type, target)
  if (!r) { failures.push(`CLAIM: row not found ${type} -> ${target} (${note})`); return }
  if (claimsOf([r]).length > 0) failures.push(`CLAIM: ${type} -> ${target} must be UNMARKED (${note}) but carries ${JSON.stringify(r.metadata?.languageNamespace)}`)
}

expectClaim(on, "references", "override", "listed bare annotation")
expectUnmarked(on, "references", "NotListed", "unlisted annotation")
expectClaim(on, "instantiates", "Duration", "listed capitalized type use")
expectUnmarked(on, "uses", "target", "lowercase vocabulary member read — type-shaped narrowing")

// ---- INVARIANT on every claimed row ------------------------------------------------------------
for (const r of claimsOf(on)) {
  const t = String(r.target)
  if (!DART_CITATION_ROOTS.has(t)) failures.push(`INVARIANT: claimed target '${t}' is not in the vocabulary`)
  if (r.metadata?.languageNamespacePolicy !== "strict-absent") failures.push(`INVARIANT: claimed target '${t}' lacks the strict-absent policy`)
  const isAnnotation = r.metadata?.isAnnotation === true
  const capitalized = /^[A-Z]/.test(t)
  if (!isAnnotation && !capitalized) failures.push(`INVARIANT: claimed target '${t}' is neither an annotation row nor a capitalized type-shaped target`)
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`)
  console.error(`citation fixtures: ${failures.length} failure(s)`)
  process.exit(3)
}
console.log("citation fixtures PASS — drift, identity (flag off byte-identical beyond claims), listed claim + policy, unlisted unmarked, lowercase narrowing, invariant on every claimed row")
