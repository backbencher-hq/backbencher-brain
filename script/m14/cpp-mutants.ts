/**
 * CPP MUTANTS — the lane's regression mutants for the M14.0.F4 gate.
 *
 * WHY A SEPARATE FILE. `script/m14/mutate-analyzer.ts` is a shared registry several lanes edit
 * at once, and a 259-line block written into it was silently overwritten within the hour by
 * another lane's edit — the overwrite was SILENT, the file stayed syntactically valid, and the
 * gate kept reporting numbers with this lane's mutants simply absent from them. A two-line
 * footprint in the shared file, and the work itself somewhere the lane owns.
 *
 * WHAT EACH MUTANT IS. The F4 rule: a deliberately injected defect MUST make the suite red. A
 * surviving mutant fails THE SUITE, not the mutant, because a suite that stays green whatever
 * you do to the code is decoration. Each entry below is a revert of one defect class this lane's
 * own rounds measured on real C++, and each names the fixture that catches it.
 *
 * THE FIRST TWO ARE THE SPELLING PAIR, and they are the shape the Lead's ruling L-2026-10-21-07
 * names (the csharp lane's measured case: 73 mutants, 1 survivor, invisible because the defect
 * re-added rows with the target spelled `IThing.GetName` while every forbid pinned the BARE
 * spelling `GetName`). **IN C++ THE SAME HOLE HAS A NAME: WALL W4.** The analyzer publishes a
 * member's target as its LEAF — `src/ast/pool-worker.ts:1334` shows why: a cpp member symbol
 * publishes neither `qualifiedName` nor `scope` nor `metadata.fqn`, so its published identity is
 * the leaf, and `Owner::member` answers to no published key. A defect that re-spells a member
 * target (or source) as `owner::member` therefore hides behind every forbid that pins the bare
 * spelling — the cpp instance of the csharp case, and the reason this lane's
 * `script/m14/cpp-forbid-spelling-audit.ts` exists and measured 77 holes before the fixtures
 * were closed.
 */
import type { Mutant } from "./mutate-analyzer"

/** The owner each published symbol name has, from the analyzer's OWN result. */
const ownersOf = (r: any): Map<string, Set<string>> => {
  const m = new Map<string, Set<string>>()
  for (const s of r?.symbols ?? []) {
    if (!s?.name) continue
    if (!m.has(s.name)) m.set(s.name, new Set())
    if (s.ownerName) m.get(s.name)!.add(String(s.ownerName))
  }
  return m
}

/** Re-spell an end of a row in the owner-qualified spelling — the W4 shape. */
const respell = (r: any, side: "source" | "target") => {
  const owners = ownersOf(r)
  const rels = (r?.relationships ?? []).map((x: any) => {
    const v = x[side]
    if (typeof v !== "string") return x
    const o = owners.get(v)
    if (!o || o.size !== 1) return x
    const owner = [...o][0]
    if (!owner || owner.includes("::")) return x
    return { ...x, [side]: `${owner}::${v}` }
  })
  return { ...r, relationships: rels }
}

/** The symbol whose range contains a given line, among the class-like kinds. */
const classAt = (r: any, line: number): any =>
  (r?.symbols ?? []).find(
    (s: any) =>
      (s.kind === "class" || s.kind === "struct" || s.kind === "union") &&
      s.range?.startLine <= line &&
      s.range?.endLine >= line,
  )

export const CPP_MUTANTS: Mutant[] = [
  {
    id: "cpp/qualified-target-spelling",
    language: "cpp",
    defectClass: "spelling-contract",
    description:
      "THE SPELLING HALF OF WALL W4, INVERTED. The cpp analyzer publishes a member's TARGET as its LEAF (a member symbol publishes neither `qualifiedName` nor `scope` nor `metadata.fqn` — src/ast/pool-worker.ts:1334 — so `Owner::member` answers to no published key today). This mutant is the defect the Leaf model prevents: a resolver that publishes the member's target in the OWNER-QUALIFIED spelling, `owner::member`. It is the cpp instance of the csharp lane's measured survivor (L-2026-10-21-07: 73 mutants, 1 survivor, invisible because every forbid pinned the BARE spelling). Caught by the SPELLING-CONTRACT forbid rows this lane added across its fixtures (script/m14/cpp-forbid-spelling-audit.ts measured 77 holes before they were closed).",
    caughtBy: "cpp/contains-name-line-921",
    transform: (r) => respell(r, "target"),
  },
  {
    id: "cpp/qualified-source-spelling",
    language: "cpp",
    defectClass: "spelling-contract",
    description:
      "THE SAME DEFECT ON THE OTHER END of the row: a resolver that publishes the row's SOURCE in the owner-qualified spelling, `owner::member`, instead of the leaf the analyzer publishes. The half that pins the SOURCE side of the spelling contract, and the half a target-only forbid cannot see.",
    caughtBy: "cpp/contains-name-line-921",
    transform: (r) => respell(r, "source"),
  },
  {
    id: "cpp/friend-body-owned-by-class",
    language: "cpp",
    defectClass: "wrong-owner",
    description:
      "D13, REVERTED. A friend function DEFINED inside a class body is not a member of that class, so its body's reads belong to the friend and not to the class. The defect this reverts is the one the lane MEASURED on absl/random/uniform_int_distribution.h:81-87, where the enclosing CLASS was published as the owner of a read of a PARAMETER — wrong twice over, because the class has members of the same name, so the edge cannot be told apart from reading those members. The mutant re-owns the friend definition's body's reads to the class, which is the pre-D13 behaviour verbatim.",
    caughtBy: "cpp/friend-definition-body-owner",
    transform: (r) => {
      const friendSym = (r?.symbols ?? []).find((s: any) => s?.metadata?.isCppFriendDefinition)
      if (!friendSym) return r
      const cls = classAt(r, friendSym.range?.startLine ?? 0)
      if (!cls) return r
      const rels = (r?.relationships ?? []).map((x: any) =>
        x.source === friendSym.name ? { ...x, source: cls.name } : x,
      )
      return { ...r, relationships: rels }
    },
  },
  {
    id: "cpp/friend-declaration-minted",
    language: "cpp",
    defectClass: "phantom-symbol",
    description:
      "CP2, REVERTED. A friend DECLARATION — `friend void helper();` — declares someone ELSE's function: it is not a member of the class and it mints no symbol of the class. The pre-CP2 analyzer minted a (private) Method for the inner declaration node, which is the defect CP2 removed. The mutant mints that member symbol again, from the SOURCE (the declaration's own spelling), so the revert is faithful rather than a hardcoded string.",
    caughtBy: "cpp/friend-definition-body-owner",
    transform: (r, source) => {
      const src = String(source ?? "")
      if (!/friend\b/.test(src)) return r
      const decls = [...src.matchAll(/friend\s+[A-Za-z_][\w:<>,\s*&]*?\b([A-Za-z_]\w*)\s*\([^)]*\)\s*;/g)].map((m) => m[1])
      if (decls.length === 0) return r
      const symbols = [...(r?.symbols ?? [])]
      for (const name of decls) {
        if (symbols.some((s: any) => s?.name === name)) continue
        const line = src.slice(0, src.indexOf(name)).split("\n").length
        const cls = classAt(r, line)
        symbols.push({
          name,
          kind: "method",
          range: { startLine: line, startColumn: 1, endLine: line, endColumn: 1, startIndex: 0, endIndex: 0 },
          visibility: "private",
          ownerName: cls?.name,
          ownerKind: cls?.kind,
          metadata: { isCppFunction: true, isDeclaration: true },
        })
      }
      return { ...r, symbols }
    },
  },
  {
    id: "cpp/friend-operator-as-class-member",
    language: "cpp",
    defectClass: "wrong-owner",
    description:
      "W9, REVERTED — the operator spelling published INSIDE the class's member key space. The Lead's ruling L-2026-10-21-02 is that an operator spelling is not in the published key space of the class's members, and the lane's own measurement is the reason: the class has real members `a` and `b` AND an in-class friend `operator==` whose PARAMETERS are also named `a` and `b`, so publishing the operator as a class member would make `uses param_type -> b` undecidable. The mutant gives the friend operator a class owner and a `contains` edge from the class — the exact shape the ruling forbids.",
    caughtBy: "cpp/friend-definition-body-owner",
    transform: (r) => {
      const friendSym = (r?.symbols ?? []).find((s: any) => s?.metadata?.isCppFriendDefinition)
      if (!friendSym) return r
      const cls = classAt(r, friendSym.range?.startLine ?? 0)
      if (!cls) return r
      const symbols = (r?.symbols ?? []).map((s: any) =>
        s?.name === friendSym.name ? { ...s, ownerName: cls.name, ownerKind: cls.kind } : s,
      )
      const rels = [...(r?.relationships ?? [])]
      if (!rels.some((x: any) => x.type === "contains" && x.source === cls.name && x.target === friendSym.name)) {
        rels.push({
          source: cls.name,
          target: friendSym.name,
          type: "contains",
          confidence: 1,
          line_number: friendSym.range?.startLine,
          metadata: { relationshipType: "class_member" },
        })
      }
      return { ...r, symbols, relationships: rels }
    },
  },
  {
    id: "cpp/last-sig-wins-overrides-respelled",
    language: "cpp",
    defectClass: "relationship-loss",
    description:
      "THE REPLACEMENT FOR THE NO-OP `cpp/last-sig-wins-overrides` (in script/m14/mutate-analyzer.ts), and it is here because the rule is that a no-op's REPLACEMENT TRAVELS WITH IT. THAT MUTANT IS A NO-OP MEASURED, NOT ASSUMED: it filters the override rows whose `metadata.reasonCode` is EXACTLY `signature-match` and whose source starts with `Derived.f` — but MEASURED on the current analyzer, the `Derived.f` row's reasonCode is `override-keyword+signature-match` (the `override-keyword+` prefix was added later), so the filter matches NOTHING and the mutant reports 0 -> 0 failures. A no-op is not a pass. This replacement models the SAME defect class at the CURRENT spelling: the virtual registry keeps one signature per method name, so the override of the first-declared base overload is silently dropped when the base also declares an overload of the same name. The filter drops the override row for the first-declared overload — the row the fixture cpp/ctor-and-overload-regressions pins as `overrides Derived.f -> f` with `meta.overriddenOwner: Base`."
      + " ★ M65 RE-SPELLING, AND THE LESSON IS THE POINT. This filter ALSO became a no-op when the analyzer's override SOURCE spelling changed from the DOT form (`Derived.f`) to the C++ scope form (`Derived::f`) — my own change, which silently disabled this mutant. The battery then reported `SURVIVED ... (0 -> 0 failures)`, and the honest reading of `0 -> 0` is NOT 'the suite missed it' but 'the mutant never fired'. A mutant whose filter matches nothing is indistinguishable from a surviving one in the count, so the filter is now matched on the SCOPE-SPELLING-AGNOSTIC leaf pair (`source` ends with `::f` or `.f`, and the owner segment is `Derived`), which survives either spelling. Any future change to how a source is spelled must re-check this filter, not the count.",
    caughtBy: "cpp/ctor-and-overload-regressions",
    transform: (r) => {
      // The row the fixture pins: the override of the FIRST-declared base overload, matched on the
      // DECLARATION rather than on one spelling of it. `Derived::f` (M65) and `Derived.f` (pre-M65)
      // are the same row; matching either keeps the mutant live across the spelling change.
      const isTarget = (x: any): boolean => {
        if (x?.type !== "overrides") return false
        const s = String(x?.source ?? "")
        return s === "Derived::f" || s === "Derived.f"
      }
      const drop = (r?.relationships ?? []).filter(isTarget)
      if (drop.length === 0) return r
      return {
        ...r,
        relationships: (r?.relationships ?? []).filter((x: any) => !isTarget(x)),
      }
    },
  },
  {
    id: "cpp/qualified-name-metadata-dropped",
    language: "cpp",
    defectClass: "metadata-loss",
    description:
      "The analyzer publishes each row's QUALIFIED SPELLING in `metadata.qualified` — the row's own qualified name, the thing a resolver needs and the thing W4 is about. This mutant drops it from every row, which is what a resolver that reads the leaf only would see. Caught by the fixtures that pin `meta.qualified` (14 pins across the lane's fixtures).",
    caughtBy: "cpp/qualified-declarator-name-924",
    transform: (r) => {
      const rels = (r?.relationships ?? []).map((x: any) => {
        if (!x?.metadata || x.metadata.qualified === undefined) return x
        const m = { ...x.metadata }
        delete m.qualified
        return { ...x, metadata: m }
      })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "cpp/overridden-owner-dropped",
    language: "cpp",
    defectClass: "metadata-loss",
    description:
      "The analyzer publishes the OWNER of an overridden method in `metadata.overriddenOwner` — the base class the override belongs to, and the fact the `overrides` edge's spelling is carried by. Dropping it leaves the override row naming a base that no reader can resolve, which is the shape the cross-file override fixtures pin (34 pins across the lane's fixtures).",
    caughtBy: "cpp/override-signature-aware",
    transform: (r) => {
      const rels = (r?.relationships ?? []).map((x: any) => {
        if (!x?.metadata || x.metadata.overriddenOwner === undefined) return x
        const m = { ...x.metadata }
        delete m.overriddenOwner
        return { ...x, metadata: m }
      })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "cpp/pure-virtual-flag-dropped",
    language: "cpp",
    defectClass: "metadata-loss",
    description:
      "`implements` IS ADAPTED SEMANTICS in C++ — a PURE-VIRTUAL CONTRACT (a class declaring `= 0`) is a contract a derived class implements — and the analyzer publishes the fact in `metadata.isPureVirtual` ON THE MEMBER SYMBOL (and `metadata.isAbstract` on the class). Dropping it leaves the `implements` row asserting a relationship the reader cannot check against the contract that justifies it. MEASURED: the first version of this mutant dropped the flag from the RELATIONSHIPS and SURVIVED, because the flag lives on the SYMBOL — the pins are symbol pins, so a relationship-side drop is a NO-OP. It is the symbol-side drop that bites (9 pins across the lane's fixtures).",
    caughtBy: "cpp/pure-virtual-abstract-919",
    transform: (r) => {
      const symbols = (r?.symbols ?? []).map((s: any) => {
        if (!s?.metadata) return s
        const m = { ...s.metadata }
        let changed = false
        if (m.isPureVirtual !== undefined) { delete m.isPureVirtual; changed = true }
        if (m.isAbstract !== undefined) { delete m.isAbstract; changed = true }
        return changed ? { ...s, metadata: m } : s
      })
      return { ...r, symbols }
    },
  },
  {
    id: "cpp/reason-code-dropped",
    language: "cpp",
    defectClass: "metadata-loss",
    description:
      "Every cpp row carries a `metadata.reasonCode` — WHY the row exists (the node type and the evidence class that produced it). Dropping it leaves the row asserting a relationship with no explanation, which is the state the reason-code fixtures exist to prevent (17 pins across the lane's fixtures).",
    caughtBy: "cpp/reason-code-4",
    transform: (r) => {
      const rels = (r?.relationships ?? []).map((x: any) => {
        if (!x?.metadata || x.metadata.reasonCode === undefined) return x
        const m = { ...x.metadata }
        delete m.reasonCode
        return { ...x, metadata: m }
      })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "cpp/evidence-class-flattened",
    language: "cpp",
    defectClass: "metadata-loss",
    description:
      "Every cpp row carries a `metadata.evidenceClass` — the evidence class that produced it (`structural`, `import_based`, `usage_contextual`, `reference_qualified`, `inferred`). Flattening it to one constant makes every row claim the same evidence, which is a LIE about the corpus's own evidence and not a loss of detail (15 pins across the lane's fixtures).",
    caughtBy: "cpp/bare-value-reads",
    transform: (r) => {
      const rels = (r?.relationships ?? []).map((x: any) =>
        x?.metadata?.evidenceClass ? { ...x, metadata: { ...x.metadata, evidenceClass: "structural" } } : x,
      )
      return { ...r, relationships: rels }
    },
  },
  {
    id: "cpp/macro-recovery-in-error-spans",
    language: "cpp",
    defectClass: "symbol-loss",
    description:
      "M65 MACRO RECOVERY, the mutant that travels WITH the fix (the rule this lane has learned repeatedly: a fix with no mutant is a fix with no proof it can fail). It removes the RECOVERY ARM — the pass that mints a Macro/Constant for a `#define` the pinned grammar did not produce a `preproc_def` node for — while leaving the ordinary `preproc_def` branch intact. That is exactly the pre-fix state: MEASURED on a two-repo corpus, 544 `#define` lines have no `preproc_*` node (3,483 in source vs 2,939 produced), 543 of them in a file with >=1 ERROR node, and `calls` rows targeting those unpublished macros came to 9,004 of the 13,407 genuinely-unresolved targets. `CHECK` alone is 6,734. The fixture cpp/macro-recovery-in-error-spans pins a macro declared inside an ERROR region and requires the symbol to exist, so removing this arm lands 0 symbols where the fixture expects 1 and fails.",
    caughtBy: "cpp/macro-recovery-in-error-spans",
    transform: (r) => {
      // Drop exactly the symbols the recovery arm mints: `metadata.isMacro === true` AND
      // `metadata.recoveredFromDirective === true`. The second key is what distinguishes a
      // recovered macro from an ordinary `preproc_def` one, so the ordinary branch is untouched and
      // the mutant models the defect rather than deleting every macro.
      return {
        ...r,
        symbols: (r?.symbols ?? []).filter(
          (s: any) => !(s?.metadata?.isMacro === true && s?.metadata?.recoveredFromDirective === true),
        ),
        relationships: (r?.relationships ?? []).filter((x: any) => {
          if (x?.type !== "contains") return true
          const md = x?.metadata ?? {}
          return md.recoveredFromDirective !== true
        }),
      }
    },
  },
  {
    id: "cpp/imports-per-occurrence-not-per-module",
    language: "cpp",
    defectClass: "duplicate-emission",
    description:
      "D3 ON THE `imports` KIND: one edge per OCCURRENCE (per `#include` line) instead of one edge per MODULE. This is the pre-dedupe state the `referencesSeen` / `depKey(type, target)` guard in real-cpp-analyzer.ts exists to prevent, and it is the mutation that proves the guard is load-bearing. Two facts make it a faithful model rather than an arbitrary edit: (1) `result.imports` is the OCCURRENCE array and still carries every `#include` (the analyzer emits it separately from the graph, which is the documented contract 'the ARRAY keeps every occurrence, the GRAPH keeps one edge'); (2) cpp/imports-include-910 includes `<string>` TWICE, so a per-occurrence emission produces two `imports -> string` rows where the contract requires exactly one. The fixture pins that with `expectRelationshipCount { equals: 1 }` — an assertion that did not exist before this mutant: every relationship row in that file was an `expectRelationships` '>=1 match', which a duplicate satisfies, so the de-dupe was documented in prose and enforced by nothing. Caught-by names the fixture rather than the class for that reason.",
    caughtBy: "cpp/imports-include-910",
    transform: (r) => {
      // How many times each module is #included in THIS file, from the occurrence array.
      const occurrences = new Map<string, number>()
      for (const imp of r?.imports ?? []) {
        const m = String((imp as any)?.module ?? "")
        if (m) occurrences.set(m, (occurrences.get(m) ?? 0) + 1)
      }
      const rels: any[] = []
      for (const x of r?.relationships ?? []) {
        if (x?.type !== "imports") {
          rels.push(x)
          continue
        }
        // Emit the edge once per OCCURRENCE: the duplicate-injection under test.
        const n = occurrences.get(String(x?.target ?? "")) ?? 1
        for (let i = 0; i < Math.max(1, n); i++) rels.push(x)
      }
      return { ...r, relationships: rels }
    },
  },
  {
    id: "cpp/citation-claim-dropped",
    language: "cpp",
    defectClass: "claim-loss",
    description:
      "THE ISO C++ CITATION CLAIM, shipped 2026-11-16, must stay shippable: this removes `metadata.languageNamespace` and its `languageNamespacePolicy` companion from every row, which is exactly the pre-ship state of the emission (and also what a later refactor that stopped threading the qualified spelling into the facts would produce). The claim is invisible to a row count, so only a fixture that PINS it can catch the loss — cpp/citation/citation now asserts the claim AND the marker on all three listed `std::` rows, and asserts the marker's absence everywhere else. Caught-by names that fixture rather than a class for the same reason as cpp/imports-per-occurrence-not-per-module: a claim with no pin is a claim nothing can refute.",
    caughtBy: "cpp/citation/citation",
    transform: (r) => {
      const strip = (x: any) => {
        if (!x?.metadata) return x
        const md = { ...x.metadata }
        let touched = false
        if (Array.isArray(md.languageNamespace)) { delete md.languageNamespace; touched = true }
        if (md.languageNamespacePolicy !== undefined) { delete md.languageNamespacePolicy; touched = true }
        return touched ? { ...x, metadata: md } : x
      }
      return { ...r, relationships: (r?.relationships ?? []).map(strip) }
    },
  },
  {
    id: "cpp/local-implicit-owner-dropped",
    language: "cpp",
    defectClass: "claim-loss",
    description:
      "THE INDEX-FREE RECEIVER ARM (§14.18), shipped default-on, must stay shippable: this removes `metadata.owner` from EVERY relationship, which is exactly the pre-arm state of the emission (and also what a later refactor that stopped routing the post-pass candidates would produce). The arm adds no row and moves no target, so no row count can catch its loss — only a fixture that PINS the owner can. Caught-by names cpp/local-implicit-owner, whose positive rows (shapeBare/shapeLate/shapeThis/shared, the lambda body and the out-of-line body) each assert `meta.owner: Widget`; the citation-claim-dropped mutant records the same lesson for the other default-on claim.",
    caughtBy: "cpp/local-implicit-owner",
    transform: (r) => {
      const strip = (x: any) => {
        if (!x?.metadata || typeof x.metadata.owner !== "string") return x
        const md = { ...x.metadata }
        delete md.owner
        return { ...x, metadata: md }
      }
      return { ...r, relationships: (r?.relationships ?? []).map(strip) }
    },
  },
  {
    id: "cpp/local-implicit-owner-walk-time-table",
    language: "cpp",
    defectClass: "ordering-defect",
    description:
      "THE WALK-TIME FORM OF THE LOCAL RECEIVER ARM — the defect the post-pass exists to prevent. A version that consulted the class's member table DURING the walk cannot see a member declared BELOW the calling body, so it attaches the owner where the declaration came first and silently drops it where the declaration comes later. This mutant replays exactly that: for every owner-bearing `calls` row whose target is declared (as a callable member of that owner) on a LINE GREATER THAN THE CALL'S, the owner is removed. It is what a walker-local `Set<owner, members>` would have produced, and it is faithful rather than arbitrary because the analyzer's symbols are published in walk order — a declaration later in the file genuinely was absent from any table built during the walk. Caught by cpp/local-implicit-owner's shapeLate (declared below run()) and shapeThis (declared below run(), called through `this->`) rows; the shapeBare row is the control that must survive, which is why the mutant removes only the later-declared ones.",
    caughtBy: "cpp/local-implicit-owner",
    transform: (r) => {
      const memberDeclLine = new Map<string, number>()
      for (const s of r?.symbols ?? []) {
        if (!s?.ownerName || !s?.name) continue
        if (s.kind !== "method" && s.kind !== "constructor") continue
        const k = `${String(s.ownerName)}\u0000${String(s.name)}`
        const line = Number(s?.range?.startLine ?? 0)
        if (line > 0) memberDeclLine.set(k, Math.min(memberDeclLine.get(k) ?? Infinity, line))
      }
      const keep = (x: any) => {
        if (x?.type !== "calls" || typeof x?.metadata?.owner !== "string") return x
        const rowLine = Number(x?.metadata?.line ?? x?.line_number ?? 0)
        const declLine = memberDeclLine.get(`${String(x.metadata.owner)}\u0000${String(x.target)}`)
        if (declLine === undefined || rowLine === 0 || declLine <= rowLine) return x
        const md = { ...x.metadata }
        delete md.owner
        return { ...x, metadata: md }
      }
      return { ...r, relationships: (r?.relationships ?? []).map(keep) }
    },
  },
  {
    id: "cpp/local-implicit-owner-unchecked",
    language: "cpp",
    defectClass: "false-evidence",
    description:
      "THE FIRST VERSION OF THE LOCAL RECEIVER ARM, re-injected: a member table keyed by the owner NAME ALONE, with none of the three guards the shipped version carries (class declared exactly once in the file; member declared INSIDE that class body; no function-scope binding shadows the name at the call site). This mutant attaches an owner to every bare/`this->` call row whose SOURCE symbol belongs to a class that publishes a callable member with the target's name — the name-keyed rule. MEASURED on the two-repo corpus before the guards landed: that rule produced false claims on template specializations (seven `UniversalPrinter` spellings in gtest.h), block-scope shadowing (`using std::swap;` hiding `AssertionResult::swap`), duplicate same-named classes in one file, and vendored amalgamations whose class bodies are in included headers (gmock-gtest-all.cc). Those four defects are pinned as the forbid rows of cpp/local-implicit-owner: withShadow (local lambda shadows a member), withUsing (using-declaration shadows a member), runPairAlpha (two `Pair` classes, one spelling), and the class-must-be-in-file/unique guards named in the fixture rationale. Caught-by names that fixture.",
    caughtBy: "cpp/local-implicit-owner",
    transform: (r) => {
      const callableMembersByOwner = new Map<string, Set<string>>()
      const sourceOwners = new Map<string, Set<string>>()
      for (const s of r?.symbols ?? []) {
        const owner = typeof s?.ownerName === "string" ? String(s.ownerName).trim() : ""
        if (owner === "" || owner === "global" || !s?.name) continue
        // guard 1 (class uniqueness), 2 (inside the class body) and 3 (shadowing) ALL removed.
        if (s.kind === "method" || s.kind === "constructor") {
          let set = callableMembersByOwner.get(owner)
          if (set === undefined) {
            set = new Set()
            callableMembersByOwner.set(owner, set)
          }
          set.add(String(s.name))
        }
        let owners = sourceOwners.get(String(s.name))
        if (owners === undefined) {
          owners = new Set()
          sourceOwners.set(String(s.name), owners)
        }
        owners.add(owner)
      }
      const claim = (x: any) => {
        if (x?.type !== "calls" || typeof x?.metadata?.owner === "string") return x
        const owners = sourceOwners.get(String(x?.source ?? ""))
        if (owners === undefined) return x
        for (const owner of owners) {
          if (callableMembersByOwner.get(owner)?.has(String(x?.target ?? "")) === true) {
            return { ...x, metadata: { ...(x.metadata ?? {}), owner } }
          }
        }
        return x
      }
      return { ...r, relationships: (r?.relationships ?? []).map(claim) }
    },
  },
]
