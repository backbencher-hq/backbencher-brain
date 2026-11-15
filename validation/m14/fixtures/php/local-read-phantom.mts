/**
 * THE LOCAL-READ PHANTOM LINK, php — a `uses` edge that asserts a dependency which does not exist.
 *
 * ## The shape, in two files that never met
 *
 *   reads.php      declares its OWN `$counter` inside a function body, reads it, and names
 *                  nothing outside itself.
 *   declares.php   declares `class Telemetry { public int $counter = 0; }` — an unrelated class,
 *                  in another file, with a common English field name.
 *
 * The php analyzer publishes that read as `uses run -> counter` with `metadata.isLocalRead`, which
 * is correct and deliberate: the read IS of a local, and the marker says so. But the `target` was
 * the BARE name, and the target is what the store resolves — not the marker.
 *
 * `parallel-indexer.ts:resolveRelationships` matches a target in two passes:
 *   Strategy 1  exact `qualified_name` match
 *   Strategy 2  bare `name` match, admitted only while the name is declared exactly once in the
 *               project
 * Neither pass reads the edge's metadata. Locals are never published as symbols (the family
 * contract, `src/ast/types.ts:148-190`), so the only `counter` in the key space is Telemetry's
 * property — and Strategy 2 binds the read to it.
 *
 * MEASURED ON THE BARE SPELLING (before the fix, 2026-10-11):
 *   `uses run -> counter` → classifyEdge says `resolved`, decls=1, kinds=property
 *   the declaration it binds to lives in local-read/declares.php
 * The same held for `summary` (bound to `Report::$summary`) through TWO arms at once,
 * `isSubscriptBase` and `isLocalRead`.
 *
 * ## The fix is the SPELLING, and the family already had it
 *
 * A binding target is `<read source>\0<binding>` (`BINDING_SEP`, `src/ast/types.ts`) and the edge
 * carries `metadata.localBinding` — the claim key `incoming-rule.ts` checks FIRST and verifies by
 * the target's own spelling. Dart took this route for the identical defect
 * (`validation/m14/fixtures/dart/local-read-phantom.ts`); php's lane was four arms behind it.
 *
 * ## Why this is checked with the GATE's rule rather than with a copy of it
 *
 * A census that counts edges differently from the arbiter is about a different question, so this
 * probe imports `classifyEdge` from `script/m14/incoming-rule.ts` — the same function the
 * whole-corpus gate calls — and builds its key space the same way (`name` plus the
 * `qualifiedName` alias, one increment per alias, as `incoming-gate.ts:measure` does).
 *
 * ## WHAT THE EXIT CODE MEANS
 *
 * 0 when the fix HOLDS: the binding is spelled so no lookup can bind it, the claim is verified by
 * that spelling, and the counterfactual proves the spelling is what does the work (strip it and
 * the gate's own rule resolves the bare name to the OTHER file again). Exit 1 means the false
 * link is reachable again or the analyzer changed shape.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/php/local-read-phantom.mts
 */
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge } from "../../../../script/m14/incoming-rule"
import { BINDING_SEP } from "../../../../src/ast/types"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const READS = path.join(HERE, "local-read/reads.php")
const DECLARES = path.join(HERE, "local-read/declares.php")

let failures = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${label} — ${detail}`)
}

type Sym = { name?: string; kind?: string; qualifiedName?: string; ownerName?: string }
type Rel = { type?: string; relationshipType?: string; source?: string; target?: string; metadata?: Record<string, unknown> }

const reads = (await parseFile(READS, HERE)) as { symbols?: Sym[]; relationships?: Rel[] }
const declares = (await parseFile(DECLARES, HERE)) as { symbols?: Sym[]; relationships?: Rel[] }

// ---------------------------------------------------- the key space, by the gate's own rule
const declCount = new Map<string, number>()
const kinds = new Map<string, Set<string>>()
let aliasedKeys = 0
const bareNameFile = new Map<string, string>()
const files: [string, { symbols?: Sym[] }][] = [
  ["local-read/reads.php", reads],
  ["local-read/declares.php", declares],
]
for (const [file, result] of files) {
  for (const s of result.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    const bump = (key: string) => {
      declCount.set(key, (declCount.get(key) ?? 0) + 1)
      const set = kinds.get(key) ?? new Set<string>()
      set.add(kind)
      kinds.set(key, set)
      bareNameFile.set(key, file)
    }
    bump(name)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== name) { bump(q); aliasedKeys++ }
  }
}

// ------------------------------------------------------------------ the edges under test
const VAR_ARMS = ["isLocalRead", "isGlobalRead", "isSubscriptBase", "isClosureCapture", "isInterpolationRead"]
const varReads = (reads.relationships ?? []).filter(
  (r) => String(r.type ?? "") === "uses" && VAR_ARMS.some((k) => r.metadata?.[k] === true),
)
const localReads = varReads.filter((r) => r.metadata?.localBinding === true && String(r.target ?? "").includes(BINDING_SEP))
/**
 * A PHANTOM IS NOT "ANY VARIABLE READ" — it is a variable read whose BARE name the key space
 * RESOLVES to a declaration in the OTHER file. Selecting the first edge instead picks a binding
 * that collides with nothing (`$xs` here), and then neither the RED run nor the GREEN one names
 * the false link this file exists to demonstrate. The selection therefore runs the SAME test in
 * both states, on the name the separator carries when it is present.
 */
const phantomOf = (r: Rel): boolean => {
  const t = String(r.target ?? "")
  const at = t.includes(BINDING_SEP) ? t.lastIndexOf(BINDING_SEP) : -1
  const n = at >= 0 ? t.slice(at + 1) : t
  const c = classifyEdge(declCount, kinds, n, null)
  return c.outcome === "resolved" && bareNameFile.get(n) === "local-read/declares.php"
}
const edge = varReads.find(phantomOf) ?? localReads[0] ?? varReads[0]
const fixed = edge !== undefined && edge.metadata?.localBinding === true
const target = String(edge?.target ?? "")
const source = String(edge?.source ?? "")
const sepAt = fixed ? target.lastIndexOf(BINDING_SEP) : -1
const bindingName = fixed ? target.slice(sepAt + 1) : target
const boundFile = bareNameFile.get(bindingName) ?? null
const boundSymbols = [
  ...(reads.symbols ?? []).map((s) => ({ file: "local-read/reads.php", s })),
  ...(declares.symbols ?? []).map((s) => ({ file: "local-read/declares.php", s })),
].filter((x) => String(x.s.name ?? "") === bindingName)
const claim = { kind: "binding" as const }
const classified = edge ? classifyEdge(declCount, kinds, target, claim) : null
const bareClassified = bindingName ? classifyEdge(declCount, kinds, bindingName, null) : null
const bareWithClaim = bindingName ? classifyEdge(declCount, kinds, bindingName, claim) : null

console.log(`php local-read phantom link (guarding the fix)`)
console.log(
  `key space: ${declCount.size} keys from 2 files (${aliasedKeys} qualifiedName alias(es)); ` +
    `the local read is \`uses ${source || "?"} -> ${JSON.stringify(target || "?")}\``,
)
console.log("")

check(
  "the local read is emitted and carries the binding claim",
  localReads.length > 0 && edge?.metadata?.localBinding === true,
  localReads.length > 0
    ? `${localReads.length} edge(s) with metadata.isLocalRead + metadata.localBinding`
    : "NO EDGE WITH metadata.localBinding — the analyzer changed shape, re-read this file",
)

check(
  "the target is SPELLED as a binding",
  sepAt > 0 && sepAt < target.length - 1 && bindingName === "counter" && target.startsWith(source),
  `${JSON.stringify(target)} = \`${source}\` + \`${BINDING_SEP.replace(/\0/g, "\\0")}\` + \`${bindingName}\` — ` +
    `the read's own source, then the binding it reads`,
)

check(
  "the LOCAL is not a published symbol, but its callable is",
  !(reads.symbols ?? []).some((s) => String(s?.name ?? "") === bindingName) &&
    (reads.symbols ?? []).some((s) => String(s?.name ?? "") === source),
  `no symbol named \`${bindingName}\` in reads.php (locals are never published) while \`${source}\` IS ` +
    `published: a lookup for the BINDING can only ever find someone else's declaration of the same name, ` +
    `and the spelling is the only thing that says which half is which`,
)

check(
  "THE CLAIM HOLDS: the arbiter verifies the binding by its spelling",
  classified?.outcome === "bindingVerified" && classified?.verifiedBy === "binding",
  classified === null
    ? "no edge to classify"
    : `classifyEdge says \`${classified.outcome}\` (decls=${classified.decls}, kinds=${classified.kinds}, verifiedBy=${classified.verifiedBy ?? "-"})`,
)

check(
  "COUNTERFACTUAL: the bare name would be bound to the OTHER file",
  bareClassified?.outcome === "resolved" && boundFile === "local-read/declares.php",
  bareClassified === null
    ? "no binding name to test"
    : `with no claim, classifyEdge on \`${bindingName}\` says \`${bareClassified.outcome}\` ` +
      `(decls=${bareClassified.decls}, kinds=${bareClassified.kinds}) and the declaration it binds to lives in ` +
      `${boundFile ?? "(none)"}` +
      (boundSymbols.length ? ` as ${boundSymbols.map((b) => `${b.s.ownerName ?? b.s.qualifiedName ?? ""}.${b.s.name}`).join(", ")}` : ""),
)

check(
  "AND the claim alone catches a lost spelling",
  bareWithClaim?.outcome === "bindingRefuted",
  bareWithClaim === null
    ? "no binding name to test"
    : `classifyEdge on the bare \`${bindingName}\` WITH the binding claim says \`${bareWithClaim.outcome}\` — a marked ` +
      `edge whose target could name a declaration is counted against the lane`,
)

// ── THE OTHER ARMS, kept in one probe because fixing one site of a multi-site defect is itself
//    the defect this programme has recorded three times. Each entry names the metadata key, so a
//    future change that spells one arm and not another is visible HERE rather than in a corpus run.
{
  const arms: [string, (r: Rel) => boolean, string][] = [
    ["isLocalRead", (r) => r.metadata?.isLocalRead === true, "counter"],
    ["isSubscriptBase", (r) => r.metadata?.isSubscriptBase === true, "summary"],
  ]
  for (const [arm, pred, want] of arms) {
    const hit = (reads.relationships ?? []).filter((r) => String(r.type ?? "") === "uses" && pred(r))
    const spelled = hit.filter((r) => String(r.target ?? "").includes(BINDING_SEP) && r.metadata?.localBinding === true)
    const names = [...new Set(hit.map((r) => String(r.target ?? "").split(BINDING_SEP).pop() ?? ""))]
    // EVERY edge of the arm must be spelled — not merely one — and the exemplar the arm was chosen
    // for must be among them. The first version demanded that EVERY edge end with the exemplar,
    // which no multi-binding arm can satisfy; a check that cannot pass is not a check.
    check(
      `arm ${arm} is spelled as a binding, in full`,
      hit.length > 0 && spelled.length === hit.length && names.includes(want),
      `${spelled.length} of ${hit.length} \`${arm}\` edge(s) carry the separator + \`localBinding\`; ` +
        `bindings seen: ${names.join(", ")}` +
        (hit.length === 0 ? " — ARM PRODUCES NO EDGE IN THIS FIXTURE, so it is not covered here" : ""),
    )
  }
}

console.log("")
if (failures === 0) {
  console.log(`THE PHANTOM LINK IS CLOSED. The stored row can no longer bind \`${source}\` in reads.php to a field`)
  console.log(`of an unrelated class in declares.php, and the counterfactual above shows the spelling is what`)
  console.log(`closes it: remove \`${BINDING_SEP.replace(/\0/g, "\\0")}\` and the gate's own rule re-creates the false link.`)
  console.log(`exit 0 = fix holds.`)
  process.exit(0)
}
console.log(`${failures} check(s) FAILED — the false link is reachable again, or the analyzer changed shape.`)
console.log(`Do not trust anything downstream of this file until it reads 0 failures.`)
process.exit(1)
