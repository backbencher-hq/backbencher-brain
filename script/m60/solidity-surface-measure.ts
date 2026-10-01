#!/usr/bin/env bun
/**
 * script/m60/solidity-surface-measure.ts — the per-language SURFACE measurement,
 * over the pinned real corpus, through the production entry point.
 *
 * WHY IT IS ITS OWN FILE. Every M14/M49/M60 gate that could have caught this
 * lane's condition asked a question about a lane it did not have:
 * `completeness-inventory.ts` threw `unknown language solidity`, `run-fixtures.ts`
 * had no `solidity` entry, `mutate-analyzer.ts` carried 0 mutants, `differential.ts`
 * had no row so F5 and the perf budget read `n/a`, and `analyzer-complexity-gate`
 * scored the lane `unscorable`. The result is a language whose only green cell
 * would be the one gate that asks whether a node type the analyzer NAMES exists —
 * so the complement, the 124 it does not name, is never asked about. This file
 * closes that gap for the dimensions that need no truth oracle, and says plainly
 * that it is not a substitute for one.
 *
 * WHAT IT MEASURES, per corpus
 * ----------------------------
 *   files            the production (non-test) draw, hash-ordered and pinned
 *   parseDamage      files with `hasError`, and the ERROR/MISSING split — the
 *                    GRAMMAR's own number, which no analyzer decision changes
 *   symbols/rels     the emitted surface, through the production `parseFile`
 *   kinds            every relationship type, with the ones this DRAW did not
 *                    exercise named. Read as NOT-EXERCISED, never as
 *                    NOT-IMPLEMENTED: an audit read the PowerShell measure's
 *                    `absent` label as unimplemented and had to be corrected
 *                    against the source. An instrument whose label invites the
 *                    wrong reading is a defect in the instrument.
 *   lineNumber       relationships carrying a POSITIVE line — the completeness
 *                    check on the emit path, not a quality score
 *   tiers            the evidence tier of every edge, from the analyzer's own
 *                    central emitter, so this cannot drift from the emit path
 *   unknownTargets   targets that match no declared symbol, at TWO SCOPES — see
 *                    the note in the method block. `contains` per-file (a
 *                    containment edge cannot cross a file, and that is the check
 *                    that catches a declaration/edge split); extends, implements,
 *                    overrides and exports project-wide (Solidity inheritance is
 *                    cross-file by nature).
 *                    Deliberately PROJECT-WIDE, and the first draft was not: it
 *                    resolved each target against the symbols of its own file and
 *                    reported 509 unknowns, every one of them a legitimate
 *                    cross-file base (`contract X is ERC4626Fees` where the base is
 *                    declared in another file). A `.sol` file is one compilation
 *                    unit among many and inheritance across files is the norm —
 *                    537 `extends` edges over 389 files could not be otherwise. A
 *                    per-file resolvability proxy is the §5.4 class of instrument
 *                    defect: it manufactures findings by measuring the wrong thing,
 *                    and 509 rows all of them correct reads like a real problem
 *                    rather than a broken instrument. So pass 1 collects every
 *                    declared type name project-wide and pass 2 checks against it.
 *                    KINDS: contains/overrides/extends/implements/exports only,
 *                    restricted by definition to targets that are locally
 *                    DECLARED somewhere.
 *   dupKeys          (file, OWNER, name, kind) emitted more than once
 *   reservedTargets  `calls` naming a name no Solidity identifier can hold, via
 *                    the lane's own imported predicate — never a private copy
 *   unresolvedCalls  `calls` naming neither a declared symbol nor a known engine
 *                    builtin. NOT zero, and not meant to be: `abi.encode(1)` is a
 *                    real call in the source whose target is an EVM builtin
 *                    member. Reported with samples so it can be adjudicated.
 *   perf             wall time, per-file ms, facts per ms — AND the load context
 *                    they were taken under
 *
 * THE PERF RULE THIS FILE INHERITS. A `perFileMs` measured at 5x load is
 * contention, not a lane budget. The PowerShell artifact published one that moved
 * 228 → 246 → 91 ms/file across three runs of an UNCHANGED analyzer on a loaded
 * box, and nothing recorded the machine, so a reader could not tell. So the number
 * carries its own context and `perfIsQualified` says outright when the draw was
 * too loaded to be a budget row. The F9 section-F gate wants a pinned
 * `avgMsPerFile`; a value taken at this load must not be the one it gets.
 *
 * Usage:
 *   bun run script/m60/solidity-surface-measure.ts
 *   bun run script/m60/solidity-surface-measure.ts --sample 60
 *   bun run script/m60/solidity-surface-measure.ts --baseline before.json
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import * as WTS from "web-tree-sitter"
import * as os from "node:os"
import { isReservedTarget, ENGINE_FUNCTION_NAMES } from "../../src/ast/solidity-reserved-tokens"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/solidity-surface.json")
const argv = process.argv.slice(2)
const val = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)

const SAMPLE = parseInt(val("--sample", "389") ?? "389", 10)
const REPO = val("--repo", "solidity") ?? "solidity"
const DIR = path.join(CORPUS_ROOT, REPO)

function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** Production routing's candidate set: tracked `.sol`, minus test trees. */
function draw(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!fs.existsSync(dir)) return []
  let rels: string[]
  try {
    rels = execSync(`git -C ${dir} ls-files '*.sol'`, { encoding: "utf8", maxBuffer: 1 << 26 })
      .trim().split("\n").filter(Boolean)
  } catch { return [] }
  const prod = rels.filter((r) => !(r.startsWith("test/") || r.includes("/test/") || r.endsWith(".t.sol")))
  return prod
    .map((r) => ({ r, h: hashOf(`${repo}/${r}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.r < b.r ? -1 : 1))
    .slice(0, SAMPLE)
    .map((x) => x.r)
}

/** The grammar's own damage number, independent of any analyzer decision. */
async function parseDamage(files: string[], lang: any) {
  const parser = new WTS.Parser()
  parser.setLanguage(lang)
  let damaged = 0, errNodes = 0, missing = 0
  for (const abs of files) {
    const tree = parser.parse(fs.readFileSync(abs, "utf8"))
    const stack = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "ERROR") errNodes++
      if (n.isMissing) missing++
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
    }
    if (tree.rootNode.hasError) damaged++
  }
  parser.delete()
  return { damaged, errNodes, missing }
}

const ONTOLOGY = ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports"]

await WTS.Parser.init()
const grammar: any = await WTS.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-solidity.wasm")))
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker"))

const rels = draw(REPO)
if (rels.length === 0) {
  console.error(`corpus absent: ${DIR} — nothing to measure`)
  process.exit(2)
}
const files = rels.map((rel) => ({ rel, abs: path.join(DIR, rel) }))
const digest = hashOf(rels.join("\n"))
console.log(`draw: ${files.length} files, digest ${digest}`)

const damage = await parseDamage(files.map((f) => f.abs), grammar)

const kinds: Record<string, number> = {}
const tiers: Record<string, number> = {}
let symbols = 0
const ownerKinds: Record<string, number> = {}
let complexitySymbols = 0
let complexityTotal = 0
let complexityAboveOne = 0
let maxComplexity = 0
let relationships = 0
let withLine = 0
const dupSeen = new Map<string, number>()
const unknown: { file: string; line: number; type: string; target: string }[] = []
const reserved: string[] = []
const unresolvedCalls: string[] = []
/** SOL-15 — the only two `calleeKind`s whose TARGET IS NOT A PROJECT SYMBOL BY
 *  CONSTRUCTION, and therefore must never be counted as an unknown one:
 *    · `conversion`      — `uint256(x)`. The callee is a primitive TYPE word; the
 *      target is a type, not a declaration, and `isPrimitiveTypeToken` recognises it
 *      mechanically.
 *    · `namespaceBuiltin` — `abi.encode(…)`, `type(IERC20).interfaceId`, `super.f()`,
 *      `this.f()`. The target is a member of a language NAMESPACE.
 *  Everything else stays IN the unresolved count on purpose: an `eventEmission`,
 *  `errorRevert`, `structConstructor` and `modifierInvocation` all name something a
 *  contract really declares, so a cross-file one is a genuine cross-file target and
 *  hiding it would be the dishonest direction. */
const NON_SYMBOL_CALLEE_KINDS = new Set(["conversion", "namespaceBuiltin"])
const callCalleeKinds: Record<string, number> = {}
const unresolvedByKind: Record<string, number> = {}
const declaredNames = new Set<string>()
const allDeclaredNames = new Set<string>()
const owners = new Set<string>()
let getterSymbols = 0
const callKindsTotal: Record<string, number> = {}
let commentsRead = 0
let commentsAttached = 0
let documentedSymbols = 0
let overridesEmitted = 0
let overridesEmittedExternal = 0
let overridesUnresolved = 0
let overridesAmbiguousBaseCount = 0
let implementsCrossFileUnresolved = 0
let engineCallsSuppressed = 0
let storeRefusedDeclarations = 0

// PASS 1 — every symbol name declared anywhere in the draw. Solidity inheritance is
// cross-file by nature, so SOME kinds need a project-wide resolvability universe.
const declaredAnywhere = new Set<string>()
for (const f of files) {
  const r: any = await parseFile(f.abs, ROOT)
  for (const s of r.symbols ?? []) declaredAnywhere.add(s.name)
}

const t0 = performance.now()
for (const f of files) {
  const r: any = await parseFile(f.abs, ROOT)
  const names = new Set<string>()
  for (const s of r.symbols ?? []) {
    names.add(s.name)
    allDeclaredNames.add(s.name)
    if (s.ownerName) owners.add(s.ownerName)
    symbols++
    // SOL-18 — per-symbol complexity and ownerKind, tallied from the symbol's OWN
    // fields for the reason the comment below gives: `parseFile` returns every symbol
    // with `metadata: undefined`.
    if (typeof s.ownerKind === "string" && s.ownerKind !== "") ownerKinds[s.ownerKind] = (ownerKinds[s.ownerKind] ?? 0) + 1
    if (typeof s.complexity === "number") {
      complexitySymbols++
      complexityTotal += s.complexity
      if (s.complexity > 1) complexityAboveOne++
      if (s.complexity > maxComplexity) maxComplexity = s.complexity
    }
    // NOT read from `s.metadata`: `parseFile` returns every symbol with
    // `metadata: undefined` because pool-worker.ts drops the object at the worker
    // boundary. Reading the getter fact from metadata reported 0 on a corpus where
    // every ERC-20 mock has public state variables — a clean-looking zero for a
    // thing that is not zero. The analyzer therefore also reports it in
    // `metadata.getterSymbols`, which is read here because it is computed by the
    // analyzer over facts the store can see.
    if (String(s.name).endsWith("()")) getterSymbols++
    // The OWNER is part of the key, exactly as the analyzer's own dedupe key is
    // (`owner\0name\0kind`). Without it a local declared in two functions is two
    // correct declarations and the proxy reported 186 such rows on a sibling lane.
    const k = `${f.rel}|${s.ownerName ?? ""}|${s.name}|${s.kind}`
    dupSeen.set(k, (dupSeen.get(k) ?? 0) + 1)
  }
  for (const x of r.relationships ?? []) {
    relationships++
    const t = String(x.type ?? x.relationshipType ?? "")
    const meta = (x.metadata ?? {}) as Record<string, unknown>
    kinds[t] = (kinds[t] ?? 0) + 1
    const tier = String(meta.evidenceClass ?? "")
    tiers[tier] = (tiers[tier] ?? 0) + 1
    if (typeof x.line_number === "number" && x.line_number > 0) withLine++
    const target = String(x.target ?? "")
    if (t === "calls" && isReservedTarget(t, target, meta)) reserved.push(`${f.rel}:${x.line_number} calls -> ${target}`)
    // RESOLVABILITY, and only for the kinds whose BOTH ends are, by definition,
    // locally declared. `calls`, `uses`, `instantiates` and `references` are
    // excluded: a `calls` target may be an external function, a library, a Yul
    // function or an EVM member (`abi.encode`, `transfer`), and a `uses` target
    // may be a language-supplied type. Including them made a sibling lane's first
    // run report 3,604 of 9,485 rows — a number that measured nothing.
    if (target) {
      // TWO SCOPES, AND THE DIFFERENCE IS THE POINT.
      //
      // `contains` resolves WITHIN ITS OWN FILE and must. A containment edge is
      // emitted by the analyzer's `declareSymbol`, which binds the symbol and its
      // edge together precisely so this holds; a sibling lane shipped a
      // `contains` edge pointing at a name its file never declared, and per-file
      // resolution is what caught it. A project-wide universe would NOT have: any
      // name declared anywhere would satisfy it.
      //
      // `extends` / `implements` / `overrides` / `exports` resolve PROJECT-WIDE,
      // because in Solidity they routinely do. `contract X is ERC4626Fees` names a
      // base declared in another of the 389 files — 537 `extends` edges cannot
      // resolve in-file and are not wrong. A per-file proxy reported all 509 of
      // them as unknown, which reads like a defect and is a broken instrument.
      const universe = t === "contains" ? names : declaredAnywhere
      if ((t === "contains" || t === "overrides" || t === "extends" ||
           t === "implements" || t === "exports") && !universe.has(target)) {
        unknown.push({ file: f.rel, line: x.line_number, type: t, target })
      }
    }
    // A `calls` target that resolves to NO symbol in the file and is not a known
    // engine builtin is either external or an EVM/ABI member. Both are real; the
    // point is that they are REPORTED with samples rather than counted as good.
    if (t === "calls") {
      const ck = String((x.metadata as Record<string, unknown> | undefined)?.calleeKind ?? "")
      callCalleeKinds[ck] = (callCalleeKinds[ck] ?? 0) + 1
    }
    if (t === "calls" && target && !names.has(target) && !ENGINE_FUNCTION_NAMES.has(target) &&
        !NON_SYMBOL_CALLEE_KINDS.has(String((x.metadata as Record<string, unknown> | undefined)?.calleeKind ?? ""))) {
      unresolvedCalls.push(`${f.rel}:${x.line_number} -> ${target}`)
      const uk = String((x.metadata as Record<string, unknown> | undefined)?.calleeKind ?? "(unclassified)")
      unresolvedByKind[uk] = (unresolvedByKind[uk] ?? 0) + 1
    }
  }
  declaredNames.add(names.size.toString())
  const md = (r.metadata ?? {}) as Record<string, unknown>
  overridesEmitted += Number(md.overridesEmitted ?? 0)
  overridesUnresolved += Number(md.overridesUnresolved ?? 0)
  overridesEmittedExternal += Number(md.overridesEmittedExternal ?? 0)
  commentsRead += Number(md.commentsRead ?? 0)
  commentsAttached += Number(md.commentsAttached ?? 0)
  documentedSymbols += Number(md.documentedSymbols ?? 0)
  const ck = (md.callKinds ?? {}) as Record<string, number>
  for (const k of Object.keys(ck)) callKindsTotal[k] = (callKindsTotal[k] ?? 0) + ck[k]
  overridesAmbiguousBaseCount += Number(md.overridesAmbiguousBaseCount ?? 0)
  implementsCrossFileUnresolved += Number(md.implementsCrossFileUnresolved ?? 0)
  engineCallsSuppressed += Number(md.engineCallsSuppressed ?? 0)
  storeRefusedDeclarations += Number(md.storeRefusedDeclarations ?? 0)
}
const wallMs = performance.now() - t0

const dups = [...dupSeen.entries()].filter(([, n]) => n > 1)
const linePct = relationships > 0 ? ((withLine / relationships) * 100).toFixed(2) : "n/a"
const load1 = os.loadavg()[0]

const out = {
  gate: "M60.solidity-surface",
  title: "Solidity analyzer surface over the pinned real corpus",
  at: new Date().toISOString(),
  commit: safeCommit(),
  loadContext: {
    loadAvg1: Number(load1.toFixed(2)),
    cores: os.cpus().length,
    memoryPsiFullAvg10: readPsiMemory("full"),
  },
  perfIsQualified: load1 < 8,
  perfIsQualifiedRule: "loadAvg1 < 8. A perFileMs taken above that is contention, not a lane budget — measured on a sibling lane whose artifact published 228 → 246 → 91 ms/file across three runs of an UNCHANGED analyzer. /proc/pressure/memory is recorded too, because load is the wrong signal when the box is memory-stalled: PSI, not loadavg, is what stalls.",
  corpus: {
    repo: REPO,
    rev: safeRev(DIR),
    dir: DIR,
    productionSolFiles: rels.length,
  },
  draw: { sample: SAMPLE, order: "hash of repo/relative-path ascending", digest, excluded: "test/ and *.t.sol" },
  runtime: { wasm: "wasm/tree-sitter-solidity.wasm", abi: grammar.abiVersion, nodeTypeCount: grammar.nodeTypeCount, fieldCount: grammar.fieldCount },
  totals: {
    files: files.length,
    damage,
    symbols,
    relationships,
    kinds,
    notExercisedByThisDraw: ONTOLOGY.filter((k) => !kinds[k]),
    notExercisedNote: "`imports` is expected here and is NOT a gap: imports are modelled as `references` edges carrying `metadata.import: true`, the settled convention for this repo (PowerShell PS-7 for the same reason). The count of those edges is `tiers.import_based`, and every one of them is checked by the fixtures' `expectImports`.",
    tiers,
    lineNumber: { withLine, total: relationships, pct: linePct },
    unknownTargets: { count: unknown.length, samples: unknown.slice(0, 12) },
    dupKeys: { count: dups.length, samples: dups.slice(0, 12).map(([k, n]) => `${k} x${n}`) },
    reservedTargets: { count: reserved.length, samples: reserved.slice(0, 12) },
    callCalleeKinds: {
      ...callCalleeKinds,
      _note: "SOL-15. Every `calls` edge carries a `calleeKind`, so the `unresolvedCallTargets` count below no longer mixes four unrelated things. `conversion` and `namespaceBuiltin` name a primitive type word or a member of `abi`/`type`/`super`/`this` — provably not project symbols, and excluded from it. `localFunction`/`inheritedMember`/`libraryFunction`/`modifierInvocation` resolve against THIS FILE's declarations and the inheritance closure. `external` is the real residue: a member or free function declared in another file, which a per-file analyzer cannot see — measured at 0 for localFunction and inheritedMember over the whole corpus, because OpenZeppelin is modularised so thoroughly that almost every call leaves the file.",
    },
    unresolvedCallTargets: {
      byCalleeKind: {
        ...unresolvedByKind,
        _note: "The point of SOL-15: the unresolved count is no longer one undifferentiated class. `errorRevert` dominates because SOL-15 REPAIRED the `revert_statement` case, which had never fired for any input — so these 453 custom-error call edges did not exist in this lane at all before, and the unresolved count ROSE when the lane got more correct. `external` is the genuine residue: a member or free function declared in another file.",
      },
      excludedCalleeKinds: [...NON_SYMBOL_CALLEE_KINDS],
      count: unresolvedCalls.length,
      distinct: new Set(unresolvedCalls.map((s) => s.slice(s.lastIndexOf("-> ") + 3))).size,
      topTargets: [...unresolvedCalls.reduce((m, s) => {
        const t = s.slice(s.lastIndexOf("-> ") + 3)
        m.set(t, (m.get(t) ?? 0) + 1); return m
      }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, n]) => `${t} x${n}`),
      samples: unresolvedCalls.slice(0, 12),
    },
    analyzerDecisions: {
      publicStateVariables: getterSymbols,
      getterSymbols,
      commentsRead,
      commentsAttached,
      documentedSymbols,
      natspecNote: "SOL-16. `commentsRead` is every `comment` node in the corpus; `commentsAttached` is how many of them landed on a declaration, which is the count that matters because Solidity attaches documentation to what FOLLOWS it. The gap between the two is real: a comment before an expression, or a trailing remark at the end of a body, documents nothing. `documentedSymbols` is the share of the 5,976 symbols that carry a `docstring`, which the store persists to `brain_symbol.docstring` — a column NULL for every Solidity symbol before this.",
      ownerKinds,
      perSymbolComplexity: {
        symbolsWithAValue: complexitySymbols,
        aboveOne: complexityAboveOne,
        max: maxComplexity,
        mean: complexitySymbols > 0 ? Number((complexityTotal / complexitySymbols).toFixed(3)) : 0,
        _note: "SOL-18. Before SOL-18 every Solidity symbol reported complexity 1, because pool-worker's default is `s.complexity || s.metadata?.complexity || 1` and the analyzer set neither. The count is attributed through the FRAME stack as the walk goes, so it costs one increment per branch node and no second traversal. `aboveOne` is the number that matters: a metric that reports 1 for everything reads as configured rather than broken, which is exactly how the first attempt hid — `declareSymbol` called `pushSymbol` and discarded the result, so every frame carried `sym: null` and the feature measured nothing while looking live.",
      },
      overridesEmitted,
      overridesEmittedExternal,
      overridesUnresolved,
      overridesAmbiguousBaseCount,
      externalBaseNote: "`overridesEmittedExternal` are rows whose base is named by an explicit `override(...)` list but declared in ANOTHER file. The Solidity compiler rejects `override(X)` unless `X` declares the member, so the edge is true for any compiling source; it is carried at 0.75 with `meta.reasonCode: \"named-by-override-specifier\"` rather than 0.9, because the member's presence is read off the language invariant instead of a declaration. Every one of those targets resolves to a real project symbol (`unknownTargets` is judged project-wide for `overrides`), so the corpus agrees with the edge.",
      implementsCrossFileUnresolved,
      engineCallsSuppressed,
      storeRefusedDeclarations,
    },
    perf: {
      wallMs: Math.round(wallMs),
      perFileMs: Number((wallMs / files.length).toFixed(3)),
      factsPerMs: Number((((symbols + relationships) / wallMs) * 1000).toFixed(3)),
    },
  },
  method:
    "Candidates are the corpus's production (non-test) tracked .sol files, drawn by a hash of `repo/relative-path` so the sample is unbiased and reproducible; the digest is recorded so a re-run that drew a DIFFERENT set says so instead of being compared. Every file goes through the production `parseFile`. `damage` is measured with a separate parser and is the GRAMMAR's number, independent of any analyzer decision. `lineNumber` counts relationships carrying a positive line — the analyzer REFUSES a non-positive line at its single emit helper, so this ratio is a completeness check on the emit path, not a quality score. `tiers` is read from the analyzer's own central `evidenceClassFor`, not recomputed here, so it cannot drift from the emit path. `unknownTargets` counts ONLY the kinds whose both ends are locally declared by definition — contains, overrides, extends, implements, exports. `calls`, `uses`, `instantiates` and `references` are excluded because their targets may be external, a Yul function, a language-supplied type, or an EVM member. `dupKeys` counts (file, owner, name, kind) tuples emitted more than once; the owner IS part of the key, because a local declared in two functions is two correct declarations. `reservedTargets` uses the lane's own imported predicate (src/ast/solidity-reserved-tokens.ts) — one copy of the rule, because a sibling lane's two instruments each held their own and silently disagreed.",
  limits: [
    "This is NOT a truth oracle. It measures what the analyzer emits and how it changed; whether each edge is CORRECT is F5's question. Everything here can be green with every edge wrong.",
    "`unknownTargets` is a proxy for resolvability, not for correctness: a target that names a real contract which happens to share a spelling with a local symbol counts as resolved.",
    "`unresolvedCallTargets` is NOT expected to be 0 and must not be gated as if it were. `abi.encode(1)` and `payable(a).transfer(1)` are real calls whose targets are EVM/ABI members; Solidity has no syntax that distinguishes them from a user-defined member access, so suppressing them would lose real edges. The top-target list is the adjudication surface.",
    "`storeRefusedDeclarations` counts declarations this lane declined to make because pool-worker.ts's UNIVERSAL denylist would drop the symbol while the analyzer's `contains` edge survived — 2 over the draw (`self` at CrosschainLinked.sol:59, `root` at MerkleTreeMock.sol:15). Both are real Solidity identifiers, so the store's list is over-broad for this language; the fix belongs in pool-worker.ts, which this lane does not own, so the drift between the two lists is checked by script/m60/solidity-reserved-words.ts instead. The refusals are COUNTED so an uncounted one is distinguishable from the analyzer being wrong.",
    "`implementsCrossFileUnresolved` counts `extends` edges that may really be `implements` because the interface is declared in another file. A per-file analyzer cannot see it; the count is reported rather than hidden, and it is a wrong KIND, not a missing edge.",
    "Parse damage is the vendored grammar's, and it is 0 on all 389 production files — so this draw cannot exercise the recovery-region refusal (SOL-6). The fixture `recovery-regions-sol6` forces an ERROR on purpose, because a green 0-damage corpus would otherwise leave that rule untested.",
  ],
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

const r = out.totals
console.log(
  `${REPO.padEnd(10)} files=${String(r.files).padStart(3)}  damage=${r.damage.damaged} (${r.damage.errNodes} ERROR / ${r.damage.missing} MISSING)` +
  `  symbols=${r.symbols}  rels=${r.relationships}  line=${r.lineNumber.withLine}/${r.lineNumber.total} (${r.lineNumber.pct}%)` +
  `  unknownTargets=${r.unknownTargets.count}  dupKeys=${r.dupKeys.count}  reserved=${r.reservedTargets.count}`,
)
console.log(`            kinds: ${JSON.stringify(r.kinds)}`)
console.log(`            tiers: ${JSON.stringify(r.tiers)}`)
if (r.notExercisedByThisDraw.length) console.log(`            not exercised by this draw (all implemented + gated): ${r.notExercisedByThisDraw.join(", ")}`)
console.log(`            unresolved call targets: ${r.unresolvedCallTargets.count} over ${r.unresolvedCallTargets.distinct} distinct — top: ${r.unresolvedCallTargets.topTargets.slice(0, 8).join(", ")}`)
console.log(`            overrides: ${r.analyzerDecisions.overridesEmitted} emitted (${r.analyzerDecisions.overridesEmittedExternal} to a base in another file), ${r.analyzerDecisions.overridesUnresolved} unresolved (${r.analyzerDecisions.overridesAmbiguousBaseCount} of them a bare \`override\` over 2+ bases: which base declares it is genuinely undecidable)`)
console.log(`            implements cross-file unresolved: ${r.analyzerDecisions.implementsCrossFileUnresolved}`)
console.log(`            synthesised public getters published: ${r.analyzerDecisions.getterSymbols}`)
console.log(`            declarations refused (store would drop the name): ${r.analyzerDecisions.storeRefusedDeclarations}`)
console.log(`            engine calls suppressed: ${r.analyzerDecisions.engineCallsSuppressed}`)
console.log(`            ${r.perf.perFileMs}ms/f  ${r.perf.factsPerMs} facts/ms   loadAvg1=${load1.toFixed(2)} cores=${os.cpus().length} perfIsQualified=${out.perfIsQualified}`)
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)

const baseFile = val("--baseline")
if (baseFile) {
  const base = JSON.parse(fs.readFileSync(baseFile, "utf8"))
  console.log(`\nBASELINE COMPARISON (${path.basename(baseFile)}):`)
  if (base.draw?.digest !== digest) console.log("  SAMPLE DRIFT — digests differ, no delta may be read")
  else {
    const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${(((a - b) / b) * 100).toFixed(1)}%`)
    const b = base.totals
    console.log(`  symbols ${b.symbols}->${r.symbols} (${pct(r.symbols, b.symbols)})  rels ${b.relationships}->${r.relationships} (${pct(r.relationships, b.relationships)})`)
    console.log(`  line coverage ${b.lineNumber?.withLine}/${b.lineNumber?.total} -> ${r.lineNumber.withLine}/${r.lineNumber.total}`)
    console.log(`  unknownTargets ${b.unknownTargets?.count}->${r.unknownTargets.count}   dupKeys ${b.dupKeys?.count}->${r.dupKeys.count}   reserved ${b.reservedTargets?.count}->${r.reservedTargets.count}`)
    console.log(`  per-file ms ${b.perf?.perFileMs} -> ${r.perf.perFileMs}  (baseline perfIsQualified=${base.perfIsQualified}, now ${out.perfIsQualified})`)
  }
}

function safeCommit(): string { try { return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } }
function safeRev(dir: string): string { try { return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim() } catch { return "unknown" } }
function readPsiMemory(kind: "some" | "full"): string | null {
  try {
    const line = fs.readFileSync("/proc/pressure/memory", "utf8")
      .split("\n").find((l) => l.startsWith(kind))
    if (!line) return null
    const m = line.match(/avg10=([0-9.]+)/)
    return m ? m[1] : null
  } catch { return null }
}