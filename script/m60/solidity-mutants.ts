/**
 * M60 — the solidity mutant set.
 *
 * Every entry is a faithful REVERT of a shape this lane was MEASURED to emit
 * while it was being built, written GENERICALLY off the result's own fields and
 * its own file name — never a name filter, because a name filter silently stops
 * matching the moment a fixture is renamed. That failure mode is not
 * hypothetical: a sibling lane's `swift/drop-container-subscript-uses` survived
 * for exactly that reason, and a mutant that cannot fail is decoration, which is
 * the standard this repo states.
 *
 * WHY THE SET IS BUILT FROM THIS LANE'S OWN DEFECTS. Every mutant here reverts a
 * defect that was actually observed and fixed in this lane, and each one's
 * `caughtBy` names the fixture that carries it. That is the difference between a
 * mutant set and a list of plausible edits: a revert of a shape that never
 * existed tests nothing, and a revert of a shape the lane shipped tests exactly
 * the thing that would have shipped again.
 *
 * THE 19 DEFECTS, for reference (each has a mutant here unless noted):
 *   SOL-1  the file is the module, and a synthesised `global` scope is refused
 *   SOL-2  a READ is an identifier whose PARENT is an `expression`
 *   SOL-3  the public state-variable getter, published as `bal()`
 *   SOL-4  `constructor` / `receive` / `fallback` names are read off tokens
 *   SOL-5  `is` resolves to `implements` for an interface base
 *   SOL-6  a recovery region is a range of SOURCE LINES
 *   SOL-7  a global's members are not project members
 *   SOL-7b an identifier-spelled engine function is refused
 *   SOL-8  an EVM builtin is not a Yul call
 *   SOL-9  the callee resolver recurses through call-option wrappers
 *   SOL-10 both struct literal spellings reach the constructor call
 *   SOL-11 `overrides` is `inferred`, and never fabricated
 *   SOL-12 `exports` is the compilation-unit surface, free functions excluded
 *   SOL-13 a function is a declaration container, so its locals belong to it
 *   SOL-14 a name the store refuses is not declared
 *   F9     an edge target must be a name a stored symbol could have
 *
 * Plus the three that were plain defects with no ruling attached:
 *   `new_expression` nests its type under a `type_name`, so a direct-child read
 *   emitted ZERO `instantiates` over the whole probe set;
 *   `yul_path`'s children are `yul_identifier`, not `identifier`, so a direct read
 *   emitted ZERO Yul path reads over 2,640 corpus nodes;
 *   a member call's flag came from a second traversal, so `t.call{value: 1}("")`
 *   resolved its name and was then deleted by the reserved-token rule.
 */
import type { Mutant } from "../m14/mutate-analyzer"
import { STORE_REFUSED_SYMBOL_NAMES } from "../../src/ast/solidity-reserved-tokens"

/** The file's own basename: the `module` symbol SOL-1 published. */
const solFileName = (r: any): string =>
  (r.symbols ?? []).find((s: any) => s.kind === "module")?.name ?? "contract.sol"

/** Does this edge carry the metadata key with the given value? */
const solHas = (rel: any, key: string, value: unknown): boolean =>
  (rel?.metadata ?? {})[key] === value

/** Drop a field from every relationship. */
const solDropRelField = (field: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    const { [field]: _dropped, ...rest } = x
    return rest
  }),
})

/** Drop every relationship of one type, optionally only those matching `only`. */
const solDropRelType = (type: string, only?: (rel: any) => boolean) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter((x: any) =>
    x.type !== type || (only ? !only(x) : false)),
})

/**
 * THE PER-SITE REVERT, and the one that must exist for any lane whose standard
 * says "the line is part of the edge's identity". Going back to
 * `source|type|target` is PER-SET: the first site's line is kept and every later
 * site of the same edge is swallowed. A fixture pinning only one
 * `line_number: <n>` per edge does NOT catch this, which is why the fixtures
 * carry rows that differ ONLY by line.
 */
const solEdgeKeyPerSet = (r: any) => {
  const seen = new Set<string>()
  return {
    ...r,
    relationships: (r.relationships ?? []).filter((x: any) => {
      const k = `${x.source}|${x.type}|${x.target}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }),
  }
}

export const SOLIDITY_MUTANTS: Mutant[] = [
  {
    id: "solidity/global-file-owner",
    language: "solidity",
    defectClass: "fabrication",
    description:
      "SOL-1 REVERT: the file-scope edge source goes back to the literal string `global`. That is the pre-wave shape in the sibling shell lanes verbatim (`relSource() || \"global\"`), and it is a fabrication by construction: `isIndexArtifactName` (src/ast/analysis-exclusions.ts:129) REJECTS `global` as a symbol name, so not one of those edges can ever resolve to a stored row — measured on that lane at the store as 4 of 7 relationships on a two-file project with `source_symbol_id = NULL`, and `bb_graph` on a method that IS called answering `callers: []`. Caught by the `global` forbid half of module-owner-sol1 and all-kinds-sol. Written generically off the `module` symbol, so it reverts whatever the fixture declares rather than a hard-coded file name.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.source === solFileName(r) ? { ...x, source: "global" } : x),
    }),
  },
  {
    id: "solidity/drop-line-number",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "SOL-2 REVERT: no relationship carries a `line_number` at all. The lane's headline number is `line=25750/25750 (100.00%)`, and it is a completeness check on the EMIT PATH rather than a quality score because the analyzer's single `addRel` helper refuses a non-positive line — an emit path that could produce a null could not be checked at all. Caught by every fixture's line pins.",
    transform: solDropRelField("line_number"),
  },
  {
    id: "solidity/edge-key-per-set",
    language: "solidity",
    defectClass: "relationship-loss",
    description:
      "SOL-2 REVERT, the second half: the edge identity loses the line, going back to `source|type|target`. Two call sites of one callee collapse to one row and the second site is swallowed — measured in a sibling lane as a `contains` edge pointing at a name the file does not declare, because `pushSymbol` dedupes the SYMBOL while the EDGE key did not. Caught by per-site-lines-sol2's two `calls` rows, which differ ONLY in `line_number`, and by its four `uses` rows for the same variable.",
    transform: solEdgeKeyPerSet,
  },
  {
    id: "solidity/line-from-declaration-start",
    language: "solidity",
    defectClass: "misattribution",
    description:
      "SOL-2 REVERT, the misattribution form: every edge takes the line of the ENCLOSING DECLARATION instead of the line its own name is written on. M60 #921's measured pre-fix shape, family-wide. Caught by per-site-lines-sol2: `calls one -> helper` is pinned at the CALL line while `contains Sites -> helper` is pinned at the DECLARATION line, so a transform that stamps the declaration line onto both fails the first and passes the second. Derived from the result's own symbol table — the first symbol of each owner is the enclosing declaration — rather than from a fixture name, and the `module` bucket is seeded by hand because the module carries no `ownerName`: the first version of this transform left every file-scope edge untouched and the MUTANT SURVIVED, which is the outcome that caught it.",
    transform: (r: any) => {
      const declLine = new Map<string, number>()
      const file = solFileName(r)
      for (const s of r.symbols ?? []) {
        if (s.kind === "module") { declLine.set(file, s.range?.startLine ?? s.startLine ?? 1); continue }
        const owner = s.ownerName ?? s.scope ?? ""
        if (owner && !declLine.has(owner)) declLine.set(owner, s.range?.startLine ?? s.startLine ?? 0)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (typeof x.line_number !== "number") return x
          const l = declLine.get(x.source)
          return l ? { ...x, line_number: l } : x
        }),
      }
    },
  },
  {
    id: "solidity/function-to-contract-owner",
    language: "solidity",
    defectClass: "misattribution",
    description:
      "SOL-13 REVERT: a method's outgoing edges are re-attributed to its OWNER, the contract. The pre-wave lane's shape, and the one PowerShell PS3 measured at the SURFACE as `bb_graph Start` returning `callers: []` and `callees: []` at once — a dead end in both directions, with the class absorbing every method's calls. Caught by per-site-lines-sol2's forbid row `calls Sites -> helper`. Written generically off the symbol table, so it reverts whatever the fixture declares.",
    transform: (r: any) => {
      const ownerOf = new Map<string, string>()
      for (const s of r.symbols ?? []) {
        const owner = s.ownerName ?? s.scope
        if (owner && (s.kind === "method" || s.kind === "constructor")) ownerOf.set(s.name, owner)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          ownerOf.has(x.source) ? { ...x, source: ownerOf.get(x.source) } : x),
      }
    },
  },
  {
    id: "solidity/locals-to-file-owner",
    language: "solidity",
    defectClass: "misattribution",
    description:
      "SOL-13 REVERT, the containment half: a `variable` or `constant` symbol's containment edge goes back to the FILE. Measured on this lane while it was being built: the frame's owner was the contract, so `contains C -> ok` claimed a contract contains a local — and Solidity locals are strictly function-scoped, so the edge is simply false. Caught by call-shapes-sol9's `contains everyShape -> ok` at the FUNCTION and by module-owner-sol1's forbid row for a file-owned local. Derived generically: the TARGET of a `contains` edge is the declaration, so its kind is what says whether the edge is a local's or a member's. A first draft looked the kind up on the edge's SOURCE — which is the OWNER — found no variable-like symbol, changed nothing, and SURVIVED, i.e. it would have been reported as passing while testing nothing.",
    transform: (r: any) => {
      const file = solFileName(r)
      const localKinds = new Set(["variable", "constant"])
      const byName = new Map<string, any>()
      for (const s of r.symbols ?? []) byName.set(`${s.kind}\u0000${s.name}`, s)
      const isLocal = (n: any) =>
        (byName.get(`variable\u0000${n}`) !== undefined || byName.get(`constant\u0000${n}`) !== undefined) &&
        // a LOCAL is declared inside a scope; a state variable is declared inside a
        // contract. Both are `property`/`variable` rows, so the discriminator is
        // whether the owner's own kind is a container.
        (() => {
          for (const s of r.symbols ?? []) {
            if (s.name !== n) continue
            if (localKinds.has(s.kind)) return s.ownerName !== file
          }
          return false
        })()
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          x.type === "contains" && isLocal(x.target) ? { ...x, source: file } : x),
      }
    },
  },
  {
    id: "solidity/drop-evidence-class",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "TIER REVERT: the evidence class is dropped from every edge. It is emitted CENTRALLY by one `evidenceClassFor` so no call site can forget it and none can drift, and the surface measure reads it from the analyzer's own emitter rather than recomputing it — which is why the tier histogram in `validation/m60/results/solidity-surface.json` cannot disagree with the emit path. Caught by every fixture's `meta.evidenceClass` pin, which is on almost every row.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const { evidenceClass: _dropped, ...rest } = (x.metadata ?? {})
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "solidity/flatten-tiers-to-structural",
    language: "solidity",
    defectClass: "misattribution",
    description:
      "TIER REVERT: every edge is stamped `structural`. The tiers are the graph engine's, and calling everything structural overstates the evidence — `overrides` locates its target by MATCHING a member name inside a base the tree only names, so it is `inferred`, and only `contains`/`extends`/`implements`/`exports`/`instantiates` are settled by the tree itself. Caught by all-kinds-sol's `overrides` row, which pins `meta.evidenceClass: inferred`, and by the `usage_contextual` pins on the call and use rows. Measured: the shipped histogram is 6,561 structural / 18,282 usage_contextual / 899 import_based / 8 inferred over 25,750 edges, so flattening it is a 25,750-row change that no count alone would notice.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => ({
        ...x,
        metadata: { ...(x.metadata ?? {}), evidenceClass: "structural" },
      })),
    }),
  },
  {
    id: "solidity/drop-instantiates",
    language: "solidity",
    defectClass: "relationship-loss",
    description:
      "THE MEASURED ZERO. `new_expression` nests its `user_defined_type` inside a `type_name` (grammar.js), so a direct-child read returned null and this lane emitted ZERO `instantiates` across a six-file probe set — while containing `A a = new A();`. The whole kind was absent and nothing reported it, because a metric that counts what exists cannot report a class that does not exist. Measured after the fix: 1 over the 389-file corpus, and the count is small enough that it needed a fixture. Caught by call-shapes-sol9's and all-kinds-sol's `instantiates` rows and `expectRelationshipCount`.",
    transform: solDropRelType("instantiates"),
  },
  {
    id: "solidity/drop-implements",
    language: "solidity",
    defectClass: "relationship-loss",
    description:
      "SOL-5 REVERT, the loss half: `implements` is dropped entirely. Solidity has ONE heritage construct and the tree does not say which kind each ancestor is, so a lane that only knew `extends` would have shipped 7 `implements` and 537 `extends` with nothing to notice. Caught by all-kinds-sol's `implements` row and its `equals: 1` count.",
    transform: solDropRelType("implements"),
  },
  {
    id: "solidity/implements-as-extends",
    language: "solidity",
    defectClass: "misattribution",
    description:
      "SOL-5 REVERT, the misattribution half — the more dangerous of the pair, because it loses nothing. Every `implements` edge is relabelled `extends`, so the total inheritance count is unchanged and only the KIND is wrong. Caught by all-kinds-sol's `forbidRelationships` row `extends Feed -> IFeed` and by its `implements equals 1` count; a fixture pinning only `implements -> IFeed` would pass under this mutant, which is why the forbid row and the count are both there.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "implements" ? { ...x, type: "extends" } : x),
    }),
  },
  {
    id: "solidity/drop-overrides",
    language: "solidity",
    defectClass: "relationship-loss",
    description:
      "SOL-11 REVERT: `overrides` is dropped. Solidity HAS the keyword, so this is not the PowerShell situation where the language offers nothing — the edge is dropped because the ANALYZER stopped resolving the target, which is the failure a keyword does not excuse. Caught by all-kinds-sol's `overrides` row and its `equals: 1` count. Measured context: 8 emitted over 389 files against 386 UNRESOLVED, because a base declared in another file yields no edge at all rather than a fabricated one — so this kind is small on purpose, and the count row is what stops 'small' from becoming 'missing'.",
    transform: solDropRelType("overrides"),
  },
  {
    id: "solidity/override-fabricates-external-base",
    language: "solidity",
    defectClass: "fabrication",
    description:
      "SOL-11 REVERT: instead of dropping an unresolvable override, FABRICATE one. For every method carrying `meta.hasOverrideSpecifier`, emit an `overrides` edge to the contract's first base even when that base is not declared in the file. This is the exact trap the rule exists to avoid: a fabricated target sits at ZERO `unknownTargets` — the metric asks whether a target MATCHES a symbol, and a name that matches nothing is no more detectable than one that matches something. The rejected shape is recorded as `metadata.overrideExternal: true` and a `references` edge instead. Caught by all-kinds-sol plus, on the corpus, by the surface measure's `overridesUnresolved: 386`.",
    transform: (r: any) => {
      const byOwner = new Map<string, any>()
      for (const s of r.symbols ?? []) {
        if (s.ownerName && s.kind === "method") {
          if (!byOwner.has(s.ownerName)) byOwner.set(s.ownerName, s)
        }
      }
      const extra: any[] = []
      for (const x of r.relationships ?? []) {
        if (x.type !== "contains") continue
        const ownerSym = (r.symbols ?? []).find((s: any) => s.name === x.source && s.kind !== "module")
        if (!ownerSym) continue
        const first = byOwner.get(ownerSym.name)
        if (!first) continue
        const method = (r.symbols ?? []).find(
          (s: any) => s.ownerName === ownerSym.name && s.kind === "method" && (s.metadata ?? {}).hasOverrideSpecifier)
        if (!method) continue
        extra.push({
          source: method.name,
          target: first.name,
          type: "overrides",
          confidence: 0.8,
          line_number: method.range?.startLine ?? 1,
          metadata: { evidenceClass: "inferred", fabricatedExternalBase: true },
        })
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "solidity/drop-exports",
    language: "solidity",
    defectClass: "relationship-loss",
    description:
      "SOL-12 REVERT: `exports` is dropped. Solidity has NO export construct, so nothing else in the lane would notice the kind is gone — a lane that silently omits one of the ontology's ten kinds has a hole in the matrix that no count reports. Caught by all-kinds-sol's four `exports` rows and module-owner-sol1's `equals: 7`.",
    transform: solDropRelType("exports"),
  },
  {
    id: "solidity/exports-includes-free-functions",
    language: "solidity",
    defectClass: "fabrication",
    description:
      "SOL-12 REVERT, the WIDENING: every file-scope FUNCTION joins the export surface alongside the type declarations. `solc` emits an ABI and an abstraction for each contract, interface and library in a source unit and for nothing else — a free function lives in the unit's bytecode and contributes no ABI entry — so claiming it is an export asserts a surface the language does not define. Caught by module-owner-sol1's forbid row `exports … -> fileScopeFunction` and by its `exports equals 7` count, which a widened rule would make 8.",
    transform: (r: any) => {
      const file = solFileName(r)
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (s.kind !== "function" || s.ownerName !== file) continue
        extra.push({
          source: file, target: s.name, type: "exports", confidence: 1.0,
          line_number: s.range?.startLine ?? 1,
          metadata: { evidenceClass: "structural", isCompilationUnitSurface: true },
        })
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "solidity/yul-path-uses-dropped",
    language: "solidity",
    defectClass: "relationship-loss",
    description:
      "THE MEASURED ZERO, second instance. `yul_path`'s children are `yul_identifier`, not `identifier` — grammar.js declares `yul_identifier: $ => $.identifier`, an ALIAS, so the node type on the wire differs from the aliased one. A direct read of `identifier` children finds NONE of them, and this lane emitted zero Yul path reads over 2,640 `yul_path` corpus nodes while looking entirely healthy. Caught by yul-subset-sol's `isYulPathSegment` rows. Selecting on the METADATA rather than on the node type keeps the mutant generic and keeps it pointing at the behaviour rather than at the fixture.",
    transform: solDropRelType("uses", (rel: any) => solHas(rel, "isYulPathSegment", true)),
  },
  {
    id: "solidity/member-call-flags-become-bare",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "SOL-9 REVERT, the measured total loss. The `isMemberCall` flag is stripped from every call, so the reserved-token rule stops exempting MEMBER calls and deletes them: `call`, `balance` and `delegatecall` are EVM opcode TOKENS and also members of Solidity's built-in types. Measured before the fix: `t.call{value: 1, gas: 100}(\"\")` published NO edge at all, and the surface measure could not report the loss because the edge never existed to be counted. 3878 → 3810 calls is the whole difference and it was invisible until a fixture asked for the callee by name. Caught by call-shapes-sol9's `calls everyShape -> call` row and all-kinds-sol's `calls push -> latest` (`this.latest()`, a call through a global).",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "calls") return x
        const { isMemberCall: _dropped, ...rest } = (x.metadata ?? {})
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "solidity/getter-named-without-parens",
    language: "solidity",
    defectClass: "misattribution",
    description:
      "SOL-3 REVERT, the collision form: the synthesised getter takes the plain variable name instead of its external signature, so a `public uint256 balance` yields a method named `balance` beside the property named `balance`. Two rows that both resolve and that nobody can tell apart, and `bb_graph` would answer a question about which one. This is the shape the lane's FIRST draft tried to avoid by recording the getter in `metadata` and publishing nothing — a decision `parseFile` never received, because pool-worker drops the metadata object at the worker boundary. Caught by getter-sol3's `forbidSymbols` row for a method named `balance`.",
    transform: (r: any) => {
      const bare = new Map<string, string>()
      for (const s of r.symbols ?? []) {
        if (typeof s.name === "string" && s.name.endsWith("()")) bare.set(s.name.slice(0, -2), s.name)
      }
      if (bare.size === 0) return r
      const rename = (n: any) => (typeof n === "string" && bare.has(n) ? bare.get(n) : n)
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) =>
          (s.metadata ?? {}).isSynthesisedGetter === true ? { ...s, name: rename(s.name) } : s),
        relationships: (r.relationships ?? []).map((x: any) => ({
          ...x, source: rename(x.source), target: rename(x.target),
        })),
      }
    },
  },
  {
    id: "solidity/getters-not-published",
    language: "solidity",
    defectClass: "relationship-loss",
    description:
      "SOL-3 REVERT, the omission form: no getter is published at all — which is what the first draft did, and what a reader of that draft would have called the shipped state. Solidity synthesises a getter for every `public` state variable (measured: 59 over the 389-file corpus) and a member surface missing them is missing functions the contract really has. Caught by getter-sol3's two `balance()`/`owner()` symbol rows, its two `contains` rows, and the forbid rows for `hidden()`/`secret()`, which is also what pins that visibility is read rather than 'every state variable'.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isSynthesisedGetter !== true),
      relationships: (r.relationships ?? []).filter(
        (x: any) => (x.metadata ?? {}).isGetterFor !== true && (x.metadata ?? {}).isSynthesisedGetter !== true),
    }),
  },
  {
    id: "solidity/store-refused-names-declared",
    language: "solidity",
    defectClass: "fabrication",
    description:
      "SOL-14 REVERT: declarations whose name the store refuses are declared anyway, and their containment edges emitted. pool-worker.ts's `UNIVERSAL` denylist says such names are 'never legitimate declarations in any language', which is false for Solidity's `self` (CrosschainLinked.sol:59) and `root` (MerkleTreeMock.sol:15) at this rev — measured as 2 unknown `contains` targets, because the store dropped both symbols while the edges survived. That is a shared-store over-reach rather than a grammar bug, and the file two blocks above that list already fixed the same class for JS globals. Caught by store-refusal-sol14's forbid rows for the symbols, the `contains` edges, and the getter link. Selected by the mirror set's membership, not by the two names, so a third name added to either list is covered automatically.",
    transform: (r: any) => {
      // The names come from the analyzer's OWN diagnostic (`storeRefusedNames`),
      // so this mutant cannot drift from the rule it reverts and a third name added
      // to either list is covered automatically rather than needing a new mutant.
      // A first draft read the set off `globalThis`, which is always undefined here,
      // so the transform was a NO-OP; and a second draft searched the RESULT for a
      // symbol with a refused name, which by construction it never contains — so
      // that one was a no-op too, and both would have been reported as passing while
      // testing nothing. Naming what was refused is the only way for a revert to be
      // written generically at all.
      const file = solFileName(r)
      const names: string[] = Array.isArray((r.metadata ?? {}).storeRefusedNames)
        ? ((r.metadata ?? {}).storeRefusedNames as string[])
        : []
      if (names.length === 0) return r
      const byName = new Set((r.symbols ?? []).map((s: any) => s.name))
      const missing = names.filter((n) => !byName.has(n))
      if (missing.length === 0) return r
      return {
        ...r,
        symbols: [...(r.symbols ?? []), ...missing.map((n) => ({
          name: n, kind: "property", scope: file, ownerName: file, visibility: "public",
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          metadata: { soliditySpecific: true },
        }))],
        relationships: [...(r.relationships ?? []), ...missing.map((n) => ({
          source: file, target: n, type: "contains", confidence: 1.0, line_number: 1,
          metadata: { evidenceClass: "structural", soliditySpecific: true },
        }))],
      }
    },
  },
  {
    id: "solidity/recovery-lines-ignored",
    language: "solidity",
    defectClass: "fabrication",
    description:
      "SOL-6 REVERT: the recovery rule is narrowed back to skipping an ERROR/MISSING node's DESCENDANTS, which is where it started and was not enough. On the fixture's line 7 the parser emits an ERROR covering only `is not ) valid solidity ( at`, so the tokens `this` and `all` are SIBLINGS of the ERROR node, outside its subtree: the pre-fix analyzer published a symbol named `all` and a type reference `this` — the parser's guess about garbage, stored as graph fact. The corpus is 0% damaged over all 389 production files, so NO corpus run can exercise this, which is exactly why the fixture forces an ERROR on purpose. Caught by recovery-regions-sol6's forbid rows for the symbol `all`, for `contains … -> all`, for `uses … -> this` and for `contains … -> this`, while its clean declarations on lines 5, 6 and 8 still have to survive.",
    transform: (r: any, source?: string) => {
      // Generic, faithful, and driven by the SOURCE rather than by a fixture name.
      // The narrower pre-fix rule published whatever the parser invented on a
      // recovery line, so a faithful revert republishes the IDENTIFIER TOKENS on
      // each of those lines — which on the fixture are exactly `this` and `all`, the
      // two names the fixture forbids. A first draft invented a single synthetic
      // name instead, which no forbid row names, so the mutant SURVIVED; and a
      // second inferred the recovery lines from the result's own edge set, which by
      // construction contains none of them. Two no-op reverts in a row on the same
      // entry, which is the reason this description is as long as it is.
      const lines: number[] = Array.isArray((r.metadata ?? {}).recoveryLinesList)
        ? ((r.metadata ?? {}).recoveryLinesList as number[])
        : []
      if (lines.length === 0 || typeof source !== "string") return r
      const file = solFileName(r)
      const isIdentStart = (c: number) =>
        (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 /* _ */ || c === 36 /* $ */
      const isIdentPart = (c: number) => isIdentStart(c) || (c >= 48 && c <= 57)
      const invented: { name: string; line: number }[] = []
      const srcLines = source.split("\n")
      for (const lineNo of lines) {
        const text = srcLines[lineNo - 1] ?? ""
        let i = 0
        while (i < text.length) {
          if (!isIdentStart(text.charCodeAt(i))) { i++; continue }
          let j = i
          while (j < text.length && isIdentPart(text.charCodeAt(j))) j++
          invented.push({ name: text.slice(i, j), line: lineNo })
          i = j
        }
      }
      if (invented.length === 0) return r
      const byName = new Set((r.symbols ?? []).map((s: any) => s.name))
      const fresh = invented.filter((x) => !byName.has(x.name))
      if (fresh.length === 0) return r
      return {
        ...r,
        symbols: [...(r.symbols ?? []), ...fresh.map((x) => ({
          name: x.name, kind: "variable", scope: file, ownerName: file, visibility: "public",
          range: { startLine: x.line, startColumn: 1, endLine: x.line, endColumn: 1 },
          metadata: { soliditySpecific: true, fromRecoveryRegion: true },
        }))],
        relationships: [...(r.relationships ?? []), ...fresh.map((x) => ({
          source: file, target: x.name, type: "contains", confidence: 1.0, line_number: x.line,
          metadata: { evidenceClass: "structural", fromRecoveryRegion: true },
        })), ...fresh.map((x) => ({
          source: x.name, target: x.name, type: "uses", confidence: 0.8, line_number: x.line,
          metadata: { evidenceClass: "usage_contextual", isTypeReference: true, fromRecoveryRegion: true },
        }))],
      }
    },
  },
  {
    id: "solidity/external-override-suppressed",
    language: "solidity",
    defectClass: "coverage-loss",
    description:
      "SOL-11 REVERT, the whole defect in one edit: refuse to emit an `overrides` edge when the base is not declared in the same file. That is EXACTLY what the first version of this lane did, and it cost 414 true edges over the 389-file corpus while reporting itself clean — the JavaScript lane's `first-parent-guess` failure mode wearing a different language, since 15 sibling analyzers read an `overrideCompanion` hook that no production caller ever populates and every one of them would drop these edges the same way. Solidity needs no companion: the compiler rejects `override(X)` unless `X` declares the member, so the edge is the language's own invariant. Caught by external-override-sol11's `handle -> ILater` row, which this revert deletes outright.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "overrides" && (x.metadata ?? {}).externalBase === true),
      ),
    }),
    caughtBy: "solidity/external-override-sol11",
  },
  {
    id: "solidity/external-override-overstated",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "SOL-11 REVERT, the honesty half: report an external-base `overrides` edge at the same 0.9 as an in-file verified one, keeping only the target and dropping the tier reasoning. Every COUNT stays identical and the edge is still correct, which is why this is the more dangerous half — a consumer cannot tell a member read from a declaration from one inferred from the compiler's rule. Caught by external-override-sol11's `confidenceMax: 0.75` and its `meta.reasonCode` / `meta.externalBase` pins.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "overrides" || (x.metadata ?? {}).externalBase !== true) return x
        const { reasonCode: _r, externalBase: _e, crossFileVerified: _c, ...rest } = x.metadata ?? {}
        return { ...x, confidence: 0.9, metadata: rest }
      }),
    }),
    caughtBy: "solidity/external-override-sol11",
  },
  {
    id: "solidity/ambiguous-override-emitted",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-11 REVERT, the refusal: emit an `overrides` edge for a bare `override` over TWO OR MORE header bases, picking the first. This fabricates 100 rows over the 389-file corpus and is the one shape where guessing is genuinely wrong rather than merely weak — Solidity 0.8.8+ requires an explicit list precisely when more than one base declares a member, so the keyword says one of them does and not which. Caught by external-override-sol11's TWO `ambiguous` forbid rows.",
    // The FIRST attempt at this mutant only ADDED METADATA to override rows that
    // already existed, and it SURVIVED — because the refused shape emits NO row, so
    // there is nothing on the result to annotate. A faithful revert of "we used to
    // emit this" has to synthesise the edge, and synthesise it GENERICALLY: any owner
    // carrying TWO OR MORE heritage edges (extends/implements) gets an `overrides` row
    // from each of its members to its FIRST base. That is exactly what "pick the first
    // base" does, and it needs no name filter.
    transform: (r: any) => {
      const basesByOwner = new Map<string, string[]>()
      for (const x of r.relationships ?? []) {
        if (x.type !== "extends" && x.type !== "implements") continue
        const list = basesByOwner.get(x.source) ?? []
        list.push(x.target)
        basesByOwner.set(x.source, list)
      }
      const have = new Set((r.relationships ?? []).filter((x: any) => x.type === "overrides").map((x: any) => `${x.source} -> ${x.target}`))
      const added: any[] = []
      for (const sym of r.symbols ?? []) {
        if (sym.kind !== "method" || !sym.ownerName) continue
        const bases = basesByOwner.get(sym.ownerName)
        if (!bases || bases.length < 2) continue
        const first = bases[0]
        if (have.has(`${sym.name} -> ${first}`)) continue
        added.push({
          type: "overrides",
          source: sym.name,
          target: first,
          confidence: 0.75,
          metadata: { evidenceClass: "inferred", soliditySpecific: true, overridesMember: sym.name, baseType: first, baseFromContractHeader: true, guessedFirstBase: true },
        })
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...added] }
    },
    caughtBy: "solidity/external-override-sol11",
  },
  {
    id: "solidity/project-index-ignored",
    language: "solidity",
    defectClass: "coverage-loss",
    description:
      "SOL-21 REVERT: ignore `AnalyzeContext.projectIndex` entirely. That is the pre-SOL-21 behaviour, and it cost 507 undecided inheritance kinds and 1,487 unresolved call targets on the 389-file corpus — the whole point of adding an OPTIONAL field to a type fifteen sibling analyzers depend on. Caught by solidity-crossfile-gate's five `with-index` checks, which assert the kinds settle and the calls resolve.",
    // Modelled on the OUTPUT, not by blanking the context: the mutation harness calls
    // `transform(result, content)` and never hands a transform the AnalyzeContext, so a
    // mutant that tried to clear `context.projectIndex` would be a no-op — which is
    // exactly what the first version of this entry did, and it SURVIVED.
    //
    // Rewriting the resolved rows back to the shape the pre-SOL-21 analyzer emitted is
    // the faithful revert in the only channel available: the kind falls back to
    // `extends`, the row regains `kindUnresolved` at 0.9/`inferred`, and the resolved
    // call becomes `external` again.
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = x.metadata ?? {}
        if ((x.type === "extends" || x.type === "implements") && md.kindResolvedProjectWide === true) {
          const { kindResolvedProjectWide: _k, baseDeclarationKind: _b, ...rest } = md
          return {
            ...x,
            type: "extends",
            confidence: 0.9,
            metadata: {
              ...rest,
              evidenceClass: "inferred",
              kindUnresolved: true,
              assumedKind: "extends",
              reasonCode: "base-not-declared-in-file",
            },
          }
        }
        if (x.type === "calls" && md.calleeKind === "crossFileInheritedMember") {
          return { ...x, metadata: { ...md, calleeKind: "external" } }
        }
        return x
      }),
    }),
    caughtBy: "solidity/crossfile-sol21",
  },
  {
    id: "solidity/project-index-candidate-as-resolution",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-21 REVERT, the honesty half: collapse `projectMemberCandidate` into `crossFileInheritedMember`, i.e. resolve a call whenever the index knows the name ANYWHERE rather than only through the OWNING contract's ancestors. This is the specific way the two grades could be confused, and it would convert 1,031 honest candidates into 1,031 confident facts — a Solidity `calls` edge carries no receiver type for a free function, so WHICH type is meant is undecidable. Caught by solidity-crossfile-gate's `candidate-is-not-a-resolution` check.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if ((x.metadata ?? {}).calleeKind !== "projectMemberCandidate") return x
        return { ...x, metadata: { ...(x.metadata ?? {}), calleeKind: "crossFileInheritedMember" } }
      }),
    }),
    caughtBy: "solidity/crossfile-sol21",
  },
  {
    id: "solidity/qualified-calls-dropped",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "SOL-20 REVERT: stop publishing `qualified_calls`. 601 corpus symbols over 407 distinct qualified names stop saying which qualified calls they MAKE, and no relationship, count or line changes \u2014 so nothing but a gate can notice. Caught by call-resolution-sol15's `everything` row.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        const y: any = { ...s }
        delete y.qualified_calls
        delete y.qualifiedCalls
        return y
      }),
    }),
    caughtBy: "solidity/call-resolution-sol15",
  },
  {
    id: "solidity/qualified-calls-include-namespaces",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-20 REVERT, the over-collection direction: include `abi.` and `type.` receivers. It ADDS rows rather than removing them, so no count-based gate would notice, and the effect is to put `abi.encode` in the same list as `Helpers.twice` \u2014 destroying the one distinction a reader of this field most needs, since a language namespace is not a call on an object. Caught by the same row, because the pinned list is exact.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        const list = s.qualified_calls ?? s.qualifiedCalls
        if (!Array.isArray(list) || list.length === 0) return s
        const widened = [...new Set([...list, "abi.encode", "type.max"])].sort()
        return { ...s, qualified_calls: widened, qualifiedCalls: widened }
      }),
    }),
    caughtBy: "solidity/call-resolution-sol15",
  },
  {
    id: "solidity/inheritance-kind-overstated",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-19 REVERT: publish cross-file inheritance at confidence 1.0 with tier \"structural\", dropping `kindUnresolved`. No COUNT changes and no kind changes \u2014 the edge is still `extends` to the right target \u2014 which is why this needs its own mutant: the defect is purely that a guess was labelled a fact. 537 corpus rows carried it. A consumer weighting by evidence tier read an undecided KIND as structural, and one filtering `extends` to find contracts inherited a mis-typed base. Caught by inheritance-sol5's `confidenceMax: 0.95` and `meta.kindUnresolved` pin, plus its `confidenceMin: 0.99` forbid.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if ((x.type !== "extends" && x.type !== "implements") || (x.metadata ?? {}).kindUnresolved !== true) return x
        const { kindUnresolved: _k, assumedKind: _a, reasonCode: _r, ...rest } = x.metadata ?? {}
        return { ...x, confidence: 1, metadata: { ...rest, evidenceClass: "structural" } }
      }),
    }),
    caughtBy: "solidity/inheritance-sol5",
  },
  {
    id: "solidity/library-owner-kind-as-contract",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-19 REVERT, a bug from the PREVIOUS commit: report a library member's `ownerKind` as \"contract\". `declareSymbol` maps BOTH `contract_declaration` and `library_declaration` to `SymbolKind.Class`, so deriving ownerKind from the SymbolKind cannot tell them apart. No gate caught this \u2014 the fixture that pinned it had been written against the buggy output. Found by reading contracts/utils/Strings.sol back. Caught by complexity-sol18's `fromLibrary` row, now pinned as `library`.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        s.ownerKind === "library" ? { ...s, ownerKind: "contract" } : s),
    }),
    caughtBy: "solidity/complexity-sol18",
  },
  {
    id: "solidity/complexity-flattened-to-one",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "SOL-18 REVERT: report complexity 1 for every symbol. This is not a hypothetical shape — it is EXACTLY what the lane published for its whole life, because `pool-worker` defaults to `s.complexity || s.metadata?.complexity || 1` and the analyzer set neither, so the field was populated corpus-wide with a constant that reads as a measurement. Caught by complexity-sol18's seven `complexity` pins.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: 1, metadata: { ...(s.metadata ?? {}), complexity: 1 } })),
    }),
    caughtBy: "solidity/complexity-sol18",
  },
  {
    id: "solidity/complexity-declaration-wide",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-18 REVERT, the attribution half: count branches over the whole FILE rather than per frame, so every function in a file inherits the file's branch total. It is the natural wrong implementation — the file-level cyclomatic count already exists and is computed in the same loop — and it would pass any fixture whose file has one branchy function. Caught by complexity-sol18: `straight` is 1 and `twoBranches` is 3 in the SAME file, so a file-wide count cannot satisfy both.",
    transform: (r: any) => {
      const md: any = r.metadata ?? {}
      const fileTotal = typeof md.cyclomaticComplexity === "number" ? md.cyclomaticComplexity : 0
      if (fileTotal <= 0) return r
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) =>
          s.kind === "method" || s.kind === "function" ? { ...s, complexity: fileTotal } : s),
      }
    },
    caughtBy: "solidity/complexity-sol18",
  },
  {
    id: "solidity/owner-kind-flattened",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-18 REVERT: report every `ownerKind` as \"contract\". The plausible-looking wrong answer: an interface's members and a library's members both look like members of something, and 'contract' is the default kind for a type declaration. Caught by complexity-sol18's `ownerKind: \"interface\"` on `IThing.external1`.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        typeof s.ownerKind === "string" && s.ownerKind !== ""
          ? { ...s, ownerKind: "contract", metadata: { ...(s.metadata ?? {}), ownerKind: "contract" } }
          : s),
    }),
    caughtBy: "solidity/complexity-sol18",
  },
  {
    id: "solidity/natspec-docstring-dropped",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "SOL-16 REVERT: stop publishing `docstring`. No relationship, count or line changes at all — 2,779 of 5,976 symbols simply stop carrying their documentation, and `brain_symbol.docstring` goes back to NULL for every Solidity symbol in the index. A payload-only revert is invisible to every count-based gate in the repository, which is why it needs one of its own. Caught by natspec-sol16's five `docstring` pins.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        if (s.docstring === undefined) return s
        const { docstring: _d, ...rest } = s
        return rest
      }),
    }),
    caughtBy: "solidity/natspec-sol16",
  },
  {
    id: "solidity/natspec-last-comment-only",
    language: "solidity",
    defectClass: "coverage-loss",
    description:
      "SOL-16 REVERT, the bug the fixture was written for: attach documentation PER COMMENT instead of per RUN, so only the LAST comment of a run survives. This is not hypothetical — it was the first implementation, and it published `library Docs` as documented by `@author Someone` while silently dropping the `@title` and `@notice` above it, i.e. two lines kept out of every three, on every documented declaration in the corpus. Caught by natspec-sol16's exact `docstring` for `Docs` and `SLOT`.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        const parts = s.comments
        if (!Array.isArray(parts) || parts.length < 2) return s
        return { ...s, docstring: parts[parts.length - 1] }
      }),
    }),
    caughtBy: "solidity/natspec-sol16",
  },
  {
    id: "solidity/natspec-anchor-reused",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-16 REVERT, the second bug the fixture was written for: do not clear the run anchor after a flush, so a TRAILING comment run at the end of a parent reuses the previous declaration as its target. On natspec-sol16 that published the file's closing remark as part of `IThing`'s docstring — the precise opposite of what a trailing remark is. Modelled from the SOURCE, because the harness passes `content` and a fixture-phrase key would never fire. Caught by natspec-sol16's exact `docstring` for `IThing`. (The mutant body uses a small regex; the ZERO-REGEX gate scopes the ANALYZER, and a revert written against the fixture's own text would be the weaker instrument.)",
    // The first attempt keyed on a phrase from the FIXTURE'S comment text, so it never
    // fired — a mutant that models nothing and reads as coverage is exactly what this
    // file's own header warns about. Modelled from the SOURCE instead (the harness
    // passes `content`): find the file's trailing comment run, which the correct
    // analyzer publishes nowhere, and graft it onto the last documented declaration.
    transform: (r: any, content?: string) => {
      if (typeof content !== "string") return r
      const lines = content.split("\n")
      let end = lines.length
      while (end > 0 && lines[end - 1].trim() === "") end--
      let start = end
      while (start > 0) {
        const t = lines[start - 1].trim()
        if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("*/")) start--
        else break
      }
      if (start >= end) return r
      const trailing = lines.slice(start, end)
        .map((l) => { const t = l.trim(); return t.startsWith("//") ? t.slice(2).trim() : t.replace(/^\*+/, "").trim() })
        .filter((l) => l !== "")
        .join("\n")
      if (trailing === "") return r
      const syms = (r.symbols ?? []) as any[]
      for (let i = syms.length - 1; i >= 0; i--) {
        if (typeof syms[i].docstring !== "string") continue
        syms[i] = { ...syms[i], docstring: `${syms[i].docstring}\n${trailing}` }
        break
      }
      return { ...r, symbols: syms }
    },
    caughtBy: "solidity/natspec-sol16",
  },
  {
    id: "solidity/modifiers-decorators-dropped",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "SOL-17 REVERT: stop publishing applied modifiers on the `decorators` field. 188 corpus symbols over 40 distinct modifier names stop carrying them; no relationship changes, because the `calls` edge for an applied modifier is emitted by the `modifier_invocation` case and is untouched. Caught by modifiers-sol17's four `decorators` pins.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        if (!Array.isArray(s.decorators)) return s
        const { decorators: _d, ...rest } = s
        return rest
      }),
    }),
    caughtBy: "solidity/modifiers-sol17",
  },
  {
    id: "solidity/modifiers-every-scope",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-17 REVERT, the over-collection direction: publish EVERY modifier declared anywhere in the file as a decorator on EVERY function. This is the failure mode of reading modifiers from the enclosing contract instead of from the function's own header, and it is the reason modifiers-sol17 pins `single` as exactly `[\"onlyOwner\"]` — `single` applies one modifier while three are in scope, so this turn would make the fixture fail rather than quietly widen. Caught by modifiers-sol17's `single` and `paired` pins.",
    transform: (r: any) => {
      const all: string[] = []
      for (const x of r.relationships ?? []) {
        if (x.type === "calls" && (x.metadata ?? {}).calleeKind === "modifierInvocation") {
          if (!all.includes(x.target)) all.push(x.target)
        }
      }
      if (all.length === 0) return r
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) =>
          s.kind === "method" ? { ...s, decorators: all } : s),
      }
    },
    caughtBy: "solidity/modifiers-sol17",
  },
  {
    id: "solidity/using-alias-funcs-dropped",
    language: "solidity",
    defectClass: "coverage-loss",
    description:
      "SOL-16's audit find: revert the `using_alias` case to looking for DIRECT `identifier` children. The grammar nests the name as `using_alias (user_defined_type (identifier)) (user_definable_operator)`, so the direct-child search is empty for every input and the branch had NEVER fired — 4 `using_alias` nodes in the corpus, all in contracts/account/utils/draft-ERC7579Utils.sol, and 0 edges. Found by a per-case emit census, the same signature as the `revert_statement` dead branch.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.metadata ?? {}).isUsingAliasFunction === true,
      ),
    }),
    caughtBy: "solidity/call-resolution-sol15",
  },
  {
    id: "solidity/call-callee-kind-dropped",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "SOL-15 REVERT, the payload half: strip `calleeKind` from every `calls` edge. No COUNT changes — 4,331 edges stay 4,331 and every kind's edge count stays put — so nothing but the gate can notice. What is lost is the one field that says whether a callee is a symbol at all, and with it the difference between `abi.encode` (a language namespace), a custom error, and a member declared in another file. That difference is the whole content of the 1,849-row unresolved figure. Caught by call-resolution-sol15's four `meta.calleeKind` pins.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "calls") return x
        const { calleeKind: _drop, ...rest } = (x.metadata ?? {})
        return { ...x, metadata: rest }
      }),
    }),
    caughtBy: "solidity/call-resolution-sol15",
  },
  {
    id: "solidity/call-callee-kind-flattened",
    language: "solidity",
    defectClass: "correctness",
    description:
      "SOL-15 REVERT, the RULE half: report every call as `external`. This is the classifier as it behaves when resolution never runs — and it is what the lane effectively shipped before SOL-15, except that the field did not exist then, so a consumer could not even tell resolution had been skipped. With the field present and flat, the four kinds collapse to one and every count stays identical. Caught by call-resolution-sol15's three `meta.calleeKind` forbids — which is where the closure-order bug WOULD have been caught, had the fixture existed when the bug was written.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "calls") return x
        return { ...x, metadata: { ...(x.metadata ?? {}), calleeKind: "external" } }
      }),
    }),
    caughtBy: "solidity/call-resolution-sol15",
  },
  {
    id: "solidity/custom-error-revert-dropped",
    language: "solidity",
    defectClass: "coverage-loss",
    description:
      "SOL-15 REVERT, the never-fired branch: revert the `revert_statement` case to its original form, which tested `node.namedChild(0).type === \"identifier\"` and was therefore FALSE for every possible input, because the grammar puts an `expression` wrapper there for `revert Boom(1)`, `revert Solo` and `revert(\"x\")` alike. That is 453 custom-error call edges over the 389-file corpus that this lane did not emit AT ALL, and no gate noticed — the kind had a case in the source, so it read as covered. Caught by call-resolution-sol15's `boom -> Boom` row and its `errorRevert` forbid.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "calls" && (x.metadata ?? {}).isCustomErrorRevert === true),
      ),
    }),
    caughtBy: "solidity/call-resolution-sol15",
  },
  {
    id: "solidity/import-edges-unannotated",
    language: "solidity",
    defectClass: "payload-loss",
    description:
      "IMPORT REVERT, the annotation half. `imports` is not a relationship kind in this product: an import is a `references` edge carrying `metadata.import: true` (the settled convention, the same reason PowerShell PS-7 used it), so the ANNOTATION is what distinguishes an import from any other reference. Stripping it leaves the edge type intact and the meaning gone — 899 edges over the 389-file corpus would stop being imports while every count stayed identical. Caught by all-kinds-sol's two import rows' `meta.import` pins and its `references equals 4`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (!solHas(x, "import", true)) return x
        const { import: _dropped, ...rest } = (x.metadata ?? {})
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "solidity/namespace-import-edge-dropped",
    language: "solidity",
    defectClass: "relationship-loss",
    description:
      "IMPORT REVERT, the MEASURED ZERO. `import * as Utils from \"./Utils.sol\"` produced NO edge while a braced import produced one per name — two import statements yielded one edge, because the reader only looked for a plain import name and the namespace form has only an ALIAS. The edge that was missing is the one naming the local binding, the only name the importing file can use. Caught by all-kinds-sol's `references … -> Utils` row and its `expectImports`, and by the `references equals 4` count, which a rule that handled only two of the three import forms would make 3.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !solHas(x, "isNamespaceImport", true)),
    }),
  },
  {
    id: "solidity/f9-admits-path-targets",
    language: "solidity",
    defectClass: "fabrication",
    description:
      "F9 REVERT: the plausible-name gate stops refusing a target containing a path separator, so a bare `import \"./Bare.sol\";` grows a `references` edge naming the path. That edge can never resolve to a stored symbol, and — the reason F9 exists — it would sit at ZERO `unknownTargets` for exactly as long as it existed, because the metric asks whether a target MATCHES a symbol and a name matching nothing is no more detectable than a name matching something. Measured on a sibling lane: malformed here-string targets sat at 0 unknown indefinitely. The correct state is that a bare import binds no name and so contributes an `imports` payload row and no edge. Caught by all-kinds-sol's `forbidRelationships` row naming the path. The first draft of this transform went the WRONG WAY — it removed path-targeting edges, which is the opposite of a revert of the gate and therefore a no-op, because the gate working means there are none to remove. A revert has to ADD what the gate suppresses.",
    transform: (r: any) => {
      const file = solFileName(r)
      const have = new Set(
        (r.relationships ?? []).map((x: any) => `${x.type}|${x.target}`))
      const extra: any[] = []
      for (const imp of r.imports ?? []) {
        const path = String(imp?.source ?? "")
        if (path.length === 0) continue
        if (have.has(`references|${path}`)) continue
        // A bare import binds no name, so `imported` is the PATH itself — that is
        // the pre-gate shape, and it is exactly why the gate exists.
        if (String(imp?.imported ?? "") !== path) continue
        extra.push({
          source: file, target: path, type: "references", confidence: 1.0,
          line_number: imp?.line ?? 1,
          metadata: { evidenceClass: "import_based", import: true, isNamespaceImport: true },
        })
      }
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
]
