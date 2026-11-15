/**
 * THE LOCAL-READ PHANTOM LINK — a `uses` edge that once asserted a dependency which did not
 * exist. This file now guards the FIX, and carries the measurement that forced it.
 *
 * ## The shape, in two files that never met
 *
 *   reads.dart     declares its OWN `counter` in a function body and reads it. It imports
 *                  nothing, names no other declaration and depends on nothing outside itself.
 *   declares.dart  declares `class Telemetry { int counter = 0; }` — an unrelated class, in
 *                  another file, with a common English field name. Nothing unusual.
 *
 * The dart analyzer publishes that read as `uses run -> counter` with `metadata.isLocalRead`,
 * which is correct and deliberate: the read IS of a local, and the marker says so. But the
 * `target` was the BARE name, and the target is what the store resolves — not the marker.
 *
 * `parallel-indexer.ts:resolveRelationships` matches a target in two passes:
 *   Strategy 1  exact `qualified_name` match (`_res_qname`)
 *   Strategy 2  bare `name` match, admitted only while `_res_name.cnt = 1` for that name
 * Neither pass reads the edge's metadata. The local is not a symbol (locals never are), so the
 * only `counter` in the project's key space is Telemetry's field — and Strategy 2 bound the
 * read to it. The stored row said `run` depends on `Telemetry.counter`: a dependency between
 * two files that never met, invented by a rule working exactly as designed.
 *
 * MEASURED ON THAT SPELLING, with this probe in its first (RED) form, before the fix:
 *   `uses run -> counter` → classifyEdge says `resolved` (decls=1, kinds=field)
 *   the declaration it bound to lives in local-read/declares.dart as Telemetry.counter
 * The fix is the SPELLING: a binding target is `<callable>#<binding>` (`BINDING_SEP`,
 * `src/ast/types.ts`) and the edge carries `metadata.localBinding`. `#` cannot occur in an
 * identifier, so the string can never name a declaration — Strategy 1 and Strategy 2 both miss
 * it, and the store leaves the edge alone.
 *
 * ## Why this is checked with the GATE's rule rather than with a copy of it
 *
 * A census that counts edges differently from the arbiter is about a different question, so
 * this probe imports `classifyEdge` from `script/m14/incoming-rule.ts` — the same function the
 * whole-corpus gate calls — and builds its key space the same way (`name` plus the
 * `qualifiedName` alias, one increment per alias, as `incoming-gate.ts:measure` does). There is
 * one counting rule in this programme and this file does not add a second.
 *
 * ## WHAT THE EXIT CODE MEANS
 *
 * It exits 0 when the fix HOLDS: the binding is spelled so no lookup can bind it, the claim is
 * verified by that spelling, and the counterfactual proves the spelling is what does the work
 * (strip it and the store's own rule resolves the bare name to the OTHER file again, exactly as
 * it did before the fix). Exit 1 means the false link is reachable again or the analyzer
 * changed shape — re-read this file rather than trusting anything downstream of it.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/local-read-phantom.ts
 */
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge } from "../../../../script/m14/incoming-rule"
import { BINDING_SEP } from "../../../../src/ast/types"

const HERE = (import.meta as any).dirname
const READS = path.join(HERE, "local-read/reads.dart")
const DECLARES = path.join(HERE, "local-read/declares.dart")

let failures = 0
const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${label} — ${detail}`)
}

type Sym = { name?: string; kind?: string; qualifiedName?: string; ownerName?: string }
type Rel = {
  type?: string
  relationshipType?: string
  source?: string
  from?: string
  target?: string
  to?: string
  metadata?: Record<string, unknown>
}

const reads = (await parseFile(READS, HERE)) as { symbols?: Sym[]; relationships?: Rel[] }
const declares = (await parseFile(DECLARES, HERE)) as { symbols?: Sym[]; relationships?: Rel[] }

// ---------------------------------------------------- the key space, by the gate's own rule
const declCount = new Map<string, number>()
const kinds = new Map<string, Set<string>>()
let aliasedKeys = 0
/** Which FILE each bare name's declaration lives in — the fact the phantom link turns on. */
const bareNameFile = new Map<string, string>()
const files: [string, { symbols?: Sym[] }][] = [
  ["local-read/reads.dart", reads],
  ["local-read/declares.dart", declares],
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
    // The qualifiedName ALIAS, counted as the SAME declaration — `incoming-gate.ts:measure`.
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== name) {
      bump(q)
      aliasedKeys++
    }
  }
}

// ------------------------------------------------------------------ the edge under test
const localReads = (reads.relationships ?? []).filter(
  (r) =>
    String(r.type ?? "") === "uses" &&
    r.metadata?.isLocalRead === true &&
    r.metadata?.localBinding === true,
)
const edge = localReads[0]
const target = String(edge?.target ?? "")
const source = String(edge?.source ?? "")
const sepAt = target.lastIndexOf(BINDING_SEP)
const bindingName = sepAt >= 0 ? target.slice(sepAt + 1) : ""
const boundFile = bareNameFile.get(bindingName) ?? null
const boundSymbols = [
  ...(reads.symbols ?? []).map((s) => ({ file: "local-read/reads.dart", s })),
  ...(declares.symbols ?? []).map((s) => ({ file: "local-read/declares.dart", s })),
].filter((x) => String(x.s.name ?? "") === bindingName)
const claim = { kind: "binding" as const }
const classified = edge ? classifyEdge(declCount, kinds, target, claim) : null
const bareClassified = bindingName ? classifyEdge(declCount, kinds, bindingName, null) : null
const bareWithClaim = bindingName ? classifyEdge(declCount, kinds, bindingName, claim) : null

console.log(`local-read phantom link (guarding the fix)`)
console.log(
  `key space: ${declCount.size} keys from 2 files (${aliasedKeys} qualifiedName alias(es)); ` +
    `the local read is \`uses ${source || "?"} -> ${target || "?"}\``,
)
console.log("")

// (1) The edge is still emitted, and now carries BOTH parts of the claim: the legacy
//     `isLocalRead` label and the `localBinding` key the arbiter reads.
check(
  "the local read is emitted and carries the binding claim",
  localReads.length > 0 && edge?.metadata?.localBinding === true,
  localReads.length > 0
    ? `metadata.isLocalRead + metadata.localBinding both present`
    : "NO EDGE WITH metadata.localBinding — the analyzer changed shape, re-read this file",
)

// (2) The target is spelled so that no published symbol can carry it, and it still names the
//     local: the part after the separator IS the binding the analyzer resolved.
check(
  "the target is SPELLED as a binding",
  sepAt > 0 && sepAt < target.length - 1 && bindingName === "counter" && target.startsWith(source),
  `${JSON.stringify(target)} = \`${source}\` + \`${BINDING_SEP}\` + \`${bindingName}\` — ` +
    `the enclosing callable, then the binding it reads`,
)

// (3) The local is not a symbol, so nothing in its OWN file can ever answer the target — the
//     half that makes the spelling necessary rather than decorative. The CALLABLE is checked
//     separately because it is the opposite case: `run` IS published (a top-level function is a
//     declaration), which is why the spelling may name it on the left of the separator.
check(
  "the LOCAL is not a published symbol, but its callable is",
  !(reads.symbols ?? []).some((s) => String(s?.name ?? "") === bindingName) &&
    (reads.symbols ?? []).some((s) => String(s?.name ?? "") === source),
  `no symbol named \`${bindingName}\` in reads.dart (locals are never published, DARTD8) while ` +
    `\`${source}\` IS published: a lookup for the BINDING can only ever find someone else's ` +
    `declaration of the same name, and the spelling is the only thing that says which half is ` +
    `which`,
)

// (4) THE FIX: the arbiter's own rule reads the claim, and the claim is verified by the
//     spelling. Note what this is NOT: not `resolved` (nothing was resolved — there is nothing
//     to resolve to) and not `unresolved` (nothing is missing).
check(
  "THE CLAIM HOLDS: the arbiter verifies the binding by its spelling",
  classified?.outcome === "bindingVerified" && classified?.verifiedBy === "binding",
  classified === null
    ? "no edge to classify"
    : `classifyEdge says \`${classified.outcome}\` (decls=${classified.decls}, ` +
      `kinds=${classified.kinds}, verifiedBy=${classified.verifiedBy ?? "-"})`,
)

// (5) THE COUNTERFACTUAL, and the reason this file is worth keeping: put the bare spelling back
//     and the store's own rule resolves it to the unrelated class again — the exact stored row
//     this round exists to remove. Measured with the same rule and the same key space, so the
//     two outcomes are comparable, and it is what makes the fix LOAD-BEARING rather than
//     cosmetic: it is not that the analyzer stopped emitting the edge, it is that the string it
//     emits can no longer be bound.
check(
  "COUNTERFACTUAL: the bare name would be bound to the OTHER file",
  bareClassified?.outcome === "resolved" && boundFile === "local-read/declares.dart",
  bareClassified === null
    ? "no binding name to test"
    : `with no claim, classifyEdge on \`${bindingName}\` says \`${bareClassified.outcome}\` ` +
      `(decls=${bareClassified.decls}, kinds=${bareClassified.kinds}) and the declaration it ` +
      `binds to lives in ${boundFile ?? "(none)"}` +
      (boundSymbols.length
        ? ` as ${boundSymbols.map((b) => `${b.s.ownerName ?? b.s.qualifiedName ?? ""}.${b.s.name}`).join(", ")}`
        : ""),
)

// (6) The belt to that brace: if a future revision drops the spelling but keeps the claim, the
//     arbiter still refuses the edge. A one-sided fix (spelling without claim, or claim without
//     spelling) is caught here rather than in a whole-corpus run.
check(
  "AND the claim alone catches a lost spelling",
  bareWithClaim?.outcome === "bindingRefuted",
  bareWithClaim === null
    ? "no binding name to test"
    : `classifyEdge on the bare \`${bindingName}\` WITH the binding claim says ` +
      `\`${bareWithClaim.outcome}\` — a marked edge whose target could name a declaration is ` +
      `counted against the lane`,
)

console.log("")
if (failures === 0) {
  console.log(
    `THE PHANTOM LINK IS CLOSED. The stored row can no longer bind \`${source}\` in reads.dart to a`,
  )
  console.log(
    `field of an unrelated class in declares.dart, and the counterfactual above shows the spelling is`,
  )
  console.log(
    `what closes it: remove \`${BINDING_SEP}\` and the store's own rule re-creates the false link.`,
  )
  console.log(`exit 0 = fix holds.`)
  process.exit(0)
}
console.log(
  `${failures} check(s) FAILED — the false link is reachable again, or the analyzer changed shape.`,
)
console.log(`Do not trust anything downstream of this file until it reads 0 failures.`)
process.exit(1)
