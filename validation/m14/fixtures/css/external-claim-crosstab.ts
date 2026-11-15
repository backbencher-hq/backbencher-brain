/**
 * CSS EXTERNAL-CLAIM CROSS-TAB — the two sides of the `references` remainder, and the falsifier
 * that says whether a declared-external claim could ever VERIFY one.
 *
 * WHY. After CSS-D15 the lane's residual is `references` 180 ambiguous + 4,803 unresolved, and
 * 4,803 is one class: dotless custom-property reads (`var(--fa-animation-duration)`,
 * `var(--pico-*)`, `var(--bulma-*)`) — the CSS customization hook, a stylesheet reading a
 * property it deliberately does not declare. The fleet rule for that shape is settled across four
 * lanes: a name genuinely outside the population gets the external marker, and the project's own
 * declarations are what verify or refute it. This file answers the two questions that rule
 * requires BEFORE a marker is written, because `yaml` is the counter-example: it attached an
 * external NAME claim to a literal path and the gate refuted 103 of them through the file's stem.
 *
 *   1. THE TARGET SIDE — is the name declared in the edge's own PROJECT (which would make any
 *      "outside" claim false), in ANOTHER project of the corpus (cross-project, not external), or
 *      nowhere in the 1,174-file population at all?
 *   2. THE VERIFIER SIDE — what does the arbiter's OWN `verifyExternalClaim` return for these
 *      targets if the marker is attached? It is imported, not re-implemented, so this cannot
 *      drift from the rule that will grade the marker.
 *
 * THE CONTROLS ARE THE POINT, and they are what make the second answer a finding rather than an
 * opinion: a JS-shaped dotless name that nothing declares MUST verify, the same name declared in
 * the key space MUST refute, and the lane's own `--x` spelling is then run through the SAME
 * function. The third result is the one that decides whether a marker in this lane can ever do
 * more than move an edge from one non-passing column to another.
 *
 * Usage: npx tsx validation/m14/fixtures/css/external-claim-crosstab.ts [--json]
 */
import { readFileSync, statSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { emptyOutcomes, tally, classifyEdge, externalClaimOf, verifyExternalClaim } from "../../../../script/m14/incoming-rule"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

// THE LANE'S DECLARED POPULATION IS `css,less`, not `.css`. `d43a5fa4d` (the population gate)
// found css measuring a fraction of its own language — the router maps `.less` to css — and set
// the lane to BOTH extensions in `incoming-gate.ts` and `residual-gate.ts`. This instrument
// walked `.css` only until 2026-10-10, which is why it read `imports` 127 where the gate reads
// 178: a POPULATION difference, not a parse difference. Override with BB_CSS_EXTS.
const LANE_EXTS = (process.env.BB_CSS_EXTS ?? "css,less").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)


function discover(): string[] {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!LANE_EXTS.some((x) => rel.toLowerCase().endsWith("." + x))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  return found.sort()
}

const files = discover()
const project = new Map<string, Map<string, number>>()   // repo -> key -> declarations
const pooled = new Map<string, number>()
const edges: { repo: string; type: string; target: string }[] = []
let parsed = 0, failed = 0
for (const f of files) {
  const repo = f.slice(CR.length + 1).split(path.sep)[0]
  if (!project.has(repo)) project.set(repo, new Map())
  const d = project.get(repo)!
  let res: any
  try { res = await parseFile(f, readFileSync(f, "utf8")) } catch { failed++; continue }
  parsed++
  const countKey = (key: string) => { if (!key) return; d.set(key, (d.get(key) ?? 0) + 1); pooled.set(key, (pooled.get(key) ?? 0) + 1) }
  for (const s of res.symbols ?? []) {
    const name = String(s?.name ?? ""); if (!name) continue
    countKey(name)
    const q = String(s?.qualifiedName ?? ""); if (q && q !== name) countKey(q)
  }
  for (const r of res.relationships ?? []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (t !== "references" && t !== "imports") continue
    edges.push({ repo, type: t, target: String(r.target ?? "") })
  }
}

// ── the cross-tab: the target side, per dotless custom-property read
const dotless = edges.filter((e) => e.target.startsWith("--") && !e.target.includes("."))
const bucket = { declaredInProject: 0, declaredOnlyElsewhereInCorpus: 0, declaredNowhere: 0, resolvedInProject: 0 }
const ambiguousOrResolved = { resolved: 0, ambiguous: 0, unresolved: 0 }
for (const e of dotless) {
  const d = project.get(e.repo)!
  const inProject = d.get(e.target) ?? 0
  const inPooled = pooled.get(e.target) ?? 0
  if (inProject === 1) { bucket.resolvedInProject++; ambiguousOrResolved.resolved++; continue }
  if (inProject > 1) { ambiguousOrResolved.ambiguous++; continue }
  ambiguousOrResolved.unresolved++
  if (inPooled > 0) bucket.declaredOnlyElsewhereInCorpus++
  else bucket.declaredNowhere++
}

// ── the verifier side, through the arbiter's OWN function
const verdictCounts: Record<string, number> = {}
for (const e of dotless) {
  const d = project.get(e.repo)!
  const v = verifyExternalClaim(d, e.target)
  verdictCounts[v] = (verdictCounts[v] ?? 0) + 1
}

// ── CONTROLS: the mechanism must be able to verify, and to refute, before either 0 above means
// anything. The sigil pair is the one that mattered: BEFORE the arbiter was widened
// (11fb2e07e) both arms returned `externalUnverified` — a refusal that gave the same verdict for
// a true and a false claim — and after it the two arms must DISAGREE, which is what makes the
// marker a verification rather than a label.
const controlVerify = verifyExternalClaim(new Map(), "notDeclaredAnywhereAtAll")
const controlRefute = verifyExternalClaim(new Map([["notDeclaredAnywhereAtAll", 1]]), "notDeclaredAnywhereAtAll")
const controlSigil = verifyExternalClaim(new Map(), "--pico-color")
const controlSigilDeclared = verifyExternalClaim(new Map([["--pico-color", 1]]), "--pico-color")
const controls = {
  jsShapedUndeclared: controlVerify,
  jsShapedDeclared: controlRefute,
  sigilUndeclared: controlSigil,
  sigilDeclared: controlSigilDeclared,
}
const controlFires =
  controlVerify === "externalVerified" &&
  controlRefute === "externalRefuted" &&
  controlSigil === "externalVerified" &&
  controlSigilDeclared === "externalRefuted"

console.log("css external-claim cross-tab — the `references` dotless custom-property remainder")
console.log(`population ${parsed} parsed of ${files.length} admitted .css files (${failed} failed)`)
console.log(`references edges ${edges.length}; dotless custom-property reads ${dotless.length}`)
console.log("")
console.log("TARGET SIDE (declared where?)")
console.log(`  resolved in the edge's own project (1 declaration)   ${bucket.resolvedInProject}`)
console.log(`  declared ONLY in another corpus project              ${bucket.declaredOnlyElsewhereInCorpus}`)
console.log(`  declared NOWHERE in the 1,174-file population        ${bucket.declaredNowhere}`)
console.log(`  of the remainder: resolved ${ambiguousOrResolved.resolved} · ambiguous ${ambiguousOrResolved.ambiguous} · unresolved ${ambiguousOrResolved.unresolved}`)
console.log("")
console.log("VERIFIER SIDE — arbiter's verifyExternalClaim(project key space, target), imported")
for (const k of Object.keys(verdictCounts).sort()) console.log(`  ${k.padEnd(20)} ${verdictCounts[k]}`)
console.log("")
console.log("CONTROLS (the same function, on planted spellings)")
console.log(`  JS-shaped, undeclared        -> ${controls.jsShapedUndeclared}   ${controls.jsShapedUndeclared === "externalVerified" ? "FIRES" : "DID NOT FIRE"}`)
console.log(`  JS-shaped, declared          -> ${controls.jsShapedDeclared}   ${controls.jsShapedDeclared === "externalRefuted" ? "FIRES" : "DID NOT FIRE"}`)
console.log(`  \`--pico-color\`, undeclared    -> ${controls.sigilUndeclared}   (declared: ${controls.sigilDeclared})   ${controlFires ? "the pair DISAGREES, which is what the widening bought" : "STILL BLIND"}`)
console.log("")

// ── THE `imports` HALF, MEASURED BEFORE ANY CLAIM. The Lead's rule for this lane: an `@import`
// target is a FILE, `verifyFileClaim` REFUTES on a miss, and a URI is refused by the owner
// branch — so what these edges ARE has to be measured before a claim is written. Classified with
// the arbiter's own `classifyEdge` against the same project key space, with NO claim attached,
// and grouped by the SHAPE of the specifier, because the shape is what decides which claim (if
// any) could ever verify one.
const shapeOf = (t: string): string =>
  t.includes("://") ? "url" : t.startsWith("@") ? "npm/at-scope" : t.includes("/") ? "relative-path" : t.includes(".") ? "basename" : "bare"
const importEdges = edges.filter((e) => e.type === "imports")
const importsByShape: Record<string, Record<string, number>> = {}
for (const e of importEdges) {
  const d = project.get(e.repo)!
  const kinds = new Map<string, Set<string>>()
  for (const k of d.keys()) { let s = kinds.get(k); if (!s) kinds.set(k, (s = new Set())); s.add("decl") }
  const c = classifyEdge(d, kinds, e.target, null, undefined)
  const shape = shapeOf(e.target)
  importsByShape[shape] = importsByShape[shape] ?? {}
  importsByShape[shape][c.outcome] = (importsByShape[shape][c.outcome] ?? 0) + 1
}
console.log(`IMPORTS, ${importEdges.length} edges by specifier SHAPE x arbiter outcome (no claim attached)`)
for (const shape of Object.keys(importsByShape).sort()) {
  const outcomes = importsByShape[shape]
  console.log(`  ${shape.padEnd(15)} ${Object.entries(outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
}
console.log("")

const verdict = controlFires && parsed > 0
console.log(`VERDICT: ${verdict ? "cross-tab complete, controls fired" : "CONTROLS DID NOT FIRE — the counts above prove nothing"}`)
process.exitCode = verdict ? 0 : 1
