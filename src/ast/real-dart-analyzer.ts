// Dart Intelligence Engine — Author: Muhammad Ishaq Khan
// What this file is: the pure-AST analyzer for Dart (`.dart`, routed by src/ast/language-detection.ts) — the
// M12.11 rewrite under the C#-family contract: it publishes the symbols and relationships the graph engine
// stores, works from AST nodes only, and is fully regex-free (string work is char-code scans). Symbols:
// classes, mixins, extensions, enums (+enum members), typedefs, methods, getters/setters -> property,
// fields, top-level functions, constructors -> "constructor"; NO locals/params/lambda params.
// Relationship types: the TEN matrix types PLUS the canonical vocabulary the owner ruling added (2026-10-18):
//   contains · uses · calls · references · instantiates · extends · overrides · imports · implements · exports
//   mixes_in      with-clause mixin application (all three sites; was uses{isMixin:true})
//   part_of       `part`/`part of` directives, URI and NAMED-library forms (was imports{isPart})
//   references    additionally carries ANNOTATIONS (references{isAnnotation, annotatedKind}, 16 positions)
//                 and the mixin `on`-constraint (references{isMixinOn}; was extends{isMixinOn})
// The rules: leaf identities for calls (`Counter -> Sqrt`); contains from ownerName; extends/implements from
// the superclass/interfaces clauses; instantiates from capitalized constructor invocations (Dart has no
// `new`); imports/exports from import/export directives with a project-relative file target when the
// checkout can answer; overrides from `@override` or same-name-in-base; constant-pattern TESTS (bare,
// null-check/null-assert, relational, collection forms) publish uses{isConstantPattern,isPatternTest};
// builtins (print/assert) filtered; selector chains and cascade_sections resolve to the selector.
// RECEIVER CHANNEL: calls/uses rows whose receiver type is statically known carry metadata.owner (exact
// class-like type: class/enum or a type declared outside the file) + metadata.ownerEvidence in
// {param, field, annotation, assignment} — the channel src/ast/member-owner-resolution.ts resolves
// through. Mixin/extension/typedef owners are deliberately withheld (the resolver would withdraw the
// binding). Typed catch clauses, container ELEMENT types (List<T> etc.), MAP views (`for (v in
// m.values)` reads V; `.keys` reads K) and AWAITED FUTURES (`final repo = await pending` with
// `Future<Repo> pending` types `repo` as Repo) type their bindings from written evidence.
// NAMESPACE CITATION CLAIMS (task-26): with BB_DART_CITATION=1 (DEFAULT OFF) rows whose bare target
// is an exact committed DART_SDK_CORE vocabulary name carry languageNamespace:[name] +
// languageNamespacePolicy:"strict-absent" (annotation rows and capitalized type-shaped targets only);
// the arbiter verifies against the committed list and strict-absent falls through where the run
// declares the target. Flag-off output is byte-identical (probe: script/m14/dart-citation-fixtures.ts).
// THE POPULATION THIS IS MEASURED ON: docs in validation/m14/verification/ — DART-APPLICABLE-SET.md,
// DART-RESOLUTION-CLASSIFICATION.md, DART-WHOLE-POPULATION.md (cap-0 arm: 3,748,617 edges over 33,738
// files, every non-resolved edge in a named counted class).
// Where docs, spec, fixtures and validations live: docs/analyzers/real-dart-analyzer.md ·
// script/m14/spec/dart-completeness.json · validation/m14/fixtures/dart/** · `bun run script/m14/run-fixtures.ts --lang dart`.
// CO-EDIT WHEN THIS FILE CHANGES: the spec's node-type buckets · the fixtures pinning a changed edge · the
// docs · script/m14/differential.ts (`deriveDartEdges` — the TRUTH side; an emission the oracle does not
// derive lands as MISSING/UNEXPLAINED) · script/m14/completeness-inventory.ts (`dart` LANG_CONFIG) ·
// src/ast/engine.ts (getAnalyzer + wasm) · src/ast/language-detection.ts (`.dart` routing).
// Grammar: tree-sitter-dart (wasm/tree-sitter-dart.wasm, resolved through node_modules by engine.ts).

import type { Node } from "web-tree-sitter"
import * as path from "path"
import { existsSync, readFileSync, readdirSync } from "fs"
import { ASTEngine } from "./engine"
import { BINDING_SEP } from "./types"

/**
 * The committed citation vocabulary, LITERAL COPY of `script/m14/citations.ts` `DART_SDK_CORE`
 * (id `dart-sdk-core`; source: "Dart SDK dart:core / dart:async — metadata annotations and core
 * global symbols"). `src/ast` must not import `script/`, so the copy is asserted against the
 * committed file by `script/m14/dart-citation-fixtures.ts`; a divergence fails that probe.
 * EXPORTED so the drift probe can read the exact list that ships.
 */
export const DART_CITATION_ROOTS: ReadonlySet<string> = new Set([
  "override", "deprecated", "Deprecated", "pragma", "deprecated_member_use", "mustCallSuper",
  "protected", "required", "immutable", "factory", "optionalTypeArgs", "visibleForTesting",
  "visibleForOverriding", "doNotStore", "doNotSubmit", "mustBeOverridden", "redeclare",
  "nonVirtual", "recordUse", "target", "Target", "Metadata", "Object", "String", "int", "double",
  "bool", "List", "Map", "Set", "Future", "FutureOr", "Stream", "Function", "Iterable", "Duration",
  "DateTime", "Exception", "Error", "StackTrace", "RegExp", "Uri", "BigInt", "Symbol", "Type",
  "Null", "Never", "void", "dynamic", "print", "identical", "identityHashCode",
])

/** Labels whose bare-name targets may carry a citation claim (the D7 row-6 type-shaped class). */
const DART_CITATION_TYPE_SHAPED_LABELS = new Set([
  "calls", "uses", "instantiates", "extends", "implements", "overrides", "mixes_in", "part_of",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free normalization)
// ============================================================================

/** Remove every whitespace character by char code. Replaces /\s+/g. */
function stripWhitespace(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const ws = c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12
      || (c >= 0x00a0 && (c === 0x00a0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a)
          || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff))
    if (!ws) out += text[i]
  }
  return out
}

/**
 * `[A-Za-z_$][\w$]* ( "." [A-Za-z_$][\w$]* )*` by char code.
 *
 * The first version of this allowed `$` in EVERY position, because it used one predicate
 * for both halves of the pattern. That is wrong: `$` is legal only as the FIRST character
 * (`$x` is a valid Dart identifier) — the tail class is `\w$` but in the SOURCE pattern the
 * tail is `\w` plus `$` only where the character class literally spells `[\w$]`... which
 * it does NOT. The real tail is `[\w$]`? No: the pattern is `[A-Za-z_$][\w$]*`, whose
 * tail class IS `[\w$]` and DOES include `$`.
 *
 * Measured against the original: `9a` disagreed — false in the regex, true here. So the
 * regex's own tail class must be read literally, and the disagreement is the evidence.
 * Fixed by making the tail exactly `[A-Za-z0-9_$]` as the pattern's class says, and
 * re-verified by the differential rather than by reasoning.
 */
function isDottedIdentifier(s: string): boolean {
  const identStart = (c: number): boolean =>
    (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36
  const identPart = (c: number): boolean =>
    (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36
  if (s.length === 0 || !identStart(s.charCodeAt(0))) return false
  let prevDot = false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 46 /* . */) {
      if (prevDot) return false
      prevDot = true
      continue
    }
    if (!identPart(c)) return false
    prevDot = false
  }
  return !prevDot
}

/**
 * `[A-Za-z_$][A-Za-z0-9_$]*` by char code — the SINGLE-segment sibling of `isDottedIdentifier`,
 * and the replacement for the four `/^[A-Za-z_$][A-Za-z0-9_$]*$/` tests that were this lane's
 * share of the fleet's no-regex gate.
 *
 * This is a predicate about a STRING THE SOURCE WROTE (a field type or parameter type read off
 * the tree), not a claim about a node type the grammar may or may not emit, so a character walk
 * is the same test and not a dead branch: the class is ASCII, both ends are anchored, and there
 * is no quantifier subtlety. Char codes rather than `includes` so the class cannot drift from
 * `isDottedIdentifier`'s by a locale-aware comparison.
 */
function isPlainIdentifier(s: string): boolean {
  if (s.length === 0) return false
  const start = s.charCodeAt(0)
  if (!((start >= 97 && start <= 122) || (start >= 65 && start <= 90) || start === 95 || start === 36)) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36)) return false
  }
  return true
}

/**
 * Drop every trailing `?` — Dart's nullable-type suffix (`String?`, `List<int>?`), the four
 * `.replace(/\?+$/, "")` sites. A backward walk is the same rule as `\?+$`: all of them, only
 * at the end, and the string is returned unchanged when there are none (which is the common
 * case, so the common path allocates nothing).
 */
function stripNullableSuffix(text: string): string {
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 63 /* ? */) end--
  return end === text.length ? text : text.slice(0, end)
}

/**
 * THE TYPE NAME A SPELLED HEAD NAMES, with its type arguments removed.
 *
 * `GenericClass<int>` -> `GenericClass`, `Map<String, List<int>>` -> `Map`. The arguments are
 * part of the TYPE, not of its NAME: `GenericClass<int>.new` and `GenericClass<String>.new` name
 * the same constructor of the same declaration, and every lookup this pass makes — the visibility
 * of the type, the named-constructor set, `qualifiedTarget` and the `baseBeyondRunScope` claim —
 * is a question about the NAME. Passing the arguments through made each of them a different
 * question: `visibleTypes.has("GenericClass<int>")` is false, `namedCtors.has("GenericClass<int>.new")`
 * is false, and the claim `GenericClass<int>` is not identifier-shaped — which is how three
 * const-pattern rows in dart-sdk came to be REFUTED by the gate (`causeFAIL` 3).
 *
 * CONSERVATIVE ON PURPOSE, because the head arrives as raw source text: the `<` must open a run
 * that balances and CLOSES AT THE END of the segment (`Map<String, List<int>>` yes, `a < b` no),
 * and what precedes it must be a plain identifier. Anything else is returned unchanged, so a head
 * this rule does not understand is passed through rather than truncated — a wrong name is worse
 * than an unnormalized one.
 */
function typeNameWithoutArguments(text: string): string {
  const lt = text.indexOf("<")
  if (lt <= 0) return text
  if (text.charCodeAt(text.length - 1) !== 62 /* > */) return text
  let depth = 0
  for (let i = lt; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 60 /* < */) depth++
    else if (c === 62 /* > */) {
      depth--
      // a run that closes before the end means the tail is not all arguments
      if (depth === 0 && i !== text.length - 1) return text
    }
  }
  if (depth !== 0) return text
  const head = text.slice(0, lt)
  return isPlainIdentifier(head) ? head : text
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

function stripCommentMarkers(text: string): string {
  if (text.startsWith("///")) return text.slice(3).trimStart()
  if (text.startsWith("//")) return text.slice(2).trimStart()
  if (text.startsWith("/*")) {
    const end = text.endsWith("*/") ? text.length - 2 : text.length
    return text.slice(2, end).trim()
  }
  return text.trim()
}

function isCapitalized(text: string): boolean {
  if (text.length === 0) return false
  const code = text.charCodeAt(0)
  return code >= 65 && code <= 90 // 'A'..'Z'
}

/**
 * Dart's implicit `dynamic` — a TYPE NAME the analyzer publishes under
 * `parameters[].type`, NOT a grammar node type.
 *
 * Named rather than written inline because the F1 grammar audit reads every
 * `X.type === "lit"` as a node-type reference (`isTypeComparison`), so the
 * inline comparison was reported as `unknownNodeTypes: ["dynamic"]` on this
 * lane for a literal the grammar is never asked about. The reference is honest
 * about what it is now; the audit is not being taught to skip anything.
 */
const IMPLICIT_DYNAMIC_TYPE = "dynamic"

/**
 * THE NAME AN UNNAMED EXTENSION IS PUBLISHED UNDER.
 *
 * `extension on String { ... }` is legal Dart: an extension with no name of its own. Until this
 * round the analyzer gave it the TARGET TYPE — `name = node.childForFieldName("name")?.text ||
 * targetType` — and that is a NAME-KEYED lie: the project then publishes a declaration called
 * `String` that is not `String`, so every consumer that decides BY NAME reads the wrong answer.
 *
 * MEASURED, whole project, through the pool (`validation/m14/fixtures/dart/unnamed-extension-price.ts`):
 *
 *   riverpod   41 unnamed extensions, 19 sharing a name with a REAL declaration of the same project
 *              (`ProviderBase` x5, `RiverpodAnalysisResult` x2, `_DataRecord`, `Node`,
 *              `ProviderListenableOrFamily`, `_ProviderOverride`, `_FamilyOverride`, and `Object`
 *              from `packages/riverpod/test/feature/offline_test.dart` — whose six members also
 *              published the AMBIGUOUS targets `Mutation.constructor`/`label`/`key`/`call`/`run`).
 *   proxicall   1 (`BusinessDiscoveryCubit`).   dart-http   2, neither colliding.
 *
 * The `Object` row is the expensive one, and it is why this is a defect rather than untidiness:
 * with an index the analyzer retargets `Object.hashCode` / `Object.operator ==` / `Object.toString`
 * to the dart:core interface and marks the claim `isExternalBase`; the arbiter verifies an external
 * claim by looking the OWNER up, found the ANONYMOUS EXTENSION, and REFUSED 31 claims that are
 * true. The gate counts a refused claim against the lane, so the lie was published as the lane's
 * own defect (`/tmp/dartgate/gate-riverpod-index.log`: `extFAIL 31`).
 *
 * So an unnamed extension publishes a SYNTHESIZED name that is no declaration's, in the family's
 * spelling for a declaration the source never named (`anonymous_Comparator`, real-java-analyzer.ts;
 * `anonymous_impl`, real-rust-analyzer.ts): `unnamed_extension_<target>`, or the bare
 * `unnamed_extension` when the `on` type is not an identifier (java's `anonymous_class` fallback).
 * The prefix is load-bearing in one more place — `isIndexArtifactName` (src/ast/
 * analysis-exclusions.ts) drops `^(anonymous|anon|unnamed)[_-]`, so the synthesized symbol never
 * reaches the index by construction, which is the honest state for a declaration that has no name
 * to jump to. `metadata.targetType` still carries the subject, so nothing about it is lost.
 */
const DART_UNNAMED_EXTENSION = "unnamed_extension"

/**
 * Positions where a `type_identifier` is a type mention the analyzer has ALREADY
 * published under another label, plus the one position where it is not a mention
 * of a type at all.
 *
 * Every entry is here because publishing it a second time would DOUBLE-COUNT one
 * fact under two labels, or claim a mention that the source does not make. The
 * inventory that produced this list is measured, not recalled —
 * `validation/m14/fixtures/dart/type-position-probe.ts` walks the same corpus and
 * prints the parent-position histogram; `collectTypeMention` carries the reason
 * for each group.
 */
const DART_TYPE_MENTION_DOUBLE_COUNTED = new Set<string>([
  // heritage — `extends` / `implements` / `with` (extractClassHeritage)
  "superclass", "interfaces", "mixins",
  // a mixin `on`-base is an `extends` edge (DARTD14), and a mixin-application
  // class publishes its base and its with-list through the same extractor
  "mixin_declaration", "mixin_application",
  // construction is `instantiates`
  "new_expression", "const_object_expression", "constructor_invocation",
  "redirecting_factory_constructor_signature",
  // `class Box<T>` DECLARES a type variable; it does not mention a type
  "type_parameter",
  // parse damage: not a fact about a well-formed program
  "ERROR",
])

/**
 * M60 rule R7 — no relationship endpoint may be the placeholder literal
 * `unknown`.
 *
 * MEASURED, analyzer-side, and reproducible with `BB_DART_CONC=1` — the census is
 * deterministic only at concurrency 1, for the reason its own header records:
 *
 *   BEFORE (`git show HEAD:src/ast/real-dart-analyzer.ts`):
 *     all 2,351 tracked `.dart` files of `proxicall` — **239** rows carry the literal
 *       as an endpoint: 154 `uses`, 68 `contains`, 17 `calls`.
 *     the 2,735-file sample across 5 repositories this lane's census uses — **106**
 *       rows: 85 `uses`, 19 `contains`, 2 `calls`.
 *   AFTER (this filter in place), the same two runs: **0** and **0**.
 *   `symbolsNamedUnknown 0` in both AFTER runs: no sampled file publishes a symbol
 *   named `unknown`, because `src/ast/pool-worker.ts` `keepSymbol`'s UNIVERSAL
 *   denylist rejects the name for every language. So every one of those rows was an
 *   endpoint NOTHING COULD BIND.
 *
 * Those 106 rows moved the published relationship total by 104 rather than 106: the
 * filter shares its loop with the dedup, and two of the 85 `uses` rows were
 * duplicates the dedup was already discarding. Both numbers are stated because a
 * reader who subtracts one from the other should find that difference rather than
 * trip on it.
 *
 * The shape is one construction, and it is common:
 *
 *   `ApiError.unknown('Data transformation failed: $e')`
 *
 * The selector chain reduces to its leaf, the leaf of a constructor call on a
 * capitalized type is the named constructor's segment, and the segment happens to
 * be the word `unknown`. The published edge read `map calls unknown`, i.e. a
 * symbol named `unknown` that no file in the corpus contains, colliding with the
 * pipeline's own "no target" sentinel.
 *
 * The alternative was to publish `map calls ApiError`, which is a different claim
 * and a false one — a call is not a call OF the type. The third alternative,
 * `instantiates ApiError`, is the shape `DT-A` trusts only for an IN-FILE named
 * constructor, and widening that to a cross-file guess would put edges in the graph
 * that the oracle does not derive and that nothing can check.
 *
 * So the edge goes. That is R7's own instruction: when a fallback has nothing
 * truthful to say, the honest state is ABSENCE and not the string `unknown`. The
 * cost is declared rather than assumed — a Dart declaration literally named
 * `unknown` loses its edge, and `proxicall/lib/models/nms/user_segment.dart`
 * declares exactly one (an enum constant, `enum SegmentType { …, unknown, … }`),
 * so the price is measured and non-zero: one declaration, and it published no edge
 * to it before the filter either.
 */
const R7_PLACEHOLDER_NAME = "unknown"

/**
 * The members `Object` declares, and therefore the members EVERY Dart class's
 * interface contains whether or not the class mentions them.
 *
 * Dart has no other root: every class implicitly extends `Object`, so
 * `toString`, `hashCode`, `runtimeType`, `noSuchMethod` and `operator ==` are
 * reachable from every type in the language. That makes this set the one place
 * where an override target can be named WITHOUT knowing the base's own file, and
 * `extractOverrideRelationships` uses it for exactly that. Measured against the
 * Dart SDK's own sources (`dart-sdk/sdk/lib/core/object.dart`, parsed through the
 * production entry point): `Object.toString`, `Object.hashCode`,
 * `Object.runtimeType`, `Object.noSuchMethod` and `Object.operator ==` are all
 * published declarations there.
 */
const DART_OBJECT_TYPE = "Object"
const DART_OBJECT_INTERFACE_MEMBERS = new Set<string>([
  "toString", "hashCode", "runtimeType", "noSuchMethod", "operator ==",
])



// ============================================================================
// SCOPE MANAGEMENT — frames carry an immutable snapshot of the scope chain
// ============================================================================

enum DartScopeKind {
  Global = "global",
  Class = "class",
  Function = "function",
}

interface DartScopeEntry {
  name: string
  kind: DartScopeKind
}

/**
 * Which of the three library-directive forms a file used, published on its Module node.
 *
 * The three are different claims about a name and a consumer must not read one as
 * another. `named` — `library X;`, the name is declared. `unnamed` — `library;`, the
 * library exists and declares NO name, so the file stem this analyzer published is its
 * own convention. `implicit` — no directive at all, and the Dart spec defines the
 * library's name as the file stem, so here the stem is the language's own answer and
 * not the analyzer's. Frequencies in a 3,000-file sample: 17 / 101 / 2,882.
 */
type DartLibraryDirective = "named" | "unnamed" | "implicit"

function scopeOwnerName(scopes: DartScopeEntry[]): string | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i].kind === DartScopeKind.Class) return scopes[i].name
  }
  return undefined
}

function scopeString(scopes: DartScopeEntry[]): string {
  const parts: string[] = []
  for (let i = 1; i < scopes.length; i++) {
    const s = scopes[i]
    if (s.kind !== DartScopeKind.Global) parts.push(s.name)
  }
  return parts.join(".")
}

// ============================================================================
// ANALYZER
// ============================================================================

/**
 * The inheritance-closed member set for every type in a `ProjectIndex`, derived ONCE
 * per index and shared by every file.
 *
 * `extractOverrideRelationships` runs per file, so deriving this inside it rebuilds
 * the whole closure for each file: on ProxiCall/lib with `--dart-deps=direct` that is
 * 13,846 types re-closed 2,351 times, and the differential stopped completing inside
 * two hours. Memoised on the index object with a WeakMap, so the cost is paid once per
 * run and a garbage-collected index takes its companion with it.
 *
 * The closure is what makes the two resolution paths agree — see the `exposed` comment
 * in `extractOverrideRelationships` — so it is the one piece of cross-file state this
 * analyzer holds, and holding it per-index rather than per-file is the difference
 * between a lane that runs and a lane that does not.
 */
const DARt_COMPANION_CACHE = new WeakMap<object, Map<string, Set<string>>>()

function dartCompanionFor(projectIndex: any): Map<string, Set<string>> | undefined {
  if (!projectIndex?.typeMembers) return undefined
  const key = projectIndex as object
  const hit = DARt_COMPANION_CACHE.get(key)
  if (hit) return hit
  const out = new Map<string, Set<string>>()
  const closure = (t: string, seen: Set<string>): Set<string> => {
    const cached = out.get(t)
    if (cached) return cached
    // A cycle in the type graph must terminate with "nothing known", not hang.
    if (seen.has(t)) return new Set<string>()
    seen.add(t)
    const members = new Set<string>(projectIndex.typeMembers.get(t) ?? [])
    for (const b of projectIndex.typeBases?.get(t) ?? []) for (const m of closure(b, seen)) members.add(m)
    out.set(t, members)
    return members
  }
  for (const t of projectIndex.typeKinds?.keys() ?? []) closure(t, new Set())
  DARt_COMPANION_CACHE.set(key, out)
  return out
}

// ============================================================================
// LIBRARY IDENTITY — a Dart library IS its URI, so an import edge can name a FILE
// ============================================================================
/**
 * `processImportExport` writes the SPECIFIER into every import/export target
 * (`package:flutter/material.dart:*`, `../x.dart:*`, `order_domain.dart:*`). None of those is a
 * symbol name, so no resolver can bind them — and that is not a defect of the resolver's rule:
 * a specifier is a PATH, and the rule resolves NAMES. Measured on the admitted population
 * (`validation/m14/fixtures/dart/import-target-paths.ts`: comment-aware text scan, 33,738
 * files, 110,957 directives):
 *
 *   · 86,196 directives (77.7%) name a file IN THE SAME CHECKOUT — resolvable, and today none
 *     are, because the edge names the specifier instead of the file the specifier names.
 *   · 44,296 of those name a target whose bare file STEM is not unique in its checkout, so the
 *     library NAME cannot address them. A project-relative PATH is unique by construction:
 *     one file, one path.
 *   · The other 24,761 name something no file in that checkout answers to — a dependency in the
 *     pub cache, a `dart:` library outside the SDK checkout, a generated or deleted file. Those
 *     are NOT resolved here and must not be: an unresolvable import may be a genuine external
 *     dependency or a broken edge, and telling those apart is the gate's external-claim question.
 *
 * So what is published for a library is its PROJECT-RELATIVE PATH (posix separators) — which is
 * what a Dart library really is: the language identifies a library by its URI, and inside a
 * checkout that URI is its path. BOTH sides read that string from ONE function, so the published
 * module and the edges that point at it cannot drift apart — the discipline this file already
 * applies to `libraryName` (`M60 D1`).
 *
 * WHERE THE PROJECT STARTS is derived, not passed: the directory containing `.git`, found by
 * walking UP from the file. No caller hands `analyze()` a project root — fixtures, the incoming
 * gate and production all enter through the same call, and the file's own path is the only thing
 * common to all three. Where there is no checkout above the file, the analyzer keeps the old
 * specifier targets rather than publishing a path whose origin no other file in the run shares.
 *
 * `package:` resolution reads the checkout's own `pubspec.yaml` files — the project's statement
 * of which packages it contains. It is cached per project root, and a package the checkout does
 * not declare (a pub dependency) is refused: the half of the answer that only the project can give.
 */
type DartLibrarySite = {
  /** the library's declared name (the file stem when it declares none) — the edge SOURCE */
  moduleName: string
  filePath: string
  /** the checkout root above the file, or null when the file is not inside one */
  projectRoot: string | null
  /** the project-relative path that names this library, or null when there is no root */
  moduleIdentity: string | null
}

type DartProjectFacts = {
  /** package name -> project-relative directory holding its pubspec.yaml ("" = the root) */
  packageRoots: Map<string, string>
  /** does this checkout carry an SDK (`sdk/lib`)? */
  sdkLib: boolean
  /** memoised `dart:<lib>` probe -> the relative SDK file, or null when the checkout has none */
  dartLibs: Map<string, string | null>
}

const DART_PROJECT_ROOT_CACHE = new Map<string, string | null>()
const DART_PROJECT_FACTS_CACHE = new Map<string, DartProjectFacts>()
/** Directory names a package/pubspec walk never enters. Not a guess: `.git` alone is the repo's
 *  own object store, and the rest are build outputs that no project declares packages in. */
const DART_WALK_SKIP = new Set([
  ".git", ".hg", ".svn", "node_modules", ".dart_tool", ".symlinks", "build", "coverage", ".pub-cache", "out",
])

/** The checkout root above `filePath`, memoised per directory; null when there is no `.git`. */
function dartProjectRootOf(filePath: string): string | null {
  const start = path.dirname(path.resolve(filePath))
  const seen: string[] = []
  let dir = start
  for (let i = 0; i < 64; i++) {
    const cached = DART_PROJECT_ROOT_CACHE.get(dir)
    if (cached !== undefined) {
      for (const d of seen) DART_PROJECT_ROOT_CACHE.set(d, cached)
      return cached
    }
    seen.push(dir)
    if (existsSync(path.join(dir, ".git"))) {
      if (DART_PROJECT_ROOT_CACHE.size > 20000) DART_PROJECT_ROOT_CACHE.clear()
      for (const d of seen) DART_PROJECT_ROOT_CACHE.set(d, dir)
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (DART_PROJECT_ROOT_CACHE.size > 20000) DART_PROJECT_ROOT_CACHE.clear()
  for (const d of seen) DART_PROJECT_ROOT_CACHE.set(d, null)
  return null
}

/** `[a-z][a-z0-9_]*` by char code — the pub and `dart:` library name shape. No regex: this
 *  lane parses with char scans so a pattern cannot quietly disagree with the grammar. */
function isDartLibraryName(text: string): boolean {
  if (text.length === 0) return false
  const first = text.charCodeAt(0)
  if (first < 97 || first > 122) return false
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    if (!ok) return false
  }
  return true
}

/** The `name:` of a pubspec, read by scanning lines from column 0 (a dependency's name is
 *  indented, so a top-level match is the package's own name and not a dependency's). */
function dartPubspecName(file: string): string | null {
  let text: string
  try { text = readFileSync(file, "utf8") } catch { return null }
  let lineStart = 0
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text.charCodeAt(i) !== 10) continue
    const line = text.slice(lineStart, i)
    lineStart = i + 1
    if (!line.startsWith("name:")) continue
    let v = 5
    while (v < line.length && (line.charCodeAt(v) === 32 || line.charCodeAt(v) === 9)) v++
    let end = v
    while (end < line.length) {
      const c = line.charCodeAt(end)
      if (c === 32 || c === 9 || c === 13 || c === 35) break
      end++
    }
    const value = line.slice(v, end)
    return isDartLibraryName(value) ? value : null
  }
  return null
}

/**
 * The project's own package map and SDK presence, built once per project root.
 *
 * The WALK COST is paid once per process per project (a repo's directory tree), not per file:
 * a `package:` specifier cannot be turned into a path without knowing which directory declares
 * the package, and only a directory walk can answer that for a package that is not on the
 * importing file's own ancestor path (measured: 23,375 of the in-repo `package:` directives
 * name a SIBLING package, more than half). Secrets are not read: only files literally named
 * `pubspec.yaml` are opened, and only their `name:` line is used.
 */
function dartProjectFacts(projectRoot: string): DartProjectFacts {
  const hit = DART_PROJECT_FACTS_CACHE.get(projectRoot)
  if (hit) return hit
  const facts: DartProjectFacts = {
    packageRoots: new Map(),
    sdkLib: existsSync(path.join(projectRoot, "sdk", "lib")),
    dartLibs: new Map(),
  }
  const stack: string[] = [projectRoot]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: import("fs").Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DART_WALK_SKIP.has(entry.name)) continue
        stack.push(path.join(dir, entry.name))
        continue
      }
      if (entry.name !== "pubspec.yaml" || !entry.isFile()) continue
      const name = dartPubspecName(path.join(dir, entry.name))
      if (name === null || facts.packageRoots.has(name)) continue
      const rel = path.relative(projectRoot, dir)
      facts.packageRoots.set(name, rel.split(path.sep).join("/"))
    }
  }
  if (DART_PROJECT_FACTS_CACHE.size >= 64) DART_PROJECT_FACTS_CACHE.clear()
  DART_PROJECT_FACTS_CACHE.set(projectRoot, facts)
  return facts
}

/** `lib/src/x.dart` — the project-relative path of an absolute file, posix separators. */
function dartRepoRelPath(projectRoot: string, absPath: string): string | null {
  const rel = path.relative(projectRoot, path.resolve(absPath))
  if (rel.length === 0 || path.isAbsolute(rel)) return null
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) return null
  return rel.split(path.sep).join("/")
}

/** Join a project-relative base and a `lib/...` tail, refusing anything that climbs out. */
function dartJoinInside(baseRel: string, tail: string): string | null {
  const base = baseRel.length === 0 ? "" : `${baseRel}/`
  const norm = path.posix.normalize(`${base}${tail}`)
  if (norm.length === 0 || norm === "." || norm === ".." || norm.startsWith("../")) return null
  return norm
}

/**
 * The file a directive names, as a project-relative path, or null when this checkout cannot
 * answer. Refusing is a first-class result: every branch below is a rule the corpus can audit.
 */
function dartImportTargetPath(projectRoot: string, filePath: string, uri: string): string | null {
  if (uri.length === 0) return null
  if (uri.startsWith("package:")) {
    const rest = uri.slice(8)
    const slash = rest.indexOf("/")
    if (slash <= 0 || slash === rest.length - 1) return null
    const pkg = rest.slice(0, slash)
    const sub = rest.slice(slash + 1)
    if (!isDartLibraryName(pkg)) return null
    const packageRoot = dartProjectFacts(projectRoot).packageRoots.get(pkg)
    // A package this checkout does not declare is a pub dependency: outside the population.
    if (packageRoot === undefined) return null
    return dartJoinInside(packageRoot, `lib/${sub}`)
  }
  if (uri.startsWith("dart:")) {
    const lib = uri.slice(5)
    if (!isDartLibraryName(lib)) return null
    const facts = dartProjectFacts(projectRoot)
    // Without an SDK in this checkout there is nothing to point at: a `dart:` library is part
    // of the SDK, and the SDK is present exactly when `sdk/lib` is.
    if (!facts.sdkLib) return null
    const cached = facts.dartLibs.get(lib)
    if (cached !== undefined) return cached
    const rel = `sdk/lib/${lib}/${lib}.dart`
    const found = existsSync(path.join(projectRoot, rel)) ? rel : null
    facts.dartLibs.set(lib, found)
    return found
  }
  // Another scheme (`http:`, `file:`, …) names something no path in this checkout is.
  if (uri.indexOf(":") >= 0) return null
  // A relative or bare specifier is resolved against the importing file's own directory.
  const abs = path.resolve(path.dirname(path.resolve(filePath)), uri)
  return dartRepoRelPath(projectRoot, abs)
}

export class RealDartAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const frameworks: Record<string, boolean> = { Dart: true }
    const patterns: Record<string, boolean> = {}
    const scopes: DartScopeEntry[] = [{ name: "__global__", kind: DartScopeKind.Global }]
    // M60 D1: the library is a real Dart entity and the `imports`/`exports` edges
    // already name it as their source, but nothing published it — 1,755 of 1,815
    // `imports` sources at 600 files did not resolve and 1,755/1,755 were exactly
    // the file stem. ONE name function feeds both sides, so the edge and the node
    // cannot drift apart again.
    //
    // The name comes from the parse tree, and the three cases are counted, not
    // assumed (3,000-file sample, `validation/m14/fixtures/dart/library-directive-census.ts`
    // and `empty-library-name.ts`):
    //   no `library` directive    2,882 files — an IMPLICIT library, whose name the Dart
    //                              spec defines as the file stem. The stem is a FACT.
    //   `library;` (unnamed)        101 files — a real directive whose `library_name` node
    //                              is EMPTY. The library declares NO name, so the stem here
    //                              is a CONVENTION this analyzer applies, not a fact, and
    //                              the published node says so in `libraryDirective`.
    //   `library X;` (named)         17 files — the declared name, read from the grammar.
    //                              Frequently DOTTED (`_fe_analyzer_shared.scanner.characters`),
    //                              which a first-token regex truncates to a name no other
    //                              file imports. 15 further files produce a `library_name`
    //                              whose only child is an `annotation` (`@TestOn('vm')`);
    //                              those are rejected by the identifier shape below, which
    //                              is correct — an annotation is not a library name.
    const library = this.libraryName(rootNode, filePath)
    const moduleName = library.name

    // A library's own URI, read once and used by BOTH sides: the module node published below,
    // and the import/export/part edges that name a file (see LIBRARY IDENTITY above).
    const projectRoot = dartProjectRootOf(filePath)
    const librarySite: DartLibrarySite = {
      moduleName,
      filePath,
      projectRoot,
      moduleIdentity: projectRoot === null ? null : dartRepoRelPath(projectRoot, filePath),
    }

    // ...and the node. Published for EVERY file, not only for files that import
    // something: a Dart file IS a library whether or not it has directives, and a
    // module that appears only when the file imports something would be a node whose
    // existence depends on the edges pointing at it.
    //
    // Range: the `library` DIRECTIVE when the file has one, else the file head at zero
    // width. An implicit library has no declaration site — its identity is the file —
    // so a zero-width mark at byte 0 is the honest position, and the whole-file range
    // would claim the library spans every member it contains.
    //
// No `ownerName` on purpose: every pass that walks the symbol table keys on
    // `ownerName` (`contains`) or on a declaration kind (`overrides` heritage,
    // `references` visible types, `topLevelValues`), and Module is in none of those
    // sets, so the node is inert for them and visible only as an edge endpoint.
    //
    // `metadata` carries the GRAMMAR's own node name and nothing this analyzer invented.
    // `nodeType` is on `parseFile`'s metadata allowlist and a new key is not, so
    // publishing the named/unnamed split as its own field would put a claim in the file
    // that no production reader can see — an unverifiable claim on every dart symbol.
    // The split stays readable from the RANGE instead: an implicit library is zero-width
    // at byte 0, and `library;` is zero-width where the directive is.
    symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Module,
      // THE LIBRARY'S URI. Strategy 1 of the shared resolver matches `qualified_name` exactly,
      // so publishing the path here is what lets an import edge name this file. Unset when the
      // file is not inside a checkout: then the engine's own synthesis (`<scope>.<name>`) is
      // what it always was, and the edges keep their specifier targets (see LIBRARY IDENTITY).
      ...(librarySite.moduleIdentity === null ? {} : { qualifiedName: librarySite.moduleIdentity }),
      range: library.directive
        ? this.nodeToRange(library.directive)
        : { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startIndex: 0, endIndex: 0 },
      visibility: "public",
      scope: moduleName,
      metadata: { nodeType: library.directive ? library.directive.type : "implicit_library" },
    })

    // --- Error collection --------------------------------------------------
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    // --- Symbol + import/export extraction (single iterative traversal) ----
    interface Frame {
      node: Node
      scopes: DartScopeEntry[]
      functionDepth: number
    }

    const stack: Frame[] = [{ node: rootNode, scopes, functionDepth: 0 }]
    let cyclomaticComplexity = 1
    // DARTD12: getter/setter pairs share owner:name — dedup by
    // owner:name:kind so a class with `get value` AND `set value` keeps both
    // symbols (setters carry the value param; the pair collapsed to one
    // Property symbol before).
    // owner:name:kind -> index in `symbols`. The accessor-pair dedup (DARTD12)
    // AND the duplicate-declaration ruling (#753/DARTD20) both live here, so the
    // value is the slot the LAST declaration of a name must replace.
    const seenMembers = new Map<string, number>()
    // M60 line contract, SYMBOL side: `contains`/`overrides` name the DECLARED
    // member, and a WRAPPED declaration puts the name on a later line than the
    // declaration's start — `final void Function(UrlRequest? u,\n    String? s)\n        _onSucceeded;` (cronet_http jni_bindings.dart). MEASURED before
    // this map: 148 of 32,016 edges on a 120-file draw claimed the start line,
    // i.e. a line the named token is not written on. Keyed by name+range
    // because one declaration node can carry several names (`int a = 1, b = 2`).
    const nameLines = new Map<string, number>()

    while (stack.length > 0) {
      const { node, scopes: frameScopes, functionDepth } = stack.pop()!
      const scopeStack = [...frameScopes]
      let nextFunctionDepth = functionDepth

      const t = node.type
      if (
        t === "if_statement" ||
        t === "for_statement" ||
        t === "while_statement" ||
        t === "do_statement" ||
        t === "switch_statement_case" ||
        t === "switch_expression_case" ||
        t === "catch_clause" ||
        t === "conditional_expression" ||
        t === "logical_and_expression" ||
        t === "logical_or_expression"
      ) {
        cyclomaticComplexity++
      }

      switch (t) {
        case "class_definition": {
          // `class A = Base with M;` is a mixin-application class: the name is
          // an identifier child of the mixin_application_class node (no name
          // field), so fall back to it for the symbol.
          const name = node.childForFieldName("name")?.text ||
            (this.findChildByType(node, "mixin_application_class")
              ? this.findDescendantByType(node, "identifier")?.text
              : undefined)
          if (name) {
            const comments = this.collectComments(node)
            // Dart 3 class modifiers (sealed/base/interface/final): sealed is
            // implicitly abstract (can't be instantiated, only subtyped in
            // the same library); the rest are captured for the symbol model.
            const isSealed = this.hasModifier(node, "sealed")
            const isBase = this.hasModifier(node, "base")
            const isInterfaceClass = this.hasModifier(node, "interface")
            const isFinalClass = this.hasModifier(node, "final")
            const isAbstract = this.hasModifier(node, "abstract") || isSealed
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              isAbstract,
              genericParameters: this.extractTypeParameters(node),
              metadata: { isClass: true, isAbstract, isSealed, isBase, isInterfaceClass, isFinalClass },
            })
            scopeStack.push({ name, kind: DartScopeKind.Class })

            // heritage: extends / with / implements
            this.extractClassHeritage(node, name, relationships, patterns)
          }
          break
        }

        case "mixin_declaration": {
          // tree-sitter-dart exposes the mixin name as a direct `identifier`
          // child (no name field): `mixin_declaration > identifier > class_body`
          const name =
            node.childForFieldName("name")?.text ||
            this.findChildByType(node, "identifier")?.text
          if (name) {
            const comments = this.collectComments(node)
            patterns["Mixins"] = true
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Mixin,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isMixin: true },
            })
            scopeStack.push({ name, kind: DartScopeKind.Class })
            // DARTD14: `mixin M on Base implements I` — the on-base is a
            // direct type_identifier child of the mixin_declaration (NOT the
            // name: probed dart-mixin-shape.ts); implements/with reuse the
            // class heritage extractor. Corpus had mixin on-clauses emitting
            // zero heritage edges.
            this.extractClassHeritage(node, name, relationships, patterns)
          }
          break
        }

        case "extension_declaration": {
          const targetType = this.extensionTargetType(node)
          // AN UNNAMED EXTENSION IS PUBLISHED UNDER ITS OWN SYNTHESIZED NAME, never under
          // its target type's — see `DART_UNNAMED_EXTENSION` for the measurement that forced
          // it. The SAME spelling has to reach the scope push below, because the push is what
          // gives the members their owner: one rule, two sites, one helper.
          const name = this.extensionPublishedName(node)
          if (name) {
            const comments = this.collectComments(node)
            patterns["Extensions"] = true
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Extension,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isExtension: true, targetType, isUnnamedExtension: !node.childForFieldName("name") },
            })
            scopeStack.push({ name, kind: DartScopeKind.Class })
          }
          break
        }

        case "extension_type_declaration": {
          // Dart 3 EXTENSION TYPES (`extension type X._(objc.ObjCObject o)
          // implements I`) — registered as MISSING in the lane's own spec
          // (script/m14/spec/dart-completeness.json: "Dart 3 extension type
          // symbols", node_type "extension_type_declaration,
          // representation_declaration") and recorded by the M60 shape census
          // as UNSCANNED (validation/m60/results/unscanned-shapes.json, 169
          // occurrences). The #753 duplicate census over the FULL extent found
          // it independently: 303 declarations in 4 pinned dart-http files
          // (jni/objc bindings), whose members were emitted as TOP-LEVEL
          // symbols with no owner — no `contains`, no heritage, no enclosing
          // type for a call. Probed shape (dt-exttype-shape.ts):
          //   extension_type_declaration
          //     identifier [field=name]  <- the container name
          //     representation_declaration > identifier [field=name] <- field
          //     interfaces               <- heritage (same clause as a class)
          //     class_body [field=body]  <- members
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            const rep = this.findChildByType(node, "representation_declaration")
            const repType = this.representationTypeName(rep)
            patterns["Extensions"] = true
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Extension,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isExtension: true, isExtensionType: true, representationType: repType },
            })
            scopeStack.push({ name, kind: DartScopeKind.Class })
            // the REPRESENTATION FIELD is a real member accessor of the type
            // (`X(T field)` exposes `field`), so it joins the symbol table and
            // gets a `contains` edge like any other declared member.
            const repName = rep?.childForFieldName("name")?.text
            if (rep && repName && repName !== "_") {
              const repRange = this.nodeToRange(rep)
              // M60 line contract, FIELD side: the `contains X -> field` edge
              // NAMES the field, and a wrapped representation declaration
              // (`X._(\n  ffi.Pointer<…> _$this,\n) implements …`, the pinned
              // FFI bindings' shape) puts the name on a later line than the
              // declaration's start. The lane's own consistency probe caught
              // exactly this as its ONLY inconsistent edge out of 32,989
              // (`UrlRequestCallbackProxy$…::_$this` claimed line 42, the
              // container line). The symbol keeps the declaration SPAN; the
              // edge takes the NAME's line, like every other member.
              const repNameNode = rep.childForFieldName("name")
              if (repNameNode) nameLines.set(dartNameLineKey(repName, repRange), this.nodeLine(repNameNode)!)
              symbols.push({
                name: repName,
                kind: ASTEngine.SymbolKind.Property,
                range: repRange,
                scope: name,
                ownerName: name,
                ownerKind: ASTEngine.SymbolKind.Extension,
                visibility: repName.startsWith("_") ? "private" : "public",
                metadata: { isRepresentationField: true, dataType: repType },
              })
            }
            this.extractClassHeritage(node, name, relationships, patterns)
          }
          break
        }

        case "enum_declaration": {
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Enum,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isEnum: true },
            })
            // enum members
            const body = this.findChildByType(node, "enum_body")
            if (body) {
              for (let i = 0; i < body.namedChildCount; i++) {
                const c = body.namedChild(i)
                if (c && c.type === "enum_constant") {
                  const mname = c.childForFieldName("name")?.text
                  if (mname) {
                    symbols.push({
                      name: mname,
                      kind: ASTEngine.SymbolKind.EnumMember,
                      range: this.nodeToRange(c),
                      scope: name,
                      ownerName: name,
                      ownerKind: ASTEngine.SymbolKind.Enum,
                      visibility: mname.startsWith("_") ? "private" : "public",
                      metadata: { isEnumMember: true },
                    })
                  }
                }
              }
            }
            // DARTD15: enhanced enums carry implements/with heritage like
            // classes (`enum Poly implements Shape`) — same extractor.
            this.extractClassHeritage(node, name, relationships, patterns)
            scopeStack.push({ name, kind: DartScopeKind.Class })
          }
          break
        }

        case "type_alias": {
          const nameNode = node.childForFieldName("name") || this.findChildByType(node, "type_identifier")
          const name = nameNode?.text
          if (name && name !== "Function") {
            const comments = this.collectComments(node)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.TypeAlias,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: name.startsWith("_") ? "private" : "public",
              comments,
              metadata: { isTypeAlias: true },
            })
          }
          break
        }

        case "declaration": {
          const sig = this.findSignatureIn(node)
          if (sig) {
            // DARTD22: a constructor-SHAPED signature that is not named after
            // its owner is an UNTYPED METHOD (the grammar has no node for one) —
            // see `isRealConstructor`. It was published as a `constructor` named
            // `constructor`, which both lost the method's own name and collapsed
            // every untyped method in a class onto one published name.
            if (this.isConstructorSignature(sig.type)) {
              const owner = scopeOwnerName(scopeStack)
              if (owner && this.isRealConstructor(sig, owner)) {
                this.processConstructor(node, sig, owner, symbols, relationships, patterns)
              } else if (owner) {
                this.processFunctionOrMethod(node, sig, symbols, scopeStack, patterns, seenMembers, nameLines)
              }
            } else {
              this.processFunctionOrMethod(node, sig, symbols, scopeStack, patterns, seenMembers, nameLines)
            }
          } else {
            // field / top-level variable declaration
            this.processFieldOrVariable(node, symbols, scopeStack, nameLines)
          }
          break
        }

        case "method_signature":
        case "function_signature":
        case "getter_signature":
        case "setter_signature":
        case "function_declaration": {
          // Bare signatures (mixin bodies, extension bodies, top-level
          // functions) WITHOUT a `declaration` wrapper. Class members wrapped
          // in `declaration` are handled by that case — skip them here to
          // avoid double-processing.
          if (node.parent?.type === "declaration") break
          // DARTD20 (#753): the INNER signature of a `method_signature`
          // wrapper is processed by the WRAPPER's own visit (which digs to
          // `findInnerSignature`), so visiting it again here built a SECOND
          // symbol for the same member — and a worse one: the inner node has
          // no body SIBLING (complexity collapsed to 1) and no annotation
          // sibling (`@override` was never attached). The FIRST-wins dedup
          // this lane used to have hid that duplicate; the family ruling's
          // LAST-wins (registerCallable) exposed it, which is how it was
          // found: `dart/payload-and-complexity` and
          // `dart/dedup-and-attribution` failed the moment the ruling
          // landed. Same rule as the `declaration` guard above.
          if (node.parent?.type === "method_signature") break
          // Local functions (local_function_declaration > lambda_expression >
          // function_signature[name]) are NOT symbols — family contract: no
          // locals (csharp/python/go never emit them; DARTD8). Without this
          // guard their signature hit this case and leaked as top-level
          // Function symbols with an empty scope (counted as duplicate
          // functions across a corpus census).
          if (t === "function_signature" && node.parent?.type === "lambda_expression") break
          const owner = scopeOwnerName(scopeStack)
          // Factories surface as `method_signature > factory_constructor_signature`
          // — dispatch constructors to processConstructor.
          const inner = this.findInnerSignature(node)
          // DARTD22: the same node TYPE covers an UNTYPED METHOD; the NAME
          // decides. `method_signature` is the wrapper the grammar uses for
          // BOTH, so the wrapper cannot.
          if (owner && this.isConstructorSignature(inner.type) && this.isRealConstructor(inner, owner)) {
            this.processConstructor(node, inner, owner, symbols, relationships, patterns)
          } else if (owner || t === "function_declaration") {
            this.processFunctionOrMethod(node, node, symbols, scopeStack, patterns, seenMembers, nameLines)
          } else if (t === "function_signature" || t === "getter_signature" || t === "setter_signature") {
            // top-level function/getter/setter — signature with sibling
            // function_body. Top-level accessors were silently dropped before
            // (no dispatch branch), leaving their calls attributed to a
            // non-declared source (DARTD10 — corpus: translate.dart's
            // `List<String> get _deepLKeys`).
            this.processTopLevelFunction(node, symbols, scopeStack, patterns, nameLines, seenMembers)
          }
          break
        }

        case "constructor_signature":
        case "factory_constructor_signature":
        case "constant_constructor_signature":
        case "redirecting_factory_constructor_signature": {
          // Wrapped by `declaration` (plain constructors) or `method_signature`
          // (factories) — both handled by their wrapper cases.
          const ptype = node.parent?.type
          if (ptype === "declaration" || ptype === "method_signature") break
          const owner = scopeOwnerName(scopeStack)
          // DARTD22: node type alone does not decide — an UNTYPED METHOD
          // parses as a `constructor_signature`. See `isRealConstructor`.
          if (owner && this.isRealConstructor(node, owner)) {
            this.processConstructor(node, node, owner, symbols, relationships, patterns)
          } else if (owner) {
            this.processFunctionOrMethod(node, node, symbols, scopeStack, patterns, seenMembers, nameLines)
          }
          break
        }

        case "initialized_identifier_list":
        case "static_final_declaration_list": {
          // Top-level variables: the tree-sitter-dart root is `program` (there
          // is no compilation_unit/library_definition wrapper — a library
          // directive is a `library_name` child). Final/const top-level vars
          // live in static_final_declaration_list; var/inferred ones in
          // initialized_identifier_list.
          const parent = node.parent
          if (parent && parent.type === "program") {
            this.processTopLevelVariables(node, symbols, scopeStack, nameLines)
          }
          break
        }

        case "import_specification":
        case "library_export":
        case "part_directive":
        case "part_of_directive": {
          this.processImportExport(node, imports, exports, frameworks, relationships, librarySite)
          break
        }
      }

      // Recurse children
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, scopes: scopeStack, functionDepth: nextFunctionDepth })
        }
      }
    }

    // --- Relationship passes -------------------------------------------------
    this.addContainmentRelationships(symbols, relationships, nameLines)
    this.extractOverrideRelationships(symbols, relationships, context?.overrideCompanion, nameLines, (context as any)?.projectIndex)
    this.extractExpressionRelationships(rootNode, relationships, moduleName, symbols, (context as any)?.projectIndex)
    // Deduplicate identical rows: calls/instantiates emit ONE row PER CALL
    // SITE, so N sites of the same callee in one function push N identical
    // (type,source,target,confidence) rows — 192,761 redundant rows across
    // the proxicall corpus (35% of all relationships; icon files carried
    // 1,511 identical `instantiates` rows from 1,512 const fields). The
    // oracle/fixtures are presence-based, so multiplicity is pure payload
    // pollution. Keep the first row per key (first metadata wins) — DARTD7.
    {
      const seenRel = new Set<string>()
      const uniq: ASTEngine.UniversalRelationship[] = []
      for (const r of relationships) {
        // M60 R7, in the one pass that already rewrites the row list. See
        // R7_PLACEHOLDER_NAME for the measurement and for what the alternatives
        // would have claimed.
        if (
          r.source === R7_PLACEHOLDER_NAME || r.target === R7_PLACEHOLDER_NAME ||
          (r as any).from === R7_PLACEHOLDER_NAME || (r as any).to === R7_PLACEHOLDER_NAME
        ) continue
        const key = `${r.type}|${r.source}|${r.target}|${r.confidence}`
        if (seenRel.has(key)) continue
        seenRel.add(key)
        uniq.push(r)
      }
      relationships.splice(0, relationships.length, ...uniq)
    }
    this.classifyEvidenceTier(relationships)

    // --- Metadata ------------------------------------------------------------
    // DARTD13 (part 2): `P(this.name)` — the constructor_param node carries
    // ONLY the name; its type is the type of the field it initializes. Bind
    // post-pass (O(symbols), no parent scans — DARTD6 lesson): every
    // constructor param still typed `dynamic` resolves against a field of the
    // same name in the owning class. `super.key` and unresolvable names stay
    // `dynamic` (honest no-type).
    {
      const fieldTypeByClass = new Map<string, string>()
      for (const s of symbols) {
        if ((s.metadata ?? {}).isField && s.ownerName) {
          const dt = (s.metadata as any).dataType
          if (dt) fieldTypeByClass.set(`${s.ownerName}.${s.name}`, dt)
        }
      }
      for (const s of symbols) {
        if (s.kind === ASTEngine.SymbolKind.Constructor && s.ownerName) {
          for (const p of s.parameters ?? []) {
            if (p.type === IMPLICIT_DYNAMIC_TYPE) {
              const ft = fieldTypeByClass.get(`${s.ownerName}.${p.name}`)
              if (ft) p.type = ft
            }
          }
        }
      }
    }
    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns = Object.keys(patterns)
    const detectedFrameworks = Object.keys(frameworks)
    const frameworkPatterns = detectedPatterns.map((p) => ({
      framework: "Dart",
      patterns: [{ type: "usage", detected: true, description: p }],
    }))

    // ============================================================================
    // NAMESPACE CITATION CLAIMS (charter §18.19 / task-26, Lead-approved)
    // ============================================================================
    //
    // WHAT IS CLAIMED. A row whose target is a BARE name that appears EXACTLY in the committed
    // `DART_SDK_CORE` vocabulary (`script/m14/citations.ts`, id `dart-sdk-core`: dart:core /
    // dart:async metadata annotations and core symbols) is a PLATFORM name, not a project
    // declaration — the project is not expected to declare `override` or `Duration`. The claim is
    // `metadata.languageNamespace = [<name>]` + `metadata.languageNamespacePolicy = "strict-absent"`.
    // The arbiter verifies it against the committed list (extOK, `verifiedBy: namespace`) and,
    // because of strict-absent, ONLY where the run declares nothing for the target: a project that
    // vendors a same-named declaration (measured: dart-http's `extension type Uri` in its JNI
    // bindings) makes the claim FALL THROUGH to the name model instead of laundering it.
    //
    // WHAT MAY CARRY IT (two measured classes, both under the D7 ledger):
    //   * annotation rows (`metadata.isAnnotation`) — the 246,724-row annotation wall; the census
    //     showed 99.87 % of it is already in the committed list (proxicall 228,955 / 229,257);
    //   * bare-name TYPE-SHAPED rows of the row-6 labels — the census showed only ~3.3 % claimable,
    //     and its measured `Uri` collision is why claims in this class are restricted to
    //     CAPITALIZED names: lowercase vocabulary entries (`target`, `required`, `factory`, …) are
    //     also ordinary member names, and a member read named `target` is not a dart:core symbol.
    //     The narrowing can only REMOVE claims, never add one.
    //
    // WHY A LITERAL COPY. `src/ast` must not depend on `script/` (the vocabulary header says so), so
    // the roots are copied here with the vocabulary id and source named. The copy is checked against
    // the committed file by `script/m14/dart-citation-fixtures.ts` (drift assertion): a name added to
    // the list becomes claimable only after the copy moves with it, and a removed name cannot linger.
    //
    // FLAG-GATED AND DEFAULT-OFF: `BB_DART_CITATION=1` enables the emission; without it not a single
    // byte of the analyzer's output changes (the probe compares the two states structurally).
    if (process.env.BB_DART_CITATION === "1") {
      for (const r of relationships) {
        const t = String(r.target ?? "")
        if (!DART_CITATION_ROOTS.has(t)) continue
        const md = (r.metadata ?? {}) as Record<string, unknown>
        const isAnnotation = md.isAnnotation === true
        const label = String(r.type)
        const typeShaped = DART_CITATION_TYPE_SHAPED_LABELS.has(label) && /^[A-Z][A-Za-z0-9_$]*$/.test(t)
        if (!isAnnotation && !typeShaped) continue
        md.languageNamespace = [t]
        md.languageNamespacePolicy = "strict-absent"
        r.metadata = md
      }
    }

    // THE EMPTY-ENDPOINT GUARD — measured on the whole-population arm (cap 0, 33,738 files):
    // 23 of 3,748,617 edges carried an EMPTY TARGET. That is the incoming gate's `unclassed`
    // class, whose declared ceiling is 0: the gate cannot classify an edge with no target, so
    // such a row is neither resolved nor a named gap and would sit outside D3's partition. The
    // rows are zero-width MISSING/ERROR token texts inside damaged parse regions
    // (`type_identifier`.text === "" there) — no rule can bind a name that is not written. The
    // guard lives in ONE place so no emission site can reintroduce the class by forgetting it.
    for (let i = relationships.length - 1; i >= 0; i--) {
      const r = relationships[i]
      const target = String(r.target ?? "")
      const source = String(r.source ?? "")
      if (target.length === 0 || source.length === 0) relationships.splice(i, 1)
    }
    return {
      language: "dart",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: detectedFrameworks.length > 1 ? detectedFrameworks[1] : detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "4.0.0-m12.11-family-contract",
      },
    }
  }

  // ============================================================================
  // SYMBOL PROCESSORS
  // ============================================================================

  private processConstructor(
    node: Node,
    sig: Node,
    owner: string,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    patterns: Record<string, boolean>,
  ): void {
    const isFactory =
      sig.type === "factory_constructor_signature" || sig.type === "redirecting_factory_constructor_signature"
    const isConst = sig.type === "constant_constructor_signature"
    if (isFactory) patterns["Factory"] = true

    // Named constructors: `Counter.initial()` / `factory Counter.zero() = ...`
    // — the named segment is a DIRECT identifier child of the signature (the
    // class name arrives via the name field, parameters live inside the
    // formal_parameter_list, so direct identifiers are unambiguous).
    let isNamed = false
    let namedSegment: string | undefined
    const directIds = this.directIdentifiers(sig)
    const named = directIds.find((id) => id !== owner)
    if (named) {
      isNamed = true
      namedSegment = named
    }

    const params = this.extractParameters(sig)
    const comments = this.collectComments(node)
    const annotations = this.extractAnnotations(node)

    symbols.push({
      name: "constructor",
      kind: ASTEngine.SymbolKind.Constructor,
      range: this.nodeToRange(node),
      scope: owner,
      ownerName: owner,
      ownerKind: ASTEngine.SymbolKind.Class,
      visibility: "public",
      parameters: params,
      comments,
      decorators: annotations,
      metadata: { isFactory, isConst, isNamed, namedSegment, isConstructor: true },
    })

    // factory redirection: `factory Counter.zero() = Counter.initial;` —
    // ONLY the redirecting form carries the target inside the signature;
    // expression-bodied factories (`factory X.y() => X(...)`) construct via
    // the normal constructor-invocation path in the calls pass.
    if (isFactory && sig.type === "redirecting_factory_constructor_signature") {
      // DT-C: the redirect target may be alias-qualified
      // (`= _i1.Impl.make` — the raw first type_identifier is the import
      // alias, not the class). Collect the qualified name AFTER the `=`
      // token only (parameters precede it and carry their own identifiers).
      // Parts: [Class, ctor] or [alias, Class, ctor] — the class is
      // second-to-last (singletons like `= _$Y` stay whole).
      const parts: string[] = []
      // M60 line contract: the node that NAMES the redirect edge is the
      // redirect target identifier itself (`= A.B` written on a later line
      // than the `factory` keyword).
      const partNodes: Node[] = []
      let pastEquals = false
      for (let i = 0; i < sig.childCount; i++) {
        const c = sig.child(i)
        if (!c) continue
        if (!pastEquals) {
          if (!c.isNamed && c.type === "=") pastEquals = true
          continue
        }
        if (c.isNamed && (c.type === "type_identifier" || c.type === "identifier")) {
          parts.push(c.text)
          partNodes.push(c)
        }
      }
      const redirectTarget = parts.length <= 1 ? parts[0] : parts[parts.length - 2]
      const redirectNode = partNodes.length <= 1 ? partNodes[0] : partNodes[partNodes.length - 2]
      if (redirectTarget) {
        relationships.push({
          source: owner,
          target: redirectTarget,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.95,
          line_number: this.nodeLine(redirectNode),
          metadata: { isFactoryRedirection: true },
        })
      }
    }
  }

  private processFunctionOrMethod(
    node: Node,
    sig: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
    patterns: Record<string, boolean>,
    seenMembers: Map<string, number>,
    nameLines: Map<string, number>,
  ): void {
    // Dig through method_signature wrappers to the inner getter/setter/function
    // signature which carries the name field.
    const inner = this.findInnerSignature(sig)
    const nameNode = this.signatureNameNode(inner)
    const name = this.signatureName(inner)
    if (!name) return
    const owner = scopeOwnerName(scopeStack)
    const isGetter0 = inner.type === "getter_signature"
    const isSetter0 = inner.type === "setter_signature"
    const dedupKey = `${owner ?? "module"}:${name}:${isGetter0 ? "get" : isSetter0 ? "set" : "fn"}`
    // DARTD20 (#753, the family dup-key ruling): one scope declaring the same
    // member twice is INVALID Dart (a compile error), so no compiling program
    // reaches the shape — the analyzer's answer is a DETERMINISTIC family
    // contract. dart kept the FIRST body (the symbol's range, parameters,
    // return type, comments and `contains` line all described the declaration
    // that does not run). The family matrix this was registered against is
    // settled by python's #748, measured on 512 pinned files: 21 of the 25
    // duplicate-name scopes were declaration CHAINS, 3 were branch
    // ALTERNATIVES, exactly ONE was a genuine rebinding — and the language's
    // own answer there was LAST-WINS. Same here (see registerCallable).

    const isGetter = isGetter0
    const isSetter = isSetter0
    if (isGetter || isSetter) patterns["Getters and Setters"] = true

    const params = this.extractParameters(inner)
    const returnType = this.extractReturnType(inner)
    const isAsync = this.isAsyncSignature(node, inner)
    const isStatic = this.hasModifier(node, "static") || this.hasModifier(inner, "static")
    const isAbstract = !this.hasBody(node) && (this.hasModifier(node, "abstract") || owner !== undefined)
    const comments = this.collectComments(node)
    const annotations = this.extractAnnotations(node)

    if (isAsync || (returnType && returnType.startsWith("Future"))) patterns["Async Programming"] = true

    const kind =
      isGetter || isSetter
        ? ASTEngine.SymbolKind.Property
        : owner
          ? ASTEngine.SymbolKind.Method
          : ASTEngine.SymbolKind.Function

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind,
      range: this.rangeIncludingBody(node, inner),
      scope: scopeString(scopeStack),
      ownerName: owner,
      ownerKind: owner ? scopeOwnerKind(scopeStack) : undefined,
      visibility: name.startsWith("_") ? "private" : "public",
      parameters: params,
      returnType,
      comments,
      decorators: annotations,
      isStatic,
      isAsync,
      isAbstract,
      complexity: this.methodComplexity(node),
      metadata: { isGetter, isSetter, isStatic, isAsync, isAbstract, hasBody: this.hasBody(node) },
    }
    // Replace IN PLACE when the scope already declared this name: the symbol
    // table keeps exactly one entry per (owner,name,kind), and it is the
    // declaration that RUNS (registerCallable).
    if (!this.registerCallable(symbols, seenMembers, dedupKey, symbol, nameLines, nameNode)) return

    scopeStack.push({ name, kind: DartScopeKind.Function })
  }

  /**
   * One symbol per (scope,name,kind), LAST declaration wins (DARTD20 — the
   * family dup-key ruling; #753). Both producers of callable symbols use this:
   * a duplicate is a compile error in Dart, so the analyzer's answer for the
   * shape is a deterministic contract, and the family's (settled by python
   * #748) is that the LAST declaration owns the name. Returns false when the
   * symbol REPLACED an earlier one, so the caller can skip its scope push.
   */
  private registerCallable(
    symbols: ASTEngine.UniversalSymbol[],
    seenMembers: Map<string, number>,
    dedupKey: string,
    symbol: ASTEngine.UniversalSymbol,
    nameLines: Map<string, number>,
    nameNode: Node | null,
  ): boolean {
    if (nameNode) nameLines.set(dartNameLineKey(symbol.name, symbol.range), this.nodeLine(nameNode)!)
    const priorIdx = seenMembers.get(dedupKey)
    if (priorIdx !== undefined) {
      symbols[priorIdx] = symbol
      return false
    }
    seenMembers.set(dedupKey, symbols.length)
    symbols.push(symbol)
    return true
  }

  private processTopLevelFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
    patterns: Record<string, boolean>,
    nameLines: Map<string, number>,
    seenMembers: Map<string, number>,
  ): void {
    const nameNode = node.childForFieldName("name") || this.findChildByType(node, "identifier")
    if (!nameNode) return
    const name = nameNode.text
    const params = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const isAsync = this.isAsyncSignature(node, node)
    if (isAsync || (returnType && returnType.startsWith("Future"))) patterns["Async Programming"] = true
    const comments = this.collectComments(node)

    const isAccessor = node.type === "getter_signature" || node.type === "setter_signature"
    const range = this.rangeIncludingBody(node, node)
    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: isAccessor ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Function,
      range,
      scope: scopeString(scopeStack),
      visibility: name.startsWith("_") ? "private" : "public",
      parameters: params,
      returnType,
      comments,
      isAsync,
      complexity: this.methodComplexity(node),
      metadata: {
        isAsync,
        isGetter: node.type === "getter_signature",
        isSetter: node.type === "setter_signature",
        isTopLevelFunction: !isAccessor,
        isTopLevelAccessor: isAccessor,
      },
    }
    // #753 (program scope): the duplicate census over the FULL extent found 15
    // genuine duplicate TOP-LEVEL callables in the pinned corpora (test-file
    // helpers in proxicall and http2) — dart emitted BOTH symbols for those,
    // which is the same defect one scope up. Same ruling, same helper.
    const accessorKind = node.type === "getter_signature" ? "get" : node.type === "setter_signature" ? "set" : "fn"
    if (!this.registerCallable(symbols, seenMembers, `module:${name}:${accessorKind}`, symbol, nameLines, nameNode)) return
    scopeStack.push({ name, kind: DartScopeKind.Function })
  }

  private processFieldOrVariable(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
    nameLines: Map<string, number>,
  ): void {
    const declList = this.findChildByType(node, "initialized_identifier_list") ||
      this.findChildByType(node, "static_final_declaration_list") ||
      (node.type === "initialized_identifier_list" || node.type === "static_final_declaration_list"
        ? node
        : undefined)
    if (!declList) return

    const owner = scopeOwnerName(scopeStack)
    const isStatic = this.hasModifier(node, "static") || node.type === "static_final_declaration_list"
    const isFinal = this.hasModifier(node, "final") || node.type === "static_final_declaration_list"
    const isConst = this.hasModifier(node, "const")
    const isLate = this.hasModifier(node, "late")
    const dataType = this.extractFieldType(node, declList)
    const declRange = this.nodeToRange(node)

    for (let i = 0; i < declList.namedChildCount; i++) {
      const child = declList.namedChild(i)
      if (!child) continue
      let name: string | undefined
      let nameNode: Node | null = null
      if (child.type === "initialized_identifier" || child.type === "static_final_declaration") {
        nameNode = this.findChildByType(child, "identifier")
        name = nameNode?.text
      } else if (child.type === "identifier") {
        name = child.text
        nameNode = child
      }
      if (!name) continue
      nameLines.set(dartNameLineKey(name, declRange), this.nodeLine(nameNode ?? child)!)

      const kind =
        owner
          ? ASTEngine.SymbolKind.Property
          : isConst || isFinal
            ? ASTEngine.SymbolKind.Constant
            : ASTEngine.SymbolKind.Variable

      symbols.push({
        name,
        kind,
        range: declRange,
        scope: scopeString(scopeStack),
        ownerName: owner,
        ownerKind: owner ? scopeOwnerKind(scopeStack) : undefined,
        visibility: name.startsWith("_") ? "private" : "public",
        isStatic,
        metadata: { isStatic, isFinal, isConst, isLate, dataType, isField: owner !== undefined },
      })
    }
  }

  private processTopLevelVariables(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    scopeStack: DartScopeEntry[],
    nameLines: Map<string, number>,
  ): void {
    const isFinal = this.hasModifier(node, "final") || this.hasModifier(node.parent!, "final")
    const isConst = this.hasModifier(node, "const") || this.hasModifier(node.parent!, "const")
    const dataType = this.extractFieldType(node, node)
    const declRange = this.nodeToRange(node)

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      let name: string | undefined
      let nameNode: Node | null = null
      if (child.type === "initialized_identifier" || child.type === "static_final_declaration") {
        nameNode = this.findChildByType(child, "identifier")
        name = nameNode?.text
      } else if (child.type === "identifier") {
        name = child.text
        nameNode = child
      }
      if (!name) continue
      nameLines.set(dartNameLineKey(name, declRange), this.nodeLine(nameNode ?? child)!)
      symbols.push({
        name,
        kind: isConst || isFinal ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
        range: declRange,
        scope: scopeString(scopeStack),
        visibility: name.startsWith("_") ? "private" : "public",
        metadata: { isStatic: false, isFinal, isConst, dataType, isField: false, isTopLevelVariable: true },
      })
    }
  }

  private processImportExport(
    node: Node,
    imports: ASTEngine.ImportInfo[],
    exports: ASTEngine.ExportInfo[],
    frameworks: Record<string, boolean>,
    relationships: ASTEngine.UniversalRelationship[],
    site: DartLibrarySite,
  ): void {
    // THE TARGET IS THE FILE THE SPECIFIER NAMES, when this checkout can say which file that
    // is (`dartImportTargetPath`): that file's library node publishes the same project-relative
    // path as its `qualifiedName`, so the edge resolves by exact match. The `:${"*"}` form is kept
    // where the checkout cannot answer (a dependency, a `dart:` library this checkout does not
    // carry, a path outside the root), because a specifier that names something the population
    // does not contain must stay visibly unresolved rather than be pointed at a wrong file.
    const targetOf = (uri: string): string | null =>
      site.projectRoot === null ? null : dartImportTargetPath(site.projectRoot, site.filePath, uri)
    // OUTSIDE THE PROJECT vs ABSENT FROM IT — two different facts, and only one is a CLAIM.
    //
    //   OUTSIDE (marked `importOutsideProject`): the checkout cannot contain the target at all
    //     — a package its own pubspec files do not declare, a `dart:` library in a checkout
    //     that carries no SDK, a scheme (`http:`, `file:`) that is not a path in any project.
    //     The marker asserts "this is not in this project", and the incoming gate verifies
    //     that assertion against the project's own pubspec files and admitted file list —
    //     never against this analyzer's opinion, or the claim would be its own evidence.
    //
    //   ABSENT (unmarked): the checkout DOES declare it and the file is not there — generated
    //     and deleted files, a `part` whose library is gone. That is a DANGLING INTERNAL
    //     reference: it stays unresolved and visible. Marking it external would launder a
    //     real defect into a clean row, which is the one thing a marker must never do.
    const outsideProject = (uri: string): boolean => {
      if (site.projectRoot === null) return false
      if (uri.startsWith("package:")) {
        const rest = uri.slice(8)
        const slash = rest.indexOf("/")
        if (slash <= 0) return false
        const pkg = rest.slice(0, slash)
        if (!isDartLibraryName(pkg)) return false
        return dartProjectFacts(site.projectRoot).packageRoots.get(pkg) === undefined
      }
      if (uri.startsWith("dart:")) {
        const lib = uri.slice(5)
        if (!isDartLibraryName(lib)) return false
        // No SDK in this checkout means no `dart:` library is in it. When the SDK IS here the
        // question is per-library, and a missing one is ABSENT rather than outside.
        return !dartProjectFacts(site.projectRoot).sdkLib
      }
      return uri.indexOf(":") >= 0
    }
    const claimMeta = (uri: string, resolved: string | null): Record<string, boolean> =>
      resolved === null && outsideProject(uri) ? { importOutsideProject: true } : {}
    // `part 'x.dart'` (library lists a part) and `part of 'lib.dart'`
    // (part file names its library) are both library-coupling directives —
    // each produces a `part_of` edge so the part graph is visible (ProxiCall
    // has 29 `part of` files, incl. generated freezed output).
    //
    // CANONICAL `part_of` since 2026-10-18. The old shape was `imports` with
    // ad-hoc `isPart`/`isPartOf` flags, which put a file-coupling fact on the
    // same label as every dependency import. The DIRECTION is the directive's own
    // direction, so `partRole` says which end this file is:
    //   part_of_directive -> "part"    (this part file -> the library it belongs to)
    //   part_directive    -> "library" (this library -> the part file it lists)
    // ONLY these two node types reach this branch: import/export directives are
    // handled below, so a plain `import` can never be relabelled by this code.
    // An UNRESOLVABLE specifier publishes NO row: without a resolved target the
    // edge would name a specifier string, and a path no project key can answer is
    // exactly the `:${"*"}` shape this label exists to stop publishing.
    if (node.type === "part_directive" || node.type === "part_of_directive") {
      const uriNode = this.findDescendantByType(node, "string_literal") || this.findDescendantByType(node, "uri")
      const uri = uriNode ? unquote(uriNode.text) : ""
      // THE NAMED FORM: `part of my.lib;` names the library by NAME, not by file — legal Dart
      // (a library declared `library my.lib;`), and the pinned grammar parses it as
      // `(part_of_directive (part_of_builtin) (dotted_identifier_list (identifier) (identifier)))`
      // (probed). It was published as NOTHING while every URI-shaped part published a row.
      // The target is the library NAME as written (whitespace stripped by the same helper the
      // library-name reader uses, so `part of a . b;` and `library a.b;` spell the same string),
      // which is exactly the module symbol's name in the store — strategy 2 resolves it when the
      // project declares that name once. Only `part_of_directive` has this form; `part` always
      // carries a URI.
      if (!uri && node.type === "part_of_directive") {
        const named = this.findChildByType(node, "dotted_identifier_list")
        if (named) {
          relationships.push({
            source: site.moduleName,
            target: stripWhitespace(named.text),
            type: ASTEngine.RelationshipType.PartOf,
            confidence: 1.0,
            line_number: this.nodeLine(named),
            metadata: { partRole: "part", isNamedLibrary: true },
          })
        }
        return
      }
      if (uri) {
        const resolved = targetOf(uri)
        // The ImportInfo payload is NOT a relationship and is kept for consumers that
        // read the parsed file's directive list; the STORED edge is the `part_of` row.
        imports.push({ module: uri, source: uri, imported: ["*"], isPart: true, range: this.nodeToRange(node) })
        if (resolved !== null) {
          relationships.push({
            source: site.moduleName,
            target: resolved,
            type: ASTEngine.RelationshipType.PartOf,
            confidence: 1.0,
            line_number: this.nodeLine(uriNode),
            metadata: { partRole: node.type === "part_of_directive" ? "part" : "library" },
          })
        }
      }
      return
    }

    const isExport = node.type === "library_export" || node.text.startsWith("export")
    const uriNode = this.findDescendantByType(node, "string_literal") || this.findDescendantByType(node, "uri")
    const uri = uriNode ? unquote(uriNode.text) : ""
    if (!uri) return

    if (uri.startsWith("package:flutter/")) frameworks["Flutter"] = true
    if (uri.startsWith("package:angular/")) frameworks["AngularDart"] = true

    if (isExport) {
      // M49 exports invariant: `export 'uri.dart' show X` re-exports a FILE,
      // not a bindable name — the uri is a module path (relationship target
      // below already carries it), never a resolvable export entry. Exported
      // BINDINGS (`export 'x.dart' show Alpha` binds Alpha) belong in the
      // export list; the bare uri does not. Dropping the uri push leaves the
      // Exports relationship intact.
      // exports.push({ name: uri, isDefault: false, range: this.nodeToRange(node) })
      const resolved = targetOf(uri)
      relationships.push({
        source: site.moduleName,
        target: resolved ?? uri,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        line_number: this.nodeLine(uriNode),
        metadata: { ...claimMeta(uri, resolved) },
      })
    } else {
      const resolved = targetOf(uri)
      imports.push({ module: uri, source: uri, imported: ["*"], isTypeOnly: false, range: this.nodeToRange(node) })
      relationships.push({
        source: site.moduleName,
        target: resolved ?? `${uri}:*`,
        type: ASTEngine.RelationshipType.Imports,
        confidence: 1.0,
        line_number: this.nodeLine(uriNode),
        metadata: { ...claimMeta(uri, resolved) },
      })
    }
  }

  // ============================================================================
  // RELATIONSHIP PASSES
  // ============================================================================

  private addContainmentRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    nameLines: Map<string, number>,
  ): void {
    for (const symbol of symbols) {
      if (symbol.ownerName) {
        // THE TARGET IS THE MEMBER'S PUBLISHED SPELLING, not its bare name.
        //
        // This was the lane's LAST type emitting two bare names (`Owner -> member`), and it is
        // its largest one: `contains 700,265 edges / 169,829 resolved / 530,368 ambiguous` in
        // the whole-corpus gate run — 75.7% of the type unwalkable, and not because any member
        // is wrong. A Dart project repeats member names constantly (`value`, `build`, `name`,
        // `props`), and a bare name two classes declare is ambiguous BY CONSTRUCTION: the shared
        // resolver (strategy 2) accepts a bare name only under `HAVING COUNT(*) = 1`.
        //
        // PRICED BEFORE BUILT, on whole checkouts so each project's key space is complete
        // (`validation/m14/fixtures/dart/contains-target-price.ts`, dart-http + riverpod +
        // proxicall, 292,017 contains edges):
        //
        //     ambiguous -> resolved   267,878   (91.7%)
        //     ambiguous -> ambiguous   14,564   every one of them an OWNER-name collision
        //     resolved  -> resolved     9,575
        //     resolved  -> ambiguous        0   no edge moves backwards
        //
        // The spelling is `${scope}.${name}` because that is exactly what `pool-worker.ts`
        // synthesises into the published `qualifiedName` for a symbol (`s.qualifiedName ||
        // s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : s.name)`), so the edge and the
        // node it names are one string from one rule — the discipline `libraryName` follows. A
        // member with no scope keeps its bare name, which is today's behaviour rather than a
        // guess at a spelling nothing publishes.
        const qualified = symbol.scope ? `${symbol.scope}.${symbol.name}` : symbol.name
        relationships.push({
          source: symbol.ownerName,
          target: qualified,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // The member's OWN NAME line — the name node when the producers could
          // hand one over (a wrapped declaration moves it off the start line),
          // the declaration start otherwise (php stamps contains the same way).
          line_number: nameLines.get(dartNameLineKey(symbol.name, symbol.range)) ?? symbol.range?.startLine,
          metadata: {},
        })
      }
    }
  }

  private extractOverrideRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    overrideCompanion?: Map<string, Set<string>>,
    nameLines?: Map<string, number>,
    // LAST, and it must stay last: this parameter was added after `nameLines`, and
    // inserting it earlier silently swapped the two — `nameLines` landed in this
    // slot, the name-line lookup started returning undefined, and every override
    // edge fell back to the declaration's START line (the return type) instead of
    // the signature's line. `dart/callsite-lines-825` caught it, pinning exactly
    // that distinction. Optional parameters with different types are the worst kind
    // of reorder: it compiles, it type-checks, and it is silently wrong.
    projectIndex?: any,
  ): void {
    // DARTD16: the old engine only checked the DIRECT extends base — so a
    // chain (`A extends B extends C`, hello declared on C) emitted nothing,
    // interface implementations (`class X implements Shape { area() }`) —
    // which ARE overrides in Dart — emitted nothing, and cross-file bases
    // (Flutter's `build`, `createState`, `==` — 99.8% of the corpus's 34,306
    // @override sites) emitted nothing because production never passes an
    // overrideCompanion (parseFile callers pass no context). Three passes
    // mirroring the csharp family contract (real-csharp-analyzer.ts
    // resolveOverrides): in-file BFS over ALL heritage (extends + implements
    // + with), cross-file companion when provided, then a deterministic
    // first-heritage-parent fallback for cross-file framework bases.
    // A CONSTRUCTOR IS NOT AN OVERRIDABLE MEMBER, and leaving it in this surface published a
    // fabricated edge. Every constructor symbol the analyzer emits is named `constructor` (the
    // language's own spelling), so a subclass member that happens to carry that name matched the
    // base's constructor BY NAME alone:
    //
    //   sealed class RecordedUse {
    //     RecordedUse();
    //   }
    //   class RecordedInstanceCreation extends RecordedUse {
    //     final ConstructorEntity constructor;
    //
    // claimed `RecordedInstanceCreation.constructor -> RecordedUse.constructor` at 0.95, and
    // `RecordedConstructorTearOff.constructor` claimed the same base member. Constructors are not
    // inherited and cannot be overridden in Dart, and this is also the rule the ORACLE already
    // holds: its member surface (`memberNamesOf` in script/m14/oracles/dart-overrides.ts) handles
    // `method_signature` and `declaration` nodes only, so a constructor contributes no name there
    // and the two implementations disagreed on exactly this one. MEASURED on dart-sdk with the
    // exposure watchdog: these 2 rows (`pkg/compiler/lib/src/universe/recorded_use.dart`) were
    // refuted while every instrument-side cause around them was eliminated.
    const byName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Constructor) continue
      const list = byName.get(s.name) ?? []
      list.push(s)
      byName.set(s.name, list)
    }
    const companionForPass2: Map<string, Set<string>> | undefined =
      overrideCompanion ?? dartCompanionFor(projectIndex)
    // WHAT THIS RUN COULD SEE, as a fact about the RUN rather than about the project.
    //
    // A companion map IS the project's type inventory: it exists only when someone handed
    // this run `projectIndex.typeMembers` (or an equivalent stand-in for the cross-repository
    // index), so its PRESENCE is the difference between "I looked for this base in the
    // project and it is not there" and "I could not look". MEASURED, and the reason this
    // distinction is load-bearing rather than pedantic: the gate verifies an `isExternalBase`
    // claim by looking the base's OWNER up in the PROJECT's key space, and production hands
    // dart no index at all (`parallel-indexer.ts` PROJECT_INDEX_EXTENSIONS names only `.sol`).
    // On that population the same claim is refuted 16,894 times and verified 10,731 times:
    // 61% of the claims the arbiter examines are bases the analyzer could not have reached —
    // another FILE of the same project or the Flutter framework are the same thing to it.
    //
    // So the claim is split by what it is about: a base this run cannot reach is a fact about
    // the RUN (`baseBeyondRunScope`, its own column in the gate, never folded into `resolved`
    // and never verified against the project), while `isExternalBase` is kept — unchanged — for
    // the runs that really did look and really did not find it.
    const seesProject = companionForPass2 !== undefined

  // DARTD16's cross-file pass is implemented, documented, and — until now —
  // unreachable: `overrideCompanion` is an OPTIONAL context field that no caller in
  // src/ or script/ ever populated, so Pass 2 was dead code. The repo already ships
  // the cross-file knowledge this needs, in `ProjectIndex` (`typeMembers`,
  // `typeBases`) and `buildResolutionTables`, which the Solidity lane reads for the
  // same reason. Deriving the companion from it here is additive: with no
  // `projectIndex` in context the field is undefined and every pass below behaves
  // exactly as before, byte for byte.
  //
  // `allMembers` is INHERITANCE-CLOSED, which is the semantics Pass 2 wants: it
  // answers "does this base expose the member", not "does it declare it". That is
  // also why it settles the freezed family. `sealed class TemplateState extends
  // Equatable` does not declare `props` but does expose it, so
  // `TemplateInitial.props` resolves against TemplateState — the nearest base whose
  // interface the member actually replaces — instead of being left to the
  // first-parent fallback, which had no way to tell a base that exposes a member
  // from one that merely inherits it.
    // Heritage graph from extends/implements/uses edges (in-file knowledge).
    const heritageByClass = new Map<string, string[]>()
    const firstHeritage = new Map<string, string>()
    for (const r of relationships) {
      if (!r.source || !r.target) continue
      const type = r.type ?? r.relationshipType ?? ""
      // 2026-10-18 — `mixes_in` JOINS THIS WALK. The with-clause used to arrive here as
      // `uses{isMixin:true}`; the relabel removed that spelling, and a filter left on `uses`
      // alone would silently stop the pass from seeing mixin-contributed members (the
      // fixture caught the regression in `dart/object-interface-override`, case K/N: the
      // fall-through over `extends Object with ListMixin<int>` stopped naming `ListMixin`).
      // `references{isMixinOn}` is deliberately NOT here: an `on` constraint contributes no
      // members to the host, so it must never enter the inheritance walk.
      if (type === "extends" || type === "implements" || type === "uses" || type === "mixes_in") {
        const list = heritageByClass.get(r.source) ?? []
        if (!list.includes(r.target)) list.push(r.target)
        heritageByClass.set(r.source, list)
        if (!firstHeritage.has(r.source)) firstHeritage.set(r.source, r.target)
      }
    }
    // BASES ONLY. `heritageByClass` above also collects `uses`, because a read is
    // evidence that a type is relevant to this file — but it is not a BASE, and
    // closing the exposure of a class through a `uses` edge would make every type the
    // file merely mentions into a supertype. The walk keeps using `heritageByClass`
    // for breadth; this map is what "inherits from" means when the question is
    // whether a base EXPOSES a member.
    const basesOf = new Map<string, string[]>()
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      if (type !== "extends" && type !== "implements") continue
      if (!r.source || !r.target) continue
      const list = basesOf.get(r.source) ?? []
      if (!list.includes(r.target)) list.push(r.target)
      basesOf.set(r.source, list)
    }
    // THE REAL BASES, IN THE FILE'S OWN ORDER — for the fallback's base CHOICE and nothing else.
    //
    // `extends`, `implements`, and a `with` mixin (which this pass publishes as a `uses` edge
    // carrying `isMixin: true`). A bare `uses` is ANY type the file mentions, so it must never
    // become a fallback base: `class X extends Object { void f(List<int> x) {} }` mentions
    // `List` in a parameter and does not inherit from it, and naming `List` would be the same
    // fabricated-edge shape this map exists to remove. `basesOf` above is narrower still on
    // purpose — a mixin affects what a base EXPOSES, and folding mixins into that closure is a
    // separate question from which name a fallback may print.
    const baseOrder = new Map<string, string[]>()
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      // `mixes_in` IS a base for this map's purpose — a with-clause is a heritage clause, and
      // this is the map the Object-skip fallback chooses from. The old `uses{isMixin}` spelling
      // is gone (2026-10-18 relabel), and the reference row an `on` constraint publishes is not
      // in this list: a constraint is not a base.
      const isBase = type === "extends" || type === "implements" || type === "mixes_in"
      if (!isBase || !r.source || !r.target) continue
      const list = baseOrder.get(r.source) ?? []
      if (!list.includes(r.target)) list.push(r.target)
      baseOrder.set(r.source, list)
    }

    // Does this base EXPOSE the member — its own, or one it inherits?
    //
    // This is the whole of a defect that survived fifteen commits because every
    // corpus row that exposed it was read as an oracle bug. The answer CHANGED
    // depending on whether a project index was supplied:
    //
    //   class A { void close() {} }
    //   class B extends A {}
    //   class C extends B { @override void close() {} }
    //
    // With no index, `declares("B", "close")` looked for a symbol named `close`
    // OWNED BY B. B has none, so the walk continued to A and published
    // `C.close->A.close` — a DECLARER answer. With an index the companion's
    // `allMembers` is inheritance-closed, so B exposes `close` and the same file
    // published `C.close->B.close` — an EXPOSER answer. The same code, two
    // different edges, decided by the environment rather than by the language.
    //
    // EXPOSER is the right question for `overrides`. The edge names the base whose
    // INTERFACE the member replaces, and a class that inherits a getter replaces
    // that getter whether or not it re-declares it. It is also what the companion
    // path already did, so this makes the two paths agree instead of making the
    // no-index answer "more correct".
    //
    // The oracle reached the same rule independently by closing its own in-file
    // member sets over inheritance, and the two now agree on the three-deep chain
    // as well as on the freezed family.
    const exposedCache = new Map<string, Set<string>>()
    const exposing = new Set<string>()
    const exposed = (cls: string): Set<string> => {
      const cached = exposedCache.get(cls)
      if (cached) return cached
      // A cycle in the type graph must terminate with "nothing known", not hang.
      if (exposing.has(cls)) return new Set<string>()
      exposing.add(cls)
      const out = new Set<string>()
      for (const [name, syms] of byName) if (syms.some((bm) => bm.ownerName === cls)) out.add(name)
      for (const b of basesOf.get(cls) ?? []) for (const m of exposed(b)) out.add(m)
      exposing.delete(cls)
      exposedCache.set(cls, out)
      return out
    }

    // Base exposes the member? In-file closure first, then the companion. The
    // companion is consulted even when the base is declared here, because a base can
    // expose a member it inherits from a package — which is the freezed case, and the
    // reason the early return here would have broken it.
    const declares = (base: string, method: string): boolean => {
      if (exposed(base).has(method)) return true
      const companion = companionForPass2?.get(base)
      return !!companion && companion.has(method)
    }
    // Every type name DECLARED in this file, distinct from every member name. The
    // Pass-1 `declares` check answers "does this base have the member", which is
    // not the question the fallback gate needs: it needs "is this base in this
    // file at all", and only a declaration inventory answers that.
    //
    // Declarations ONLY. A base named in an `extends` clause is not thereby
    // declared here — that is the whole premise of the external fallback — so
    // harvesting extends/implements targets into this set would mark every
    // external base as in-file and refute every fallback. It did exactly that on
    // the first attempt: `class Banner extends StatelessWidget` lost its
    // `toString -> StatelessWidget.toString` edge, which the
    // `dart/dedup-and-attribution` fixture correctly pins. A failing fixture caught
    // it, which is the argument for pinning behaviour at all.
    const TYPE_KINDS = new Set<ASTEngine.SymbolKind>([
      ASTEngine.SymbolKind.Class, ASTEngine.SymbolKind.Interface,
      ASTEngine.SymbolKind.Enum, ASTEngine.SymbolKind.Type,
    ])
    const inFileTypes = new Set<string>()
    for (const s of symbols) {
      if (typeof s.name === "string" && s.name && TYPE_KINDS.has(s.kind)) inFileTypes.add(s.name)
    }
    const seenOverride = new Set<string>()
    for (const s of symbols) {
      if ((s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Property) && s.ownerName) {
        // A STATIC member is not overridable. Dart resolves a static call against the
        // STATIC TYPE it was written on, so a subclass declaring the same static name
        // shadows nothing and overrides nothing — there is no such thing as overriding
        // a static method, and no `@override` is even legal on one.
        //
        // The gate that excludes FIELDS from this loop ("fields can never override in
        // Dart") was written for fields; the same reasoning covers static methods and
        // was never written down. It produced a fabricated edge at 0.95, the highest
        // confidence this pass uses, for the one case where the claim is provably
        // impossible:
        //
        //   class BrowserWebSocket implements WebSocket {
        //     static Future<BrowserWebSocket> connect(Uri url, {...}) async { ... }
        //   }
        //
        // claimed `BrowserWebSocket.connect -> WebSocket.connect`. `WebSocket.connect`
        // is itself `static`, so the "base" does not have an instance member to
        // override either. Two statics, one edge, no override.
        if (s.isStatic) continue
        const heritage = heritageByClass.get(s.ownerName)
        if (!heritage || heritage.length === 0) continue
        // Pass 1: BFS over the full heritage graph (extends/implements/with,
        // transitively) for a base that declares this member IN-FILE.
        let target: string | null = null
        const seenCls = new Set<string>()
        const queue = [...heritage]
        while (queue.length > 0 && !target) {
          const base = queue.shift()!
          if (seenCls.has(base)) continue
          seenCls.add(base)
          if (declares(base, s.name)) {
            target = base
            break
          }
          for (const h of heritageByClass.get(base) ?? []) queue.push(h)
        }
        let confidence = 0.95
        let metadata: Record<string, unknown> = { isOverride: true, relationshipType: "method_override" }
        if (target) {
          // exact in-file resolution
        } else if (companionForPass2 && heritage.length > 0) {
          // Pass 2: cross-file companion declaring-parent resolution.
          const seen2 = new Set<string>()
          const q2 = [...heritage]
          while (q2.length > 0 && !target) {
            const base = q2.shift()!
            if (seen2.has(base)) continue
            seen2.add(base)
            if (this.companionHas(companionForPass2, base, s.name)) {
              target = base
              break
            }
            for (const h of heritageByClass.get(base) ?? []) q2.push(h)
          }
        }
        if (!target) {
          // Pass 3: deterministic cross-file fallback — the first heritage
          // parent (csharp parity). Flutter methods override StatelessWidget
          // etc.; the base class is real even when declared elsewhere.
          // GATED on the @override annotation: fields (kind Property too)
          // can never override in Dart and carry no annotation — without
          // this gate every field of a subclass faked an external override
          // (`Poly.sides -> Shape.sides`).
          const hasOverrideAnn = (s.decorators ?? []).some((d) => d.includes("@override"))
          if (hasOverrideAnn) {
            const rawFirst = firstHeritage.get(s.ownerName) ?? null
            // `Object` IS NOT A NAMEABLE FALLBACK BASE FOR A MEMBER `Object` DOES NOT DECLARE.
            //
            // `extends Object` is how a Dart file writes "no superclass": Dart's root class is
            // implicit on every class, so naming it explicitly adds nothing — `Object` is `X` on
            // the next line's class, and it declares exactly five members
            // (`DART_OBJECT_INTERFACE_MEMBERS`). Naming `Object.<member>` for anything outside
            // those five asserts a declaration where none exists, which is the same class of
            // fabrication the Object-interface retarget below removes in the other direction.
            //
            // MEASURED, and this is the exact shape: `class LineStarts extends Object with
            // ListMixin<int> { @override int get length => ...; }`. The member is the MIXIN's,
            // `Object` has never had a `length`, and the first-heritage-parent fallback named
            // `Object.length` anyway — 128 rows over dart-sdk, every one of them
            // `isExternalBase`, which is the claim the gate refutes on the one project whose
            // checkout publishes `sdk/lib/core/object.dart` (verdict clause: `128 external
            // claim(s) REFUTED`). All 128 have a real base besides Object (46 name
            // `AnalysisDriverUnitIndex` through `implements idl.AnalysisDriverUnitIndex`, 9
            // `ListMixin`, 7 `SetMixin`, …), so the honest fallback is the next REAL base.
            //
            // So `Object` is skipped for such a member and the walk continues to the first
            // `extends`/`implements`/`with` base. Two boundaries, both pinned:
            //   * when the member IS one of Object's own, `Object` stays the base (its interface
            //     is the one thing a per-file run can name with no evidence about the base —
            //     `class Direct extends Object { @override String toString() }`);
            //   * when Object is the ONLY base, there is nothing left to name and no edge is
            //     published — an out-of-file base may be guessed, but a KNOWN-empty one may not
            //     (the same reason a refuted fallback publishes nothing).
            const first = rawFirst === DART_OBJECT_TYPE && !DART_OBJECT_INTERFACE_MEMBERS.has(s.name)
              ? ((baseOrder.get(s.ownerName) ?? []).find((b) => b !== DART_OBJECT_TYPE) ?? null)
              : rawFirst
            // A fallback may only fire where there is NO EVIDENCE AGAINST it. The
            // first heritage parent is the right guess when it lives in another
            // repository, because then nothing in this file can refute it. But if
            // Pass 1 already walked an in-file base and PROVED it does not declare
            // this member, claiming it is a fabricated edge, not a guess: the edge
            // asserts "this member overrides that member in that base", and the base
            // demonstrably has no such member.
            //
            // freezed is the case that reaches it. `sealed class TemplateState
            // extends Equatable` declares no `props`; `class TemplateInitial
            // extends TemplateState` does, annotated `@override` (freezed emits the
            // annotation). Pass 1 walks TemplateState in-file, finds no `props`, and
            // cannot reach Equatable; Pass 3 then attributed the override to
            // TemplateState — a class that does not override anything. The real
            // base is Equatable. Measured 91 such rows on 1,294 ProxiCall/lib
            // files, all of them freezed `props` / `hashCode` / `toString` /
            // `operator ==` against Equatable.
            //
            // The genuine external cases are untouched: `FmsCubit extends Cubit` and
            // `InventoryCategoryException implements Exception` have a first parent
            // that is NOT in this file, so there is no evidence against and the
            // fallback still fires.
            // Two refutations, and the second is only possible once a project index
            // exists. The first is in-file evidence: this file declares the base and
            // the base has no such member. The second is PROJECT-WIDE evidence: the
            // index knows the base, and the inheritance-closed member set says it does
            // not EXPOSE the member. That is the same standard as the first one, at a
            // wider scope, and it is what the gate was missing — it was written before
            // the companion existed and could only ever look at this file.
            //
            // It matters because a 0.8 first-parent claim is wrong the moment the base
            // is KNOWN. dart-http's `WebSocketSink` is `abstract interface class
            // WebSocketSink implements DelegatingStreamSink` and declares only
            // `close`; `done`, `add`, `addError` and `addStream` come from
            // `DelegatingStreamSink`. So every `X.done -> WebSocketSink.done` names a
            // base that does not have the member — 37 rows on that lane alone, all
            // @0.8, all unrefuted only because the base was declared in a DIFFERENT
            // file of the same repository.
            const indexKnowsBase = first !== null && companionForPass2?.has(first) === true
            const refuted = first !== null && !declares(first, s.name) &&
              (byName.get(s.name)?.some((bm) => bm.ownerName === first) ?? false) === false &&
              ((heritageByClass.has(first) || inFileTypes.has(first)) || indexKnowsBase)
            if (!refuted) {
              target = first
              confidence = 0.8
              // The marker must not make a claim about the PROJECT that this run cannot
              // check. With project knowledge the external claim is exactly right — the
              // analyzer did look the base up and did not find it — and the arbiter (which
              // has the whole project) can confirm it, which is what those 93 index-assisted
              // refutations measure. Without it, the only true thing to say is about the RUN,
              // and it is said in the gate's own bucket-3 column: `baseBeyondRunScope` carries
              // the base the run could not reach, is deliberately NOT one of `EXTERNAL_KEYS`,
              // and can never raise a resolution number.
              //
              // `Object` IS THE ONE EXCEPTION, and it is not a carve-out for convenience: the
              // claim `baseBeyondRunScope` says the run could not REACH the base, and when the
              // base the file itself names is `Object`, nothing was out of reach — `Object` is
              // dart:core's root, declared by the language rather than by any file in the
              // population. What `isExternalBase` then claims is that the PROJECT does not
              // publish `Object`, which the arbiter checks by looking the owner up, and that
              // check BITES: 31 riverpod claims were refused by it while a fake `Object`
              // existed (the unnamed-extension defect, fixed 2026-10-09). Reporting it as a
              // declared cause would move a checked claim into an unchecked column, which is
              // the one direction bucket 3 must never be used in.
              metadata = seesProject || first === DART_OBJECT_TYPE
                ? { isOverride: true, relationshipType: "method_override", isExternalBase: true }
                : { isOverride: true, relationshipType: "method_override", baseBeyondRunScope: String(first) }
              // THE OBJECT INTERFACE IS THE ONE OVERRIDE TARGET THAT NEEDS NO
              // EVIDENCE ABOUT THE BASE.
              //
              // Reaching this point means no base the run can see exposes the
              // member, so the first heritage parent is a NAME and not a
              // declaration. When the member is one of `Object`'s own, the parent
              // inherits it — `class ProtocolException implements Exception` with
              // `@override String toString()` does not override
              // `Exception.toString`, because `Exception` declares no `toString`
              // at all (`dart-sdk/sdk/lib/core/exceptions.dart` publishes 17
              // symbols and `Exception.toString` is not one of them). The edge
              // `ProtocolException.toString -> Exception.toString` therefore
              // named a member that does not exist, and the graph asserted a
              // declaration there.
              //
              // MEASURED over 4,788 corpus files at `BB_DART_CONC=1` (3 repos
              // read whole: dart-http 335, riverpod 1,295, proxicall 2,351; 2
              // sampled: flutter-packages 404, dart-sdk 403):
              //
              //   before — 247,737 `overrides` rows, 2,422 of them (0.98%) name a
              //            target no published declaration provides. Every one of
              //            the 2,422 is this shape, and every one is an
              //            `isExternalBase` fallback.
              //   after  — those rows name `Object.<member>`, which IS published
              //            in the SDK sources, and the residual unexplained
              //            `overrides` population falls by the same 2,422.
              //
              // WHAT THIS TRADES, stated rather than argued away. If an
              // out-of-run base DOES declare the member — a user class in another
              // package with its own `toString` — then `Base.toString` was the
              // nearest correct target and `Object.toString` is one hop further
              // up. The retarget cannot tell the two cases apart without the
              // base's own file, and it prefers naming a declaration that
              // provably EXISTS over naming one that may not. That is the same
              // preference the rest of this pass already makes when it refuses a
              // refuted fallback: an edge the graph cannot walk asserts something
              // that is not there, and a narrower graph that is true beats a
              // wider one that is not.
              //
              // The row is tagged `isObjectInterfaceBase`, so a consumer can tell
              // a retargeted row from a first-parent row, and M14 §4's
              // countability holds: it is one boolean over a single type at a
              // single confidence.
              if (
                first !== null &&
                first !== DART_OBJECT_TYPE &&
                DART_OBJECT_INTERFACE_MEMBERS.has(s.name)
              ) {
                // The BASE name, not the qualified member: the push below appends
                // `.${s.name}` itself. Writing `Object.toString` here produced the
                // target `Object.toString.toString`, which the fixture caught on
                // its first run.
                target = DART_OBJECT_TYPE
                metadata = {
                  isOverride: true,
                  relationshipType: "method_override",
                  isExternalBase: true,
                  isObjectInterfaceBase: true,
                  firstHeritageParent: first,
                }
              }
            }
          }
        }
        if (!target) continue
        const key = `${s.ownerName}.${s.name}->${target}.${s.name}`
        if (seenOverride.has(key)) continue
        seenOverride.add(key)
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${target}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence,
          // The overriding METHOD's own name line — the node that names the
          // edge, not the base it shadows (and not a wrapped start line).
          line_number: nameLines?.get(dartNameLineKey(s.name, s.range)) ?? s.range?.startLine,
          metadata,
        })
      }
    }
  }

  /** Companion lookup with leaf-name fallback (bases may arrive qualified). */
  private companionHas(companion: Map<string, Set<string>>, base: string, method: string): boolean {
    if (companion.get(base)?.has(method)) return true
    const leaf = base.includes(".") ? base.split(".").pop()! : base
    return leaf !== base && !!companion.get(leaf)?.has(method)
  }

  /**
   * The whole-tree EXPRESSION pass: `calls`, `uses`, `instantiates` and
   * `references`.
   *
   * Named for what it reads rather than for when it was written. It began as the
   * call pass, but it is also the only traversal that already knows, at every
   * node, which declaration encloses it (`current`/`owner`, the family attribution
   * rule), and a type mention's SOURCE is the same question a call's source is.
   * A second traversal would have had to re-derive that attribution, and two
   * copies of one rule are two rules that drift.
   *
   * `projectIndex` is LAST and it must stay last — the same hazard
   * `extractOverrideRelationships` documents: an optional parameter inserted
   * earlier silently swapped the ones after it.
   */
  private extractExpressionRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
    symbols: ASTEngine.UniversalSymbol[],
    projectIndex?: any,
  ): void {
    // IMPORT ALIASES, collected once: they decide whether a scoped annotation's qualifier is an
    // ALIAS (`@_i1.TestFor()` -> the type is `TestFor`) or the TYPE itself
    // (`@TestFor.async_value_nullable_pattern` -> the type is `TestFor` and the member selects a
    // named constructor). The grammar builds the same `scoped_identifier` shape for both, so the
    // alias table is the only evidence that separates them. Shape probed:
    // `(import_specification (configurable_uri …) (identifier))` — the identifier DIRECTLY under
    // import_specification is the alias; the uri's own identifiers live inside configurable_uri.
    const importAliases = this.collectImportAliases(node)

    // The types this run can SEE. `references` publishes a type mention only when
    // the mentioned name binds to a type declaration the analyzer can point at —
    // a type from another file is a real mention, but from one file it is a NAME,
    // and a name with nothing behind it is what `references` must not publish
    // (see `collectTypeMention`).
    //
    // Same-file types come from the symbol table the first pass just built.
    // UNNAMED EXTENSIONS ARE EXCLUDED, and this is the second half of the rule
    // `DART_UNNAMED_EXTENSION` states: their published name is SYNTHESIZED, so nothing in
    // source spells it, and admitting it would put a name no code writes into the resolver.
    const visibleTypes = new Set<string>()
    for (const s of symbols) {
      const kind = s.kind as ASTEngine.SymbolKind
      const isType = kind === ASTEngine.SymbolKind.Class || kind === ASTEngine.SymbolKind.Mixin ||
        kind === ASTEngine.SymbolKind.Extension || kind === ASTEngine.SymbolKind.Enum ||
        kind === ASTEngine.SymbolKind.TypeAlias
      if (!isType) continue
      if (kind === ASTEngine.SymbolKind.Extension && (s.metadata as any)?.isUnnamedExtension) continue
      if (s.name) visibleTypes.add(s.name)
    }
    // What this FILE declared, kept apart from what the index contributed, so a
    // row can say which of the two resolved it. Production supplies no index for
    // `.dart`, so there the two are the same set and every row says false.
    const fileTypes = new Set(visibleTypes)
    // LIBRARY SCOPE — the THIRD scope a bare name binds in, and the one that makes a bare
    // target CORRECT rather than a receiver the run failed to type.
    //
    // Dart resolves an unqualified callee against the enclosing type's members FIRST and the
    // library's top-level declarations second, so `configure()` inside a class whose chain does
    // not declare `configure` does not name a member of any type: it names a library-scope
    // declaration, whose own spelling IS the bare name in this family's key space (a Dart
    // library is its URI, and a library-scope symbol carries no owner). Counting those rows in
    // the receiver cut would file "already spelled as correctly as the family allows" under "no
    // static name reaches this", which is the opposite conclusion a roadmap should draw.
    //
    // Type names are excluded because `Foo()` is a CONSTRUCTION and the instantiates arm owns
    // it; the bare-callee arm never sees it.
    const libraryScope = new Set<string>()
    for (const s of symbols) {
      if (s.ownerName) continue
      if (fileTypes.has(s.name)) continue
      if (s.kind === ASTEngine.SymbolKind.EnumMember) continue
      if (s.name) libraryScope.add(s.name)
    }
    for (const t of projectIndex?.typeKinds?.keys?.() ?? []) visibleTypes.add(String(t))

    // DT-A (first review): in-file named constructors (`Foo.named`) — the
    // calls below consult this set so construction wins over the dangling
    // leaf call. Cross-file named ctors stay leaf calls (translation-unit
    // boundary, documented).
    const namedCtors = new Set<string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Constructor && s.ownerName) {
        const seg = (s.metadata as any)?.namedSegment
        if (seg) namedCtors.add(`${s.ownerName}.${seg}`)
      }
    }
    // DT-F+ (#752): declared members per owning type. A BARE identifier read
    // (`return count;`) is only a member read when it resolves to a member of
    // the enclosing type — otherwise every local/loop variable fabricates a
    // uses edge (a false edge is worse than a missing one, #299). Built once
    // from the symbol table; O(symbols) like namedCtors above.
    const membersByOwner = new Map<string, Set<string>>()
    for (const s of symbols) {
      if (!s.ownerName) continue
      let set = membersByOwner.get(s.ownerName)
      if (!set) {
        set = new Set<string>()
        membersByOwner.set(s.ownerName, set)
      }
      set.add(s.name)
    }
    // DT2 (second review): file-scope VALUE names — top-level variables,
    // constants, functions and accessors. Types (classes, enums, mixins,
    // extensions, typedefs) are never values. Locals shadow globals and
    // members shadow both (Dart scoping); the arms below are mutually
    // exclusive by construction.
    const topLevelValues = new Set<string>()
    for (const s of symbols) {
      if (s.ownerName) continue
      if (
        s.kind === ASTEngine.SymbolKind.Variable ||
        s.kind === ASTEngine.SymbolKind.Constant ||
        s.kind === ASTEngine.SymbolKind.Function ||
        s.kind === ASTEngine.SymbolKind.Property
      ) {
        topLevelValues.add(s.name)
      }
    }
    // DT-D (first review): superclass per class (resolved, alias-free) for
    // `super(...)` initializer targets. Superclass-child clauses only —
    // mixin-application bases are vanishingly rare as super targets.
    const superByClass = new Map<string, string>()
    {
      const pre: Node[] = [node]
      while (pre.length > 0) {
        const cn = pre.pop()!
        if (!cn) continue
        if (cn.type === "class_definition") {
          const nm = cn.childForFieldName?.("name")?.text
          const sup = this.findChildByType(cn, "superclass")
          if (nm && sup) {
            const base = this.resolvedHeritageNames(sup)[0]
            if (base) superByClass.set(nm, base)
          }
        }
        for (let i = cn.namedChildCount - 1; i >= 0; i--) {
          const ch = cn.namedChild(i)
          if (ch) pre.push(ch)
        }
      }
    }
    // ── THE SOURCE'S OWN QUALIFIER, KEPT INSTEAD OF DROPPED ──────────────
    //
    // Measured 2026-10-08 on a 6-line probe file (`script/m14/tmp/dt-selector-shape.ts`
    // prints the node shapes; the symbol table below is `pool-worker.parseFile`'s):
    //
    //   source            edge the analyzer emitted      symbol the file PUBLISHES
    //   Color.red         uses  -> red                   enum_member  q=Color.red
    //   C.create()        calls -> create                method       q=C.create
    //   super.go()        calls -> go                    method       q=Base.go
    //   this.count        uses  -> count                 property     q=Base.count
    //   b.count           uses  -> count                 property     q=Base.count
    //
    // Every one of those targets is a bare member name, and the qualifier that would make it
    // determinate is written in the SOURCE. `Color.red` in a project with four `red`s is an
    // ambiguous edge; `Color.red` is exactly one declaration, because the member symbol's
    // `ownerName` is what `pool-worker` turns into its `qualifiedName`. This is the same
    // defect the fsharp lane measured and fixed (calls target-determinacy 19.1% -> 29.1%).
    //
    // VERIFY-THEN-WRITE, because qualification can also make an edge WORSE: a bare `count`
    // that is unique in the project resolves, while `C.count` for a member C inherits names
    // a declaration C does not have. So the target is written ONLY when the analyzer can
    // point at the declaration it names — in this file's own symbol table, or in the project
    // index's member table. Nothing here guesses an owner from a capital letter alone.
    const fileQualified = new Set<string>()
    for (const s of symbols) {
      if (s.ownerName) fileQualified.add(`${s.ownerName}.${s.name}`)
    }
    /** type -> member, transitively closed, from the index — the same read the override pass
     *  makes (`buildResolutionTables`' `typeMembers`), and absent for a per-file run. */
    const indexDeclares = (typeName: string, member: string): boolean => {
      const set = projectIndex?.typeMembers?.get?.(typeName)
      if (set instanceof Set) return set.has(member)
      if (Array.isArray(set)) return set.includes(member)
      return false
    }
    /**
     * The type that DECLARES `member`, starting at `from` and walking this file's superclass
     * chain. Dart's own rule: a member is addressable through the type that inherits it, but
     * the DECLARATION is what a qualified name names — `this.count` inside C is `Base.count`
     * when C extends Base, and writing `C.count` there would name a symbol that does not
     * exist (and, being a lookup miss, would be counted as a broken edge).
     */
    const declaringOwner = (member: string, from: string | null, memberNodesByOwner: Map<string, Set<string>>): string | null => {
      const seen = new Set<string>()
      let cur = from
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        if (memberNodesByOwner.get(cur)?.has(member)) return cur
        cur = superByClass.get(cur) ?? null
      }
      return null
    }
    /** owner text -> the fields/locals it declares -> their DECLARED type, when that type is
     *  a plain identifier. `final Base b;` makes `b.count` addressable as `Base.count`. */
    // THE KIND OF EACH TYPE THIS FILE DECLARES, by name. The receiver contract asks for an owner
    // that the store's resolver can use: `src/ast/member-owner-resolution.ts` accepts exactly one
    // CLASS-LIKE owner (class | interface | trait | enum), and a dart `mixin`, `extension` or
    // `typedef` is NOT class-like to that rule. Emitting such a name as `owner` would make the
    // resolver decline AND withdraw the row's name binding ("a wrong owner is worse than none",
    // Lead contract) — so a type this file declares as a non-class-like kind must not become an
    // owner. A type NOT declared in this file has no kind here and is still emitted: that is the
    // `HttpClient.close` case, where the owner channel is the only resolution a store can reach.
    const typeKindByName = new Map<string, string>()
    const fieldTypeByField = new Map<string, string>()
    for (const s of symbols) {
      if (!s.ownerName) continue
      const dt = String((s.metadata as any)?.dataType ?? "")
      if (isPlainIdentifier(dt)) fieldTypeByField.set(`${s.ownerName}.${s.name}`, dt)
    }
    /**
     * A QUALIFIED TARGET or null, AND WHY — the second half is the RECEIVER AVAILABILITY CUT.
     *
     * The cut is the decomposition the roadmap is written on: of the edges whose target stayed
     * a bare member name, how many have a receiver whose type this run could not see (an
     * index question), how many name a member whose declaring type is outside the run (a
     * different index question), and how many have NO type name at the site at all (`dynamic`,
     * an untyped parameter, a call result, an index expression) — which is bucket 3's true
     * population, and the only one of the three that no amount of indexing can move.
     *
     * IT IS REPORTED HERE, INSIDE THE FUNCTION THAT DECIDES, rather than derived afterwards in
     * a census. A second walker that re-asks "could this have been qualified" would be a second
     * copy of this rule, and this repository's repeated finding is that two copies of one rule
     * are two rules — the copy the CENSUS used would be the one that was wrong. The cause
     * strings are the three null-returning branches below, in order:
     *
     *   receiverUnnamed            no owner text at the site (a call result, an index expression,
     *                              a cascade, a bare callee in library scope). Not typeable here.
     *   receiverTypeOutsideRun     a CAPITALIZED owner text names a type this run cannot see (an
     *                              imported type, a prefix): the type's NAME is in the source, so
     *                              the target can be spelled `Type.member` even though no member
     *                              table here can confirm it.
     *   receiverTypeUnknown       a lowercase owner text whose declared type this run did not
     *                              resolve — a VALUE, not a type. No spelling at the site reaches
     *                              a declaration; this is the receiver-typing gap.
     *   receiverInFileNotSpelled   the declaring owner IS in this file, and the qualified
     *                              spelling is not in this file's published symbol table — the
     *                              one branch that is an analyzer gap rather than missing
     *                              knowledge, and it is kept separate for exactly that reason.
     *   receiverMemberOutsideRun   the type is visible here and does not declare the member, so
     *                              the DECLARING type (a superclass, a mixin, a mixin's own base)
     *                              is outside the run.
     *   libraryScopeCallee         the bare name is a LIBRARY-scope declaration of this file —
     *                              not a receiver problem at all. Set by the bare-callee arm only
     *                              (see `libraryScope`), because a receiver-qualified member never
     *                              falls back to library scope and so can never mean this.
     */
    const qualifiedTarget = (
      ownerText: string | null,
      member: string,
    ): { target: string | null; cause: string | null; typeName?: string; claim?: string } => {
      if (!ownerText || !member) return { target: null, cause: "receiverUnnamed" }
      // TWO DIFFERENT DECLINES, and the first draft of this cut did not tell them apart — the dump
      // did. Dart capitalizes type names and lowercases values, which is the one piece of evidence
      // the source itself carries here:
      //
      //   `ExternalThing.frob()` — a CAPITALIZED head is a TYPE this run cannot see. The name is
      //   written in the source, so the edge could publish `ExternalThing.frob` (a spelling that
      //   is more specific than the bare member and that a project index can resolve) instead of
      //   dropping it: this is a SPELLING loss.
      //
      //   `ext.frob()` — a lowercase head is a VALUE whose declared type this run did NOT resolve
      //   (the type lives in the declaration of `ext`, which `headOwner` fell back past). Nothing
      //   at the site names a type, so no spelling change reaches it: this is a RECEIVER-TYPING
      //   gap, and reporting it as "the type is outside the run" — which the first draft did, by
      //   using the head TEXT as the type — would have counted a typing gap as a spelling loss in
      //   the very census written to decide which of the two to build.
      if (!visibleTypes.has(ownerText)) {
        if (!isCapitalized(ownerText)) return { target: null, cause: "receiverTypeUnknown" }
        // THE RECEIVER-TYPE SPELLING, AND WHY ITS CLAIM IS THE HONEST HALF.
        //
        // The type's NAME is in the source or in the value's own declaration (`headOwner` resolves
        // a local, a parameter or a field), so the target can name an owner instead of guessing
        // that the bare LEAF is unique in the project: `ExternalThing.make` is strictly more
        // specific than `make`, and it resolves exactly when the project declares
        // `ExternalThing.make` — measured on the gate's own key space, 966 ambiguous riverpod calls
        // resolve against 129 previously-resolved rows that stop being resolvable, which is the
        // trade the census exists to price.
        //
        // What makes it SAFE is `baseBeyondRunScope`, whose contract was built for exactly this
        // situation: the run was handed no project index, so it could not look the owner up. The
        // claim CANNOT raise a resolution — the gate reads it only where the target names nothing
        // — and it is checked against the edge's own target owner, so it cannot excuse an unrelated
        // row. Rows whose spelling DOES resolve never have their claim read, so the spelling is
        // never bought with an exemption.
        return { target: `${ownerText}.${member}`, cause: null, typeName: ownerText, claim: ownerText }
      }
      const declared = declaringOwner(member, ownerText, membersByOwner)
      if (declared) {
        // the in-file spelling is verified against what the file PUBLISHES, not rebound
        const spelling = `${declared}.${member}`
        if (fileQualified.has(spelling)) return { target: spelling, cause: null }
        return { target: null, cause: "receiverInFileNotSpelled" }
      }
      if (indexDeclares(ownerText, member)) return { target: `${ownerText}.${member}`, cause: null }
      return { target: null, cause: "receiverMemberOutsideRun" }
    }
    /**
     * THE CUT'S METADATA, built in ONE place so no site can record a cause without its type or a
     * type without its cause — the same reason the cause is produced inside the rule that decides
     * it. A row the analyzer qualified carries nothing here: the cut labels bare rows only.
     */
    const receiverCut = (q: { cause: string | null; typeName?: string; claim?: string }): Record<string, unknown> => {
      // A SPELLED ROW CARRIES THE CLAIM, NOT A CUT CAUSE. The two are mutually exclusive by
      // construction: the cut labels rows that stayed BARE, and a spelled row did not. Keeping the
      // split here means no emission site can attach both and no site has to remember the rule.
      if (q.claim !== undefined) return { baseBeyondRunScope: q.claim }
      return q.cause ? { receiverCause: q.cause, ...(q.typeName ? { receiverType: q.typeName } : {}) } : {}
    }

    /**
     * A declared type name this pass can POINT AT, or undefined. `Widget?` is the same
     * declaration as `Widget` (the operand of `?` is the type), and a generic or record
     * type is NOT reduced here — `List<int>` names a declaration whose members this pass
     * would then have to resolve through arguments it has not read, so it declines.
     */
    const plainTypeName = (text: string | undefined | null): string | undefined => {
      const leaf = stripNullableSuffix(String(text ?? ""))
      return isPlainIdentifier(leaf) ? leaf : undefined
    }

    /**
     * The type a READ/CALL head names, in the order Dart resolves an unqualified name:
     * a LOCAL/PARAMETER binding shadows a field, which shadows nothing else this pass
     * knows. `this` -> the enclosing type, `super` -> its base, a capitalized name -> the
     * type it spells, a field -> the type the field is declared with. Anything else (a
     * call result, an index expression, a prefix alias) has no owner this run can point
     * at, and returns null so the target stays the bare leaf the source wrote.
     */
    const headOwner = (head: Node | null, enclosing: string | null, localTypes: Map<string, string>): string | null => {
      const t = head?.type
      if (t === "this") return enclosing
      if (t === "super") return superByClass.get(enclosing ?? "") ?? null
      const text = this.headNameText(head)
      if (text === null) return null
      const localType = localTypes.get(text)
      if (localType) return localType
      const fieldType = fieldTypeByField.get(`${enclosing ?? ""}.${text}`)
      if (fieldType) return fieldType
      return text
    }

    /**
     * RECEIVER OWNERSHIP — the STORE's channel, not a second spelling.
     *
     * `src/ast/member-owner-resolution.ts` (`claimOwnerCarryingTargets` +
     * `resolveMemberTargetsByOwner`, called from both resolution paths in
     * `src/ast/parallel-indexer.ts`) already resolves a call/uses row by the
     * `metadata.owner` key: it requires exactly one CLASS-LIKE owner (class / interface /
     * trait / enum — a dart `mixin`/`extension` is not class-like to that rule), filters the
     * member candidates by kind, walks the owner's ancestors through the stored super_types,
     * and WITHDRAWS the row's name binding rather than letting an owner-carrying row keep an
     * unrelated same-name declaration.
     *
     * The analyzer's job is therefore exactly one thing: state the type the receiver is
     * STATICALLY KNOWN to have, and the EVIDENCE CLASS that says how the source said so.
     * The four classes are the receiver contract's, not this lane's invention:
     *
     *   param       the receiver resolves to a formal parameter whose declared type was
     *               extracted (`void run(OrderRepository r) { r.load(); }`)
     *   field       the receiver resolves to a field of the enclosing class
     *               (`fieldTypeByField`, filled by the symbol pass)
     *   annotation  a local/for-in binding with a WRITTEN type (`final Base b = ...`,
     *               `for (final Element e in xs)`)
     *   assignment  a local whose type comes from its INITIALIZER (`var x = Foo()`)
     *
     * NOT emitted for `this`/`super` (the target spelling already names the owner and "the
     * enclosing class" is none of the four classes), and NOT emitted when the head is not a
     * plain name (call result, index expression, prefix alias). A WRONG owner is worse than
     * none: this helper only reports a type the source wrote or the initializer constructed —
     * it never infers one from member names or call results.
     */
    const receiverOwnerMeta = (
      head: Node | null,
      enclosing: string | null,
      localTypes: Map<string, string>,
      localEvidence: Map<string, string>,
    ): Record<string, unknown> | null => {
      const t = head?.type
      if (t === "this" || t === "super") return null
      const text = this.headNameText(head)
      if (text === null) return null
      // A declared non-class-like type (mixin / extension / typedef) is NOT a usable owner: the
      // store's resolver accepts only class | interface | trait | enum and would withdraw the
      // row's name binding on a name it cannot accept. Unknown kinds (type declared outside this
      // file) stay eligible — that is the external-owner case the channel exists for.
      const classLikeType = (name: string): string | null => {
        // `dynamic` / `void` / `Never` are not declared types at all: they are the ABSENCE of a
        // type (or a bottom type the resolver never accepts). Emitting them as `owner` would be a
        // claim about a declaration that cannot exist.
        if (name === "dynamic" || name === "void" || name === "Never") return null
        const kind = typeKindByName.get(name)
        if (kind === undefined) return name
        if (kind === "class" || kind === "enum") return name
        return null
      }
      const localType = localTypes.get(text)
      if (localType) {
        const evidence = localEvidence.get(text)
        const owner = classLikeType(localType)
        // No evidence class means no claim about HOW the type is known; the row keeps its
        // existing shape rather than inventing one.
        return evidence && owner ? { owner, ownerEvidence: evidence } : null
      }
      const fieldType = fieldTypeByField.get(`${enclosing ?? ""}.${text}`)
      const owner = fieldType ? classLikeType(fieldType) : null
      if (owner) return { owner, ownerEvidence: "field" }
      return null
    }

    for (const s of symbols) {
      if (s.ownerName) continue
      const kind = String(s.kind ?? "")
      if (kind === "class" || kind === "enum" || kind === "mixin" || kind === "extension" ||
          kind === "extension_type" || kind === "type_alias" || kind === "type") {
        if (s.name) typeKindByName.set(s.name, kind)
      }
    }

    // Current call source = enclosing function/method/constructor leaf name.
    const resolveCurrent = (n: Node, current: string | null): string | null => {
      // Local functions are NOT call contexts (family contract: locals fold
      // into the enclosing function's call set — csharp/python/go parity,
      // DARTD8). tree-sitter-dart: local_function_declaration >
      // lambda_expression > function_signature[name] — the signature's only
      // lambda parent is that wrapper, so returning `current` keeps the
      // enclosing function as source for calls inside the local body.
      if (n.type === "function_signature" && n.parent?.type === "lambda_expression") {
        return current
      }
      // Only signature-bearing nodes change the call context. `declaration`
      // nodes matter only when they DIRECTLY wrap a signature (class members);
      // class/enum/extension containers must NOT leak their first member name.
      let sig: Node | null = null
      if (this.isSignatureNode(n.type)) {
        sig = n
      } else if (n.type === "declaration") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && this.isSignatureNode(c.type)) {
            sig = c
            break
          }
        }
      }
      if (sig) {
        const inner = this.findInnerSignature(sig)
        // DARTD22: the node TYPE does not decide — a method with no return type
        // parses as a `constructor_signature` (see `isRealConstructor`). Reading
        // the type alone named the source of every edge in an untyped method's
        // body the literal string `constructor`, a name 662 declarations in a
        // 600-file sample carry. The method's own name is the source.
        if (
          this.isConstructorSignature(sig.type) || this.isConstructorSignature(inner.type)
        ) {
          if (this.isRealConstructor(inner, this.enclosingTypeName(inner))) return "constructor"
        }
        const nm = this.signatureName(inner)
        if (nm) return nm
      }
      return current
    }

    // Enclosing CLASS/MIXIN/ENUM/EXTENSION for non-function contexts: field
    // initializers and annotation arguments carry no function context, but
    // their constructions belong to the owning type, NOT the module/file name
    // (csharp parity: parentContext?.rawName || "global" — DARTD9). Without
    // this, every const field initializer of a big icon class attributed its
    // instantiates to the file basename.
    const resolveOwner = (n: Node, owner: string | null): string | null => {
      const t = n.type
      if (t === "class_definition" || t === "enum_declaration") {
        const nm = n.childForFieldName?.("name")?.text
        return nm || owner
      }
      if (t === "extension_declaration" || t === "extension_type_declaration") {
        // THE SYNTHESIZED NAME, not the target type: an `instantiates`/`uses` row emitted
        // inside an unnamed extension's body must name the same owner its `contains` row
        // does, and `extensionPublishedName` is that one rule.
        return this.extensionPublishedName(n) || owner
      }
      if (t === "mixin_declaration") {
        // mixin name is a direct identifier child (no name field)
        const id = this.findChildByType(n, "identifier")
        return id ? id.text : owner
      }
      // `typedef A = B;` — the alias is a PUBLISHED symbol (kind `type`), so the
      // mention of `B` belongs to `A` and not to the file. Added for `references`;
      // it cannot move `calls`/`uses`/`instantiates`, because a typedef has no
      // body for an expression to sit in.
      if (t === "type_alias") {
        const nm = n.childForFieldName?.("name")?.text || this.findChildByType(n, "type_identifier")?.text
        return nm || owner
      }
      return owner
    }

    // VISITS ONE NODE and RETURNS what its children inherit — it does not descend.
    //
    // The descent used to be a self-call in the tail, and that is what the dart corpus
    // broke: measured 2026-10-07, `deep_nesting_statement_test.dart` is a tree of depth
    // **20,004** and `deep_nesting_expression_test.dart` **10,005** (probe:
    // `validation/m14/fixtures/dart/deep-nesting-stack.ts`), and the recursion threw
    // `RangeError: Maximum call stack size exceeded` with the frame at the old line 2434
    // repeating 500 times — the entire stack, on one file. The engine caught it and
    // returned `2.0-basic-fallback` with 0 symbols, so the dart SDK's own deep-nesting
    // fixtures were 2 of the 8 files the whole-corpus coverage gate could not measure. A JS
    // call stack is bounded by depth and this corpus contains 20,004.
    //
    // Nothing above the tail changed: no early `return`, and `prev`/`prevOwner` keep the
    // meaning they had (the parent's values, captured before this node's own resolution).
    const visitNode = (
      n: Node,
      current: string | null,
      owner: string | null,
      locals: Set<string>,
      localTypes: Map<string, string>,
      localEvidence: Map<string, string>,
      localElements: Map<string, string>,
      insideCollected: boolean,
    ): [string | null, string | null, Set<string>, Map<string, string>, Map<string, string>, Map<string, string>, boolean] => {
      const prev = current
      const prevOwner = owner
      const t = n.type
      current = resolveCurrent(n, current)
      owner = resolveOwner(n, owner)
      // DT-F+ (#752 gate B): names the CURRENT FUNCTION binds locally are not
      // member reads (CGD15 parity). A function body's bindings are its own
      // declarators plus the formal parameters of the preceding signature
      // sibling (Dart puts the body AFTER the signature in the container).
      let childLocals = locals
      let childLocalTypes = localTypes
      let childLocalEvidence = localEvidence
      let childLocalElements = localElements
      // Whether a STRICT ancestor's whole subtree has already been collected into
      // `locals`. See the block below for why that makes a re-walk redundant.
      let childInsideCollected = insideCollected
      if (t === "function_body" || t === "function_expression_body" || t === "block") {
        // `collectDartLocals(n)` returns the names declared in subtree(n). If a strict
        // ancestor A already had its whole subtree collected, then subtree(n) is a SUBSET
        // of subtree(A), so S(n) ⊆ S(A) — and S(A) was merged into the `locals` this node
        // INHERITS. Re-walking n therefore cannot add a name: the merge below would be
        // unioning S(n) into a set that already contains it. Skipping is output-identical,
        // not a heuristic.
        //
        // Without this the pass is QUADRATIC in nesting depth. `block` is a trigger, so
        // n nested blocks each walk their own subtree; the block at depth d has O(n-d)
        // nodes beneath it and sum(n-d) = O(n²). Measured on a nested-if spine: `parent`
        // and `type` crossings both scale as n^1.95–1.98, and 95% of them were eight
        // lines inside collectDartLocals' loop body (see
        // validation/m14/fixtures/dart/climb-attribution.ts). Production parseFile did
        // not finish `dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart`
        // within 300,000 ms.
        //
        // A node-count cap was rejected against evidence: real corpus trigger subtrees
        // reach 140,062 nodes (dart-sdk/tests/language/regress/regress41983_test.dart),
        // the same order as the pathological case, so no cap separates them without
        // changing real files. Redundancy does — it needs no threshold.
        //
        // `null` rather than an empty Set: "nothing contributed here" must stay
        // distinguishable from "contributed nothing new", because the latter still has to
        // COPY `locals` before merging. Writing into `locals` in place would leak this
        // scope's bindings back into its parent's set.
        let bound: Set<string> | null = null
        // DECLARED TYPES for those bindings, collected in the same place and merged the
        // same way. A receiver whose type is written in the signature or the declaration
        // (`void run(OrderRepository r)`, `final Base b = Base();`) is what makes a call
        // target determinate; the NAME set alone cannot tell `r` from a local.
        let boundTypes: Map<string, { type: string; evidence: string; element?: string; keyElement?: string }> | null = null
        if (!insideCollected) {
          const own = this.collectDartLocals(n)
          if (own.size > 0) bound = own
          const ownTypes = this.collectDartLocalTypes(n)
          if (ownTypes.size > 0) boundTypes = ownTypes
        }
        // A signature SIBLING is not a descendant, so its parameters are NOT implied by
        // the ancestor's collection. This walk stays unconditional — it is over a
        // signature node, not the body, and is not what made the pass quadratic.
        const sig = n.previousNamedSibling
        if (sig) {
          const sigNames = this.collectDartLocals(sig)
          if (sigNames.size > 0) {
            if (!bound) bound = new Set<string>()
            for (const nm of sigNames) bound.add(nm)
          }
          const sigTypes = this.collectDartParameterTypes(sig)
          if (sigTypes.size > 0) {
            if (!boundTypes) boundTypes = new Map<string, { type: string; evidence: string; element?: string; keyElement?: string }>()
            for (const [nm, ty] of sigTypes) boundTypes.set(nm, ty)
          }
        }
        if (bound) {
          childLocals = new Set(locals)
          for (const nm of bound) childLocals.add(nm)
        }
        if (boundTypes) {
          childLocalTypes = new Map(localTypes)
          childLocalEvidence = new Map(localEvidence)
          childLocalElements = new Map(localElements)
          for (const [nm, ty] of boundTypes) {
            childLocalTypes.set(nm, ty.type)
            childLocalEvidence.set(nm, ty.evidence)
            // A map's KEY element rides in the SAME map under an encoded key: `localElements` is
            // already threaded through the traversal, and a second parallel map is state that can
            // drift. The encoding is a NUL separator — a local name cannot contain it.
            if (ty.element) childLocalElements.set(nm, ty.element)
            if (ty.keyElement) childLocalElements.set(`${nm}\u0000key`, ty.keyElement)
          }
        }
        // AWAITED LOCALS, over the whole body: `final repo = await pending;` types `repo` as the
        // Future's written type argument, and the binding must be visible to SIBLING statements
        // (a child-local write cannot reach them). It runs after the signature merge because the
        // future is very often a PARAMETER (`Future<Repo> pending`) and parameters only enter this
        // state from the merge. This is a PREPASS over the body subtree, like
        // `collectDartLocalTypes`; a fixed number of rounds settles nested awaits.
        const awaitTypes = this.collectAwaitLocalTypes(n, childLocalElements, childLocalTypes)
        if (awaitTypes.size > 0) {
          childLocalTypes = new Map(childLocalTypes)
          childLocalEvidence = new Map(childLocalEvidence)
          childLocalElements = new Map(childLocalElements)
          for (const [nm, ty] of awaitTypes) {
            childLocalTypes.set(nm, ty)
            childLocalEvidence.set(nm, "annotation")
            childLocalElements.set(nm, ty)
          }
        }
        if (!insideCollected) childInsideCollected = true
      }
      // UNTYPED FOR-IN ELEMENT INFERENCE — `for (final e in xs)` where `xs` is a container whose
      // ELEMENT type is written in its own type argument (`List<Repo> xs`). The type is written
      // in the source (same evidence class as a declared local), so the loop variable is typed
      // for its body and `e.load()` resolves to `Repo.load` instead of a bare leaf. The TYPED
      // form (`for (final Repo e in xs)`) is unaffected: its type is already in `localTypes` via
      // the collector, and this branch only fills an entry that is not there.
      if (t === "for_statement") {
        const parts = this.findChildByType(n, "for_loop_parts")
        if (parts) {
          const hasWrittenType = (parts.namedChildren ?? []).some((c) => c?.type === "type_identifier")
          const nameNode = parts.childForFieldName?.("name")
          const valueNode = parts.childForFieldName?.("value")
          if (!hasWrittenType && nameNode && valueNode && !childLocalTypes.has(nameNode.text)) {
            // TWO ITERABLE SHAPES carry a written element type: the bare local (`for (e in xs)`
            // over `List<Repo> xs`) and the MAP VIEW selector. The pinned grammar parses
            // `byId.values` as `(identifier) (selector (unconditional_assignable_selector...))` —
            // the selector is a SIBLING of the identifier, not its child — so the bare branch is
            // entered for both, and the link must be read from the NEXT named sibling. `values`
            // iterates the map's VALUE element, `keys` its KEY element (encoded as `<name>\u0000key`
            // in the same localElements map).
            let element: string | undefined
            let link: string | undefined
            const sel = valueNode.nextNamedSibling
            if (sel && sel.type === "selector") {
              // The link is one hop deeper (`selector > unconditional_assignable_selector >
              // identifier`), so the DIRECT-child reader finds nothing; the subtree scan keeps
              // the rule reading the grammar rather than the node's text.
              const ids: string[] = []
              const linkStack: Node[] = [sel]
              while (linkStack.length > 0) {
                const x = linkStack.pop()!
                if (x.type === "identifier") { ids.push(x.text); continue }
                for (const c of x.namedChildren ?? []) if (c) linkStack.push(c)
              }
              link = ids.find((t) => t === "values" || t === "keys")
            }
            if (link === "values") element = localElements.get(valueNode.text)
            else if (link === "keys") element = localElements.get(`${valueNode.text}\u0000key`)
            else element = localElements.get(valueNode.text)
            if (element) {
              childLocalTypes = new Map(childLocalTypes)
              childLocalTypes.set(nameNode.text, element)
              childLocalEvidence = new Map(childLocalEvidence)
              childLocalEvidence.set(nameNode.text, "annotation")
            }
          }
        }
      }
      // DT2: constructor initializer lists (`: x = p`, `: super(p)`) read
      // the constructor's parameters, but the list is a SIBLING of the
      // signature — not under any body. Bind the sibling signature's
      // params for this subtree (same collectDartLocals machinery).
      if (t === "initializers") {
        const par = n.parent
        if (par) {
          for (let k = 0; k < par.namedChildCount; k++) {
            const sib = par.namedChild(k)
            if (sib && (sib.type === "constructor_signature" || sib.type === "method_signature" || sib.type === "function_signature")) {
              const bound = this.collectDartLocals(sib)
              if (bound.size > 0) {
                childLocals = new Set(locals)
                for (const nm of bound) childLocals.add(nm)
              }
              break
            }
          }
        }
      }
      // Dart grammar: a function_body/function_expression_body is a named
      // child of the CONTAINER (class_body, extension_body, program) that
      // FOLLOWS the signature node it belongs to — the previous named sibling
      // carries the call context (e.g. `method_signature` then `function_body`).
      if (
        (t === "function_body" || t === "block" || t === "function_expression_body") &&
        current === prev
      ) {
        const prevSib = n.previousNamedSibling
        if (prevSib) {
          const sigSource = resolveCurrent(prevSib, current)
          if (sigSource !== current) current = sigSource
        }
      }
      const callSource = current || owner || moduleName

      // Constructor invocation: `List<int>.filled(3, 0)` → instantiates List.
      // `new Foo()` parses as new_expression and `const Foo()` as
      // const_object_expression — both are explicit constructor invocations
      // with a type_identifier child and construction args (the dart wave
      // differential oracle surfaced them as MISSING before this branch).
      if (t === "constructor_invocation" || t === "new_expression" || t === "const_object_expression") {
        const typeNode = this.findChildByType(n, "type_identifier")
        if (typeNode && isCapitalized(typeNode.text)) {
          relationships.push({
            source: callSource,
            target: typeNode.text,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            line_number: this.nodeLine(typeNode),
            metadata: { isConstructorInvocation: true },
          })
        }
      }

      // selector + argument_part = call site (Dart has no invocation_expression).
      // DT-A: the receiver chain decides construction vs call. `Foo.named()`
      // (capitalized head + in-file named ctor) and `p.Foo()` (prefix +
      // capitalized method) instantiate; static methods (`C.create()`) and
      // unknown cross-file `X.y()` stay leaf calls.
      if (t === "selector" && this.findChildByType(n, "argument_part")) {
        const { head, links } = this.invocationChain(n)
        if (links.length === 0) {
          const leafNode = this.resolveSelectorCalleeNode(n)
          const leaf = leafNode?.text ?? null
          if (leaf) {
            if (this.isDartGlobalBuiltin(leaf)) {
              // filtered
            } else if (isCapitalized(leaf) && this.selectorIsBareCall(n)) {
              // Capitalized identifier directly before argument_part = Dart
              // constructor invocation (types are capitalized): `Counter(1)`,
              // `MyWidget(...)`, `Duration(seconds: 1)`.
              relationships.push({
                source: callSource,
                target: leaf,
                type: ASTEngine.RelationshipType.Instantiates,
                confidence: 0.95,
                line_number: this.nodeLine(leafNode),
                metadata: {},
              })
            } else {
              // A bare callee inside a type body resolves to THAT type's member before it
              // resolves to a file-scope function of the same name (Dart's member scope
              // shadows the library scope), so the enclosing type is the owner — and it is
              // only written when the declaration is verifiable.
              //
              // A CALLEE can be a BINDING, not a declaration. `$default(_that)` is a real
              // invocation — freezed's generated `map`/`maybeMap` takes the mapping function
              // as a formal parameter named `$default` and calls it — and the family contract
              // publishes no locals. The label `isLocalRead` was added for exactly this and
              // the `calls` branch consulted `locals` for nothing, so the class was present
              // but UNCOUNTABLE: 138 `calls -> $default` rows and 50 `calls -> orElse` rows
              // over 4,788 corpus files, indistinguishable in any report from a call to a
              // method nobody declared.
              //
              // 2026-10-08 — the label was NOT enough, and the comment that used to sit here
              // ("the target binds to nothing a consumer holds") was FALSE about the string it
              // published. The store resolves a target by NAME and never reads the metadata:
              // `resolveRelationships` Strategy 2 admits a bare name declared exactly once in
              // the project, so `calls -> $default` binds to any single declaration of that
              // name, in any file. The target now carries `BINDING_SEP` and the `localBinding`
              // claim, so the spelling itself says "a binding" and cannot be a declaration's
              // name (see `src/ast/types.ts` and `local-read-phantom.ts`).
              const isBinding = locals.has(leaf)
              const q0 = isBinding ? { target: null, cause: null } : qualifiedTarget(owner, leaf)
              // THE LIBRARY-SCOPE REFINEMENT, applied only where Dart actually falls back to
              // library scope. A receiver-qualified member (`ext.frob()`) never binds to a
              // top-level `frob`, so the chain and selector arms keep their cause as written;
              // an unqualified callee does fall back, and the fallback is what the fourth case
              // names. Without this the cut would report a superclass outside the run for a
              // top-level function declared in the very same file.
              const q = q0.cause === "receiverMemberOutsideRun" && libraryScope.has(leaf)
                ? { target: null, cause: "libraryScopeCallee" }
                : q0
              relationships.push({
                source: callSource,
                target: q.target ?? (isBinding ? `${callSource}${BINDING_SEP}${leaf}` : leaf),
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.9,
                line_number: this.nodeLine(leafNode),
                // Metadata only, for the marker half. No row is added or removed and no
                // confidence moves, so this cannot change WHICH edges exist; it makes an
                // existing population queryable, which is what M14 §4 asks of a heuristic
                // edge.
                metadata: {
                  ...(isBinding ? { isLocalRead: true, localBinding: true } : {}),
                  ...(q.target ? { qualifier: "enclosing" } : {}),
                  // THE RECEIVER CUT, on the rows that stayed bare and only there — a row that
                  // resolved already says how it resolved (`qualifier`), and a binding has no
                  // receiver question to answer.
                  ...(isBinding ? {} : receiverCut(q)),
                },
              })
            }
          }
        } else {
          const method = links[links.length - 1]
          const before = links.length > 1 ? links[links.length - 2] : this.headNameText(head)
          const headText = this.headNameText(head)
          // The leaf of the chain is the node that NAMES the edge (a wrapped
          // `obj.\n method()` puts it on its own line).
          const calleeNode = n.previousNamedSibling ? this.lastIdentifierNode(n.previousNamedSibling) : null
          if (this.isDartGlobalBuiltin(method)) {
            // filtered
          } else if (
            links.length === 1 && isCapitalized(method) && headText !== null &&
            !isCapitalized(headText) && head !== null &&
            (head.type === "identifier" || head.type === "type_identifier")
          ) {
            // Prefix-qualified construction: `p.Foo(...)` builds Foo.
            relationships.push({
              source: callSource,
              target: method,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(calleeNode),
              metadata: { isNamedConstructor: true, isPrefixQualified: true },
            })
          } else if (
            before !== null && isCapitalized(before) && namedCtors.has(`${before}.${method}`)
          ) {
            // Named construction: `Foo.named()`, `P.Foo.bar()` (in-file).
            relationships.push({
              source: callSource,
              target: before,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(calleeNode),
              metadata: { isNamedConstructor: true },
            })
          } else {
            // KEEP THE QUALIFIER THE SOURCE WROTE (see `qualifiedTarget`). For a one-link
            // chain the owner is the head (`C.create()` -> C, `this.build()` -> this,
            // `super.go()` -> super); for a longer chain it is the link immediately before
            // the leaf, and a lowercase link (`a.b.c()`) does not name a type, so the
            // lookup refuses it and the target stays the bare leaf.
            const ownerCand = links.length > 1 ? before : headOwner(head, owner, localTypes)
            const ownMeta = links.length > 1 ? null : receiverOwnerMeta(head, owner, localTypes, localEvidence)
            const q = qualifiedTarget(ownerCand, method)
            relationships.push({
              source: callSource,
              target: q.target ?? method,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              line_number: this.nodeLine(calleeNode),
              // Same reason as the bare-call arm above: a leaf that the enclosing
              // function binds is a binding, and the row is labelled so a consumer
              // can tell it from a call to a declared member.
              //
              // 2026-10-08 — DELIBERATELY NOT re-spelled as a binding, and the reason is a
              // finding rather than an omission. This arm runs for a chain of TWO or more
              // links (`a.b.c()`), where the leaf is resolved against the RECEIVER, not
              // against the enclosing function: the `locals` set consulted here is the
              // enclosing function's, so `isLocalRead` on this arm answers a question about
              // the WRONG SCOPE whenever `links.length > 1`. The target cannot be re-spelled
              // to `#` for the same reason — for a chain the leaf may genuinely name a
              // declaration reachable through the receiver, and `qualifiedTarget` is the rule
              // that decides it. Named, not fixed: a one-link chain reaches the bare-call arm
              // above and IS re-spelled; the multi-link case needs its own measurement of how
              // often `locals.has(method)` is true where no receiver member exists.
              metadata: {
                ...(locals.has(method) ? { isLocalRead: true } : {}),
                ...(q.target ? { qualifier: "chain" } : {}),
                ...receiverCut(q),
                // THE STORE'S CHANNEL (see `receiverOwnerMeta`): the exactly-known receiver
                // type plus the evidence class. Additive — the target spelling above is
                // unchanged, so nothing here can move an edge.
                ...(ownMeta ?? {}),
              },
            })
          }
        }
      }

      // ANNOTATIONS — a type MENTION the lane published as payload only. Owner ruling
      // 2026-10-18 ("complete surface"): `@override`/`@JsonKey(...)`/`@deprecated` name a
      // declared type, and the type-usage graph must carry the edge. Before this branch the
      // names reached `decorators`/`metadata.annotations` and NOTHING in the relationship
      // channel — the same defect the Java lane's `annotation-references` fixture records.
      //
      // WHERE DART'S GRAMMAR DIFFERS FROM JAVA'S, measured by `annotation-shapes-probe.ts` in
      // this lane's fixture directory rather than assumed:
      //   * there is ONE annotation node (`annotation`); there is no `marker_annotation`;
      //   * the annotation node carries a `name` FIELD whose node is `identifier` or
      //     `scoped_identifier`, and type arguments/arguments are separate children
      //     (`@Generic<int>()` -> `(annotation name: (identifier) (type_arguments ...) (arguments))`);
      //   * the annotation sits in a DIFFERENT position per declaration kind: a CHILD of
      //     `class_definition`/`enum_declaration`, `enum_constant`, `formal_parameter` and
      //     `local_variable_declaration`, but a SIBLING of the declaration inside `class_body`
      //     and `program` (the `extractAnnotations` payload path already reads that sibling form).
      // The carrier helper below turns those positions into the name of the declaration the
      // annotation decorates, because the node alone cannot say WHAT is annotated.
      if (t === "annotation") {
        this.emitAnnotationReferences(n, relationships, current, owner, moduleName, importAliases)
      }

      // DT-F: member reads — a selector WITHOUT its own argument_part reads
      // its member (`obj.method` tear-off, `this.count`, `C.total`,
      // `a?.value`). The callee link (immediately followed by the
      // argument-carrying selector) belongs to the call; assignment-LHS
      // plain-`=` members are writes; builtins stay filtered. A capitalized
      // head with an in-file named ctor is a constructor tear-off
      // (`Foo.named` builds Foo — DT-A).
      if (t === "selector" && !this.findChildByType(n, "argument_part")) {
        const memberNode = this.linkMemberNode(n)
        const member = memberNode?.text ?? null
        if (member && !this.isDartGlobalBuiltin(member)) {
          const next = n.nextNamedSibling
          const nextIsArgs = !!next && next.type === "selector" && !!this.findChildByType(next, "argument_part")
          if (!nextIsArgs && !this.selectorIsLhsWrite(n)) {
            const head = n.previousNamedSibling
            const headText = this.headNameText(head)
            if (headText !== null && isCapitalized(headText) && namedCtors.has(`${headText}.${member}`)) {
              relationships.push({
                source: callSource,
                target: headText,
                type: ASTEngine.RelationshipType.Instantiates,
                confidence: 0.95,
                line_number: this.nodeLine(memberNode),
                metadata: { isNamedConstructor: true, isTearOff: true },
              })
            } else {
              // `Color.red`, `M.off`, `C.total`, `this.count`, `b.count` — the source
              // names the owner and the analyzer used to drop it (see `qualifiedTarget`).
              const ownMeta = receiverOwnerMeta(head, owner, localTypes, localEvidence)
              const q = qualifiedTarget(headOwner(head, owner, localTypes), member)
              relationships.push({
                source: callSource,
                target: q.target ?? member,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.9,
                line_number: this.nodeLine(memberNode),
                metadata: q.target
                  // THE CLAIM TRAVELS WITH THE SPELLING — see `apply-recv-spell.py` #4: this ternary
                  // consulted only `q.target`, so the claim was dropped the moment there was a
                  // target to spell.
                  ? { isMemberRead: true, qualifier: "head", ...receiverCut(q), ...(ownMeta ?? {}) }
                  : { isMemberRead: true, ...receiverCut(q), ...(ownMeta ?? {}) },
              })
            }
          }
        }
      }

      // A `qualified` name is the SAME member read as `identifier` + `selector`,
      // parsed the other way round, and only one of the two shapes was handled.
      //
      // `mode == M.off` parses as `equality_expression(identifier(M),
      // selector(.off))`, so the branch above reads the member and publishes
      // `uses source -> off`. `case M.off:` parses as a single `qualified` node
      // under a `constant_pattern`, so nothing read it: the string "qualified"
      // appeared NOWHERE in this analyzer, and a switch case naming a declared
      // enum member or constant published no edge of any kind — not `uses`, not
      // `references`, nothing. Measured over ProxiCall/lib: 78 such constant
      // patterns in 82 files, every one a false negative, led by
      // `case WalletOperationType.recipientLookup:` and
      // `case SessionOfflineBannerMode.offline =>`. The same text, the same
      // meaning, two node shapes, and only the common one was read.
      //
      // SCOPE, deliberately narrow. This fires only where a `qualified` sits
      // under a `constant_pattern`, which is unambiguous: it names a constant
      // being TESTED (`case M.off:`, `if (x case M.off)`). A `qualified` in a TYPE
      // position (`prefix.Type` in an annotation) is a different question — it
      // names a type, and whether that deserves a `uses` edge is a family
      // decision this lane has not made. Widening to every `qualified` would
      // answer that question by accident, so it stays open and visible.
      // DARTGAP2 (2026-10-18): the same pattern TEST in its RELATIONAL form (`x case >= M.off`)
      // parses with no wrapper node at all — the `qualified` is a direct child of the case/if
      // whose previous named sibling is the operator — so the original single-parent test missed
      // it. `isPatternTestConstant` is the ONE predicate for both shapes; it also refuses the
      // binding contexts the original test could not see (`var (a, b)` destructuring, `...rest`).
      if (t === "qualified" && this.isPatternTestConstant(n)) {
        const segs = n.text.split(".")
        const member = segs[segs.length - 1]
        // THE HEAD IS SPELLED THE WAY THE SOURCE WROTE IT, ARGUMENTS AND ALL. This site reads
        // the head off the NODE TEXT rather than through `headNameText`, so `GenericClass<int>.new`
        // arrives as `GenericClass<int>` — and every test below is a question about the type's
        // NAME, not its arguments: `isCapitalized`, the `namedCtors` lookup, `qualifiedTarget`
        // and the `baseBeyondRunScope` claim the last of those writes. Left unnormalized, the
        // claim went out as the non-identifier `GenericClass<int>` and the gate REFUTED three
        // rows for it (`causeFAIL` 3, dart-sdk, arm9) — the type was declared in each of the
        // three files, so the run held the very owner the claim said it could not reach.
        // Normalizing here means the tests and the claim all see `GenericClass`, which is the
        // name the declaration, the visibility set and the claim contract all speak.
        const head = segs.length > 1 ? typeNameWithoutArguments(segs[segs.length - 2]) : null
        if (member && !this.isDartGlobalBuiltin(member) && member !== head) {
          // A named constructor is still a construction: `case Foo.named:` tests
          // the constructor `Foo.named`, so it instantiates Foo (DT-A), the same
          // way the selector branch above treats a `Foo.named` tear-off.
          //
          // `.new` IS THE UNNAMED CONSTRUCTOR'S OWN SPELLING, and it takes the same arm. This
          // lane already states the rule: `isRealConstructor` decides "is this signature a
          // constructor" with `lead === "new" || lead === owner`, because the unnamed
          // constructor's name is `new` and a member may not be spelled that way. The parser
          // shows the same text as a construction one shape over — `case const
          // GenericClass<int>.new():`, the INVOCATION form — and that already publishes
          // `instantiates -> GenericClass` through the calls pass. Left on the member-read arm,
          // the tear-off spelling published `uses -> new`: a bare leaf no project declares and
          // no source wrote, while the identical constructor one bracket away published its
          // class. No visibility test is needed to read `X.new` as X's unnamed constructor:
          // `new` is a keyword reserved from member names, so that spelling has no other
          // reading. It carries its own flag rather than `isNamedConstructor` — that one would
          // be false here, and a consumer counting named constructions should not count this.
          if (head !== null && isCapitalized(head) && (namedCtors.has(`${head}.${member}`) || member === "new")) {
            relationships.push({
              source: callSource,
              target: head,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(n),
              metadata: member === "new"
                ? { isConstructorReference: true, isConstantPattern: true }
                : { isNamedConstructor: true, isConstantPattern: true },
            })
          } else {
            const q = qualifiedTarget(head, member)
            relationships.push({
              source: callSource,
              target: q.target ?? member,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: q.target
                ? { isMemberRead: true, isConstantPattern: true, qualifier: "pattern", ...receiverCut(q) }
                : { isMemberRead: true, isConstantPattern: true, ...receiverCut(q) },
            })
          }
        }
      }

      // DT-F+ (#752): BARE identifier member reads. The selector branch above
      // only sees dotted reads (`this.count`, `obj.count`), so a plain
      // `return count;` on a declared field emitted NOTHING (probe-confirmed:
      // uses edges on x = 0). Mirrors java #739 / javascript #744. Gate A: the
      // name must resolve to a DECLARED MEMBER of the enclosing type; gate B:
      // it must not be a local/param of the current function.
      if (t === "identifier") {
        const txt = n.text
        const ptype = n.parent?.type ?? ""
        const memberLink =
          ptype === "unconditional_assignable_selector" ||
          ptype === "conditional_assignable_selector" ||
          ptype === "cascade_selector" ||
          ptype === "selector"
        // A bare callee head (`go(n)`) is a CALL, not a value read — the
        // argument-carrying selector owns it (the calls branch above).
        const next = n.nextNamedSibling
        const nextIsCall = !!next && next.type === "selector" &&
          !!this.findChildByType(next, "argument_part")
        const declName = this.isDartDeclNameParent(ptype) || this.isDartDeclaredName(n)
        const isWrite = this.selectorIsLhsWrite(n)
        // DT2: labels (`cb:`), label definitions and control-transfer
        // targets (`break outer`) name, never read.
        const isLabel = ptype === "labeled_statement" || ptype === "break_statement" ||
          ptype === "continue_statement"
        // DT2: field-initializer targets (`: x = v`) bind the field —
        // only the value reads. The target is the first named child.
        const isFieldInitTarget = ptype === "field_initializer" && (() => {
          const first = n.parent?.namedChild(0)
          return !!first && first.startIndex === n.startIndex && first.endIndex === n.endIndex
        })()
        // ANNOTATION NAMES ARE NOT VALUE READS. `@override`/`@JsonKey` publish their own
        // `references` row (see `emitAnnotationReferences`); the identifier inside the
        // annotation node is the type NAME, not a read of it, and the alias leaf of
        // `@prefix.Foo` is not a read either. Without this gate a top-level function whose
        // name coincided with an annotation's name could publish a `uses` row for it.
        const isAnnotationName = ptype === "annotation" ||
          (ptype === "scoped_identifier" && n.parent?.parent?.type === "annotation")
        // DT2: `this`/`super` are keyword receivers, never value reads
        // (verified non-identifier in the pinned grammar; belt and braces).
        if (txt === "this" || txt === "super") {
          // fall through to no arm (silent)
        } else if (
          !memberLink &&
          !nextIsCall &&
          !declName &&
          !isWrite &&
          !isLabel &&
          !isFieldInitTarget &&
          !isAnnotationName
        ) {
          const isDeclaredMember = !!owner && (membersByOwner.get(owner)?.has(txt) ?? false)
          if (!locals.has(txt) && isDeclaredMember) {
            // The enclosing type DECLARES this member (that gate is unchanged — an
            // inherited bare read still emits no edge, which is a separate question from
            // what the edge is CALLED), so the owner is known and the qualified name is
            // checkable against what this file publishes.
            const q = qualifiedTarget(owner, txt)
            relationships.push({
              source: callSource,
              target: q.target ?? txt,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.6,
              line_number: this.nodeLine(n),
              metadata: q.target
                ? { isBareRead: true, qualifier: "enclosing", ...receiverCut(q) }
                : { isBareRead: true, ...receiverCut(q) },
            })
          } else if (locals.has(txt)) {
            // DT2: bound locals/params read as values (OC-E parity).
            // Exact scope resolution — confidence 0.9, lane-compared.
            //
            // 2026-10-08 — the target is the BINDING's spelling, not the bare name. The
            // analyzer has positively resolved `txt` to a binding here, and a binding is not a
            // declaration: no symbol exists for it (DARTD8), so no lookup can ever be right,
            // while the store's bare-name rule (Strategy 2, `cnt = 1`, metadata unread) binds
            // the bare name to whatever single declaration happens to carry it. Measured: a
            // function's own `counter` bound to an unrelated class's field named `counter`, in
            // another file (validation/m14/fixtures/dart/local-read-phantom.ts). The
            // separator makes the target unspeakable as a declaration, and the `localBinding`
            // claim is what the arbiter checks (`verifyBindingClaim`).
            relationships.push({
              source: callSource,
              target: `${callSource}${BINDING_SEP}${txt}`,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              // A read of a PARAMETER is a binding too: `locals` holds the function's bound
              // names (parameters and `var`s alike), which is why both land here.
              metadata: { isLocalRead: true, localBinding: true },
            })
          } else if (this.isPatternTestConstant(n)) {
            // DARTGAP2 — THE CONSTANT A PATTERN TESTS.
            //
            // `case kOne:` / `if (x case kOne)` / `case kNested?` / `case kOne!` /
            // `case >= kOne` / `case [kOne, 2]` / `case {'a': kOne}` / `case (kOne, 2)`:
            // every one of these is a READ of a constant, and every one was SILENT before this
            // branch. The reason is the order of the arms below: a bare identifier fall through
            // `isDeclaredMember` (no — a pattern test is not a member), `locals` (no — a constant
            // pattern does not name a local; the binding forms parse as `variable_pattern`, which
            // this predicate refuses), `topLevelValues` (only when the constant happens to be
            // declared in THIS file). A constant imported from another library therefore published
            // nothing at all, while the same text in an expression position published `uses`
            // through the top-level-value arm.
            //
            // THE TARGET IS THE NAME THE SOURCE WROTE, at the same 0.9 the qualified-constant
            // branch uses (3d4d7fa4): a pattern test is an ordinary value read of a constant, and
            // the project's own resolver decides whether that name has exactly one declaration.
            // `isConstantPattern` is the flag the closed qualified arm already carries (the mutant
            // battery keys on it); `isPatternTest` says this row came from a TEST position rather
            // than a `qualified` member spelling. No claim is attached: a pattern test can only
            // name something, so there is no unreachable owner to declare.
            //
            // A LOCAL named by a pattern test is handled ABOVE this branch (the `locals` arm) and
            // keeps the family's binding spelling `<callable>\\u0000<binding>` — a local constant is
            // still a binding, and spelling it as a bare declaration name is the phantom link
            // `local-read-phantom.ts` exists to prevent.
            relationships.push({
              source: callSource,
              target: txt,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: { isConstantPattern: true, isPatternTest: true },
            })
          } else if (!isDeclaredMember && topLevelValues.has(txt)) {
            // DT2: file-scope values read as values. Members shadow
            // globals (checked above); locals shadow both (checked above).
            relationships.push({
              source: callSource,
              target: txt,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: { isGlobalRead: true },
            })
          }
        }
      }

      // DT-D: constructor redirection in initializer lists — `B() : super(1)`,
      // `B.named() : super.named(2)` construct the superclass (resolved,
      // alias-free); `B() : this.named(x)` constructs the own class.
      if (t === "initializer_list_entry") {        let headIsSuper = false
        let headIsThis = false
        // The `super`/`this` HEAD token is the node that names the destination
        // class of the redirection (M60 line contract).
        let headNode: Node | null = null
        const firstRaw = n.child(0)
        if (firstRaw && !firstRaw.isNamed && (firstRaw.text === "super" || firstRaw.text === "this")) {
          headIsSuper = firstRaw.text === "super"
          headIsThis = firstRaw.text === "this"
          headNode = firstRaw
        } else {
          const firstNamed = n.namedChild(0)
          if (firstNamed && (firstNamed.type === "super" || firstNamed.type === "this")) {
            headIsSuper = firstNamed.type === "super"
            headIsThis = firstNamed.type === "this"
            headNode = firstNamed
          }
        }
        if (headIsSuper && owner) {
          const base = superByClass.get(owner)
          if (base) {
            relationships.push({
              source: callSource,
              target: base,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(headNode),
              metadata: { isSuperConstructor: true },
            })
          }
        } else if (headIsThis && owner) {
          relationships.push({
            source: callSource,
            target: owner,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            line_number: this.nodeLine(headNode),
            metadata: { isRedirectingConstructor: true },
          })
        }
      }

      // DT-D (continued): `this.named(...)` redirects parse as a `redirection`
      // node (`:` `this` `.` `named` `arguments`) rather than an initializer
      // entry. Same targets: this -> own class, super -> superclass.
      if (t === "redirection" && owner) {
        let rSuper = false
        let rThis = false
        let headTok: Node | null = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "this") { rThis = true; headTok = c; break }
          if (c.type === "super") { rSuper = true; headTok = c; break }
          if (c.type === "identifier" || c.type === "type_identifier" || c.type === "arguments") continue
          break
        }
        if (rSuper) {
          const base = superByClass.get(owner)
          if (base) {
            relationships.push({
              source: callSource,
              target: base,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              line_number: this.nodeLine(headTok),
              metadata: { isSuperConstructor: true },
            })
          }
        } else if (rThis) {
          relationships.push({
            source: callSource,
            target: owner,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            line_number: this.nodeLine(headTok),
            metadata: { isRedirectingConstructor: true },
          })
        }
      }

      // DT-F: subscript bases (`xs[0]`, `xs?[0]`, `m['k']`) — the grammar
      // parses the index as a bare `selector` sibling holding `[`
      // (no assignable member, no argument_part). An index operation
      // presupposes a value, so the base reads without inventory.
      // Declaration names (`int xs[3]`) bind, never read.
      if (t === "identifier") {
        const parent = n.parent
        const ptype = parent?.type ?? ""
        if (!this.isDartDeclNameParent(ptype) && ptype !== "label" && !this.isDartDeclaredName(n)) {
          const nx = n.nextNamedSibling
          if (nx && ((nx.type === "selector" && this.isIndexSelector(nx)) || this.isIndexAssignable(nx))) {
            relationships.push({
              source: callSource,
              target: n.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: { isSubscriptBase: true },
            })
          } else if (this.isInsideTemplateSubstitution(n)) {
            // DT-F: string interpolation reads (`'hello $name'`,
            // `'sum ${n + 1}'`) — every bare identifier inside a template
            // substitution is evaluated. Declaration-shaped names still bind.
            //
            // A LOCAL INSIDE THE INTERPOLATION IS A BINDING, AND THIS ARM WAS NOT
            // ASKING. Every other read arm in this pass consults `locals` before it
            // publishes, and publishes the family's binding spelling
            // (`<callable>\u0000<binding>`) when the name is one. This arm did not,
            // so a local read inside `'...'` was published as a BARE name — and a bare
            // name is a DECLARATION's spelling, which the store resolves by name
            // against whatever single declaration happens to carry it.
            //
            // MEASURED (proxicall, whole project, `--index` arm): **2,777 rows** of
            // `uses -> _temp0` unresolved, every one of them a local declared
            // `String _temp0 = intl.Intl.pluralLogic(...)` in the SAME function and
            // read back inside the interpolation `'$_temp0'`
            // (`lib/l10n/generated/app_localizations_ar.dart` and its siblings —
            // the intl pluralization the Flutter gen-l10n tooling emits). The read is
            // a local read; the row said it was a name the project must declare.
            //
            // WHY IT MATTERS BEYOND THE COUNT: the bare spelling is not merely
            // unresolved, it is RESOLVABLE-BY-MISTAKE. The store's bare-name rule
            // admits a bare name declared exactly once in the project, so a local
            // named `_temp0` could bind to an unrelated declaration named `_temp0` —
            // the `local-read-phantom.ts` failure, reached through a different door.
            //
            // The fix is the one the other arms already implement: consult `locals`
            // and publish the binding spelling when the name is bound here. NOTHING
            // else moves — the row count, the line, the confidence and the
            // `isInterpolationRead` marker are all unchanged, and a name the file
            // does not bind still publishes the bare row exactly as before.
            const isLocal = locals.has(n.text)
            relationships.push({
              source: callSource,
              target: isLocal ? `${callSource}${BINDING_SEP}${n.text}` : n.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(n),
              metadata: isLocal
                ? { isInterpolationRead: true, isLocalRead: true, localBinding: true }
                : { isInterpolationRead: true },
            })
          }
        }
      }

      // DT-F: `$name` interpolation placeholder (distinct node type).
      if (t === "identifier_dollar_escaped") {
        const raw = n.text
        const name = raw.startsWith("$") ? raw.slice(1) : raw
        if (name) {
          // THE SAME LOCAL QUESTION AS THE ARM ABOVE. A `$name` placeholder reads a
          // local exactly as a bare identifier inside `'${...}'` does, and this arm was
          // not asking either. The binding spelling is what keeps a local read from
          // being resolved by name against an unrelated declaration — see the
          // `isInterpolationRead` arm above for the measurement (2,777 rows on
          // proxicall's whole project).
          const isLocal = locals.has(name)
          relationships.push({
            source: callSource,
            target: isLocal ? `${callSource}${BINDING_SEP}${name}` : name,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            line_number: this.nodeLine(n),
            metadata: isLocal
              ? { isInterpolationRead: true, isLocalRead: true, localBinding: true }
              : { isInterpolationRead: true },
          })
        }
      }
      // DARTD17: `b..a.b.c(1)` — the cascade_selector names only the FIRST
      // segment (`a`); the deeper chain lives in nested
      // unconditional_assignable_selector children (probed cascade-shape.ts).
      // DARTD18 (OO family closure): a cascade_section may carry SEVERAL
      // invocations (`..transform(x)..listen(y)` = one section holding two
      // selector+argument_part pairs). One call is emitted per selector that
      // is IMMEDIATELY followed by its own argument_part sibling — so
      // `..headers.addAll(x)` calls addAll (headers is a bare getter, no
      // args), and multi-invocation sections call every method, not just the
      // last (dart-http corpus: echo_server's `..transform(..)..listen(..)`
      // previously dropped the transform call).
      // DT-F: selectors NOT followed by an argument_part are getter reads
      // (`..length` → uses->length), unless the section assigns (`..b = 1`
      // writes b — gated on a direct anonymous `=` child).
      if (t === "cascade_section") {
        let sectionAssigns = false
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && c.text === "=") { sectionAssigns = true; break }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type !== "cascade_selector" && c.type !== "unconditional_assignable_selector" &&
              c.type !== "conditional_assignable_selector" && c.type !== "selector") continue
          const next = n.namedChild(i + 1)
          if (next && next.type === "argument_part") {
            const idNode = this.lastIdentifierNode(c)
            const id = idNode?.text ?? null
            if (id && !this.isDartGlobalBuiltin(id)) {
              relationships.push({
                source: callSource,
                target: id,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.9,
                line_number: this.nodeLine(idNode),
                metadata: { isCascade: true },
              })
            }
          } else if (!sectionAssigns) {
            const idNode = this.lastIdentifierNode(c)
            const id = idNode?.text ?? null
            if (id && !this.isDartGlobalBuiltin(id)) {
              relationships.push({
                source: callSource,
                target: id,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.9,
                line_number: this.nodeLine(idNode),
                metadata: { isMemberRead: true, isCascade: true },
              })
            }
          }
        }
      }

      // `references`: the declaration mentions a TYPE. Collected here, on the one
      // traversal that knows the enclosing declaration — see `collectTypeMention`.
      if (t === "type_identifier") {
        this.collectTypeMention(n, callSource, relationships, visibleTypes, fileTypes)
      }

      // What this node's children inherit. `current`/`owner` are this node's resolved
      // values and `childLocals`/`childInsideCollected` its merged sets — exactly the four
      // arguments the recursive form passed down.
      return [current, owner, childLocals, childLocalTypes, childLocalEvidence, childLocalElements, childInsideCollected]
    }

    /**
     * The walk: a PREORDER descent over an explicit stack.
     *
     * Same traversal, same order, no call frames. The order is load-bearing rather than
     * tidy, which is why children are pushed in reverse so `pop()` yields them
     * left-to-right: the body reads `previousNamedSibling` and compares `current === prev`
     * (the sibling-signature rule), so a different visit order would change what the
     * analyzer reports on ordinary code, not just on this fixture.
     */
    const processNode = (
      root: Node,
      current: string | null,
      owner: string | null,
      locals: Set<string>,
      localTypes: Map<string, string>,
      localEvidence: Map<string, string>,
      localElements: Map<string, string>,
      insideCollected: boolean,
    ): void => {
      const work: Array<[Node, string | null, string | null, Set<string>, Map<string, string>, Map<string, string>, Map<string, string>, boolean]> = [
        [root, current, owner, locals, localTypes, localEvidence, localElements, insideCollected],
      ]
      while (work.length > 0) {
        const [n2, cur, own, loc, types, evid, elems, inside] = work.pop()!
        const [cur2, own2, loc2, types2, evid2, elems2, inside2] = visitNode(n2, cur, own, loc, types, evid, elems, inside)
        // MATERIALISE THE CHILD LIST ONCE, then iterate it. Indexing `n2.namedChild(i)` in
        // a loop is a trap rather than a style choice, and it is the reason this file cost
        // 7.6 minutes: `node --cpu-prof` on a 31,905-node slice put **92% of the run inside
        // tree-sitter's own accessors** (`ts_node__child` 63.8%, `ts_node_child_with_descendant`
        // 28.3%) and only 0.3% in this analyzer's JavaScript. web-tree-sitter 0.25 returns a
        // FRESH wrapper on every property access, so the child list cached on a wrapper is
        // built and discarded per iteration — the sql lane recorded the same mechanism at
        // `real-sql-analyzer.ts` ("every property access returns a FRESH wrapper", verified:
        // `namedChild(0) === namedChild(0)` is false, `.id` is equal).
        //
        // `namedChildren` builds that list ONCE for this node, which is the whole fix; the
        // walk stays a preorder in child order because the array is pushed in reverse.
        const kids: (Node | null)[] = n2.namedChildren ?? []
        for (let i = kids.length - 1; i >= 0; i--) {
          const child = kids[i]
          if (child) work.push([child, cur2, own2, loc2, types2, evid2, elems2, inside2])
        }
      }
    }

    processNode(node, null, null, new Set<string>(), new Map<string, string>(), new Map<string, string>(), new Map<string, string>(), false)
  }

  // ============================================================================
  // `references` — A DECLARATION MENTIONS A TYPE
  // ============================================================================

  /**
   * One type mention, read off ONE node. No recursion, no state: everything it
   * needs (`source`, the type set, the row sink) arrives as an argument, so the
   * rule below is the whole rule and a reader does not have to reconstruct a walk
   * to know what a `references` edge claims.
   *
   * ## WHAT IS CLAIMED
   *
   * `X references T` means: the declaration `X` names the type `T` in a TYPE
   * POSITION, and `T` binds to a type declaration this run can see.
   *
   * Dart is statically typed, and a type position is a grammatical position, not
   * a convention — the grammar has a dedicated node (`type_identifier`) that never
   * appears where a value identifier appears. So the mention is a PARSE FACT, not
   * a name-shape guess. What is not a parse fact is the BINDING of that name to a
   * declaration, which is why the edge is published only when the name resolves
   * and carries 0.95 rather than 1.0 — the same derivation `instantiates` is
   * published at, for the same reason (a syntactic role plus a resolved name).
   *
   * ## WHY RESOLUTION IS A GATE AND NOT A REPORT
   *
   * Measured over 1,000 corpus files across 5 repositories: 75,769 type mentions
   * outside heritage clauses, of which 3,460 (4.57%) name a type the same file
   * declares. The other 95.43% name `String`, `Widget`, `Future` — real types, in
   * `dart:core` and the Flutter SDK, declared in files this per-file run has not
   * read. Publishing those would make the label mostly a list of SDK types, at
   * ~22x the edge count, and every one of them an endpoint no symbol in the index
   * can bind. A narrow graph that is true beats a wide graph that is not, so the
   * unresolvable majority is deliberately unread, and the number is stated rather
   * than left to be discovered downstream.
   *
   * A `projectIndex` widens the gate to every type the run can see
   * (`src/ast/project-index.ts` `typeKinds`), which is how the differential's
   * `--dart-deps=direct` runs measure more than production does. Production does
   * not supply one for `.dart`: `parallel-indexer.ts` `PROJECT_INDEX_EXTENSIONS`
   * names only `.sol`. So the published set is file-local in production and grows
   * with an index — recorded per row in `isIndexResolved` so the two answers are
   * distinguishable in the store rather than conflated.
   *
   * ## WHAT IS NOT A REFERENCE
   *
   * Measured parent-position inventory (the probe that produced it is
   * `validation/m14/fixtures/dart/type-position-probe.ts`):
   *
   *   published — formal_parameter, normal_parameter_type, super_formal_parameter,
   *     constructor_param (a `this.x` parameter's type), function_signature /
   *     getter_signature / setter_signature / operator_signature (return types),
   *     type_arguments (`List<T>`, `Map<K,V>`), function_type, record_type_field,
   *     type_cast (`as T`), type_test (`is T`), try_statement (`on T catch`),
   *     initialized_variable_definition, typed_identifier, for_loop_parts,
   *     declaration (a field's type), program (a top-level `const String x`),
   *     qualified (the LEAF of `prefix.Type`), constructor_tearoff (`http.Client`
   *     used as a value), extension_declaration (`on T`), representation_declaration
   *     (an extension type's representation type), type_alias (`typedef A = B`),
   *     type_bound (`<T extends B>`), object_pattern / variable_pattern / cast_pattern
   *     (a Dart 3 pattern's type), record_type.
   *
   *   NOT published, each for a stated reason:
   *     superclass / interfaces / mixins / mixin_declaration / mixin_application —
   *       heritage already publishes `extends` / `implements` / `uses`, and a second
   *       label for the same fact double-counts it.
   *     new_expression / const_object_expression / constructor_invocation /
   *       redirecting_factory_constructor_signature — construction already publishes
   *       `instantiates`.
   *     type_parameter — `class Box<T>` DECLARES a type variable; it does not
   *       mention a type. A mention of `T` inside that class resolves to the type
   *       VARIABLE, which is what `isTypeParameterShadowed` refuses.
   *     ERROR — nothing inside a parse-error region is a fact about a well-formed
   *       program, and this analyzer's error policy is to publish what survived the
   *       parse, not what the recovery invented.
   *
   * The last one is the reason this method checks the PARENT at all: in this
   * grammar `type_identifier` only ever appears in a type position, so the node
   * type alone would publish the double-counted positions above.
   */
  private collectTypeMention(
    n: Node,
    source: string,
    relationships: ASTEngine.UniversalRelationship[],
    visibleTypes: Set<string>,
    fileTypes: Set<string>,
  ): void {
    const parent = n.parent
    const position = parent ? parent.type : ""
    if (DART_TYPE_MENTION_DOUBLE_COUNTED.has(position)) return

    // A `type_identifier` under a `qualified` name is ALWAYS the type, and the
    // node's own text is that type: `prefix.Type` carries `prefix` as an
    // `identifier` sibling, and `Type.member` carries `member` as one — so there is
    // nothing to strip, and the import alias is never in this branch (DAD1/DT-B).
    //
    // The first version of this read the leaf off the `qualified` NODE instead,
    // which returns null for a `type_identifier` — so every prefixed type mention
    // (`c.List<int>`, `E2.one` in a constant pattern) was silently dropped. The
    // battery in script/m14/verify-dart-references.ts caught it as a missing
    // EXPECTED row on both sides, which is the one class of defect two
    // implementations of one rule share.
    const name = n.text
    if (!name || name === IMPLICIT_DYNAMIC_TYPE) return
    // SELF-REFERENCE IS NOT A DEPENDENCY.
    if (name === source) return
    // THE SUBJECT OF AN UNNAMED EXTENSION IS NOT A MENTION ITS BODY MAKES.
    //
    // `extension on Z3 {}` is published as `unnamed_extension_Z3`, so the `on Z3` mention
    // would read `unnamed_extension_Z3 references Z3` — an edge whose SOURCE is a name the
    // store does not keep (`isIndexArtifactName` drops the synthesized prefix). The subject
    // is already published as the extension's OWN identity (`metadata.targetType`), so the
    // edge would add a source no index can resolve and nothing a reader cannot read off the
    // declaration itself.
    //
    // A NAMED extension keeps its edge: `extension M on M2 {}` still reads `M -> M2`, pinned
    // by `verify-dart-references.ts` ("a NAMED extension's target").
    if (this.isUnnamedExtensionSubject(n)) return
    if (!visibleTypes.has(name)) return
    // A mention of a TYPE VARIABLE resolves to the variable, not to a type that
    // happens to share its spelling. Ancestor-walked rather than tracked in the
    // scope set, because it runs only for names that already resolved (measured:
    // 4.57% of mentions), so the walk costs nothing on the other 95%.
    if (this.isTypeParameterShadowed(n, name)) return

    relationships.push({
      source,
      target: name,
      type: ASTEngine.RelationshipType.References,
      confidence: 0.95,
      line_number: this.nodeLine(n),
      metadata: {
        isTypeMention: true,
        typePosition: position,
        isIndexResolved: !fileTypes.has(name),
      },
    })
  }

  /**
   * Is `name` bound by a TYPE PARAMETER of an enclosing declaration?
   * `class Box<T> { T value; }` — `T` here is the type variable the class
   * introduced, so the mention is not a reference to a declared type even when
   * something in the project is also called `T`.
   */
  private isTypeParameterShadowed(n: Node, name: string): boolean {
    let cur: Node | null = n.parent
    let guard = 0
    while (cur && guard++ < 32) {
      const tp = this.findChildByType(cur, "type_parameters")
      if (tp) {
        for (let i = 0; i < tp.namedChildCount; i++) {
          const c = tp.namedChild(i)
          if (!c || c.type !== "type_parameter") continue
          // The parameter's TEXT SPANS ITS BOUND. `class Box<T extends Wallet>` is
          // ONE `type_parameter` node whose `type_bound` is a child of it, so
          // `c.text` is `"T extends Wallet"` — and comparing that against `T` never
          // matches, so the gate declined every CONSTRAINED type variable, which is
          // the common case. Measured on a 9-line reproduction with the file's own
          // `class T {}` present: this published `Box -> T`, `get -> T` and
          // `put -> T`, three edges that resolve — at the WRONG declaration, since
          // `T` inside `Box` is the variable and the class is something else.
          const declared = c.childForFieldName?.("name")?.text ??
            this.findChildByType(c, "type_identifier")?.text
          if (declared === name) return true
        }
      }
      cur = cur.parent
    }
    return false
  }

  // ============================================================================
  // CLASS HERITAGE
  // ============================================================================

  private extractClassHeritage(
    node: Node,
    className: string,
    relationships: ASTEngine.UniversalRelationship[],
    patterns: Record<string, boolean>,
  ): void {
    // Mixin application class: `class A = Base with M;` — the base + mixins
    // live in a mixin_application node (no superclass node). The base is
    // `extends`; the with-clause mixins are `mixes_in` (canonical vocabulary,
    // 2026-10-18 — they were `uses{isMixin:true}`, an ad-hoc flag on a label that
    // also means every other type mention the file makes).
    const mixinAppCls = this.findChildByType(node, "mixin_application_class")
    if (mixinAppCls) {
      const app = this.findChildByType(mixinAppCls, "mixin_application")
      if (app) {
        const baseNode = this.resolvedHeritageNodes(app)[0] ?? null
        if (baseNode) {
          relationships.push({
            source: className,
            target: baseNode.text,
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            line_number: this.nodeLine(baseNode),
            metadata: {},
          })
        }
        const mx = this.findChildByType(app, "mixins")
        if (mx) {
          patterns["Mixins"] = true
          // DT-B: resolved (alias-free) mixin names — `with _i2.M` leaked
          // the alias as a mixin use.
          for (const ti of this.resolvedHeritageNodes(mx)) {
            relationships.push({
              source: className,
              target: ti.text,
              type: ASTEngine.RelationshipType.MixesIn,
              confidence: 1.0,
              line_number: this.nodeLine(ti),
              metadata: { isMixin: true },
            })
          }
        }
      }
    }

    // DARTD14: mixin `on`-base — `mixin M on Base implements I` parses the
    // on-base as a DIRECT type_identifier child of mixin_declaration (probed
    // dart-mixin-shape.ts: [mixin, identifier, type_identifier, interfaces]).
    // The superclass/interfaces branches below never see it. DT-B: resolved
    // (alias-free) names — `on _i1.Base` leaked the alias as the base.
    //
    // 2026-10-18 — THIS IS NOT `extends` (and not `mixes_in` either). `on` is a
    // CONSTRAINT on what may be mixed in, not an inheritance edge and not an
    // application of `Base`: the mixin declares a requirement about its host.
    // The family vocabulary now has both members, so leaving it on `extends` would
    // put two different Dart facts on one label. It publishes as `references` —
    // the mixin's declaration mentions the constraining type — with the original
    // `isMixinOn` flag retained so a reader can still pick the clause out.
    if (node.type === "mixin_declaration") {
      const onNodes = this.resolvedHeritageNodes(node).filter((n) => n.text !== className)
      for (const baseNode of onNodes) {
        relationships.push({
          source: className,
          target: baseNode.text,
          type: ASTEngine.RelationshipType.References,
          confidence: 1.0,
          line_number: this.nodeLine(baseNode),
          metadata: { isMixinOn: true, isTypeMention: true, typePosition: "mixin_on_clause" },
        })
      }
    }

    // superclass: `extends X with M1, M2` — the resolved base is the first
    // RESOLVED heritage name (DAD1: the first raw type_identifier is often an
    // import-alias prefix); the `mixins` child carries the with-clause.
    const superclass = this.findChildByType(node, "superclass")
    if (superclass) {
      const baseNode = this.resolvedHeritageNodes(superclass)[0] ?? null
      if (baseNode) {
        relationships.push({
          source: className,
          target: baseNode.text,
          type: ASTEngine.RelationshipType.Extends,
          confidence: 1.0,
          line_number: this.nodeLine(baseNode),
          metadata: {},
        })
      }
    }
    // interfaces: `implements A, B<C>` — resolved names only (DAD2: alias
    // prefixes `_i2.Database` must not emit `_i2` as an interface target).
    const interfaces = this.findChildByType(node, "interfaces")
    if (interfaces) {
      for (const ti of this.resolvedHeritageNodes(interfaces)) {
        relationships.push({
          source: className,
          target: ti.text,
          type: ASTEngine.RelationshipType.Implements,
          confidence: 1.0,
          line_number: this.nodeLine(ti),
          metadata: { isImplements: true },
        })
      }
    }

    // mixins (with-clause): inside superclass OR directly on the class.
    // CANONICAL `mixes_in` since 2026-10-18 — one row per applied mixin, same
    // source/target/line the ad-hoc `uses{isMixin:true}` row carried. The
    // EXTENDS base and the IMPLEMENTS list are emitted by their own branches
    // above and never reach this one, which is what makes the three heritage
    // kinds distinguishable in the store instead of all wearing `uses`.
    let mixinsNode = superclass ? this.findChildByType(superclass, "mixins") : undefined
    if (!mixinsNode) mixinsNode = this.findChildByType(node, "mixins")
    if (mixinsNode) {
      patterns["Mixins"] = true
      // DT-B: resolved (alias-free) mixin names (same `_i2.M` leak as above).
      for (const ti of this.resolvedHeritageNodes(mixinsNode)) {
        relationships.push({
          source: className,
          target: ti.text,
          type: ASTEngine.RelationshipType.MixesIn,
          confidence: 1.0,
          line_number: this.nodeLine(ti),
          metadata: { isMixin: true },
        })
      }
    }
  }

  // ============================================================================
  // EVIDENCE TIERS
  // ============================================================================

  /**
   * Evidence-tier classification (family contract — mirrors csharp/java/rust;
   * M14 section D requires >=2 distinct evidenceClass values). Same rules as
   * the managed-OO family: structural (grammar clauses, conf 1.0) |
   * usage_contextual (calls, mixin uses) | import_based (import/export/part
   * directives) | inferred (confidence < 1 edges).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      if (type === "imports" || type === "exports") { md.evidenceClass = "import_based"; continue }
      // `part_of` is a DIRECTIVE: the same tier as imports/exports, not the
      // usage tier the default below would give it. Caught by the tier census,
      // not by assumption: without this line every part_of row would be filed
      // `usage_contextual` while it is a statement about the file graph.
      if (type === "part_of") { md.evidenceClass = "import_based"; continue }
      // `mixes_in` is a GRAMMAR CLAUSE with confidence 1.0 — the same tier as
      // extends/implements, which it replaces on the with-clause.
      if (type === "mixes_in") { md.evidenceClass = "structural"; continue }
      if (type === "calls" || type === "uses") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "overrides") { md.evidenceClass = "structural"; continue }
      // `references` is a MENTION in a type position (a parse fact) bound to a
      // declaration by name (not a parse fact), so it is `usage_contextual` — the
      // same tier `calls` gets — and never `structural`: claiming the binding is
      // structural would overstate it, since a per-file run cannot see the other
      // files that declare most Dart types.
      if (type === "references") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * The library this file declares: its name, the node that declared it, and which of
   * the three directive forms it was.
   *
   * `library X;` names the library X. No `library` directive means the file is an
   * implicit library named by its stem (Dart spec). `library;` — legal, and 101 of a
   * 3,000-file sample — declares a library with NO name, so the stem there is this
   * analyzer's convention and the caller records it as `kind: "unnamed"` rather than
   * letting a consumer read it as a declared fact.
   *
   * The declared name is read from the parse tree, never from a regex over the text,
   * because it is frequently DOTTED: `_fe_analyzer_shared.scanner.characters`, which a
   * first-token match truncates to `_fe_analyzer_shared` — a name no other file imports.
   * The corpus measurement that established the three frequencies and the `annotation`
   * case is `validation/m14/fixtures/dart/library-directive-census.ts`; the
   * `annotation` case is why the child must pass an IDENTIFIER shape test rather than
   * being taken as text.
   *
   * Only a DIRECT child of `program` is considered: a `library_name` anywhere else in
   * the tree is a declaration inside a part or a raw string (52 of 3,000 sampled files
   * carry `library X;` inside a `'''...'''` test fixture, which is not a directive at
   * all), not this file's library. Measured: no sampled file has more than one
   * top-level `library_name`, so "first valid" is not a choice between two candidates.
   */
  private libraryName(rootNode: Node, filePath: string): { name: string; directive: Node | null; kind: DartLibraryDirective } {
    const stem = path.basename(filePath, path.extname(filePath))
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i)
      if (!child || child.type !== "library_name") continue
      // An EMPTY `library_name` is the unnamed `library;` directive. Measured: 101 of
      // 3,000 files, and 0 of them declare a name anywhere else.
      if (child.namedChildCount === 0) return { name: stem, directive: child, kind: "unnamed" }
      for (let j = 0; j < child.namedChildCount; j++) {
        const nameNode = child.namedChild(j)
        if (!nameNode) continue
        // Inner whitespace is stripped before the shape test: the grammar's
        // `dotted_identifier_list` accepts `library a . b ;`, and at 600 files 2 of the
        // declared names are written that way — so testing the raw text rejected 2 real
        // library names that the parse tree had already handed over.
        // Strip whitespace by scanning, not by regex — this lane is at ZERO regex and the
        // census gate caught this reintroduced twice now.
        const declared = stripWhitespace(nameNode.text)
        // A declared name is an identifier possibly joined by `.` — anything else is
        // not a library name. Measured: 15 of 3,000 files put an `annotation`
        // (`@TestOn('vm')`) where the name goes, and this test is what keeps an
        // annotation from becoming a node.
        if (declared.length > 0 && isDottedIdentifier(declared)) {
          return { name: declared, directive: child, kind: "named" }
        }
      }
    }
    return { name: stem, directive: null, kind: "implicit" }
  }

  private isDartGlobalBuiltin(name: string): boolean {
    // Global functions (filtered) + Object leaf methods (mirrors the JS
    // family contract: `toString`, `hashCode`, ... are universal, not real
    // project call targets).
    if (name === "print" || name === "assert" || name === "identical") return true
    if (name === "toString" || name === "hashCode" || name === "runtimeType" || name === "noSuchMethod") return true
    return false
  }

  private selectorIsBareCall(selector: Node): boolean {
    // true when the node directly before the selector is a plain
    // identifier/type_identifier (no assignable selector chain).
    const prev = selector.previousNamedSibling
    if (!prev) return false
    return prev.type === "identifier" || prev.type === "type_identifier"
  }

  private resolveSelectorCallee(selector: Node): string | null {
    return this.resolveSelectorCalleeNode(selector)?.text ?? null
  }

  /** Node form of `resolveSelectorCallee` — the CALLEE identifier is the node
   *  that names a call/instantiates edge (M60 line contract). */
  private resolveSelectorCalleeNode(selector: Node): Node | null {
    const prev = selector.previousNamedSibling
    if (!prev) return null
    if (prev.type === "unconditional_assignable_selector" || prev.type === "conditional_assignable_selector" ||
        prev.type === "selector") {
      // obj.method(...) / Future.delayed(...) / super.toString()
      const inner = this.findChildByType(prev, "identifier")
      if (inner) return inner
      // nested selector chain (e.g. a.b.c()) — last identifier wins
      return this.lastIdentifierNode(prev)
    }
    if (prev.type === "identifier" || prev.type === "type_identifier") {
      return prev
    }
    return null
  }

  private lastIdentifier(node: Node): string | null {
    return this.lastIdentifierNode(node)?.text ?? null
  }

  /**
   * Node form of `lastIdentifier`: the identifier that NAMES a cascade link's
   * edge is also the node whose line the edge carries (M60 line contract), so
   * both views come from ONE traversal and cannot disagree.
   */
  private lastIdentifierNode(node: Node): Node | null {
    let result: Node | null = null
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier" || n.type === "type_identifier") result = n
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return result
  }

  /**
   * DT-A/DT-F: the member identifier of a link selector
   * (`unconditional_assignable_selector` / `conditional_assignable_selector`
   * child holding `method` in `obj.method`, `?.value`, `..length`).
   */
  private linkMember(sel: Node): string | null {
    return this.linkMemberNode(sel)?.text ?? null
  }

  /** Node form of `linkMember`: the member identifier itself is the node that
   *  NAMES a member-read/tear-off edge (M60 line contract). */
  private linkMemberNode(sel: Node): Node | null {
    const probe: Node[] = sel.type === "selector" ? this.namedChildrenOf(sel) : [sel]
    for (const c of probe) {
      if (c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector" ||
          c.type === "cascade_selector") {
        const id = this.findChildByType(c, "identifier") ?? this.findChildByType(c, "type_identifier")
        if (id) return id
      }
    }
    return null
  }

  private namedChildrenOf(n: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) out.push(c)
    }
    return out
  }

  /**
   * DT-A: receiver chain of an invocation, walking back through
   * link-selector siblings from the argument-carrying selector.
   * `P.Foo.bar()` -> head `P`, links [`Foo`, `bar`]; bare `foo()` ->
   * head `foo`, no links.
   */
  private invocationChain(argsSelector: Node): { head: Node | null; links: string[] } {
    const links: string[] = []
    let c: Node | null | undefined = argsSelector.previousNamedSibling
    while (c) {
      if (c.type === "selector") {
        const m = this.linkMember(c)
        if (!m) break
        links.unshift(m)
        c = c.previousNamedSibling
      } else if (
        c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector"
      ) {
        const id = this.findChildByType(c, "identifier") ?? this.findChildByType(c, "type_identifier")
        if (!id) break
        links.unshift(id.text)
        c = c.previousNamedSibling
      } else break
    }
    return { head: c, links }
  }

  private headNameText(head: Node | null): string | null {
    if (head && (head.type === "identifier" || head.type === "type_identifier")) return head.text
    return null
  }

  /**
   * DT-F: true when the selector sits in an assignment LHS write position
   * with a plain `=` operator (`a.b = c` writes b; `a.b += c` and `a.b ??= c`
   * read it). Span-matched like the C analyzer's LHS gate.
   */
  private selectorIsLhsWrite(sel: Node): boolean {
    let p: Node | null | undefined = sel.parent
    let guard = 0
    while (p && guard++ < 16) {
      if (p.type === "assignment_expression") {
        // Plain `=` writes the LHS; compound (`+=`, `??=`, ...) reads it.
        // Pure string comparison — never regex (family contract).
        let opText: string | null = null
        for (let i = 0; i < p.childCount; i++) {
          const c = p.child(i)
          if (c && !c.isNamed && c.text.includes("=")) { opText = c.text; break }
        }
        if (opText !== "=") return false
        const lhs = p.namedChild(0)
        if (lhs && lhs.startIndex <= sel.startIndex && lhs.endIndex >= sel.endIndex) return true
        return false
      }
      if (p.type === "function_body" || p.type === "block" || p.type === "class_body" ||
          p.type === "program" || p.type === "declaration") return false
      p = p.parent
    }
    return false
  }

  /** DT-F: declaration-name positions whose identifiers are binds, never reads. */
  private isDartDeclNameParent(ptype: string): boolean {
    return ptype === "formal_parameter" || ptype === "constructor_param" ||
      ptype === "function_signature" || ptype === "method_signature" ||
      ptype === "getter_signature" || ptype === "setter_signature" ||
      ptype === "type_alias" || ptype === "label" ||
      // #752: field / static-field declaration names (`int count = 0;`,
      // `static final int x = 1;`) — the declaration is a BIND, not a read.
      ptype === "initialized_identifier" || ptype === "static_final_declaration" ||
      ptype === "class_definition" || ptype === "enum_declaration" ||
      ptype === "mixin_declaration" || ptype === "extension_declaration" ||
      // M60 (#933 triage): `enum_declaration` covered the enum's OWN name but
      // not each VALUE's node, so every enum constant was published as a bare
      // read of its own enum (`uses Shape -> circle` at the declaration line,
      // confidence 0.6). The M12 harness files sub-threshold facts as
      // `unknown`, never as false positives, which is how it survived the
      // lane's whole fixture and mutant program — probe-verified node shape:
      // `(enum_body (enum_constant (identifier)))`. The constant's ARGUMENTS
      // are outside this gate and stay ordinary reads.
      ptype === "enum_constant" ||
      // DARTD21: an extension type's container name AND its representation
      // field name (`extension type X._(T object$)`) are declarations.
      ptype === "extension_type_declaration" || ptype === "representation_declaration" ||
      // DARTD22: a signature's OWN name binds, and the constructor-shaped
      // signatures were the one family missing from this set. A constructor
      // `Real()` and an UNTYPED METHOD `untypedMethod()` parse into the same
      // node, and in both the leading `identifier` is the declared name — so
      // without this row every one of them published a bare read of ITSELF
      // (`uses untypedMethod -> untypedMethod` at 0.6). Before DARTD22 the same
      // node was published as a member called `constructor`, so the read was
      // invisible: the source and the target were two different wrong names and
      // cancelled out. Fixing only the symbol left the self-loop visible, which
      // is why the row belongs here and not in the constructor dispatch.
      ptype === "constructor_signature" || ptype === "factory_constructor_signature" ||
      ptype === "constant_constructor_signature" || ptype === "redirecting_factory_constructor_signature"
  }

  /**
   * DT-F+ (#752): the names a function scope binds locally — its own
   * declarators plus formal / constructor / catch parameters. Used by the
   * bare-member-read gate so a name the CURRENT FUNCTION binds suppresses the
   * member read (CGD15 parity: a local is not a member, #299 — a false edge is
   * worse than a missing one). O(subtree), no regex.
   */
  /**
   * THE DECLARED TYPE OF EVERY LOCAL A SUBTREE BINDS (`collectDartLocals`' twin).
   *
   * The NAME set answers "is this a local", which is what suppresses a false member read.
   * It cannot answer "what IS this local", which is what makes a call target determinate:
   * `r.getOrders()` with `void run(OrderRepository r)` names `OrderRepository.getOrders`, and
   * without the type the edge can only say `getOrders` — the bare-name population the
   * incoming gate counts as ambiguous whenever any other declaration in the PROJECT shares
   * the name.
   *
   * Two shapes, and both are read off the GRAMMAR rather than guessed from text:
   *
   *   local_variable_declaration   the declared type is a direct child (`extractFieldType`,
   *                                the same reader fields use — `Baz y = Baz();`). It is
   *                                `undefined` for `var x = Widget();`, so the fallback below
   *                                is not a convenience: it is the only reading available.
   *   initialized_variable_definition
   *                                no declared type, so the INITIALIZER names it when it is a
   *                                construction (`Widget()`), which is a fact about the source
   *                                and not an inference about the program.
   *
   * `Widget? w` is deliberately NOT reduced (`extractFieldType` does not know the nullable
   * wrapper) and a generic type is refused by `plainTypeName` — a receiver typed `List<int>`
   * resolves through a type argument this pass has not read, and naming the wrong declaration
   * is worse than naming none.
   */
  private collectDartLocalTypes(root: Node): Map<string, { type: string; evidence: string; element?: string; keyElement?: string }> {
    const out = new Map<string, { type: string; evidence: string; element?: string; keyElement?: string }>()
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = n.type
      // A TYPED for-in VARIABLE (`for (Element e in xs)`, `for (final Element e in xs)`,
      // `await for (final Element e in stream)`) — the type is WRITTEN IN THE SOURCE and this
      // pass was not reading it, so `e.poke()` published a bare `poke` with
      // `receiverCause: receiverTypeUnknown` (measured: .tmp-probe/dartgate/typed-head-probe.mts
      // case D). The shape is `for_loop_parts (final_builtin)? (type_identifier) name: (identifier)
      // value: (identifier)` and the guard is what keeps this rule OFF the C-style loop, which
      // has NO name/value fields at all (`for_loop_parts init: … condition: … update: …`) and
      // OFF the pattern form (`for (final (int n, Element e) in xs)` → a `record_pattern`, no
      // name field), whose bindings DARTGAP1 already re-scoped by measurement. `inferred_type`
      // is the grammar's spelling of `var`/`final`-without-a-type, and it DECLINES here for the
      // same reason `var x = make()` does: nothing in the source names the type.
      if (t === "for_loop_parts") {
        const nameNode = n.childForFieldName?.("name")
        const iterable = n.childForFieldName?.("value")
        const inferred = (n.namedChildren ?? []).some((c: any) => c?.type === "inferred_type")
        if (nameNode && iterable && !inferred) {
          const nameIdx = (n.namedChildren ?? []).findIndex(
            (c: any) => c && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex,
          )
          for (let i = 0; i < nameIdx; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "type_identifier") {
              // Type arguments are dropped exactly as `extractParameters` drops them (`List<int> e`
              // records `List`), so this reader and the parameter reader agree by construction.
              const plain = stripNullableSuffix(c.text)
              if (isPlainIdentifier(plain)) out.set(nameNode.text, { type: plain, evidence: "annotation" })
              break
            }
          }
        }
      }
      // CATCH-CLAUSE TYPE — the type a caught exception is bound with is WRITTEN in the clause
      // (`on MyErr catch (e)`), and until this branch the analyzer collected the BINDING (`e`
      // was in `locals`: its reads were published) but not its TYPE. Measured on the shape:
      // `on MyErr catch (e) { e.mark(); }` published `calls -> mark` with
      // `receiverCause: receiverTypeUnknown` — a bare leaf that names a declaration three lines
      // away in the same file. The type is written, so this is the same evidence class as a
      // declared local (`annotation`), not an inference.
      //
      // The grammar puts the `on T` type as a DIRECT `type_identifier` child of `catch_clause`
      // and the bound names inside its `catch_parameters` child — a signature-style two-parameter
      // catch (`catch (e, st)`) types BOTH with the same `on` type, which is what Dart's own
      // rule says (the second parameter is the stack trace of the same exception).
      if (t === "catch_clause") {
        // THE `on T` TYPE IS A SIBLING, NOT A CHILD — probed on the pinned grammar:
        //   (try_statement (block) (type_identifier) (catch_clause (catch_parameters (identifier) (identifier))) (block))
        // so a child scan finds the bound NAMES and no type at all. The type written immediately
        // before the clause is the exception's type; a clause with no such sibling is the untyped
        // `catch (e)` form and stays cut (the reader refuses rather than guessing).
        const prev = n.previousNamedSibling
        const typeNode = prev && (prev.type === "type_identifier" || prev.type === "nullable_type")
          ? prev
          : undefined
        const typeLeaf = typeNode
          ? (typeNode.type === "type_identifier" ? typeNode.text : this.findChildByType(typeNode, "type_identifier")?.text)
          : undefined
        const typeName = typeLeaf ? stripNullableSuffix(String(typeLeaf)) : undefined
        const params = this.findChildByType(n, "catch_parameters")
        if (typeName && isPlainIdentifier(typeName) && params) {
          for (const c of params.namedChildren ?? []) {
            if (c && c.type === "identifier") out.set(c.text, { type: typeName, evidence: "annotation" })
          }
        }
      }
      if (t === "local_variable_declaration" || t === "declaration" || t === "initialized_variable_definition") {
        const name =
          n.childForFieldName?.("name")?.text ??
          this.findChildByType(n, "initialized_variable_definition")?.childForFieldName?.("name")?.text
        if (name && !out.has(name)) {
          const explicit = this.extractFieldType(n, n)
          const typeName = explicit ? stripNullableSuffix(String(explicit)) : this.constructedTypeName(n)
          // THE EVIDENCE CLASS the receiver contract asks for, recorded where the TYPE is
          // collected rather than re-derived per site: a written type (`Foo x = ...`,
          // `final Foo x`, a typed for-in) is an ANNOTATION; a type inferred from the
          // INITIALIZER (`var x = Foo()`) is an ASSIGNMENT. A parameter is the third class
          // and comes from `collectDartParameterTypes` below; a field is the fourth and is
          // read from `fieldTypeByField` (the symbol pass already extracted it).
          if (typeName && isPlainIdentifier(typeName)) {
            let element: string | undefined
            // `final List<Repo> xs = ...` — the type ARGUMENT is the same written evidence the
            // parameter collector reads; it types an untyped for-in variable over `xs`.
            const args = this.findChildByType(n, "type_arguments")
            let keyElement: string | undefined
            if (args) {
              const argsIds: string[] = []
              const argStack: Node[] = [args]
              while (argStack.length > 0) {
                const a = argStack.pop()!
                if (a.type === "type_identifier") { argsIds.push(a.text); continue }
                for (const c of a.namedChildren ?? []) if (c) argStack.push(c)
              }
              if (RealDartAnalyzer.DART_ELEMENT_CONTAINERS.has(typeName)) element = argsIds[0]
              else if (RealDartAnalyzer.DART_MAP_CONTAINERS.has(typeName)) { keyElement = argsIds[0]; element = argsIds[1] }
            }
            out.set(name, { type: typeName, evidence: explicit ? "annotation" : "assignment", ...(element ? { element } : {}), ...(keyElement ? { keyElement } : {}) })
          }
        }
      }
      for (const c of n.namedChildren ?? []) if (c) stack.push(c)
    }
    // AWAITED LOCALS — `final repo = await pending;` where `pending` is a `Future<Repo>`.
    // The awaited VALUE's type is the Future's type argument, which is WRITTEN in the source
    // (the same `annotation` evidence class as the declared local). Without this, the awaited
    // local is untyped and `repo.load()` publishes a bare leaf with receiverTypeUnknown — the
    // most common asynchronous shape in Dart. Resolved in a second pass over the declarations
    // because the future may be declared after (or in a different branch than) the await; a
    // fixed number of rounds settles nested awaits (`await f` where f itself is awaited-typed).
    const awaits: Array<{ name: string; operand: string }> = []
    const awaitStack: Node[] = [root]
    while (awaitStack.length > 0) {
      const n = awaitStack.pop()!
      if (n.type === "initialized_variable_definition") {
        const nameNode = n.childForFieldName?.("name")
        const value = n.childForFieldName?.("value")
        if (nameNode && value && value.type === "await_expression") {
          const operand = this.findChildByType(value, "identifier")
          if (operand) awaits.push({ name: nameNode.text, operand: operand.text })
        }
      }
      for (const c of n.namedChildren ?? []) if (c) awaitStack.push(c)
    }
    for (let round = 0; round < 3 && awaits.length > 0; round++) {
      let changed = false
      for (const a of awaits) {
        if (out.has(a.name)) continue
        const fut = out.get(a.operand)
        if (!fut || !fut.element) continue
        if (!RealDartAnalyzer.DART_ELEMENT_CONTAINERS.has(fut.type)) continue
        out.set(a.name, { type: fut.element, evidence: "annotation" })
        changed = true
      }
      if (!changed) break
    }
    return out
  }

  /**
   * AWAITED LOCALS: `final repo = await pending;` where the awaited variable's type is written as
   * `Future<Repo>` — the awaited VALUE's type is the future's type argument (written evidence, the
   * `annotation` class). Returns the declarations to type; the caller applies them to the body scope
   * so SIBLING statements see them. Grammar note: `await pending` parses as
   * `unary_expression > await_expression > identifier` (probed), not as a bare await_expression.
   */
  private collectAwaitLocalTypes(
    root: Node,
    localElements: Map<string, string>,
    localTypes: Map<string, string>,
  ): Map<string, string> {
    const out = new Map<string, string>()
    const decls: Array<{ name: string; operand: string }> = []
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "initialized_variable_definition") {
        const nameNode = n.childForFieldName?.("name")
        const valueRaw = n.childForFieldName?.("value")
        const awaitNode = valueRaw && valueRaw.type === "unary_expression"
          ? this.findChildByType(valueRaw, "await_expression")
          : valueRaw
        if (nameNode && awaitNode && awaitNode.type === "await_expression") {
          const operand = this.findChildByType(awaitNode, "identifier")
          if (operand) decls.push({ name: nameNode.text, operand: operand.text })
        }
      }
      for (const c of n.namedChildren ?? []) if (c) stack.push(c)
    }
    for (let round = 0; round < 3 && decls.length > 0; round++) {
      let changed = false
      for (const d of decls) {
        if (out.has(d.name) || localTypes.has(d.name)) continue
        const fut = localTypes.get(d.operand) ?? ""
        const element = localElements.get(d.operand)
        if (!element) continue
        if (fut !== "Future" && fut !== "FutureOr") continue
        out.set(d.name, element)
        changed = true
      }
      if (!changed) break
    }
    return out
  }

  /** The type a variable's INITIALIZER constructs: `var x = Widget()` -> `Widget`.
   *  `new`/`const` expressions and a bare capitalized callee are all constructions in
   *  Dart, and a lowercase callee is a function call whose RESULT type this pass has not
   *  read — so it returns undefined rather than the callee's name. */
  private constructedTypeName(n: Node): string | undefined {
    const value = n.childForFieldName?.("value")
    if (!value) return undefined
    const head =
      value.type === "constructor_invocation" || value.type === "new_expression" ||
      value.type === "const_object_expression"
        ? this.findChildByType(value, "type_identifier")
        : value.type === "identifier" || value.type === "type_identifier"
          ? value
          : null
    const text = head?.text
    if (!text || !isCapitalized(text)) return undefined
    return text
  }

  /**
   * PARAMETER DECLARED TYPES, from the signature node the body follows.
   *
   * `extractParameters` is the reader the symbol payload already uses (and its fixture
   * asserts), so a parameter is typed here exactly as it is typed on the symbol — one
   * reader, two consumers. A parameter whose type is not a plain identifier contributes
   * nothing, which is the conservative half of the rule.
   */
  /** Container types whose ELEMENT type this lane can read from a written type argument. */
  private static readonly DART_ELEMENT_CONTAINERS = new Set([
    "List", "Iterable", "Set", "Queue", "Stream", "Iterator", "ListQueue", "DoubleLinkedQueue",
    // `Future<T>`: the AWAITED value is T, and `await f` is written evidence of exactly the same
    // class as a declared local — it types the receiver of the statements after the await.
    "Future", "FutureOr",
  ])

  /** Map types whose KEY/VALUE type arguments this lane can read (value = `element`, key = `keyElement`). */
  private static readonly DART_MAP_CONTAINERS = new Set([
    "Map", "HashMap", "LinkedHashMap", "SplayTreeMap", "UnmodifiableMapView",
  ])

  private collectDartParameterTypes(sig: Node): Map<string, { type: string; evidence: string; element?: string; keyElement?: string }> {
    const out = new Map<string, { type: string; evidence: string; element?: string; keyElement?: string }>()
    let params: any[] = []
    try {
      params = (this.extractParameters(sig) as any[]) ?? []
    } catch {
      return out
    }
    for (const p of params) {
      const name = String(p?.name ?? "")
      const typeName = stripNullableSuffix(String(p?.type ?? ""))
      if (name && isPlainIdentifier(typeName)) out.set(name, { type: typeName, evidence: "param" })
    }
    // THE ELEMENT TYPE, from the parameter's own `type_arguments` child — a written type
    // argument is evidence, and it is the only thing that can type an UNTYPED for-in variable
    // (`for (final e in xs)` over `List<Repo> xs`): measured before this, `e.load()` published a
    // bare leaf with receiverTypeUnknown although `Repo` is written two tokens away.
    const stack: Node[] = [sig]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "formal_parameter" || n.type === "constructor_param" || n.type === "super_formal_parameter") {
        const nameNode = n.childForFieldName?.("name") ?? this.findChildByType(n, "identifier")
        const typeNode = this.findChildByType(n, "type_identifier")
        const args = this.findChildByType(n, "type_arguments")
        const argsIds: any[] = args ? (args.namedChildren ?? []).filter((c: any) => c && c.type === "type_identifier") : []
        const base = typeNode ? stripNullableSuffix(typeNode.text) : ""
        if (nameNode && argsIds.length > 0 && RealDartAnalyzer.DART_ELEMENT_CONTAINERS.has(base)) {
          const prev = out.get(nameNode.text)
          if (prev) prev.element = argsIds[0].text
          else out.set(nameNode.text, { type: base, evidence: "param", element: argsIds[0].text })
        } else if (nameNode && argsIds.length >= 2 && RealDartAnalyzer.DART_MAP_CONTAINERS.has(base)) {
          const prev = out.get(nameNode.text)
          if (prev) { prev.keyElement = argsIds[0].text; prev.element = argsIds[1].text }
          else out.set(nameNode.text, { type: base, evidence: "param", keyElement: argsIds[0].text, element: argsIds[1].text })
        }
        continue
      }
      for (const c of n.namedChildren ?? []) if (c) stack.push(c)
    }
    return out
  }

  /** The import aliases this file declares (`import 'x.dart' as _i1;`). Only the identifier that
   *  is a DIRECT child of `import_specification` is an alias — the specifier's own identifiers sit
   *  inside `configurable_uri`/`uri`, which is why the walk stops at those nodes. */
  private collectImportAliases(root: Node): Set<string> {
    const out = new Set<string>()
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "import_specification") {
        for (const c of n.namedChildren ?? []) {
          if (c && c.type === "identifier") out.add(c.text)
        }
        continue
      }
      if (n.type === "uri" || n.type === "configurable_uri" || n.type === "string_literal") continue
      for (const c of n.namedChildren ?? []) if (c) stack.push(c)
    }
    return out
  }

  private collectDartLocals(root: Node): Set<string> {
    const out = new Set<string>()
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier" && this.isDartDeclaredName(n)) out.add(n.text)
      // M14.0.F6 (2026-09-15): two of the names here cannot occur in the pinned
      // dart grammar, so their branches were dead — `simple_formal_parameter`
      // (the grammar's rule is HIDDEN and underscore-prefixed,
      // `_simple_formal_parameter`, so it never appears as a node type at all)
      // and `catch_clause_parameter` (dart's node is `catch_parameters`, which
      // IS listed). Measured: a catch clause parses as
      // `(catch_clause (catch_parameters (identifier) (identifier)))` and a
      // parameter as `(formal_parameter …)` — both already covered, so removing
      // the two names changes nothing (the gate's own definition of a dead
      // literal is a comparison that can never fire).
      if (
        n.type === "formal_parameter" || n.type === "constructor_param" ||
        n.type === "super_formal_parameter" || n.type === "catch_parameters"
      ) {
        const id = this.findChildByType(n, "identifier")
        if (id) out.add(id.text)
      }
      // DT2 (second review): for-in loop variables (`for (var x in xs)` —
      // the identifier preceding the `in` token) and pattern-bound names
      // (`variable_pattern` always; `constant_pattern` only under a binding
      // ancestor — a bare `case Foo:` tests a type, it binds nothing).
      if (n.type === "for_loop_parts") {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && c.text === "in") {
            for (let j = 0; j < i; j++) {
              const pc = n.child(j)
              if (pc && pc.isNamed && pc.type === "identifier") out.add(pc.text)
            }
            break
          }
        }
      }
      if (n.type === "variable_pattern") {
        const id = this.deepIdentifier(n)
        if (id) out.add(id.text)
      }
      // DARTGAP1, the missing half: a REST element BINDS ITS NAME.
      //   `final [int first, ...rest] = xs;`  ->  `(rest_pattern (constant_pattern (identifier)))`
      //   (probed: validation/m14/fixtures/dart/pattern-forms-probe.ts, which prints the raw tree
      //   for that exact line — the map-pattern rest spelling is NOT probed and is not claimed).
      // Nothing collected `rest` before this branch, so every later read of it (`rest.length`)
      // fell through every arm in the read pass and published NOTHING — a real missing edge, not
      // a convention question. The identifier is not a constant being tested: the pattern's
      // `constant_pattern` wrapper is the grammar's way of spelling the binding, and the read
      // pass explicitly refuses a constant_pattern whose parent is `rest_pattern` for the same
      // reason (see `isPatternTestConstant`).
      if (n.type === "rest_pattern") {
        const id = this.deepIdentifier(n)
        if (id) out.add(id.text)
      }
      if (n.type === "constant_pattern" && this.isBindingPatternContext(n)) {
        const id = this.deepIdentifier(n)
        if (id) out.add(id.text)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  /**
   * DT2: first document-order `identifier` in a subtree (pattern contents
   * nest — direct-child lookup misses `var (a, b)`-style bindings).
   */
  private deepIdentifier(n: Node): Node | null {
    const stack: Node[] = [n]
    while (stack.length > 0) {
      const c = stack.pop()!
      if (c.type === "identifier") return c
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const ch = c.namedChild(i)
        if (ch) stack.push(ch)
      }
    }
    return null
  }

  /**
   * DARTGAP2: is this node a CONSTANT being TESTED by a pattern — i.e. a position whose
   * owed relationship is a `uses` read of the constant, not a declaration and not a binding?
   *
   * The qualified form (`case M.off:`) is already read by the `qualified`-under-`constant_pattern`
   * branch (3d4d7fa4). This predicate covers the BARE identifier and the RELATIONAL operand.
   * The shapes are not inferred from the Dart spec — they were probed against the PINNED grammar
   * (`validation/m14/fixtures/dart/pattern-forms-probe.ts`):
   *
   *   case kOne:               (switch_statement_case (case_builtin) (constant_pattern (identifier)))
   *   if (x case kOne)         (if_statement (identifier) (constant_pattern (identifier)))
   *   if (x case kNested?)     (if_statement (identifier) (null_check_pattern (constant_pattern (identifier))))
   *   if (x case kOne!)        (if_statement (identifier) (null_assert_pattern (constant_pattern (identifier))))
   *   if (x case >= kOne)      (if_statement (identifier) (relational_operator) (identifier))
   *                            — tree-sitter-dart has NO `relational_pattern` wrapper, so the
   *                            operand is a direct child of the `if_statement` whose previous
   *                            NAMED sibling is the operator; the same shape appears under
   *                            `switch_statement_case` (probed) and `switch_expression_case`.
   *   case [kOne, 2]           (list_pattern (constant_pattern (identifier)) (constant_pattern (decimal_integer_literal)))
   *   case {'a': kOne}         (map_pattern (string_literal) (constant_pattern (identifier)))
   *   case (kOne, 2)           (record_pattern (constant_pattern (identifier)) (constant_pattern (decimal_integer_literal)))
   *
   * THREE EXCLUSIONS, each measured rather than assumed:
   *   * BINDING context. `var (int a, int b) = ...` parses its names as `variable_pattern`, so
   *     they never reach this predicate — but a destructuring declaration can still hold a
   *     `constant_pattern`, and `isBindingPatternContext` is the ONE rule that already decides
   *     that question for the binding collector. Reused rather than re-spelled.
   *   * `...rest` in `final [int f, ...rest] = ...` parses as
   *     `(rest_pattern (constant_pattern (identifier)))` — probed. That identifier is the BINDING
   *     being declared, not a constant being tested, so reading it would fabricate a use of the
   *     very name being bound.
   *   * the `_` wildcard parses as `constant_pattern (identifier "_")` in map patterns (probed:
   *     `{'b': _}`). `_` is not a constant and no declaration is named by it.
   */
  private isPatternTestConstant(n: Node): boolean {
    const id = n.type === "identifier" ? n : null
    const p = n.parent
    if (!p) return false
    if (p.type === "constant_pattern") {
      if (id && id.text === "_") return false
      if (p.parent?.type === "rest_pattern") return false
      return !this.isBindingPatternContext(p)
    }
    // RELATIONAL operand: no wrapper node exists (probed), so the parent is the case/if and the
    // operator is the previous named sibling. `a > b` in an EXPRESSION parses as
    // `relational_expression`, never this shape, so this cannot reach a comparison.
    if (p.type === "if_statement" || p.type === "switch_statement_case" || p.type === "switch_expression_case") {
      // Both spellings of a relational operand reach here: a bare identifier (`>= kOne`) and a
      // `qualified` constant (`>= Mode.off`). Neither gets a wrapper node from this grammar.
      return n.previousNamedSibling?.type === "relational_operator"
    }
    return false
  }

  /**
   * DT2: is this pattern node inside a BINDING context? Only structural
   * descent counts: a `var (a, b)` destructuring binds through record /
   * list / map wrappers to the declaration (or for-in head). A case TEST
   * (`InvitationStatus.declined => ...` inside `var x = switch ...`)
   * crosses a switch/if boundary — it tests, never binds, even when the
   * whole switch initializes a variable.
   */
  private isBindingPatternContext(n: Node): boolean {
    let p: Node | null | undefined = n.parent
    let guard = 0
    while (p && guard++ < 8) {
      const t = p.type
      if (t === "pattern_variable_declaration" || t === "for_loop_parts") return true
      if (
        t !== "record_pattern" && t !== "list_pattern" && t !== "map_pattern" &&
        t !== "constant_pattern" && t !== "variable_pattern"
      ) return false
      p = p.parent
    }
    return false
  }

  /**
   * DT-F: is this identifier the DECLARED name of its definition
   * (`var q = ...`, `int xs[3]`, `int xs[3] = ...`)? Names precede the
   * first `=` child; values follow it. Definitions without `=` bind every
   * identifier they directly hold.
   */
  private isDartDeclaredName(n: Node): boolean {
    const parent = n.parent
    if (!parent) return false
    const ptype = parent.type
    if (ptype !== "initialized_variable_definition" && ptype !== "static_final_declaration") return false
    let eqIdx = -1
    let myIdx = -1
    for (let i = 0; i < parent.childCount; i++) {
      const c = parent.child(i)
      if (!c) continue
      if (!c.isNamed && c.text === "=" && eqIdx === -1) eqIdx = i
      if (c.isNamed && c.startIndex === n.startIndex && c.endIndex === n.endIndex) myIdx = i
    }
    if (myIdx === -1) return false
    if (eqIdx === -1) return true
    return myIdx < eqIdx
  }

  /** DT-F: is this selector an index operation (`xs[0]` parses the index
   *  as a member-less selector holding brackets)? Member selectors name a
   *  member; argument selectors invoke. Bounded shape scan, never regex. */
  private isIndexSelector(sel: Node): boolean {
    if (this.linkMember(sel) !== null) return false
    if (this.findChildByType(sel, "argument_part")) return false
    return this.subtreeHasBracket(sel)
  }

  /** DT-F: is this assignable an index target (`xs[3] = 4` wraps the base
   *  and index in assignable_expression)? Same member-less + bracket test
   *  applied to the node itself. */
  private isIndexAssignable(sel: Node): boolean {
    if (sel.type !== "unconditional_assignable_selector" && sel.type !== "conditional_assignable_selector") return false
    if (this.findChildByType(sel, "identifier") ?? this.findChildByType(sel, "type_identifier")) return false
    return this.subtreeHasBracket(sel)
  }

  private subtreeHasBracket(sel: Node): boolean {
    const stack: Node[] = [sel]
    let guard = 0
    while (stack.length > 0 && guard++ < 32) {
      const c = stack.pop()!
      if (!c.isNamed && (c.text === "[" || c.text === "?[")) return true
      // All children (anonymous brackets are invisible to named traversal).
      for (let i = 0; i < c.childCount; i++) {
        const ch = c.child(i)
        if (ch) stack.push(ch)
      }
    }
    return false
  }

  /** DT-F: bounded ancestor climb — is this node inside string interpolation? */
  private isInsideTemplateSubstitution(n: Node): boolean {
    let p: Node | null | undefined = n.parent
    let guard = 0
    while (p && guard++ < 8) {
      if (p.type === "template_substitution") return true
      if (p.type === "function_body" || p.type === "block" || p.type === "class_body" ||
          p.type === "program" || p.type === "declaration") return false
      p = p.parent
    }
    return false
  }

  private isSignatureNode(type: string): boolean {
    return (
      type === "function_signature" || type === "method_signature" ||
      type === "getter_signature" || type === "setter_signature" ||
      type === "constructor_signature" || type === "factory_constructor_signature" ||
      type === "constant_constructor_signature" || type === "redirecting_factory_constructor_signature" ||
      type === "operator_signature"
    )
  }

  private isConstructorSignature(type: string): boolean {
    return (
      type === "constructor_signature" || type === "factory_constructor_signature" ||
      type === "constant_constructor_signature" || type === "redirecting_factory_constructor_signature"
    )
  }

  /**
   * Is this constructor-shaped signature actually a CONSTRUCTOR, or is it a
   * METHOD the grammar has no node for?
   *
   * ## The shape the grammar cannot distinguish
   *
   * `tree-sitter-dart` has no node for a method declared WITHOUT a return
   * type. `class A { noRetType() { } }` parses as
   *
   *     method_signature
   *       constructor_signature      <- an UNTYPED METHOD
   *         identifier  noRetType
   *         formal_parameter_list
   *
   * which is structurally identical to a real constructor `A()`. Reading the
   * node TYPE alone therefore publishes every untyped method in the corpus as a
   * `constructor` symbol named `constructor`, and the method's own name is never
   * published at all. MEASURED over a 600-file stride sample of the corpus at
   * 35,090 `.dart` files: 1,197 constructor-shaped signatures, of which 521
   * (43.5%) are untyped methods, spread over 56 files — and one file,
   * `dart-sdk/pkg/analyzer/test/src/summary/elements/type_inference_test.dart`,
   * holds 91 of them, all collapsed onto the single name
   * `TypeInferenceElementTest.constructor`. `validation/m14/fixtures/dart/
   * untyped-method-census.ts` is the census and the discriminator cross-tab.
   *
   * ## Why the PARENT is not the test
   *
   * "Is the inner signature's parent a `method_signature`?" looks like the
   * discriminator and is not: the grammar ALSO wraps real constructors that
   * way (`A.named(int a)`, `factory A.f() = A.named`), so it would misclassify
   * 559 real constructors as methods. The cross-tab in the census prints both.
   *
   * ## The test that IS exact — the language's own naming rule
   *
   * A constructor is named after its class, and the unnamed one is spelled
   * `.new`. A MEMBER may not share its class's name — that is a compile error —
   * so
   *
   *     lead === ownerName  ||  lead === "new"
   *
   * holds for every constructor and for no method. It is a property of the
   * declaration's own text, not of the grammar's node choice, so it survives a
   * grammar upgrade that re-shapes the wrapper.
   *
   * The census measures it as exact on both classes: 662 constructors and 535
   * untyped methods, with no cell of the contingency table requiring a choice.
   *
   * ## An ownerless signature is NOT decided here
   *
   * An `extension type` declares constructors too (`Ext1.name1(this i);`), and
   * `scopeOwnerName` resolves no enclosing type for one. Returning true there
   * would keep the current behaviour — a constructor published without an owner
   * — which is right, and is not this method's business to change. The 14
   * ownerless rows in the census are counted, not silently folded into either
   * class.
   */
  private isRealConstructor(sig: Node, owner: string | undefined): boolean {
    if (!owner) return true
    const lead = this.signatureName(sig)
    if (lead === null) return true
    return lead === "new" || lead === owner
  }

  /**
   * The name of the type a signature is declared in, read from the PARENT chain.
   *
   * The symbol pass has a `scopeStack` already carrying this, so it passes the
   * owner in. The relationship passes have no scope stack — they walk with
   * their own `current`/`owner` cursors — so they need it derived from the tree.
   * The two must agree or an edge's source and the symbol it names are decided
   * by different rules, which is how `resolveCurrent` came to publish the
   * literal `constructor` for every untyped method's body while the symbol pass
   * published the method under its own name.
   *
   * The owner resolution is the analyzer's, not the grammar's: `class_definition`
   * and `enum_declaration` carry a `name` FIELD, while `mixin_declaration` and
   * `extension_declaration` carry a direct `identifier` child. A lookup that read
   * only the name field would resolve no owner for a mixin and send every
   * untyped mixin method down the ownerless path.
   */
  private enclosingTypeName(node: Node): string | undefined {
    let n: Node | null = node
    let guard = 0
    while (n && guard++ < 64) {
      const t = n.type
      if (
        t === "class_definition" || t === "enum_declaration" ||
        t === "mixin_declaration" || t === "extension_declaration" ||
        t === "extension_type_declaration"
      ) {
        const named = n.childForFieldName("name")
        if (named) return named.text
        const id = this.findChildByType(n, "identifier")
        if (id) return id.text
        return undefined
      }
      n = n.parent
    }
    return undefined
  }

  private signatureName(inner: Node): string | null {
    const nameNode = inner.childForFieldName("name")
    if (nameNode) return nameNode.text
    // Operator overloads (`Vec operator +(Vec other)`) carry the operator
    // token as the 3rd child of operator_signature (return type, `operator`
    // keyword, token, parameters) — no name field, no identifier. The name is
    // the SYNTHESISED spelling `operator +` (a lane contract, like kotlin's
    // phantom members) — never the raw token, so this branch does NOT go
    // through `signatureNameNode`'s text.
    if (inner.type === "operator_signature") {
      const opTok = this.operatorTokenNode(inner)
      return opTok ? `operator ${opTok.text}` : null
    }
    const id = this.findChildByType(inner, "identifier")
    return id ? id.text : null
  }

  /** The operator symbol token of an `operator_signature`.
   *
   *  This locates the `operator` KEYWORD and takes the token after it. It must NOT
   *  hardcode a child index: the return type in front of the keyword is not one
   *  node but a variable number of them. A plain `bool` is a single
   *  `type_identifier`, so `child(2)` is the operator token — but a SCOPED return
   *  type (`core$_.bool`, `ns.bool`) is a `scoped_identifier` the grammar splits,
   *  which shifts every later child by one.
   *
   *  Measured: `extension ByteString$$Methods on ByteString { core$_.bool
   *  operator >(ByteString byteString) { ... } }` in ok_http's JNI bindings, where
   *  `child(2)` then names the member after the return type's last segment and
   *  publishes `operator bool` — a member name that names a TYPE, on a class that
   *  has no such member, while the real `operator >` went missing. Scanning for
   *  the keyword is invariant to how the return type is spelled. */
  private operatorTokenNode(inner: Node): Node | null {
    for (let i = 0; i < inner.childCount; i++) {
      const c = inner.child(i)
      if (c && !c.isNamed && c.text === "operator") return inner.child(i + 1)
    }
    return null
  }

  /** Node form of `signatureName`: the node that names a member edge is also
   *  the node whose LINE the edge carries (M60 line contract). For an operator
   *  overload the naming node is the operator TOKEN — its line, not its text,
   *  is what the synthesised spelling contributes. */
  private signatureNameNode(inner: Node): Node | null {
    const nameNode = inner.childForFieldName("name")
    if (nameNode) return nameNode
    if (inner.type === "operator_signature") {
      return this.operatorTokenNode(inner)
    }
    return this.findChildByType(inner, "identifier")
  }

  private findSignatureIn(node: Node): Node | null {
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 64) {
      const n = stack.pop()!
      if (this.isSignatureNode(n.type)) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private findInnerSignature(node: Node): Node {
    if (node.type !== "method_signature") return node
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (this.isSignatureNode(n.type) && n.type !== "method_signature") {
        return n
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return node
  }

  private hasBody(node: Node): boolean {
    const sib = node.nextNamedSibling
    if (sib && (sib.type === "function_body" || sib.type === "block")) return true
    return this.findChildByType(node, "function_body") !== null
  }

  private rangeIncludingBody(node: Node, sig: Node): ASTEngine.UniversalSymbol["range"] {
    const range = this.nodeToRange(node)
    let sib: Node | null = node.nextSibling
    let guard = 0
    while (sib && guard++ < 8) {
      if (sib.type === "function_body" || sib.type === "block") {
        range.endLine = sib.endPosition.row + 1
        range.endColumn = sib.endPosition.column + 1
        range.endIndex = sib.endIndex
        break
      }
      if (sib.type === "}" || sib.type === "class_body" || sib.type === "extension_body") break
      sib = sib.nextSibling
    }
    return range
  }

  private isAsyncSignature(node: Node, sig: Node): boolean {
    // `async` appears as a token child of the function_body or as a modifier
    const body = this.findChildByType(node, "function_body")
    if (body) {
      if (this.hasToken(body, "async")) return true
    } else {
      const sib = node.nextSibling
      if (sib && sib.type === "function_body" && this.hasToken(sib, "async")) return true
    }
    return false
  }

  private hasToken(node: Node, token: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === token || c.text === token)) return true
    }
    return false
  }

  private hasModifier(node: Node, modifier: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === modifier || c.text === modifier)) return true
    }
    // Modifiers may live on the parent `declaration` wrapper (class fields:
    // `declaration > static_final_declaration_list` carries static/final
    // tokens on the declaration). ONLY scan a declaration wrapper — scanning
    // an arbitrary parent like class_body (thousands of sibling members)
    // made per-member modifier checks O(class)² on large files.
    if (node.parent && node.parent.type === "declaration") {
      for (let i = 0; i < node.parent.childCount; i++) {
        const c = node.parent.child(i)
        if (c && (c.type === modifier || c.text === modifier)) return true
      }
    }
    return false
  }

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const out: ASTEngine.Parameter[] = []
    // A `formal_parameter_list` IS ACCEPTED AS ITSELF, not only as a child of a signature.
    //
    // The traversal hands this reader a body's PREVIOUS NAMED SIBLING, and for an ANONYMOUS
    // CLOSURE that sibling IS the list: tree-sitter-dart writes `function_expression
    // parameters: (formal_parameter_list …) body: (function_expression_body …)`, so the body's
    // previous named sibling is the list and nothing else is (probed:
    // .tmp-probe/dartgate/lambda-shape.mts, cases B/C/J). Searching for a child list INSIDE the
    // list found nothing, so every closure parameter stayed untyped while the identical method
    // parameter published `Element.poke` — measured through the production path in
    // .tmp-probe/dartgate/typed-head-probe.mts (case A `Element.poke`, cases B/C/J bare
    // `poke`/`id` with `receiverCause: receiverTypeUnknown`). A local function is NOT affected:
    // its body's sibling is a real `function_signature`, which this reader already handled.
    const paramsNode = node.type === "formal_parameter_list" ? node : this.findChildByType(node, "formal_parameter_list")
    if (!paramsNode) return out
    const stack: Node[] = [paramsNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "formal_parameter" || n.type === "constructor_param" || n.type === "typed_identifier"
      ) {
        const nameNode = n.childForFieldName("name") || this.findChildByType(n, "identifier")
        if (nameNode && nameNode.text !== "this" && nameNode.text !== "super") {
          // DARTD13: tree-sitter-dart has NO `type` field on formal_parameter
          // (probed dart-param-children.ts) — the old childForFieldName("type")
          // never matched, so EVERY typed param degraded to `dynamic` (8,094
          // in the corpus census). The type is a leading child BEFORE the name:
          // type_identifier (`int x`), function_type (`void Function() cb`),
          // or nullable_type suffix (`int? x` → type_identifier + nullable_type).
          // The name identifier is always LAST; type children precede it.
          let typeText: string | undefined
          if (n.type === "typed_identifier") {
            typeText = this.firstTypeIdentifier(n, false)?.text
          } else {
            const kids: Node[] = []
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) kids.push(c)
            }
            const nameIdx = kids.findIndex((c) =>
              // web-tree-sitter creates a NEW wrapper object per access, so
              // reference equality always fails (same trap extractReturnType's
              // KAD2 sweep fixed) — compare byte spans.
              nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex,
            )
            for (let i = 0; i < nameIdx; i++) {
              const c = kids[i]
              // `record_type` joins the list for DARTGAP3. A Dart 3 record is a
              // real declared type and it is spelled as a leading child exactly
              // like the other four, so `void f((int, String) p)` degraded its
              // parameter to `dynamic` and the record vanished from the graph.
              // The type text is taken verbatim from the node, so positional
              // `($1, $2)` and named `({int a, String b})` both survive with the
              // spelling the file used — no normalization, because a record's
              // field NAMES are part of its type.
              if (c.type === "type_identifier" || c.type === "function_type" ||
                  c.type === "nullable_type" || c.type === "void_type" ||
                  c.type === "record_type") {
                typeText = c.text
                break
              }
            }
          }
          // Named vs positional-optional: the grammar wraps BOTH `{...}` and
          // `[...]` parameter groups in optional_formal_parameters — the
          // distinction is the container's opening bracket (`{` = named,
          // `[` = positional). `this.id` / `super.key` constructor params sit
          // under a formal_parameter wrapper, so walk ancestors to find the
          // group. Default values are sibling literals.
          let group: Node | undefined
          let p: Node | null = n.parent
          while (p && p.type !== "optional_formal_parameters") p = p.parent
          if (p && p.type === "optional_formal_parameters") group = p
          const isNamed = group ? group.text.startsWith("{") : false
          const isOptional = group !== undefined
          const hasDefault = n.text.includes("=")
          const already = out.some((p) => p.name === nameNode.text)
          if (!already) out.push({ name: nameNode.text, type: typeText ?? IMPLICIT_DYNAMIC_TYPE, isOptional, isNamed })
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  private extractReturnType(node: Node): string | undefined {
    // A `childForFieldName("return_type")` read stood here and was DEAD: the
    // pinned grammar's field set has no such field (F1's 22-field oracle), and a
    // probe over both pinned corpora resolved it on 0 of 117,200 nodes. The fallback
    // it guarded was therefore the only path that ever ran, which is why removing it
    // cannot move a payload — it only removes a field the grammar never had.
    const voidType = this.findChildByType(node, "void_type")
    if (voidType) return "void"
    // first type_identifier BEFORE the name field — span-based stop (KAD2
    // sweep: `c === nameNode` never matched fresh wrappers, so the scan
    // ran past the name and could return the return-type... or a type
    // AFTER the name) — positional stop restores the intended "before the
    // name" semantics deterministically.
    const nameNode = node.childForFieldName("name")
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex) break
      // `record_type` for DARTGAP3, same reason as the parameter extractor: a
      // record RETURN type was silently lost, so `({int a, String b}) f()` published
      // no return type at all and the function looked untyped. Verbatim text, so the
      // field names inside the record survive as written.
      if (c.type === "type_identifier" || c.type === "void_type" || c.type === "record_type") return c.text
    }
    return undefined
  }

  private extractFieldType(node: Node, declList: Node): string | undefined {
    // Field/variable type: a type-ish DIRECT child of the declaration or its
    // decl list. Dart puts the explicit type in front of the list
    // (`declaration > [const_builtin, type_identifier, <list>]` — probed
    // dart-typedecl-shapes.ts). Inferred fields (`static const x = Ctor(...)`)
    // carry NO type node at all → undefined is correct. NEVER scan ancestors:
    // the old parent fallback iterated every class_body member per field —
    // O(class)², 13.6 s on phosphor_icons_regular.dart (1,512 fields × 3k-
    // member scan per field). Same trap hasModifier documents and avoids;
    // a bound is not needed since direct-child scans are O(1) per field.
    const candidates: Node[] = [node, declList]
    for (const cand of candidates) {
      for (let i = 0; i < cand.namedChildCount; i++) {
        const c = cand.namedChild(i)
        if (!c) continue
        // `record_type` for DARTGAP3 — `late (int, String) pair;` is a leading
        // child exactly like `late int n;`, so the direct-child rule was right and
        // the node-type list was the only thing missing.
        if (c.type === "type_identifier" || c.type === "void_type" || c.type === "record_type") {
          return c.text
        }
      }
    }
    return undefined
  }

  /** The representation type's leaf name (`extension type X(objc.ObjCObject o)`
   *  -> `ObjCObject`): alias-free like every other type name this lane emits
   *  (DARTD1/DARTD2), since the first identifier is the IMPORT PREFIX. */
  private representationTypeName(rep: Node | null): string | undefined {
    if (!rep) return undefined
    const nameNode = rep.childForFieldName("name")
    let leaf: string | undefined
    for (let i = 0; i < rep.namedChildCount; i++) {
      const c = rep.namedChild(i)
      if (!c) continue
      if (nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex) break
      if (c.type === "type_identifier" || c.type === "void_type") leaf = c.text
    }
    return leaf
  }

  private extractTypeParameters(node: Node): string[] | undefined {
    const tp = this.findChildByType(node, "type_parameters")
    if (!tp) return undefined
    const out: string[] = []
    for (let i = 0; i < tp.namedChildCount; i++) {
      const c = tp.namedChild(i)
      if (c && c.type === "type_parameter") out.push(c.text)
    }
    return out.length > 0 ? out : undefined
  }

  private extensionTargetType(node: Node): string | undefined {
    // `extension NumExt on int` — the target type follows the `on` keyword;
    // first type-ish named child that isn't the name.
    const name = node.childForFieldName("name")?.text
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c.type === "extension_body" || c.type === "identifier") continue
      if (c.type === "type_identifier" || c.type === "void_type") {
        if (c.text === name) continue
        return c.text
      }
    }
    // `extension on String` (unnamed extension) — the first type identifier
    return undefined
  }

  /**
   * THE NAME AN EXTENSION IS PUBLISHED UNDER — ONE rule at BOTH sites that need it (the symbol
   * emitter and `resolveOwner`), because a member whose published scope and whose container's name
   * disagree is a `contains` edge that names nothing.
   *
   * A named extension is published under its own name. An unnamed one has none, so it takes the
   * family's synthesized spelling — see `DART_UNNAMED_EXTENSION` for why borrowing the target
   * type's name was a defect rather than untidiness, and what it cost. The `undefined` fallback is
   * `DART_UNNAMED_EXTENSION` itself, mirroring java's `anonymous_class` (real-java-analyzer.ts):
   * a declaration that HAS members and no name still needs an owner string, and the alternative is
   * leaking those members into whatever scope surrounded them.
   */
  private extensionPublishedName(node: Node): string | undefined {
    const declared = node.childForFieldName?.("name")?.text
    if (declared) return declared
    const target = this.extensionTargetType(node)
    return target ? `${DART_UNNAMED_EXTENSION}_${target}` : DART_UNNAMED_EXTENSION
  }

  /**
   * Is this `type_identifier` the `on` SUBJECT of the UNNAMED extension that encloses it?
   *
   * The subject is part of the extension's own identity — `extensionPublishedName` derives the
   * published name FROM it — so it is not a mention the body makes. Only an UNNAMED extension is
   * covered: `extension M on M2 {}` publishes `M -> M2` and must keep doing so (pinned by
   * `verify-dart-references.ts`).
   */
  private isUnnamedExtensionSubject(n: Node): boolean {
    const parent = n.parent
    if (!parent || parent.type !== "extension_declaration") return false
    return parent.childForFieldName?.("name")?.text === undefined
  }

  private extractAnnotations(node: Node): string[] | undefined {
    const annotations: string[] = []
    let prev: Node | null = node.previousNamedSibling
    let guard = 0
    while (prev && guard++ < 8) {
      if (prev.type === "annotation") {
        annotations.unshift(prev.text)
        prev = prev.previousNamedSibling
      } else {
        break
      }
    }
    return annotations.length > 0 ? annotations : undefined
  }

  // ============================================================================
  // ANNOTATION REFERENCES — the type a `@...` names is a `references` edge
  // ============================================================================

  /**
   * Emit one `references` row per (annotation, decorated declaration) pair.
   *
   * THE RULES, each from the pinned grammar (see `annotation-shapes-probe.ts`):
   *
   *   TARGET — the annotation's `name` field, read as written and WITHOUT its `@`, arguments
   *   or type arguments. For `@prefix.Qualified` the target is the LEAF the `name` field names,
   *   not the import alias: this lane strips alias prefixes everywhere heritage and type
   *   mentions are spelled (DT-B/DAD1/DAD2 — `_i2.Mixin` is `Mixin`), and an annotation alias
   *   is the same alias. (Java keeps the full path because Java's qualifier is a package, not
   *   an import alias; the two lanes' conventions differ for a reason.)
   *
   *   SOURCE — the declaration the annotation DECORATES, because an annotation node has no
   *   name of its own. Three carrier shapes, all probed:
   *     child form      `@deprecated class C` -> annotation is a CHILD of `class_definition`;
   *                     `enum Kind { @deprecated old }` -> child of `enum_constant`;
   *                     `@deprecated final x = 1;` -> child of `local_variable_declaration`.
   *     sibling form    inside `class_body` and `program` the annotation is a SIBLING of the
   *                     declaration (`class_body (annotation) (method_signature)`), so the
   *                     carrier is the next non-annotation sibling.
   *     signature-param form  `void f(@required int x)` -> annotation is a CHILD of
   *                     `formal_parameter`; the carrier is the enclosing callable, because a
   *                     parameter publishes no symbol (DARTD8) and the annotation is a fact
   *                     about the declaration that carries it.
   *   Multi-declarator fields (`@JsonKey(...) int a = 1, b = 2;`) publish ONE row per
   *   declarator, matching the symbol model (each declarator is its own property).
   *
   *   CONFIDENCE 0.95, `evidenceClass: structural`: the annotation's type name is WRITTEN at
   *   the declaration, not inferred. `annotatedKind` is the carrier's grammar node type so a
   *   consumer can tell a class annotation from a parameter annotation — the node type alone
   *   cannot.
   *
   * NOT A CLAIM, and not an unresolvable-target exemption: the row is an ordinary `references`
   * edge and the project's resolver decides whether the annotation type has exactly one
   * in-project declaration (`@override` is dart:core's, so it will read unresolved in a
   * per-file run and resolve under an index — the same treatment every out-of-file type
   * mention gets on this label).
   */
  private emitAnnotationReferences(
    ann: Node,
    relationships: ASTEngine.UniversalRelationship[],
    current: string | null,
    owner: string | null,
    moduleName: string,
    importAliases: Set<string>,
  ): void {
    const nameNode = ann.childForFieldName?.("name") ?? this.findChildByType(ann, "identifier")
    if (!nameNode) return
    const target = this.annotationTargetSpelling(nameNode, importAliases)
    if (!target) return
    const carriers = this.annotationCarriers(ann, current, owner, moduleName)
    for (const carrier of carriers) {
      relationships.push({
        source: carrier.name,
        target,
        type: ASTEngine.RelationshipType.References,
        confidence: 0.95,
        // The NAME is written on the annotation's line; the declaration's header is another.
        line_number: this.nodeLine(nameNode),
        metadata: {
          relationshipType: "annotation",
          isAnnotation: true,
          annotatedKind: carrier.kind,
        },
      })
    }
  }

  /**
   * The annotation's TYPE name, as this lane spells types.
   *
   * A `scoped_identifier` is ONE grammar shape for two different Dart facts, and the alias table
   * is what tells them apart:
   *
   *   `@_i1.TestFor()`                  the qualifier is an IMPORT ALIAS -> the type is the LEAF
   *                                     (`TestFor`), and publishing `_i1.TestFor` would name an
   *                                     alias no declaration has.
   *   `@TestFor.async_value_nullable_pattern`
   *                                     the qualifier is the TYPE and the member selects a named
   *                                     CONSTRUCTOR (riverpod's `@TestFor.<lint>()` family) or a
   *                                     static; the type is the QUALIFIER. Taking the leaf here
   *                                     published a target named after a constructor, which is
   *                                     neither a type nor a declaration — and on a file whose
   *                                     stem matched the constructor it even produced a
   *                                     self-reference row (`async_value_nullable_pattern ->
   *                                     async_value_nullable_pattern`), measured by the corpus
   *                                     gate as UNEXPLAINED.
   *
   * Non-scoped names: the name field's own text. Arguments and type arguments are separate
   * children and never enter the target.
   */
  private annotationTargetSpelling(nameNode: Node, importAliases: Set<string>): string | null {
    if (nameNode.type === "identifier" || nameNode.type === "type_identifier") return nameNode.text
    if (nameNode.type === "scoped_identifier") {
      const scope = nameNode.childForFieldName?.("scope")?.text ??
        (nameNode.namedChildren ?? []).find((c) => c?.type === "identifier")?.text
      const leaf = nameNode.childForFieldName?.("name")?.text ??
        [...(nameNode.namedChildren ?? [])].reverse().find((c) => c?.type === "identifier")?.text
      if (scope && importAliases.has(scope)) return leaf ?? null
      return scope ?? leaf ?? null
    }
    const id = this.findChildByType(nameNode, "identifier") ?? this.findChildByType(nameNode, "type_identifier")
    return id ? id.text : null
  }

  /**
   * The declarations one annotation decorates, with the grammar node type of each carrier.
   * EMPTY when the position publishes no name this lane can attribute to — a library
   * directive's annotation (`library @TestOn('vm');`) is deliberately not attributed: the
   * library node is the module symbol, and an edge from the module to the annotation type
   * would be a claim about a directive the lane has not placed in this family.
   */
  private annotationCarriers(
    ann: Node,
    current: string | null,
    owner: string | null,
    moduleName: string,
  ): Array<{ name: string; kind: string }> {
    const parent = ann.parent
    if (!parent) return []
    const p = parent.type
    // CHILD OF THE DECLARATION.
    if (
      p === "class_definition" || p === "mixin_declaration" || p === "enum_declaration" ||
      p === "extension_declaration" || p === "extension_type_declaration"
    ) {
      const nm = parent.childForFieldName?.("name")?.text ?? this.findChildByType(parent, "identifier")?.text
      return nm ? [{ name: nm, kind: p }] : []
    }
    if (p === "enum_constant") {
      const nm = parent.childForFieldName?.("name")?.text ?? this.findChildByType(parent, "identifier")?.text
      return nm ? [{ name: nm, kind: p }] : []
    }
    // ANNOTATED TYPEDEF: `@A<int>(0) typedef F<T> = ...;` parses the annotation INSIDE the
    // `type_alias` wrapper — `(type_alias (annotation …) (type_identifier F) (type_parameters …) …)`
    // — so the child-form branch above did not cover it and NO row was published while the truth
    // oracle (which keys on TYPE_DECLARATIONS, including type_alias) derived one; the corpus gate
    // read that as `MISSING F -> A` on generic_metadata_test.dart.
    if (p === "type_alias") {
      const nm = parent.childForFieldName?.("name")?.text ??
        this.findChildByType(parent, "type_identifier")?.text
      return nm ? [{ name: nm, kind: p }] : []
    }
    // LIBRARY ANNOTATION — `@TestOn('vm') library annotated.lib;` parses the annotation as a
    // CHILD of `library_name`, before the dotted name (probed). The annotated declaration is the
    // library itself, and this lane already publishes a module symbol for every file, so the
    // source is that symbol's name: the DECLARED library name when the directive has one, else the
    // file-stem convention the module symbol uses for an implicit/unnamed library.
    if (p === "library_name") {
      const declared = this.findChildByType(parent, "dotted_identifier_list")
      const name = declared ? stripWhitespace(declared.text) : moduleName
      return name ? [{ name, kind: "library_annotation" }] : []
    }
    if (p === "local_variable_declaration") {
      const carrier = current ?? owner
      return carrier ? [{ name: carrier, kind: p }] : []
    }
    if (p === "formal_parameter" || p === "constructor_param" || p === "super_formal_parameter") {
      // A parameter publishes no symbol; the annotation is a fact about the callable that
      // declares it. Walk to the signature, and fall back to the enclosing function for a
      // lambda parameter (lambdas fold into their enclosing function — DARTD8).
      let sig: Node | null = parent
      let guard = 0
      while (sig && guard++ < 8) {
        if (this.isSignatureNode(sig.type)) break
        sig = sig.parent
      }
      if (sig) {
        if (sig.parent?.type === "lambda_expression" || sig.parent?.type === "function_expression") {
          return current ? [{ name: current, kind: "lambda_parameter" }] : []
        }
        const inner = this.findInnerSignature(sig)
        if (this.isConstructorSignature(sig.type) || this.isConstructorSignature(inner.type)) {
          return this.isRealConstructor(inner, this.enclosingTypeName(inner))
            ? [{ name: "constructor", kind: "constructor_param" }]
            : []
        }
        const nm = this.signatureName(inner)
        return nm ? [{ name: nm, kind: "parameter_annotation" }] : []
      }
      return current ? [{ name: current, kind: "parameter_annotation" }] : []
    }
    // SIBLING FORM: class_body / program (and enum_body defensively — the probed enum shape is
    // the child form above). Walk forward past further annotations: `@a @b class C` decorates
    // C twice.
    if (p === "class_body" || p === "program" || p === "enum_body") {
      let sib = ann.nextNamedSibling
      let guard = 0
      while (sib && sib.type === "annotation" && guard++ < 16) sib = sib.nextNamedSibling
      // SKIP THE DECLARATION'S MODIFIER KEYWORDS. `@deprecated final x = 1;` parses as three
      // PROGRAM siblings — `annotation`, `final_builtin`, `static_final_declaration_list`
      // (probed) — so the next sibling is a keyword node, not a declaration, and a carrier walk
      // that stopped there published NOTHING for every annotated *inferred* top-level variable.
      // The keyword nodes in this grammar are all `*_builtin` (`abstract`, `base`, `const`,
      // `final`, `late`, `sealed`, …); a declaration node is never one of them, so stepping over
      // them cannot skip a real declaration.
      let modGuard = 0
      while (sib && sib.type.endsWith("_builtin") && modGuard++ < 8) sib = sib.nextNamedSibling
      return sib ? this.carriersOfDeclarationNode(sib) : []
    }
    return []
  }

  /** The names a declaration node publishes, for the annotation sibling form. */
  private carriersOfDeclarationNode(node: Node): Array<{ name: string; kind: string }> {
    // THE TOP-LEVEL VARIABLE SHAPE HAS NO `declaration` WRAPPER: a top-level
    // `@deprecated int topVar = 5;` parses as three PROGRAM SIBLINGS — `annotation`,
    // `type_identifier`, `initialized_identifier_list` (probed: annotation-shapes-probe.ts) —
    // so the "next sibling is the declaration" step lands on the TYPE, not on the declarators.
    // The declaration is the LIST after it. (A top-level function's return type is inside its
    // `function_signature`, whose sibling is the signature itself, so this branch only fires
    // for variables/fields written with a separate type node.)
    if (node.type === "type_identifier" || node.type === "void_type" || node.type === "nullable_type" ||
        node.type === "function_type" || node.type === "inferred_type") {
      const after = node.nextNamedSibling
      if (after && (after.type === "initialized_identifier_list" || after.type === "static_final_declaration_list")) {
        return this.carriersOfDeclarationNode(after)
      }
      return []
    }
    if (node.type === "initialized_identifier_list" || node.type === "static_final_declaration_list") {
      const out: Array<{ name: string; kind: string }> = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        const id = this.findChildByType(c, "identifier")
        if (id) out.push({ name: id.text, kind: node.type })
      }
      return out
    }
    const t = node.type
    if (t === "class_definition" || t === "mixin_declaration" || t === "enum_declaration" ||
        t === "extension_declaration" || t === "extension_type_declaration" || t === "type_alias") {
      const nm = node.childForFieldName?.("name")?.text ?? this.findChildByType(node, "identifier")?.text
      return nm ? [{ name: nm, kind: t }] : []
    }
    // A class member arrives as `declaration` wrapping the signature (DARTD13's shape).
    let decl = node
    if (decl.type === "declaration") {
      for (let i = 0; i < decl.namedChildCount; i++) {
        const c = decl.namedChild(i)
        if (c && this.isSignatureNode(c.type)) { decl = c; break }
      }
    }
    if (this.isSignatureNode(decl.type)) {
      const inner = this.findInnerSignature(decl)
      if (this.isConstructorSignature(decl.type) || this.isConstructorSignature(inner.type)) {
        return this.isRealConstructor(inner, this.enclosingTypeName(inner))
          ? [{ name: "constructor", kind: "constructor_signature" }]
          : []
      }
      const nm = this.signatureName(inner)
      return nm ? [{ name: nm, kind: inner.type }] : []
    }
    // Field / variable declarations: one row per declarator name.
    const out: Array<{ name: string; kind: string }> = []
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 64) {
      const c = stack.pop()!
      if (c.type === "initialized_identifier" || c.type === "static_final_declaration") {
        const id = this.findChildByType(c, "identifier")
        if (id) out.push({ name: id.text, kind: node.type })
        continue
      }
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const ch = c.namedChild(i)
        if (ch && (ch.type === "initialized_identifier_list" || ch.type === "static_final_declaration_list" || ch.type === "initialized_identifier" || ch.type === "static_final_declaration")) {
          stack.push(ch)
        }
      }
    }
    return out
  }

  private collectComments(node: Node): string[] | undefined {
    const comments: string[] = []
    // Dart doc comments and annotations precede the declaration; annotations
    // (`@override`) sit between the doc comment and the node, so skip them.
    let sibling = node.previousSibling
    let guard = 0
    while (sibling && guard++ < 12) {
      if (sibling.type === "comment" || sibling.type === "documentation_comment") {
        comments.unshift(stripCommentMarkers(sibling.text))
        sibling = sibling.previousSibling
      } else if (sibling.type === "annotation") {
        sibling = sibling.previousSibling
      } else {
        break
      }
    }
    return comments.length > 0 ? comments : undefined
  }

  private directIdentifiers(node: Node): string[] {
    const out: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "type_identifier")) out.push(c.text)
    }
    return out
  }

  private methodComplexity(node: Node): number {
    let c = 1
    // The method BODY is a sibling of the signature node (tree-sitter-dart:
    // `method_signature`/`function_signature` then a following `function_body`
    // or `function_expression_body` inside class_body/program), so walk both
    // the node and its next named sibling(s) — otherwise per-method
    // cyclomatic complexity never counts branches inside the body.
    const stack: Node[] = [node]
    let sib: Node | null = node.nextNamedSibling
    let guard = 0
    while (sib && guard++ < 8) {
      if (sib.type === "function_body" || sib.type === "block" || sib.type === "function_expression_body") {
        stack.push(sib)
        break
      }
      if (sib.type === "class_body" || sib.type === "extension_body" || sib.type === "}" || sib.type === "declaration" || sib.type === "method_signature" || sib.type === "function_signature") break
      sib = sib.nextNamedSibling
    }
    guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (
        n.type === "if_statement" || n.type === "for_statement" || n.type === "while_statement" ||
        n.type === "do_statement" || n.type === "switch_statement_case" || n.type === "switch_expression_case" ||
        n.type === "catch_clause" || n.type === "conditional_expression" || n.type === "logical_and_expression" || n.type === "logical_or_expression"
      ) {
        c++
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return c
  }

  private firstTypeIdentifier(node: Node, excludeMixins: boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (excludeMixins && c.type === "mixins") continue
      if (c.type === "type_identifier") {
        return c
      }
      if (c.type === "identifier") return c
    }
    return null
  }

  /**
   * Resolved heritage names (DAD1/DAD2 contract): the real class names from a
   * heritage clause, with import-alias prefixes dropped and generic arguments
   * excluded.
   *
   * tree-sitter-dart parses a qualified supertype FLAT: `extends _i1.SmartFake`
   * is superclass > [_i1, `.`, SmartFake] — adjacent type_identifiers joined by
   * an anonymous `.` token where the FIRST is the import-alias container, not a
   * class name (the mocktail shape: `class _FakeX_0 extends _i1.SmartFake
   * implements _i2.Database`). Taking the first raw identifier named the base
   * after the alias (DAD1); enumerating all type_identifiers leaked the alias
   * into implements targets (DAD2).
   *
   * Rule over RAW children (anonymous tokens carry the disambiguation):
   * keep type_identifier/identifier nodes whose next raw sibling is NOT a `.`
   * token — a `.` means this name is an alias prefix; `,` or end-of-clause or
   * type_arguments means it is a real name. type_arguments are generic
   * arguments, never bases; mixins are handled separately as `uses`.
   * Probed shapes (dart-heritage-shapes.ts, 2026-09-03):
   *   `_i1.SmartFake`            -> [SmartFake]
   *   `Alpha, Beta`              -> [Alpha, Beta]
   *   `_i2.Database, _i3.Future` -> [Database, Future]
   *   `generics.Map<String, int>`-> [Map]
   */
  private resolvedHeritageNames(node: Node): string[] {
    return this.resolvedHeritageNodes(node).map((n) => n.text)
  }

  /** Node form of `resolvedHeritageNames` — the heritage-name node IS the node
   *  that names an extends/implements/uses edge (M60 line contract), so text
   *  and line come from one selection. */
  private resolvedHeritageNodes(node: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === "type_arguments" || c.type === "mixins") continue
      if (c.type !== "type_identifier" && c.type !== "identifier") continue
      const next = node.child(i + 1)
      if (next && next.type === ".") continue // alias prefix: `A.B` keeps B
      out.push(c)
    }
    return out
  }

  private allTypeIdentifiers(node: Node): Node[] {
    const out: Node[] = []
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 64) {
      const n = stack.pop()!
      if (n.type === "type_identifier" && n.parent && n.parent.type !== "type_arguments") {
        out.push(n)
      } else if (n.type === "identifier" && n.parent && n.parent.type === "mixins") {
        out.push(n)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private findDescendantByType(node: Node, type: string): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === type) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  /**
   * M60 (#929 lineage, dart lane): the line a relationship CLAIMS is the line
   * of the node that NAMES its target — the base clause for extends/implements,
   * the declared member for contains, the callee for calls, the constructed
   * class for instantiates, the overriding method for overrides, the uri
   * literal for an import/export/part, the redirect target for a factory
   * redirection. No node means NO field (absent is honest; `0` is the M59
   * fabrication).
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    return node.startPosition.row + 1
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}

/**
 * M60 line contract, SYMBOL side (dart lane). The `contains`/`overrides` edges
 * name the DECLARED member, and a WRAPPED declaration puts the name on a later
 * line than the declaration's start (`final void Function(UrlRequest? u,\n
 *     JString? s) _onRedirectReceived;` in cronet_http's generated jni
 * bindings). Keyed by name + range because one declaration node can carry
 * several names (`int a = 1, b = 2`).
 */
function dartNameLineKey(name: string, range: ASTEngine.UniversalSymbol["range"] | undefined): string {
  return `${name}|${range?.startIndex ?? -1}|${range?.endIndex ?? -1}`
}

function scopeOwnerKind(scopes: DartScopeEntry[]): ASTEngine.SymbolKind | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i].kind === DartScopeKind.Class) {
      // The scope entry does not carry its kind beyond class-ness; the caller
      // resolves the concrete kind via the last symbol of that name.
      return ASTEngine.SymbolKind.Class
    }
  }
  return undefined
}
