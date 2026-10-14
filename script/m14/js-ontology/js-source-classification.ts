/**
 * THE OUTGOING CLASSIFICATION, IN ONE PLACE (M14 JS lane, JSD48).
 *
 * ## Why this is a module and not a block in each caller
 *
 * The question "why is this row's source NULL?" has exactly one answer per row and is now
 * asked in two places with two very different evidence bases:
 *
 *   `javascript-store-resolution.mts` — a 250-file draw of the pinned corpus, where every
 *     class is a POPULATION and the numbers are what the lane reports.
 *   `verify-js-source-attribution.ts` — a fixture project whose answer is known BEFORE the
 *     run, where each class is an ASSERTION and a non-zero `own-store` fails the gate.
 *
 * Two callers means two copies if this lives inline, and this lane has already paid for
 * that once: JSD44 measured a name register written out in four places, where correcting
 * one left the other three refusing the names it had just admitted. The rule is the rule
 * in both callers or it is not a rule.
 *
 * ## What a class means, and what it does NOT mean
 *
 * A row whose source did not resolve is either FILE-LEVEL (the actor is the file, and
 * `graph_request.ts` answers "what does this file depend on" from exactly these rows) or
 * NAME-SPELLED (the actor is a name). NAME-SPELLED is the defect half, and its classes are
 * read off two symbol sets that are NOT the same view of the project:
 *
 *   `storedNamesByFile`   — what `brain_symbol` holds AFTER the index completed.
 *   `analyzerNamesByFile` — what the analyzer PUBLISHED for that file, read from the
 *                           analyzer's own output rather than from the store.
 *
 * The store resolves a source by a SAME-FILE NAME LOOKUP at insert time
 * (`parallel-indexer.ts`: `nameToSymbol.get(sourceName) ?? nameToSymbol.get(sourceLeaf)`,
 * with qualified/suffix fallbacks). So `own-store` — the name is in the FINAL store for the
 * row's own file — is not simply "the store forgot to look": it says the insert-time symbol
 * set and the read-back symbol set DISAGREE about that file, which is the shape a dropped
 * or late-admitted symbol produces. That is why the class is expected to be empty, and why
 * a gate can assert it rather than merely report it.
 *
 *   `own-analyzer` is the neighbouring shape: the analyzer declared the name for that file
 *   and the store has no such symbol at all — a store-path drop (the JSD44 shape), not a
 *   resolver miss.
 *
 *   `other-files` is NOT a defect and not a miss: the name is declared only in OTHER files
 *   of the project. The actor of the row is a local binding the language does not publish
 *   (the analyzer names the nearest enclosing scope, published or not), and a same-name
 *   declaration elsewhere is a COLLISION — attaching it would be a wrong-file lie of
 *   exactly the kind this lane's passes refuse. Measured on the closed draw: every row in
 *   this class is a local `const`/arrow function whose name a stranger file also declares.
 *
 * The last two classes are boundaries, not work: `stdlib` (a name the running engine's own
 * standard-library surface carries) and `neither` (an external surface — DOM/node/browser —
 * or a local binding this language does not publish). The classes are EXHAUSTIVE BY
 * CONSTRUCTION in the order below, so a caller can print the sum against its total and let
 * a non-zero remainder mean "a class stopped matching" rather than "a quieter total".
 */
/** The name-spelled classes, in the fixed order every caller prints them. */
export const REASON_KEYWORD =
  "a keyword actor (this/super) — refused by the name register, so it can never be a symbol row"
export const REASON_DECLARED_OWN_STORE =
  "the row's OWN file declares it in the STORE — the insert-time same-file lookup should have matched, so a non-zero reading means the store's insert-time and read-back symbol sets disagree about that file (the miss)"
export const REASON_DECLARED_OWN_ANALYZER =
  "the row's OWN file declares it in the ANALYZER's output but publishes no such symbol — a store-path drop, not a resolver miss"
export const REASON_DECLARED_OTHER =
  "declared only in OTHER files — a name COLLISION with an unrelated symbol; attaching would be a wrong-file lie"
export const REASON_STDLIB =
  "an ECMAScript standard-library member name — no project file declares it by construction"
export const REASON_NEITHER =
  "neither — an external surface (DOM/node/browser) or a local binding the language does not publish"

/** The fixed print order. Every class is printed, including the ones a draw has none of. */
export const NAME_SPELLED_REASONS = [
  REASON_KEYWORD,
  REASON_DECLARED_OWN_STORE,
  REASON_DECLARED_OWN_ANALYZER,
  REASON_DECLARED_OTHER,
  REASON_STDLIB,
  REASON_NEITHER,
] as const

/** Everything a NULL-source row can be, file-level and sentinel included. */
export type NullSourceClass =
  | "sentinel"
  | "file-level"
  | "keyword"
  | "own-store"
  | "own-analyzer"
  | "other-files"
  | "stdlib"
  | "neither"

/**
 * A membership test for a NAME, and nothing more.
 *
 * Deliberately not `Set<string>`: the two callers hold their per-file names in different
 * shapes (a `Set<string>` off the store, a `Map<name, lines>` off the analyzer's own report),
 * and both answer "does this file declare the name" through `has`. Requiring the narrower
 * shape would force one caller to rebuild its evidence as a set — the copy-that-drifts the
 * module exists to prevent — and would make the test narrower than the question.
 */
export type NameLookup = { has(name: string): boolean }

/** relative_path -> what that file declares, in whatever shape carries the answer. */
export type NameLookupsByFile = { get(file: string): NameLookup | undefined }

export interface NullSourceInputs {
  /** `brain_relationship.source_external` — the analyzer's spelling, or NULL. */
  source: string
  /** `brain_relationship.id` — carries `file:<relativePath>` when the source is NULL. */
  id: string
  /** The project-relative paths of the files in this run (the draw, not the corpus). */
  samplePaths: Set<string>
  /** relative_path -> the names `brain_symbol` holds for that file (READ BACK, after the run). */
  storedNamesByFile: NameLookupsByFile
  /** relative_path -> the names the ANALYZER published for that file. */
  analyzerNamesByFile: NameLookupsByFile
  /**
   * Every name the store holds ANYWHERE — the gate that separates the declared readings
   * from the language boundaries. A `NameLookup` for the same reason the per-file maps are:
   * one caller counts occurrences (`Map<name, count>`) and only ever asks `has`.
   */
  storedNamesAnywhere: NameLookup
  /** The engine-enumerated ECMAScript standard-library surface (`ecmaStdlibNames`). */
  stdlib: Set<string>
}

export interface NullSourceVerdict {
  cls: NullSourceClass
  /** The reason string, or "" for the two non-name-spelled classes. */
  reason: string
  /** The row's OWN file, recovered from the id. "" when the id names no file. */
  ownFile: string
}

/**
 * The ROW's own file, recovered from its id.
 *
 * `storeResults` builds a row id as `<projectId>:rel:<anchor>:<target>:<type>:<line>`, and
 * `<anchor>` is `file:<relativePath>` exactly when the source did NOT resolve to a symbol
 * (the M14/JS file-level wave). A NULL-source row has no source symbol, so no `brain_file`
 * join reaches it either — the id is the only place its file is written, which is what makes
 * "the row's OWN file" askable at all.
 *
 * The path is recovered by LONGEST-PREFIX match against the run's own path set rather than by
 * splitting on `:`: the target that follows the path may itself contain colons
 * (`./errors.js:CompileError`), so last-segment arithmetic truncates the path, and a
 * truncated path would silently answer "the row's file declares nothing" for every row.
 */
export function ownFileOf(id: string, samplePaths: Set<string>): string {
  const marker = ":rel:file:"
  const at = id.indexOf(marker)
  if (at < 0) return ""
  const after = id.slice(at + marker.length)
  let best = ""
  for (const p of samplePaths) if (after.startsWith(p + ":") && p.length > best.length) best = p
  return best
}

/**
 * Classify one NULL-source row. EXHAUSTIVE in this order — the first test that matches wins,
 * and the order is the reason `own-store` is tested before `stdlib`: a name that arrived in
 * the store for the row's own file is a fact about this project, and the standard-library set
 * is a fact about the language, so the project's own evidence is read first.
 */
export function classifyNullSourceRow(input: NullSourceInputs): NullSourceVerdict {
  const src = input.source
  // The row's own file is recovered FIRST and carried on EVERY verdict, file-level included:
  // for a file-level row the actor IS the file, so `ownFile` is not a diagnostic detail there
  // but the row's subject — and a caller asserting "this row's source is its own path" needs
  // the file precisely in the case where the class is already known.
  const ownFile = ownFileOf(input.id, input.samplePaths)
  if (src === "(file)") return { cls: "sentinel", reason: "", ownFile }
  if (input.samplePaths.has(src)) return { cls: "file-level", reason: "", ownFile }
  if (src === "this" || src === "super") return { cls: "keyword", reason: REASON_KEYWORD, ownFile }
  if (!input.storedNamesAnywhere.has(src)) {
    return input.stdlib.has(src)
      ? { cls: "stdlib", reason: REASON_STDLIB, ownFile }
      : { cls: "neither", reason: REASON_NEITHER, ownFile }
  }
  if (input.storedNamesByFile.get(ownFile)?.has(src)) {
    return { cls: "own-store", reason: REASON_DECLARED_OWN_STORE, ownFile }
  }
  if (input.analyzerNamesByFile.get(ownFile)?.has(src)) {
    return { cls: "own-analyzer", reason: REASON_DECLARED_OWN_ANALYZER, ownFile }
  }
  return { cls: "other-files", reason: REASON_DECLARED_OTHER, ownFile }
}

/**
 * The ECMAScript standard library surface, ENUMERATED FROM THE RUNNING ENGINE rather than
 * typed from memory: every own property of every built-in prototype, every static member of
 * every built-in constructor, and every global. The list is a by-product of executing this
 * program, so it cannot rot into a stale hand-copy, and "is this name part of the language's
 * standard library" becomes a question the runtime answers.
 *
 * It is deliberately the ENGINE's surface and not a specification scrape. A name this set
 * does not contain is not thereby "not standard" — it is simply not adjudicated here, and
 * the reports keep the two apart rather than implying the second from the first.
 *
 * ONE COPY. Two instruments and a gate share this module because the alternative — the same
 * enumeration pasted into each file — is the failure JSD44 measured: copies drift, and the
 * drift is invisible because both copies still look right on their own page.
 */
export function ecmaStdlibNames(): Set<string> {
  const names = new Set<string>()
  const addAll = (o: any) => { if (o) for (const n of Object.getOwnPropertyNames(o)) names.add(n) }
  const protos = [
    Object.prototype, Function.prototype, Array.prototype, String.prototype,
    Number.prototype, Boolean.prototype, Symbol.prototype, BigInt.prototype,
    Date.prototype, RegExp.prototype, Error.prototype, Promise.prototype,
    Map.prototype, Set.prototype, WeakMap.prototype, WeakSet.prototype,
    ArrayBuffer.prototype, DataView.prototype,
  ]
  for (const p of protos) addAll(p)
  // Read the constructors by NAME off the global object rather than by bare reference:
  // `AsyncIterator` is not a global in every engine, and a bare reference to a missing one
  // throws here rather than measuring anything. A name the engine does not define is simply
  // absent from the set.
  const ctorNames = [
    "Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt",
    "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "EvalError",
    "ReferenceError", "URIError", "AggregateError", "Promise", "Map", "Set", "WeakMap",
    "WeakSet", "WeakRef", "FinalizationRegistry", "JSON", "Math", "Reflect", "Proxy",
    "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array",
    "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
    "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "Iterator",
    "AsyncIterator", "Atomics", "Intl", "WebAssembly",
  ]
  for (const key of ctorNames) {
    const v = (globalThis as any)[key]
    if (!v) continue
    addAll(v)
    if (v.prototype) addAll(v.prototype)
  }
  addAll(globalThis)
  return names
}
