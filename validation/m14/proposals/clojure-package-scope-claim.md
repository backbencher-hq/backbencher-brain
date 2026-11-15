# PROPOSAL (Lead-only files) — the `packageScope` claim for Clojure, PRICED before it is proposed

**From:** the `clojure` lane · **2026-10-20** · **scope: files the lane may not edit**
`script/m14/incoming-gate.ts` · `script/m14/incoming-rule.ts` · `validation/m14/verification/RESOLUTION-LEDGER.md`

**Nothing here has been applied.** The lane edited `src/ast/real-clojure-analyzer.ts` only, and only
the `languageNamespaceSlash` opt-in (a lane-side, arbiter-supported change, described in
`CLOJURE-VERDICT-2026-10-20.md` §4). This file is the PROPOSAL for the rest.

---

## 1 · WHY THE CLAIM IS THE LEVER, AND WHY IT IS CURRENTLY UNREACHABLE

The fleet ledger names the `packageScope` claim as "the only true statement available for the
fleet's largest un-resolvable class", and says "no analyzer emits the claim yet, so no measurement
moved. The remaining work is the LANE's: which names belong to which dependency, the flag-gated
emission, and the fixtures in both directions."

**The remaining work is not only the lane's.** The claim's evidence is the PROJECT'S OWN MANIFEST,
and the shared arbiter reads **twelve** manifest kinds:

`go.mod` · `package.json` · `composer.json` · `pubspec.yaml` · `Cargo.toml` · `pyproject.toml` ·
`requirements*.txt` · `Gemfile` · `pom.xml` · `build.gradle` / `build.gradle.kts` ·
`Package.swift` · `*.csproj` / `*.fsproj` / `*.vbproj`

— **and not Clojure's two**: `deps.edn` (tools.deps) and `project.clj` (Leiningen). The corpus
carries both (`clj-kondo/deps.edn`, `clj-kondo/project.clj`), so the channel is structurally
unavailable to this lane: `projectFactsForFiles` finds no governing manifest for any clojure file,
`packageDependenciesByFile` has no entry for any of them, and `verifyPackageScopeClaim` therefore
returns `externalUnverified` for every row.

**A lane-side publication TODAY would be a regression, not a lever.** The 6,519 `extOK` and the
`ext? 0` headline would become `ext? N`, and the problem total would not move at all — a
relabelling, which is the exact shape the CLOJURE-FIX page's ARM C measured and rejected.

---

## 2 · THE PRICE, MEASURED BEFORE THE PROPOSAL

New lane instrument: **`validation/m14/fixtures/clojure/package-scope-price.ts`**
(`BB_CORPUS_ROOT=$PWD/.corpus bun run validation/m14/fixtures/clojure/package-scope-price.ts`).
It parses the whole admitted population with production's own `parseFile`, builds the key space
the way the gate's own `countKey` does (**name AND `qualifiedName` in ONE map** — an instrument
that keeps the alias in a second map hands the rule a key space the gate never sees and reports a
false wall of thousands of rows), classifies every edge with the arbiter's own `classifyEdge`, and
asks the arbiter's own `verifyPackageScopeClaim` what the claim would do against a lane-local
manifest reader.

**Population: 646 files / 3 repos · FARM root (`$PWD/.corpus`) · whole admitted population · stride 1.**

| | rows |
|---|---:|
| non-resolved edges | 16,533 |
| already carrying a claim | 6,591 |
| third-party libspec targets the FILE declares | 1,612 |
| **WOULD VERIFY** (the project declares the dependency) | **635** — `calls` 301 · `references` 293 · `imports` 41 |
| **WOULD REFUTE** (it does not) | **977** |
| no governing manifest (unverifiable, not a resolution) | 0 |

**Verified packages:** `babashka.fs` 535 · `babashka.process` 74 · `missing.test.assertions` 14 ·
`babashka.pods` 4 · `com.github.javaparser` 2.

**THE 629 -> 635, and WHY THE SIX MOVED (2026-10-20, re-measured after the Lead's reader landed).**
The first price was computed with a REPO-ROOT-ONLY reader. The gate's `manifestResolutionForFile`
walks UP from the file's own directory and stops at the first directory holding any manifest it
reads — and the `clojure` repository carries a **`pom.xml`** and no `deps.edn` and no
`project.clj`, so its 142 files are governed by a MAVEN manifest and six of their libspecs are
declared there. The gate finds the pom; a root-only reader does not. **The price follows the
measurement, and the control's expectations follow the price.** The reader and the walk now live in
ONE place (`validation/m14/fixtures/clojure/clojure-manifest-facts.ts`), and the instrument ASSERTS
FROM THE SOURCE that the gate's own clojure reader carries the same four spellings and the same
two regexes — it exits 4 rather than quote a price from a reader the gate does not run.

**Refuted packages (these would be clause-4 failures if the claim were published blind):**
`clj-kondo.impl.toolsreader.v1v2v2.clojure.tools.reader.reader-types` 112 ·
`clj-kondo.impl.toolsreader.v1v2v2.cljs.tools.reader.reader-types` 93 · `ring.mock.request` 150 ·
`clj-kondo.impl.rewrite-clj.node.protocols` 38 · `clj-kondo.impl.rewrite-clj.node` 34 ·
`next.jdbc` 32 · `schema.core` 32 · `cognitect.transit` 26 · `cheshire.core` 26 ·
`expectations.clojure.test` 16 · `potemkin` 15 · `compojure.response` 14 · `clojure-lsp.api` 12 ·
`rum.core` 9 …

**⇒ A BLIND PUBLICATION IS A CLAUSE-4 FAILURE (977 `extFAIL`). The lever is 635 rows, and it is
NOT reachable by publishing the claim on every libspec.**

---

## 3 · WHY THE 977 REFUTE — and it is not one thing

**Two distinct classes, and they need opposite answers.**

**(a) 205 rows are the PROJECT'S OWN namespaces.** `clj-kondo.impl.*` is clj-kondo's own code; the
per-file analyzer cannot see that a namespace it is asked about belongs to the very project it is
in, so a dependency claim on it is simply **false**. These rows are the **CLJ-IN2** class (a
namespace-aware resolver / a clojure project index would resolve them) and a dependency claim is
the wrong instrument for them.

**(b) ~772 rows are third-party namespaces whose MAVEN COORDINATE the checkout does not contain.**
The manifest declares `ring/ring-mock`; the file requires `ring.mock.request`; **nothing in the
checkout connects a Clojure namespace to a Maven coordinate** — that mapping is a Clojars/Maven
registry fact. The `packageScope` claim's evidence is therefore *insufficient* for this language,
not merely absent: the manifest can only confirm a claim when the libspec is written in the
coordinate form the manifest uses (`babashka.fs` ↔ `babashka/fs` — the convention Clojure itself
recommends, and the 635 verified rows are exactly this case), or when the libspec is a group
prefix (`com.github.javaparser` ↔ `com.github.javaparser/javaparser-core`, which the arbiter's
`/`-boundary rule already accepts).

---

## 4 · THE PROPOSAL — three changes, in order, each with its own price

### 4.1 · GATE (Lead) — read Clojure's two manifests, in the four spellings a libspec may use

In `script/m14/incoming-gate.ts`'s `manifestDependenciesIn(dir)`, add two readers beside the
existing twelve. The exact code, in the file's own style:

```ts
  // ── deps.edn (Clojure / tools.deps) — ADDED 2026-10-20 (clojure lane). A Clojure dependency is
  // a MAVEN COORDINATE `group/artifact`, and the libspec a file writes is a NAMESPACE — so a
  // coordinate is recorded in the spellings a Clojure libspec may use: the coordinate itself
  // (`babashka/fs`), the group-with-a-dot form (`babashka.fs`, the convention Clojure
  // recommends), and the namespace form the Clojure convention implies
  // (`<last group segment>.artifact`, `io.replikativ/datalog-parser` -> `replikativ.datalog-parser`).
  // The arbiter's matcher is EXACT or `/`-boundary and knows nothing about this convention, so the
  // reader must supply every spelling — the same thing the pom.xml reader already does for a
  // maven coordinate ("BOTH spellings are recorded: the coordinate for a coordinate-shaped claim,
  // and the group alone for a package-shaped one").
  {
    const text = read("deps.edn")
    if (text !== null) {
      sawManifest = true
      for (const m of text.matchAll(/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\s*\{/g)) addCoord(m[1]!, m[2]!)
    }
  }
  // ── project.clj (Clojure / Leiningen) — ADDED 2026-10-20 (clojure lane). `:dependencies
  // [[artifact "v"] [group/artifact "v"]]`, AND the PROFILE dependencies: clj-kondo's own
  // `project.clj` puts ring-mock, next-jdbc, schema, compojure, potemkin, expectations, rum and
  // clojure-lsp in the `:test` PROFILE, and the corpus's test fixtures require exactly those.
  {
    const text = read("project.clj")
    if (text !== null) {
      sawManifest = true
      for (const m of text.matchAll(/\[\s*([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?)\s+"/g)) {
        const spec = m[1]!
        const slash = spec.indexOf("/")
        if (slash > 0) addCoord(spec.slice(0, slash), spec.slice(slash + 1))
        else addCoord("", spec)
      }
    }
  }
```

with a small helper beside the reader:

```ts
/** A MAVEN COORDINATE `group/artifact`, recorded in every spelling a Clojure libspec may use. */
const addCoord = (group: string, artifact: string): void => {
  const g = group.trim(), a = artifact.trim()
  if (a.length === 0) return
  if (g.length > 0) {
    add(`${g}/${a}`)
    add(`${g}.${a}`)
    add(`${g.split("/").pop()}.${a}`)
  }
  add(a)
}
```

**PRICE: 635 rows become verifiable. NOTHING ELSE MOVES** — a manifest reader only adds names to a
set, and every other lane's manifest set is unchanged (this reader only fires in a directory that
holds a `deps.edn` or a `project.clj`, and no other corpus language ships one under those names).

**RISK: a clojure repo that ships a `project.clj` for an UNRELATED tool.** The reader is
fail-closed in both directions (a manifest with no matching dependency REFUTES), so a false
coordinate would cost a lane a refutation. `project.clj` is unambiguous (it is a Leiningen build
file by name), and `deps.edn` likewise (tools.deps by name). **ACCEPTABLE.**

### 4.2 · ARBITER (Lead) — a MEMBERSHIP claim must not be charged as a FALSE claim

**RULED BY THE LEAD, 2026-10-20 — and the ruling is the arbiter's own governing rule applied:**

> A `packageScope` claim asserts MEMBERSHIP — "this name is a member of the package P" — while the
> manifest is evidence about a DIFFERENT proposition, the project's DECLARED DEPENDENCY SET, and
> **a manifest's SILENCE about P is not evidence about P's membership.** So: the manifest declares P
> and the name is among the names P's own evidence attributes → VERIFIED · the manifest declares P
> and the name is NOT among them → REFUTED · **THE MANIFEST DOES NOT DECLARE P → UNVERIFIABLE, NOT
> REFUTED.** That follows from the ruling's own governing rule — "if the project's evidence cannot
> answer it, the claim is unverifiable" — which is why that rule is written first.

**⇒ THE 977 ARE NOT A CLAUSE-4 FAILURE TO AVOID. THEY ARE ROWS THE CLAIM MUST NOT BE PUBLISHED
ON — and the lane's own price instrument, which counted them, IS the claim's EMISSION SURFACE, not
its refutation surface.** The price becomes the emission contract:

| | rows | what happens |
|---|---:|---|
| the manifest declares the dependency | **635** | VERIFIED — the row moves from the wall to a verified claim |
| the manifest does not declare it | **977** | UNVERIFIABLE — the row stays unresolved and counts against clause 1, which is where an undecided row belongs |

**AND IT IS SAFE AGAINST LAUNDERING, WHICH WAS CHECKED RATHER THAN ASSUMED:** a lane that published
a claim for a package the project does not depend on gets UNVERIFIABLE, not VERIFIED — the row does
not resolve, clause 1 still fails, **the lane gains nothing.** The verdict moves ONLY on the rows
where the evidence is blind, and that is a NARROWER claim, not a looser one.

**THE BRANCH THE CHANGE TOUCHES** (`script/m14/incoming-rule.ts`, `verifyPackageScopeClaim`, and the
`packageScope` branch of `classifyEdge`):

```ts
// today — a package the manifest does not declare is REFUTED, and `classifyEdge` books that as
// `externalRefuted` -> extFAIL, charged against the lane.
export function verifyPackageScopeClaim(facts, dependency, edgeFile?) {
  ...
  if (norm === want) return "externalVerified"
  if (norm.startsWith(want + "/") || want.startsWith(norm + "/")) return "externalVerified"
  return "externalRefuted"        // <-- THIS LINE: "not declared" must read UNVERIFIABLE
}
```

**THE CONTROL, WHICH IS THE LANE'S HALF OF THE PROOF:** the 635/977 split is computed by the
lane's own instrument, from a lane-local manifest reader and the arbiter's own matcher, and it does
**not** depend on the arbiter's semantics at all. So after the Lead's changes land, **635 must
still verify and the 977 must still not resolve** — if the shared change loosened anything, the
arm's movement would exceed 635 and this control is what says so:

```
BB_CORPUS_ROOT=$PWD/.corpus bun run validation/m14/fixtures/clojure/package-scope-price.ts \
  --expect-verify 635 --expect-refute 977
# exits 4 on a mismatch — the control is a GATE, not a report
```

### 4.3 · LANE — the publication, READY, and it waits for 4.1 + 4.2

**The lane's half is WRITTEN and PROVEN TO APPLY, and it is deliberately NOT in the working tree
yet.** The patch: **`validation/m14/proposals/clojure-package-scope-emission.patch`** (81 lines,
against `src/ast/real-clojure-analyzer.ts` at `b99dbd66aa2e7b59805c32966f73e6aa4106e1b1`).
`git apply --check` is clean, it applies, and it REVERSES to a byte-identical file — proved by
`validation/m14/fixtures/clojure/build-emission-patch.ts`, which builds the patch from the current
analyzer, applies it, reverses it, and checks the digest.

**WHY IT WAITS, AND THE ORDER IS NOT A MATTER OF TASTE:**

| if the emission lands… | then the arm reads… | which is… |
|---|---|---|
| before the gate reads `deps.edn`/`project.clj` | `ext?` on all 1,612 rows | a **regression** on the lane's `ext? 0` and on clause 1's headline, with no movement at all |
| after the gate reader but before the semantics change | `extFAIL` on the 977 | a **clause-4 failure** charged against the lane |
| after BOTH | `extOK` +635, the 977 still unresolved | the lever, and only the lever |

**⇒ THE ORDER IS: (4.1) → (4.2) → the emission → the arm.** The lane will apply the patch and
run the arm in the same window, and the 635/977 control above is what proves the shared change
loosened nothing.

**WHAT THE EMISSION DOES.** On every `calls` / `references` / `imports` row whose target names a
namespace the FILE declares as a libspec, it publishes

```
metadata.packageScope = { package: <the libspec as the file wrote it>, name: <the member> }
```

The analyzer already knows every libspec — the `imports` edges' targets ARE the libspecs as the
file wrote them (`babashka.fs`, `io.replikativ/datalog-parser`) — and it already resolves an
aliased use to the libspec's namespace. **No new parsing, no new vocabulary, and the analyzer
still reads no manifest**: the manifest stays the ARBITER's evidence, which is the whole point of
the claim.

**TWO THINGS THE PATCH IS CAREFUL ABOUT, and both are the shape of a laundering bug:**

1. **THE LIBSPEC IS MATCHED, NOT SPLIT.** A Clojure libspec is `babashka.fs` (a namespace) **or**
   `io.replikativ/datalog-parser` (a maven coordinate) — and a coordinate contains a `/` of its
   own, so splitting the TARGET at a fixed slash would cut the namespace in half and publish a
   claim on `io.replikativ` (a GROUP, not a dependency). The patch matches the file's libspec set
   instead, LONGEST FIRST, and the member is what follows the libspec.
2. **THE TWO CLAIMS ARE DISJOINT.** The arbiter reads `packageScope` BEFORE `languageNamespace`
   (the manifest is the stronger evidence), so a row carrying both would lose the namespace
   claim's answer. The namespace claim fires only for a root IN the closed language/runtime set
   and this one only for a root OUTSIDE it — and the patch HOISTS that root list so both claims
   read ONE list rather than two copies of it (a duplicated constant is a second source of truth,
   and this one decides which rows are the language's business and which are a dependency's).

**FIXTURES, BOTH DIRECTIONS, and the lane will ship them with the change:** a libspec the project
declares → the claim is published and the row verifies; a libspec the project does NOT declare →
the claim is published and the row does NOT resolve (the 977's shape) — the second fixture is the
one that would have caught the 977.

---

## 5 · WHAT THE LANE ASKS THE LEAD TO DECIDE, IN ONE LINE EACH

| # | decision | owner | price | state |
|---|---|---|---|---|
| 1 | add `deps.edn` + `project.clj` to `manifestDependenciesIn`, in four spellings | Lead (`incoming-gate.ts`) | **+635 rows verifiable**; no other lane moves | **RULED — the Lead's, and in the ruling** |
| 2 | a `packageScope` claim whose package the manifest does not declare is UNVERIFIABLE, not REFUTED | Lead (`incoming-rule.ts`) | **977 rows**: named, not charged | **RULED — the Lead's, and in the ruling** |
| 3 | the ledger's clojure row quotes the ACCEPTED arm (43,439); HEAD's analyzer gives 43,324 | Lead (`RESOLUTION-LEDGER.md`) | the headline is the pre-Part-B number — see the verdict page §6 | **OPEN** |
| 4 | a clojure `CLOJURE_DECLARATION_SPEC` (a project index) | Lead (`src/ast/project-index.ts`) | the 205 project-namespace rows and the 768 genuinely-ambiguous rows | **OPEN** |

**AND ONE MORE, WHICH IS NOT A CHANGE BUT A DECISION:** the 205 rows that are the PROJECT'S OWN
namespaces are the **CLJ-IN2** class, and the instrument that would resolve them is a **clojure
project index** (`CLOJURE_DECLARATION_SPEC` in `src/ast/project-index.ts`, which the lane may not
edit). The D7 page already says "a namespace-aware resolver / project index would disambiguate
each pair; the lane owns no module-space fact". **A clojure `DeclarationSpec` is a Lead-scoped
decision, and it is worth more to this lane than any claim kind.**

---

## 6 · THE MEASUREMENT COMMANDS (re-runnable)

```
export BB_CORPUS_ROOT=$PWD/.corpus
bun run validation/m14/fixtures/clojure/package-scope-price.ts --json price.json
bun run validation/m14/fixtures/clojure/production-binding-split.ts \
  --expect-edges 43324 --expect-resolved 26791 --expect-amb 4259 --expect-unres 5755 \
  --json prodbind.json
```
