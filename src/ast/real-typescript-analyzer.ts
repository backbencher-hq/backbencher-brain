// ───────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — `RealTypeScriptAnalyzer`, the TypeScript/TSX AST analyzer. It is
// registered in `engine.ts` for BOTH language ids: `typescript` (.ts/.mts/.cts) and `tsx`
// (.tsx); the code is shared and only the wasm grammar differs.
// RELATIONSHIP TYPES IT EMITS — TWELVE of the canonical vocabulary: the ten stored values
// (calls, uses, contains, imports, exports, references, extends, implements, overrides,
// instantiates) plus the two the owner admitted BECAUSE the ten could not spell them honestly —
// `decorates` (a decorator is applied TO a declaration; `references` claimed the body mentioned it)
// and `renders` (a JSX element renders a component; `uses` claimed a mention). The remaining two
// of the fourteen are NOT emitted, and they are NOT the same kind of absence — stating that they
// were would be a header that the code does not bear out:
//   · `mixes_in` — ZERO SITES, and the absence is a fact about THE CORPUS, not about the language.
//     TypeScript composes a mixin with `class X extends Mixin(Base) {}`, whose extends-expression
//     is a call_expression; the language CAN express it, so this is not a grammar absence. Over
//     the whole admitted population (17,689 files / 42 repos, digest 949d0fd6a615bd3e…; 2,186
//     class heritage clauses, 1,107 interface declaration-merging clauses) the count of call-shaped
//     heritage sites is 0, no heritage base is named `*mixin*`, and this analyzer emits 0 edges —
//     the same shape is 76 sites in the javascript lane, so the difference is about the corpora.
//     It IS expressible, so it STAYS IN THE DENOMINATOR as corpus-unexercised — it does not
//     shrink n, and no reading of this file may turn it into a claim about the language.
//   · `part_of` — A REAL CONSTRUCT THE SERVED GRAMMAR MIS-LEXES. The triple-slash directive
//     (`/// <reference path="…" />`, `types="…"`, `lib="…"`) is lexed as a COMMENT by the served
//     build (8515404dceed…), so it has no node and no relation can be read from it. It is IN
//     GRAMMAR REMEDY PENDING and STAYS IN THE DENOMINATOR: a pending type is expressible, so it is
//     an unimplemented gap and not an exclusion.
// ⇒⇒⇒ SO THIS LANE IS 12 OF 14, NEVER 12 OF 12: twelve emitted types, `mixes_in` expressible but
// unexercised, `part_of` expressible but pending a grammar remedy. Both stay in n.
// The applicable-set evidence for every construct and every type is
// validation/m14/verification/TYPESCRIPT-APPLICABLE-SET.md.
// WHERE ITS EVIDENCE LIVES — docs/analyzers/real-typescript-analyzer.md (+ -ontology.md);
// fixtures validation/m14/fixtures/typescript/** (run `bun run script/m14/run-fixtures.ts
// --lang typescript`); gate `bun run script/m14/incoming-gate.ts typescript ts 400`; spec
// script/m14/spec/typescript-completeness.json; state validation/m14/verification/
// TYPESCRIPT-STATE.md; the named-cause census in fixtures/typescript/tools/*.mts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/ast/engine.ts (wiring + grammar),
// src/ast/language-detection.ts (extensions), the two docs above, every fixture AND its
// .expectation.json pair, the completeness spec, and the census tools (their buckets
// reproduce the gate's rule and must be re-run, not re-spelled).
// GRAMMAR IT DEPENDS ON — tree-sitter-typescript 0.23.2: tree-sitter-typescript.wasm (ts)
// and tree-sitter-tsx.wasm (tsx, because the plain grammar carries no JSX). This file
// carries NO regex literal by contract (script/m14/no-regex-gate.sh).
// ───────────────────────────────────────────────────────────────────────────────

import type { Node } from "web-tree-sitter"
import { detectFrameworks, type FrameworkInfo } from "./framework-detectors"
import { ASTEngine } from "./engine"
import { BINDING_SEP } from "./types"
import * as path from "path"
import * as fs from "fs"
import { treeContainsNodeType } from "./node-walk"

// ============================================================================
// BUILTIN FILTER - C#-family contract
// Console output (console.log) and Object universal leaf methods are filtered;
// framework/static calls (Map.set, Promise.resolve, String.trim, array.map,
// RegExp.test) are KEPT like Java's JDK calls (save -> put) and C#'s
// Math.Sqrt -> Sqrt. `super` is a language keyword, not a callable.
// ============================================================================

const TS_CONSOLE_BUILTINS = new Set([
  "console.log", "console.warn", "console.error", "console.info", "console.debug",
  "console.trace", "console.table", "console.group", "console.groupEnd",
  "console.groupCollapsed", "console.time", "console.timeEnd", "console.assert",
  "console.count", "console.countReset", "console.dir", "console.dirxml",
  "console.clear", "console.profile", "console.profileEnd",
])
const TS_OBJECT_LEAF_METHODS = new Set([
  "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
  "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
])

// ============================================================================
// THE PROOF TABLES FOR "THIS NAME IS OUTSIDE THE CORPUS"
//
// These are the EVIDENCE for a claim, not a heuristic about what a name looks
// like, which is why they are PINNED here and printed in full:
//
//   TS_RUNTIME_GLOBALS     identifiers the LANGUAGE RUNTIME provides: the global
//                          namespace objects (`Object`, `JSON`, `Math`, `Reflect`,
//                          `console`), the standard classes, the host objects
//                          (`window`, `document`, `process`), and the global
//                          functions (`setTimeout`, `fetch`, `structuredClone`).
//                          `JS_GLOBAL_CONSTRUCTORS` at the bottom of this file
//                          already pins the CONSTRUCTOR half of this list for
//                          `instantiates`; this is its READ/ CALL half, and the
//                          overlap is deliberate — one class of thing, two uses.
//   TS_TEST_RUNNER_GLOBALS describe/it/test/expect/beforeEach/... — declared by the
//                          TEST FRAMEWORK in node_modules, not by the project.
//   TS_TEST_FRAMEWORK_MODULES
//                          the PACKAGE SPECIFIERS that prove the same origin when the file
//                          DOES bind the name: `import { expect } from "@jest/globals"` says
//                          where the declaration lives, and it is not this project.
//   TS_LIB_TYPE_NAMES      the TypeScript LIB types (`lib.es5.d.ts` and the utility
//                          types every compiler since 2.1 ships): `Partial`,
//                          `Record`, `Awaited`, `HTMLElement`, ...
//
// A NAME IN ONE OF THESE TABLES IS NOT PROOF BY ITSELF — a file may declare `Map`, `test`
// or `Date` and mean its own. So a claim requires the FILE to bind neither the name nor its
// receiver (see `markExternalTargets`), EXCEPT that a binding whose own import specifier is
// a pinned test-framework package is itself the evidence. The file's own symbol and import
// lists are the check either way.
// ============================================================================
const TS_RUNTIME_GLOBALS = new Set([
  // namespace objects
  "Object", "JSON", "Math", "Reflect", "console", "globalThis", "Intl", "Atomics",
  // standard classes / values
  "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean", "DataView",
  "Date", "Error", "EvalError", "Float32Array", "Float64Array", "Function", "Infinity", "Int8Array",
  "Int16Array", "Int32Array", "Map", "NaN", "Number", "Promise", "Proxy", "RangeError", "ReferenceError",
  "RegExp", "Set", "SharedArrayBuffer", "String", "Symbol", "SyntaxError", "TypeError", "URIError",
  "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array", "WeakMap", "WeakRef", "WeakSet",
  // host objects
  "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
  "performance", "crypto", "process", "Buffer", "global", "module", "exports", "require",
  "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal",
  "Blob", "File", "FileReader", "FormData", "Headers", "Request", "Response", "WebSocket",
  "Worker", "SharedWorker", "XMLHttpRequest", "Image", "Event", "CustomEvent", "MessageEvent",
  "MouseEvent", "KeyboardEvent", "ResizeObserver", "MutationObserver", "IntersectionObserver",
  // global functions
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask",
  "requestAnimationFrame", "cancelAnimationFrame", "fetch", "structuredClone", "atob", "btoa",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "encodeURI", "decodeURI", "eval",
])

/** The TEST-RUNNER globals — mocha/jest/vitest/jasmine's ambient API. Declared by the
 *  framework; a project that declares one of these names is caught by the same-file
 *  check below, and the arbiter still resolves the edge if the project publishes it. */
const TS_TEST_RUNNER_GLOBALS = new Set([
  "describe", "it", "test", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll",
  "suite", "xit", "xdescribe", "fit", "fdescribe", "specify", "context",
  "jest", "vi", "vitest", "sinon", "cy", "assert", "spyOn", "mock", "fn",
])

/**
 * THE TEST-FRAMEWORK PACKAGES — the second, STRONGER evidence for the same claim.
 *
 * `TS_TEST_RUNNER_GLOBALS` above proves "this name is the framework's" only while the file
 * binds NEITHER the name nor its receiver. The common modern spelling defeats that proof:
 * `import { describe, it, expect } from "@jest/globals"` — the name IS bound, by an import
 * whose SPECIFIER names a package that lives in `node_modules`, not in the project. So the
 * file itself says where the declaration is, and it says it more specifically than any
 * table could. Measured on the 400-file stride: 662 calls edges (the largest remaining
 * doable class after the ambient-global pass) are a bare callee bound by an import from
 * one of these packages, and the previous `bound.has(target)` guard refused every one.
 *
 * PINNED, and matched by WHOLE SEGMENT (never substring): `@jest/globals` and its subpaths
 * match; `jest-utils` does not. A project that declares or re-exports one of these names
 * still blocks the claim through `declaredHere`, and the arbiter still refutes the claim
 * if the project publishes the name — so the list can only add claims the project can
 * check, never shelter a resolvable edge.
 */
const TS_TEST_FRAMEWORK_MODULES = new Set([
  "@jest/globals", "@jest/expect", "@jest/test-globals", "@jest/fake-timers",
  "jest", "vitest", "@vitest/expect", "@vitest/spy", "@vitest/runner",
  "mocha", "chai", "ava", "tap", "uvu", "jasmine", "sinon", "expect",
  "node:test", "bun:test", "cypress", "@playwright/test", "playwright",
  "@testing-library/jest-dom", "supertest",
])

/** Is `module` a pinned test-framework package? Whole segments only — see the table. */
function isTestFrameworkModule(module: string): boolean {
  if (module.length === 0) return false
  for (const pkg of TS_TEST_FRAMEWORK_MODULES) {
    if (module === pkg) return true
    if (module.startsWith(pkg + "/")) return true
  }
  return false
}

/** TypeScript LIB types the compiler ships, not the project. */
const TS_LIB_TYPE_NAMES = new Set([
  "Partial", "Required", "Readonly", "Pick", "Record", "Omit", "Exclude", "Extract", "NonNullable",
  "ReturnType", "Parameters", "ConstructorParameters", "InstanceType", "ThisParameterType",
  "OmitThisParameter", "ThisType", "Uppercase", "Lowercase", "Capitalize", "Uncapitalize", "Awaited",
  "PropertyKey", "PropertyDescriptor", "CallableFunction", "NewableFunction", "IArguments",
  "TemplateStringsArray", "ArrayLike", "ConcatArray", "ReadonlyArray", "ReadonlyMap", "ReadonlySet",
  "PromiseLike", "Iterable", "Iterator", "IterableIterator", "AsyncIterable", "AsyncIterator",
  "AsyncIterableIterator", "Generator", "AsyncGenerator", "GeneratorFunction",
  "AsyncGeneratorFunction", "HTMLElement", "Element", "Node", "NodeList", "Document", "Window",
  "EventTarget", "Storage",
])

/**
 * IS THIS TEXT A PLAIN IDENTIFIER? Regex-free by contract — this file carries no
 * regex literal (`script/m14/no-regex-gate.sh`), so the character classes are
 * written out. `$` and `_` are legal starts in TypeScript; digits are not.
 */
/**
 * PURE-STRING HELPERS FOR THE THREE SHAPES THAT KEPT RE-INTRODUCING A REGEX.
 *
 * This file carries NO regex literal by contract (`script/m14/no-regex-gate.sh`), and a later round
 * broke that contract three ways while adding the project-index pass: `module.replace(/^node:/, "")`,
 * `.split(/[./\\]/)[0]`, and `child.type.replace(/_declaration$/, "")`. The claim "no regexes" had
 * been verified against the file BEFORE those edits — the lesson is that the claim has to be
 * re-verified whenever this file changes, and a helper makes the correct form the easy one.
 */
function stripNodePrefix(specifier: string): string {
  return specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier
}
function firstPathSegment(text: string): string {
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "." || c === "/" || c === "\\") return text.slice(0, i)
  }
  return text
}
function declarationKindName(nodeType: string): string {
  const suffix = "_declaration"
  return nodeType.endsWith(suffix) ? nodeType.slice(0, nodeType.length - suffix.length) : nodeType
}

/**
 * A heritage clause's named children include nodes that NAME nothing: `comment` and `ERROR` are
 * named children of `extends_clause` / `extends_type_clause` / `implements_clause` in this grammar,
 * and their TEXT was published as an extends/implements target. Measured on the whole population
 * (13,950 admitted .ts files): `interface Hooks<D …> extends` with a comment between the clause and
 * its base produced `extends Hooks -> "/* note *\/"`, and one zero-width comment produced
 * `extends … -> ""` — the gate's noTarget class. Comments are trivia, not names.
 */
function isNameableHeritageNode(nodeType: string): boolean {
  return nodeType !== "comment" && nodeType !== "ERROR" && nodeType !== "type_arguments"
}
/**
 * DOES THIS ROW ALREADY CARRY A CLAIM? Every marker key the pipeline can attach, from the arbiter's
 * own vocabulary (`script/m14/incoming-rule.ts` claims) plus this analyzer's external marker.
 *
 * The guard exists because the arbiter's binding and imported-binding claims are SOLE AUTHORITY for
 * their rows (checked before the generic external markers). A row carrying BOTH therefore classifies
 * as `bindOK` and its `extOK`/`ext?` claim disappears — measured on the whole-population arm as
 * `extOK −27,459` and `ext? −3,633`, a defect the lane's first emission had. A claim may only land on
 * a row NOBODY else claimed, so this guard is consulted by BOTH binding passes.
 */
function carriesClaimMarker(md: Record<string, any> | undefined): boolean {
  if (!md || typeof md !== "object") return false
  if (md.isExternalTarget === true) return true
  const keys = [
    "localBinding", "importedBinding", "defaultExport", "moduleExports", "importOutsideProject",
    "importProjectFile", "remoteRef", "baseBeyondRunScope", "languageNamespace", "sourcePathClaim",
  ]
  for (const k of keys) {
    const v = md[k]
    if (v === true) return true
    if (v !== undefined && v !== null && v !== false) return true
  }
  return false
}

function isPlainIdentifier(text: string): boolean {
  if (text.length === 0) return false
  const first = text[0]
  const firstOk = first === "_" || first === "$" ||
    (first >= "a" && first <= "z") || (first >= "A" && first <= "Z")
  if (!firstOk) return false
  for (let i = 1; i < text.length; i++) {
    const c = text[i]
    if (c === "_" || c === "$" || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9")) continue
    return false
  }
  return true
}

/**
 * THE NAME A CALL EXPRESSION IS ROOTED AT, for the RECEIVER-IS-A-CALL proof:
 * `expect(trace).toEqual` -> `expect`. Returns null unless the text ENDS in `)`
 * and its head (everything before the first `(`) is a plain identifier, so
 * `(expect)(x)`, `foo.bar(x)`, `a[0]()` and `foo(x).bar` all refuse. Refusing is
 * the safe direction: an unmarked edge stays in the residual where a reader can
 * see it, while a WRONG claim is counted against the lane.
 */
function callHeadName(text: string): string | null {
  if (text.length === 0 || !text.endsWith(")")) return null
  const open = text.indexOf("(")
  if (open <= 0) return null
  const head = text.slice(0, open)
  return isPlainIdentifier(head) ? head : null
}

/**
 * THE CALLEE'S LEAF NAME, BY SHAPE — an ALLOWLIST, never `callee.text`.
 *
 * A `calls` target is a NAME. Before this reducer the target was the callee's raw
 * source text filtered by a DENYLIST (newlines, backticks, `${`, brace-equals,
 * >100 chars), and a denylist can only enumerate the garbage someone has already
 * seen. Measured over 32,672 `call_expression` nodes on 400 tracked corpus files,
 * the grammar produces TEN callee shapes — identifier 18,529 · member_expression
 * 14,030 · parenthesized_expression 51 · import 22 · non_null_expression 11 ·
 * super 10 · await_expression 8 · call_expression 6 · subscript_expression 3 ·
 * unary_expression 2 — and every shape the reducer did not understand published
 * its raw text as the target (`calls activate -> "!context.globalState.get"`,
 * `calls watchFile -> "ensureDynamicPollingWatchFile()"`, each a DUPLICATE of a
 * correct edge the named-child recursion already emitted, carrying a pseudo-name
 * no symbol index can join).
 *
 * THE ALLOWLIST IS DELIBERATELY NARROW, and the narrowness was MEASURED. Reducing
 * through `await`/`!`/`as` as well was the first cut; it retargeted 48 pseudo-name
 * edges, and 17 of them landed in the gate's `arbitraryTwin` class — the class where
 * wrong picks live — because `await this.request<X>({...})` then emitted the bare
 * leaf `request`, which the project declares as an unrelated constant in another
 * file (15 of the 17). A pseudo-name is unjoinable; a wrong name is BINDABLE. So a
 * wrapper around a MEMBER callee publishes nothing, and only the one wrapper that
 * changes no name — parentheses, `(foo)()` -> `foo` — is reduced through. The
 * measured effect on the 400-file stride: all 51 non-identifier target edges are
 * dropped (23,555 -> 23,504), `arbitraryTwin` is FLAT at 2,582, `resolved` FLAT at
 * 6,941, `collRes` FLAT at 1,592 and `amb(decl)` FLAT at 1,364.
 *
 * Returns null for every shape that names nothing or whose name cannot be stated
 * without its receiver: a call of a call (`f()(x)`), a subscript, `super`, an
 * anonymous function, and `await`/`!`/cast wrappers around a member. Returning
 * null means NO edge, never the text; the caller still walks the subtree, so calls
 * inside an IIFE body are kept (`calls-callee-shape-reduction` pins every case;
 * mutants typescript/calls-callee-raw-text and typescript/calls-callee-no-reduction).
 *
 * Bounded (8 unwrap steps), total, and regex-free by the file's contract.
 */
function calleeLeafName(node: Node | null | undefined): string | null {
  let n: Node | null = node ?? null
  // PARENTHESES ONLY. `(readNegated)("k")` names `readNegated`; every other wrapper is
  // either name-changing or receiver-dropping, and the measurement above is why it refuses.
  for (let guard = 0; guard < 8 && n && n.type === "parenthesized_expression"; guard++) {
    n = n.namedChild(0)
  }
  if (!n) return null
  if (n.type === "identifier") return isPlainIdentifier(n.text) ? n.text : null
  if (n.type === "member_expression") {
    const property = n.childForFieldName("property")
    if (!property) return null
    // A PRIVATE MEMBER KEEPS ITS `#` IN THE NAME. `this.#step()` targets the method symbol
    // `#step` (the symbol is stored with the `#` spelling — M49 W15 #813), so the leaf is
    // callable-shaped when it is `#` followed by a plain identifier, and `#` alone is not.
    if (property.type === "private_property_identifier") {
      const text = property.text
      return text.length > 1 && text[0] === "#" && isPlainIdentifier(text.slice(1)) ? text : null
    }
    return isPlainIdentifier(property.text) ? property.text : null
  }
  // `nested_identifier` is the grammar's `A.B` in a heritage/namespace position; a
  // call cannot have one as a callee today, but reducing it costs one branch and
  // keeps a future grammar honest rather than silent.
  if (n.type === "nested_identifier") {
    const last = n.namedChild(n.namedChildCount - 1)
    return last && isPlainIdentifier(last.text) ? last.text : null
  }
  return null
}


// ============================================================================
// PURE-STRING HELPERS (regex-free normalization)
// All token/type text normalization uses startsWith/endsWith + slice — never
// regex literals — keeping the analyzer fully regex-free (criterion 1). These
// are module-level pure functions shared by all classes in this file.
// ============================================================================

function stripLeading(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length).trimStart() : text
}

function stripLeadingColon(text: string): string {
  return stripLeading(text, ":")
}

function stripLeadingEquals(text: string): string {
  return stripLeading(text, "=")
}

function stripTrailingDot(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text
}

function stripTrailingQuestion(text: string): string {
  return text.endsWith("?") ? text.slice(0, -1) : text
}

function stripPrivatePrefix(name: string): string {
  return name.startsWith("#") ? name.slice(1) : name
}

function unquote(text: string): string {
  // Strip one level of matching surrounding quotes ("...", '...', `...`).
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'" || first === "`") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

function stringContent(node: Node): string {
  // Pure-AST string content: prefer the string_fragment child (tree-sitter
  // splits quoted literals into string + string_fragment), else unquote.
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "string_fragment") return c.text
  }
  return unquote(node.text)
}

/**
 * A MODULE SPECIFIER, and only when it is one.
 *
 * `stringContent` above is the right reader for a quoted literal, and it is
 * wrong for a template: `` `data:text/javascript,${src}` `` has a
 * `string_fragment` child holding the LITERAL PREFIX, so `stringContent` returns
 * `data:text/javascript,` — a module path that does not exist and that no file
 * in any project can be joined against.
 *
 * Measured: `await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(enumSource)}`)`
 * in tools/scripts/tsc/generate-enums.ts published `imports generate-enums ->
 * "data:text/javascript;charset=utf-8,:*"`. That is an `imports` edge whose
 * target names a module no injector can serve and no exporter can publish, and
 * it is the one row of 2,926 on a 200-file draw the imports oracle derived that
 * the analyzer did not — the audit found it because the oracle REFUSES to derive
 * a row for a computed specifier, which is the same rule stated on the other
 * side of the comparison.
 *
 * So: a specifier is a plain `string`, or a `template_string` with no
 * substitution in it. Anything else is computed, and a computed module path is
 * not an edge target.
 */
function literalModulePath(node: Node): string | undefined {
  if (!node) return undefined
  if (node.type === "string") return stringContent(node)
  if (node.type === "template_string") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type !== "string_fragment") return undefined
    }
    return stringContent(node)
  }
  return undefined
}

function stripCommentMarkers(text: string): string {
  if (text.startsWith("//")) return text.slice(2).trimStart()
  if (text.startsWith("/*")) {
    const end = text.endsWith("*/") ? text.length - 2 : text.length
    return text.slice(2, end).trim()
  }
  return text.trim()
}

function hasBraceEquals(text: string): boolean {
  // Malformed-call guard: any of { } ; = present (no regex).
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
  }
  return false
}

function stripWhitespace(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") out += ch
  }
  return out
}


/** Strip a literal prefix. NO trimming — the exact `^prefix` behaviour, so it
 *  replaces `/^\.\.\./` on a rest-parameter pattern (`...args` -> `args`) with
 *  the leading space of a hypothetical `"... args"` preserved, exactly as the
 *  regex preserved it. */
function stripPrefix(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}

/** Every character JS `\s` matches, spelled out. Carrying the set keeps
 *  `stripLeadingKeyword` provably identical to the `/^keyword\s+/` replace it
 *  replaces: an ASCII-only test would diverge on the Unicode spaces (`\s`
 *  matches U+00A0 and friends; `" " !== "\s"`). */
const WHITESPACE_CHARS =
  "\f\n\r\t\v                  　﻿"

/** Strip a leading keyword plus the whitespace after it.
 *  Pure string code, the exact `/^keyword\s+/` behaviour: the keyword must be
 *  followed by AT LEAST ONE whitespace character (so a bare `extends`, which
 *  the regex leaves alone, is left alone too), and a word that merely starts
 *  with the keyword (`extendsFoo`) is never cut. */
function stripLeadingKeyword(text: string, keyword: string): string {
  if (!text.startsWith(keyword)) return text
  let i = keyword.length
  if (i >= text.length || WHITESPACE_CHARS.indexOf(text[i]) === -1) return text
  while (i < text.length && WHITESPACE_CHARS.indexOf(text[i]) !== -1) i++
  return text.slice(i)
}

/** Generic type parameters of a declaration, as strings.
 *  `T`, `T extends object`, `T = string`, `T extends A = B`.
 *
 *  ONE implementation for the whole file: it existed three times (the
 *  TypeInferenceEngine copy and the RealTypeScriptAnalyzer copy had ZERO call
 *  sites — only the runner's was live), and the two dead copies were why the
 *  same `/^extends\s+/` regex appeared three times in the regex register.
 *
 *  Field names verified against the pinned tsx/typescript wasm (2026-09-16): a
 *  type_parameter carries name, constraint and value — NOT `extends`/`default`,
 *  which the pre-fix code read while the F1 field oracle was blind. `constraint`
 *  text includes the keyword ("extends object"), hence the strip. */
function extractTypeParametersOf(node: Node): string[] {
  const typeParams: string[] = []
  const typeArgs = node.childForFieldName("type_parameters") || node.childForFieldName("type_arguments")
  if (!typeArgs) return typeParams
  for (let i = 0; i < typeArgs.namedChildCount; i++) {
    const param = typeArgs.namedChild(i)
    if (!param) continue
    const nameNode = param.childForFieldName("name")
    if (!nameNode) {
      typeParams.push(param.text)
      continue
    }
    let paramStr = nameNode.text
    const constraintNode = param.childForFieldName("constraint")
    const defaultValueNode = param.childForFieldName("value")
    if (constraintNode) {
      paramStr += ` extends ${stripLeadingColon(stripLeadingKeyword(constraintNode.text, "extends"))}`
    }
    if (defaultValueNode) {
      paramStr += ` = ${stripLeadingEquals(defaultValueNode.text)}`
    }
    typeParams.push(paramStr)
  }
  return typeParams
}

/**
 * The NAME a value expression is bound to, looking upward through the wrappers
 * that can sit between a value and its binding. PORTED from the javascript twin
 * (`bindingNameAbove`, real-javascript-analyzer.ts:211) so the two analyzers
 * answer one question the same way: `const K = class {…}` binds through a
 * `variable_declarator`, `K = class {…}` through an `assignment_expression`,
 * and anything else — a call argument, a `return`, an array element — names
 * nothing, so the answer is `undefined` rather than a guess. That "rather than a
 * guess" is load-bearing: the twin measured 183 of 204 remaining ownerless
 * members on the svelte corpus as exactly this correct-silence case, and 20 as
 * the assignment form, which was a real gap.
 */
function bindingNameAbove(value: Node): string | undefined {
  let q: Node | null = value.parent
  while (q) {
    if (q.type === "variable_declarator") {
      const nm = q.childForFieldName("name")
      return nm && nm.type === "identifier" ? nm.text : undefined
    }
    if (q.type === "assignment_expression") {
      const l = q.childForFieldName("left")
      return l && l.type === "identifier" ? l.text : undefined
    }
    if (
      q.type === "pair" || q.type === "object" || q.type === "class" || q.type === "class_body" ||
      q.type === "return_statement" || q.type === "expression_statement" || q.type === "export_statement"
    ) {
      q = q.parent
      continue
    }
    return undefined
  }
  return undefined
}

/**
 * The owner a member's container names, PORTED from the javascript twin
 * (`containerOwnerName`, real-javascript-analyzer.ts:232).
 *
 * The class-EXPRESSION arm is what this analyzer was missing: `const A = class
 * Inner { m() {} }` produced NO member at all, because the variable path
 * suppressed descent for every non-`object` initializer, and the javascript
 * twin — which descends — emitted `method:m`. The oracle derives nothing for
 * the shape either, so no differential could ever have flagged it; the twin was
 * the only reference that could. A class expression's own declared name wins
 * (`class Inner`), else the binding it is initialised or assigned to; a
 * function boundary ends the search, because nothing inside a function body is
 * a module-level member of anything.
 */
/**
 * `get` / `set` are ANONYMOUS token children of a `method_definition` — not
 * named children — so a named-child walk never sees them. Verified against the
 * pinned typescript grammar: in `{ get size(){}, set size(v){} }` both members
 * are `method_definition` and each carries one anonymous `get`/`set` token.
 */
function accessorKindOf(node: Node): "get" | "set" | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && (c.type === "get" || c.type === "set")) return c.type
  }
  return undefined
}

function containerOwnerName(n: Node): string | undefined {
  let p: Node | null = n.parent
  while (p) {
    if (p.type === "class_declaration" || p.type === "abstract_class_declaration") {
      return p.childForFieldName("name")?.text
    }
    if (p.type === "class") {
      const own = p.childForFieldName("name")?.text
      if (own) return own
      return bindingNameAbove(p)
    }
    if (p.type === "object") {
      return bindingNameAbove(p)
    }
    if (
      p.type === "function_declaration" || p.type === "function_expression" ||
      p.type === "arrow_function" || p.type === "generator_function_declaration" ||
      p.type === "method_definition" || p.type === "function"
    ) {
      return undefined
    }
    p = p.parent
  }
  return undefined
}

// Contract route paths always start with "/": join a controller base with a
// method route collapsing duplicate slashes (pure string ops, no regex —
// java composes basePath+methodRoute the same way).
function joinContractPaths(base: string, route: string | undefined): string {
  let b = base
  while (b.length > 1 && b.endsWith("/")) b = b.slice(0, -1)
  let r = route ?? ""
  while (r.startsWith("/")) r = r.slice(1)
  while (r.length > 0 && r.endsWith("/")) r = r.slice(0, -1)
  if (!b.startsWith("/")) b = "/" + b
  return r ? b + "/" + r : b
}

function ensureLeadingSlash(p: string): string {
  return p.startsWith("/") ? p : "/" + p
}

// ============================================================================
// SCOPE MANAGEMENT - Proper scope tracking with push/pop for all scope types
// ============================================================================

enum ScopeKind {
  Global = "global",
  Module = "module",
  Namespace = "namespace",
  Class = "class",
  Function = "function",
  Method = "method",
  Block = "block",
  ArrowFunction = "arrow_function",
  Constructor = "constructor",
  Interface = "interface",
  Enum = "enum",
  Type = "type",
}

interface ScopeEntry {
  kind: ScopeKind
  name: string
  node: Node
  symbols: Map<string, ASTEngine.UniversalSymbol>
}

interface StackEntry {
  node?: Node
  action?: () => void
}

class ScopeManager {
  private stack: ScopeEntry[] = []

  constructor() {
    // Start with global scope
    this.pushScope(ScopeKind.Global, "__global__", null as any)
  }

  pushScope(kind: ScopeKind, name: string, node: Node): void {
    this.stack.push({
      kind,
      name,
      node,
      symbols: new Map(),
    })
  }

  popScope(): ScopeEntry | undefined {
    if (this.stack.length > 1) {
      return this.stack.pop()
    }
    return undefined // Never pop global scope
  }

  currentScope(): ScopeEntry {
    return this.stack[this.stack.length - 1]
  }

  buildQualifiedName(name: string): string {
    const parts: string[] = []
    for (let i = 1; i < this.stack.length; i++) {
      const scope = this.stack[i]
      if (scope.kind !== ScopeKind.Block && scope.kind !== ScopeKind.Global) {
        parts.push(scope.name)
      }
    }
    parts.push(name)
    return parts.join(".")
  }

  getOwnerInfo(): { ownerName?: string; ownerKind?: ASTEngine.SymbolKind } | undefined {    // Find the nearest class/namespace/interface owner
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const scope = this.stack[i]
      switch (scope.kind) {
        case ScopeKind.Class:
          return { ownerName: scope.name, ownerKind: ASTEngine.SymbolKind.Class }
        case ScopeKind.Namespace:
          return { ownerName: scope.name, ownerKind: ASTEngine.SymbolKind.Namespace }
        case ScopeKind.Interface:
          return { ownerName: scope.name, ownerKind: ASTEngine.SymbolKind.Interface }
        case ScopeKind.Enum:
          return { ownerName: scope.name, ownerKind: ASTEngine.SymbolKind.Enum }
      }
    }
    return undefined
  }

  /**
   * R10: the owner of a DECLARATION, decided LEXICALLY.
   *
   * `getOwnerInfo()` alone answers the wrong question for a declaration nested
   * in a function body: it walks to the nearest class/namespace/interface/enum
   * scope and SKIPS function scopes, so `class K { go() { function inner(){} } }`
   * resolved `inner`'s owner to `K` and emitted `contains K->inner` — the graph
   * claiming the class has a member it does not have. The same false edge
   * appeared for a type alias and an interface declared in a method body, and for
   * a function declared inside a namespace function.
   *
   * It cannot be fixed in the scope stack, because that stack ACCUMULATES: the
   * class member loop extracts each member synchronously, so while member 2 is
   * being resolved, member 1's Method scope is still on top. A guard there —
   * "a function scope means local" — was tried and measured, and it stripped REAL
   * members, because member 2 legitimately resolves through member 1's leftover
   * scope to the class. The scope stack is a resource stack, not a faithful
   * lexical stack, so the question is asked of the TREE instead.
   *
   * A declaration belongs to the nearest enclosing BODY container; if any
   * function body sits between it and that container, it is a local of that
   * function and owns nothing. All five shapes measured:
   *
   *   class K { a(){} b(){} }                 -> b's parent is class_body  : member
   *   class K { go() { function inner(){} } }  -> inner meets `go` first    : local
   *   function f() { class C {} }              -> C meets `f` first         : local
   *   namespace N { export function f() {} }   -> f meets no function       : member
   *   function f() { class C { m(){} } }       -> m meets class_body first  : member
   */
  getOwnerInfoForDeclaration(node: any): { ownerName?: string; ownerKind?: ASTEngine.SymbolKind } | undefined {
    for (let p = node?.parent; p; p = p.parent) {
      const t = p.type
      if (
        t === "function_declaration" || t === "generator_function_declaration" ||
        t === "function_signature" || t === "function_expression" ||
        t === "arrow_function" || t === "method_definition" || t === "function"
      ) return undefined
      if (t === "class_body" || t === "interface_body" || t === "enum_body") break
    }
    return this.getOwnerInfo()
  }

  findEnclosingClassNode(): Node | null {
    // Nearest Class scope's node (for class-level decorator lookup —
    // controller base paths). Returns null outside any class.
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === ScopeKind.Class) return this.stack[i].node
    }
    return null
  }

  registerSymbol(symbol: ASTEngine.UniversalSymbol): void {
    this.currentScope().symbols.set(symbol.name, symbol)
  }

  findSymbolInScope(name: string): ASTEngine.UniversalSymbol | undefined {
    // Search from innermost to outermost scope
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const found = this.stack[i].symbols.get(name)
      if (found) return found
    }
    return undefined
  }

  isInsideClass(): boolean {
    return someItems(this.stack, (s) => s.kind === ScopeKind.Class)
  }

  isInsideFunction(): boolean {
    return someItems(
      this.stack,
      (s) =>
        s.kind === ScopeKind.Function ||
        s.kind === ScopeKind.Method ||
        s.kind === ScopeKind.ArrowFunction ||
        s.kind === ScopeKind.Constructor,
    )
  }

  getDepth(): number {
    return this.stack.length
  }

  reset(): void {
    this.stack = []
    this.pushScope(ScopeKind.Global, "__global__", null as any)
  }
}

// ============================================================================
// MODULE RESOLUTION - Real Node.js module resolution algorithm
// ============================================================================

class TypeScriptModuleResolver {
  constructor(private baseDir: string) {}

  resolveModulePath(specifier: string, fromFile: string): string {
    const fromDir = path.dirname(fromFile)

    // Handle relative imports — pure path algebra, no existence probes.
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return path.resolve(fromDir, specifier)
    }

    // Handle absolute imports starting with /
    if (specifier.startsWith("/")) {
      return path.join(this.baseDir, specifier)
    }

    // Handle Node.js built-ins
    if (isBuiltinModule(specifier)) {
      return `node:${stripLeading(specifier, "node:")}`
    }

    // Bare package imports are recorded by logical identity
    // (`external:specifier`) — reached only when `isBuiltinModule` says the
    // specifier is not a Node runtime module. A previous revision walked up
    // to node_modules and sniffed package.json main/types entry points —
    // every answer it gave depended on the local machine, so the same repo
    // indexed differently per machine, at the cost of sync statSync I/O per
    // import per file. Nothing reads past the specifier (verified: no
    // metadata.resolvedPath consumers repo-wide; fixtures pin module/items
    // only). Deterministic on every machine.
    return `external:${specifier}`
  }

}

// Node.js built-in modules — module-level so every resolution doesn't
// reallocate the set (the old per-call construction ran per import).
//
// A PINNED contract, deliberately NOT `builtinModules` from node:module. That
// import would be shorter and self-maintaining, and it would also make
// classification depend on the Node version running the index: `node:sqlite`
// exists in the runtime's list and not in an older one's, so the same source
// would resolve differently on two machines — the exact machine-dependence the
// module resolver was rewritten to remove (no statSync, no node_modules
// sniffing, `external:` for bare packages). A fixed table plus the subpath-head
// rule below is the same answer on every machine and every Node version, which
// is worth more here than the maintenance saving. The table tracks Node >= 22
// (the `test` runner landed in 18; `sqlite`, `sea` and `diagnostics_channel`
// are the later additions).
const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "zlib",
  "async_hooks",
  "inspector",
  "perf_hooks",
  "trace_events",
  "worker_threads",
  "wasi",
  // Node >= 18: the test runner and the other late additions. A stale list is
  // the same defect as a missing subpath branch — the module is real, the
  // table just predates it.
  "test",
  "sqlite",
  "sea",
  "diagnostics_channel",
])

function isBuiltinModule(specifier: string): boolean {
  const bare = stripLeading(specifier, "node:")
  if (NODE_BUILTINS.has(bare)) return true
  // Node's own spec exposes most builtins under SUBPATH names: `node:fs/promises`,
  // `stream/promises`, `readline/promises`, `timers/promises`, `dns/promises`,
  // `util/types`, `assert/strict`, `path/posix`, `node:test/reporters`. A head
  // that is a builtin makes the whole specifier a RUNTIME module, never a
  // package. Without this branch every one of them fell through to
  // `external:…`, so the index reported a dependency on an npm package called
  // `fs/promises` (and `node:test`, `stream/promises`, …) in every modern
  // Node codebase — the exact misclassification the bare-name set could not see.
  const slash = bare.indexOf("/")
  if (slash <= 0) return false
  return NODE_BUILTINS.has(bare.slice(0, slash))
}

// ============================================================================
// MODIFIER EXTRACTION - AST-based, no text.includes() hacks
// ============================================================================

interface ModifierInfo {
  isPublic: boolean
  isPrivate: boolean
  isProtected: boolean
  isStatic: boolean
  isAsync: boolean
  isAbstract: boolean
  isReadonly: boolean
  isExport: boolean
  isDefault: boolean
  isDeclare: boolean
  isConst: boolean
  isOverride: boolean
  decorators: string[]
  /** Decorator lines, PARALLEL to `decorators` (M59 #860). The name list is
   *  what the store reads on the symbol; this list lets a decorator's reference
   *  edge name the line the decorator is written on, exactly as
   *  extendsLines/implementsLines do for heritage. */
  decoratorLines: Array<number | null>
}

/** Record a decorator name WITH its own line, keeping the two lists in
 *  lockstep. A name already recorded keeps its first line (the same decorator
 *  is seen by both the own-children scan and the sibling collector). */
function addDecorator(m: ModifierInfo, name: string, line: number | null): void {
  if (m.decorators.includes(name)) return
  m.decorators.push(name)
  m.decoratorLines.push(line)
}

function extractModifiersFromNode(node: Node): ModifierInfo {
  const result: ModifierInfo = {
    isPublic: false,
    isPrivate: false,
    isProtected: false,
    isStatic: false,
    isAsync: false,
    isAbstract: false,
    isReadonly: false,
    isExport: false,
    isDefault: false,
    isDeclare: false,
    isConst: false,
    isOverride: false,
    decorators: [],
    decoratorLines: [],
  }

  // Check for decorators first (they come before modifiers)
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child) continue

    if (child.type === "decorator") {
      const decoratorName = extractDecoratorName(child)
      if (decoratorName) {
        addDecorator(result, decoratorName, child.startPosition.row + 1)
      }
    }
  }

  // Walk through all children to find modifiers
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue

    const nodeType = child.type
    const nodeText = child.text

    // Handle accessibility modifiers
    if (nodeType === "accessibility_modifier") {
      switch (nodeText) {
        case "public":
          result.isPublic = true
          break
        case "private":
          result.isPrivate = true
          break
        case "protected":
          result.isProtected = true
          break
      }
      continue
    }

    // Handle individual keyword modifiers
    switch (nodeType) {
      case "static":
        result.isStatic = true
        break
      case "async":
        result.isAsync = true
        break
      case "abstract":
        result.isAbstract = true
        break
      case "readonly":
        result.isReadonly = true
        break
      case "export":
        result.isExport = true
        break
      case "default":
        result.isDefault = true
        break
      case "declare":
        result.isDeclare = true
        break
      case "const":
        result.isConst = true
        break
      case "override":
        result.isOverride = true
        break
    }

    // Also check text for keywords that might be typed differently
    if (nodeText === "static") result.isStatic = true
    if (nodeText === "async") result.isAsync = true
    if (nodeText === "abstract") result.isAbstract = true
    if (nodeText === "readonly") result.isReadonly = true
    if (nodeText === "export") result.isExport = true
    if (nodeText === "default") result.isDefault = true
    if (nodeText === "declare") result.isDeclare = true
    if (nodeText === "override") result.isOverride = true
  }

  return result
}

/**
 * Decorators for a class-level definition. Placement is ASYMMETRIC in this
 * grammar family: field decorators attach INSIDE public_field_definition,
 * but class decorators are children of export_statement/class_declaration
 * and METHOD decorators are SIBLINGS in class_body preceding the
 * method_definition. Reading only the definition node's own children sees
 * field decorators and misses everything else.
 */
function collectDecoratorsForMember(member: Node, body: Node | null): Node[] {
  const out: Node[] = []
  const own = extractModifiersFromNode(member).decorators
  if (own.length > 0) return [] // own-children scan already handled it

  // Method/class decorators: immediately-preceding consecutive decorator
  // siblings within the same body.
  if (body) {
    // web-tree-sitter returns FRESH wrapper objects per access — node
    // identity must be compared by startIndex, not object equality.
    let idx = -1
    for (let i = 0; i < body.namedChildCount; i++) {
      const c = body.namedChild(i)
      if (c && c.startIndex === member.startIndex && c.type === member.type) { idx = i; break }
    }
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        const sib = body.namedChild(i)
        if (sib && sib.type === "decorator") out.unshift(sib)
        else break
      }
    }
  }
  return out
}

/** Class decorators: own children, or the wrapping export_statement's. */
function collectDecoratorsForClass(node: Node): Node[] {
  const out: Node[] = []
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && c.type === "decorator") out.push(c)
  }
  if (out.length === 0 && node.parent?.type === "export_statement") {
    for (let i = 0; i < node.parent.childCount; i++) {
      const c = node.parent.child(i)
      if (c && c.type === "decorator") out.push(c)
    }
  }
  return out
}

function extractDecoratorName(decoratorNode: Node): string | null {  // Decorator structure: @DecoratorName or @DecoratorName() or @module.Decorator()
  for (let i = 0; i < decoratorNode.namedChildCount; i++) {
    const child = decoratorNode.namedChild(i)
    if (!child) continue

    if (child.type === "identifier") {
      return child.text
    }

    if (child.type === "call_expression") {
      const callee = child.namedChild(0)
      if (callee) {
        if (callee.type === "identifier") {
          return callee.text
        }
        if (callee.type === "member_expression") {
          // Get the property name for qualified decorators
          const property = callee.childForFieldName("property")
          if (property) {
            return callee.text // Return full qualified name
          }
        }
      }
    }

    if (child.type === "member_expression") {
      return child.text
    }
  }

  return null
}

// ============================================================================
// EXPORT STATUS ANALYSIS - AST parent analysis for export detection
// ============================================================================

function isNodeExported(node: Node): { isExported: boolean; isDefault: boolean } {
  let current: Node | null = node

  while (current) {
    const p = current.parent as Node | null
    if (!p) break

    // Check if wrapped in export statement
    if (p.type === "export_statement") {
      // Check for default export
      for (let i = 0; i < p.childCount; i++) {
        const child = p.child(i)
        if (child && child.text === "default") {
          return { isExported: true, isDefault: true }
        }
      }
      return { isExported: true, isDefault: false }
    }

    // NAMED-CONTAINER BOUNDARY (TS export semantics): a member of a
    // namespace/module needs its OWN export keyword — the container being
    // exported does not export its members. The unconditional climb marked
    // `class Hidden {}` inside `export namespace NS` as exported/public.
    if (p.type === "statement_block" && p.parent?.type === "internal_module") {
      const ownMods = extractModifiersFromNode(current)
      return { isExported: ownMods.isExport, isDefault: ownMods.isDefault }
    }

    // Check for inline export keyword
    if (
      p.type === "lexical_declaration" ||
      p.type === "function_declaration" ||
      p.type === "class_declaration" ||
      p.type === "interface_declaration" ||
      p.type === "type_alias_declaration" ||
      p.type === "enum_declaration"
    ) {
      const modifiers = extractModifiersFromNode(p)
      if (modifiers.isExport) {
        return { isExported: true, isDefault: modifiers.isDefault }
      }
    }

    current = p
  }

  // Also check the node itself for export keyword
  const modifiers = extractModifiersFromNode(node)
  if (modifiers.isExport) {
    return { isExported: true, isDefault: modifiers.isDefault }
  }

  return { isExported: false, isDefault: false }
}

// ============================================================================
// IMPORT CLAUSE PARSING - Full AST-based import clause extraction
// ============================================================================

interface ImportClauseInfo {
  defaultImport?: string
  namespaceImport?: string
  namedImports: Array<{ name: string; alias?: string }>
}

function extractImportClause(importNode: Node): ImportClauseInfo {
  const result: ImportClauseInfo = {
    namedImports: [],
  }

  for (let i = 0; i < importNode.namedChildCount; i++) {
    const child = importNode.namedChild(i)
    if (!child) continue

    switch (child.type) {
      case "import_clause": {
        // Process the import clause which contains default/named imports
        for (let j = 0; j < child.namedChildCount; j++) {
          const clauseChild = child.namedChild(j)
          if (!clauseChild) continue

          if (clauseChild.type === "identifier") {
            // Default import
            result.defaultImport = clauseChild.text
          } else if (clauseChild.type === "namespace_import") {
            // import * as name
            const asName = clauseChild.childForFieldName("name") || clauseChild.namedChild(0)
            if (asName) {
              result.namespaceImport = asName.text
            }
          } else if (clauseChild.type === "named_imports") {
            // { name1, name2 as alias2 }
            for (let k = 0; k < clauseChild.namedChildCount; k++) {
              const specifier = clauseChild.namedChild(k)
              if (specifier && specifier.type === "import_specifier") {
                const name = specifier.childForFieldName("name")
                const alias = specifier.childForFieldName("alias")

                if (name) {
                  result.namedImports.push({
                    name: name.text,
                    alias: alias?.text,
                  })
                }
              }
            }
          }
        }
        break
      }

      case "identifier": {
        // Direct identifier (default import in some tree-sitter versions)
        if (!result.defaultImport) {
          result.defaultImport = child.text
        }
        break
      }

      case "namespace_import": {
        const asName = child.childForFieldName("name") || child.namedChild(0)
        if (asName) {
          result.namespaceImport = asName.text
        }
        break
      }

      case "named_imports": {
        for (let k = 0; k < child.namedChildCount; k++) {
          const specifier = child.namedChild(k)
          if (specifier && specifier.type === "import_specifier") {
            const name = specifier.childForFieldName("name")
            const alias = specifier.childForFieldName("alias")

            if (name) {
              result.namedImports.push({
                name: name.text,
                alias: alias?.text,
              })
            }
          }
        }
        break
      }
    }
  }

  return result
}

/**
 * M59 (#825): the same items as `extractImportItems`, each paired with the node
 * that SPELLS the imported name — for `{ A as B }` that is `A`, because the edge
 * target is `module:A` and the line must be where the target is written. This is
 * scala mechanism 5 transferred: an import whose named segment sits on a later
 * line than its `import` keyword must not take the statement's first line, and a
 * string-only item list cannot say which line that is. Kept beside
 * `extractImportItems` so the two cannot drift (one is that walk's names, the
 * other its names plus their nodes).
 */
/**
 * The names an `import_statement` binds, each with the node that names it AND
 * whether that SPECIFIER carried TypeScript's inline `type` modifier
 * (`import { type A, B } from "m"`, TS 4.5+).
 *
 * The per-item flag is threaded through rather than recomputed by the caller
 * because this function returns the specifier's `name` FIELD, not the
 * `import_specifier` that owns the modifier — the caller holding `name` cannot
 * see a `type` sibling of it. Returning the specifier instead would change what
 * the `lineField` below stamps, since M59 (#825) pins the imported NAME's own
 * line, so the flag travels beside the node rather than replacing it.
 */
function extractImportItemsWithNodes(importNode: Node): Array<{ item: string; node: Node; typeOnly: boolean }> {
  const out: Array<{ item: string; node: Node; typeOnly: boolean }> = []
  for (let i = 0; i < importNode.namedChildCount; i++) {
    const child = importNode.namedChild(i)
    if (!child) continue
    if (child.type === "import_clause") {
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j)
        if (!c) continue
        if (c.type === "identifier") {
          out.push({ item: c.text, node: c, typeOnly: false })
        } else if (c.type === "namespace_import") {
          const asName = c.childForFieldName("name") ?? c.namedChild(0)
          if (asName) out.push({ item: `* as ${asName.text}`, node: asName, typeOnly: false })
        } else if (c.type === "named_imports") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const spec = c.namedChild(k)
            if (!spec || spec.type !== "import_specifier") continue
            const name = spec.childForFieldName("name")
            const alias = spec.childForFieldName("alias")
            if (name) out.push({ item: alias ? `${name.text} as ${alias.text}` : name.text, node: name, typeOnly: isTypeOnlySpecifier(spec) })
          }
        }
      }
    } else if (child.type === "identifier") {
      out.push({ item: child.text, node: child, typeOnly: false })
    } else if (child.type === "namespace_import") {
      const asName = child.childForFieldName("name") ?? child.namedChild(0)
      if (asName) out.push({ item: `* as ${asName.text}`, node: asName, typeOnly: false })
    } else if (child.type === "named_imports") {
      for (let k = 0; k < child.namedChildCount; k++) {
        const spec = child.namedChild(k)
        if (!spec || spec.type !== "import_specifier") continue
        const name = spec.childForFieldName("name")
        const alias = spec.childForFieldName("alias")
        if (name) out.push({ item: alias ? `${name.text} as ${alias.text}` : name.text, node: name, typeOnly: isTypeOnlySpecifier(spec) })
      }
    }
  }
  return out
}

/**
 * The twin's J4 rule, ported: does this `require(...)` bind the module's DEFAULT
 * export? A bare-identifier binding (`const m = require("m")`) takes the default;
 * a destructuring binding (`const { a } = require("m")`) takes named members. The
 * javascript lane hardcoded `true` for every require and flagged everything as a
 * default import, so the rule is stated once here rather than copied twice.
 */
function requireBindsDefault(call: Node): boolean {
  let vp: Node | null = call.parent
  while (
    vp && vp.type !== "variable_declarator" && vp.type !== "lexical_declaration" &&
    vp.type !== "variable_declaration" && vp.type !== "export_statement" &&
    vp.type !== "expression_statement" && vp.type !== "program"
  ) {
    vp = vp.parent
  }
  if (vp && vp.type === "variable_declarator") {
    const bindName = vp.childForFieldName("name")
    return !!bindName && bindName.type === "identifier"
  }
  return false
}

/**
 * The module path an `import_statement` names, for BOTH shapes the grammar uses.
 *
 * `import { a } from "./m"` puts the path in a `source` FIELD of the statement,
 * while `import m = require("./m")` wraps it in an `import_require_clause` whose
 * string is an ordinary named child (probed: `import_statement >
 * import_require_clause > identifier, string`). Reading only the `source` field
 * silently skipped the whole TypeScript form of CommonJS require, so those files
 * reported no dependency at all.
 */
function importStatementSource(importNode: Node): Node | null {
  const direct = importNode.childForFieldName?.("source")
  if (direct) return direct
  for (let i = 0; i < (importNode.namedChildCount ?? 0); i++) {
    const c = importNode.namedChild(i)
    if (!c || c.type !== "import_require_clause") continue
    for (let j = 0; j < c.namedChildCount; j++) {
      const s = c.namedChild(j)
      if (s && s.type === "string") return s
    }
  }
  return null
}

/** True when this `import_statement` is the `import x = require(...)` form. */
function isImportRequireClause(importNode: Node): boolean {
  for (let i = 0; i < (importNode.namedChildCount ?? 0); i++) {
    const c = importNode.namedChild(i)
    if (c && c.type === "import_require_clause") return true
  }
  return false
}

/**
 * True when this `import_statement` carries TypeScript's `type` modifier —
 * `import type { T } from "m"`, erased at compile time and unusable as a value.
 *
 * The modifier is an ANONYMOUS `type` child of the statement itself, a sibling
 * of `import_clause`, so a named-child walk cannot see it. Measured: 655
 * type-only `import_statement` nodes across 279 of 400 admitted element-plus
 * files, 982 type-only specifiers against 2,058 value specifiers — 32% of the
 * import surface on that corpus. The specifiers were already emitted as
 * `imports` edges (271 of 271 files with a type-only import produce one), so
 * this is not a missing edge: it is an edge that cannot say what it is. The
 * graph asserted a runtime dependency where the compiler asserts none, and a
 * consumer could not tell the two apart from the edge alone.
 *
 * `childCount`/`child(i)` rather than `namedChildCount`/`namedChild(i)` is the
 * whole point; `isImportRequireClause` above uses the named walk because
 * `import_require_clause` IS a named node.
 */
/** `export type { A } from "./m"` — the statement-level TYPE-ONLY re-export. The `type` token is
 *  an anonymous child of export_statement in the grammar (probed on tree-sitter-typescript
 *  0.23.2), so it is read by token, not by a named-node type. */
function isTypeOnlyExport(node: Node): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c) continue
    if (c.text === "type") return true
    // Stop once the clause opens: a `type` inside the clause belongs to an individual specifier,
    // not to the statement's `type` keyword.
    if (c.type === "export_clause") break
  }
  return false
}

function isTypeOnlyImport(importNode: Node): boolean {
  for (let i = 0; i < (importNode.childCount ?? 0); i++) {
    const c = importNode.child(i)
    if (c && c.type === "type") return true
  }
  return false
}

/**
 * The INLINE type modifier of TypeScript 4.5+ — `import { type A, B } from "m"`,
 * where one specifier is erased and another is not, in a single statement.
 *
 * Same grammar fact as `isTypeOnlyImport` at a smaller radius: an anonymous
 * `type` child, this time of the `import_specifier` rather than of the
 * statement. `import def, { type Only, value } from "./mixed"` is a real and
 * common shape, and a statement-level flag alone gets it wrong in the
 * expensive direction — it would report `Only` as a runtime dependency the
 * compiler has already deleted. Statement-level `import type {...}` erases the
 * WHOLE statement, so it takes precedence when both could apply.
 */
function isTypeOnlySpecifier(specifierNode: Node): boolean {
  for (let i = 0; i < (specifierNode.childCount ?? 0); i++) {
    const c = specifierNode.child(i)
    if (c && c.type === "type") return true
  }
  return false
}

function extractImportItems(importNode: Node): string[] {
  const clause = extractImportClause(importNode)
  const items: string[] = []

  if (clause.defaultImport) {
    items.push(clause.defaultImport)
  }

  if (clause.namespaceImport) {
    items.push(`* as ${clause.namespaceImport}`)
  }

  for (const named of clause.namedImports) {
    if (named.alias) {
      items.push(`${named.name} as ${named.alias}`)
    } else {
      items.push(named.name)
    }
  }

  return items
}

// ============================================================================
// TYPE INFERENCE ENGINE - Real type inference from context and usage
// ============================================================================

interface TypeInfo {
  type: string
  isOptional: boolean
  isNullable: boolean
  isArray: boolean
  genericArgs?: string[]
  source: "explicit" | "inferred" | "unknown"
}

class TypeInferenceEngine {
  private inferredTypes = new Map<string, TypeInfo>()

  inferType(node: Node, hint?: string): TypeInfo {
    const nameNode = node.childForFieldName("name")
    const id = nameNode?.type === "identifier" ? nameNode.text : undefined

    // Check for explicit type annotation first
    const typeAnnotation = this.findTypeAnnotation(node)
    if (typeAnnotation) {
      const info = this.parseTypeAnnotation(typeAnnotation)
      if (id) this.inferredTypes.set(id, info)
      return info
    }

    // Try to infer from initializer
    const initializer =
      node.childForFieldName("value") || node.childForFieldName("initializer") || this.findInitializer(node)

    if (initializer) {
      const info = this.inferFromInitializer(initializer)
      if (id) this.inferredTypes.set(id, info)
      return info
    }

    // Try usage-based inference when no explicit type or initializer exists
    const usage = this.inferFromUsage(node)
    if (usage.type !== "unknown") {
      if (id) this.inferredTypes.set(id, usage)
      return usage
    }

    // Use hint if provided
    if (hint) {
      const info = { type: hint, isOptional: false, isNullable: false, isArray: false, source: "inferred" as const }
      if (id) this.inferredTypes.set(id, info)
      return info
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }

  inferFromUsage(node: Node): TypeInfo {
    const nameNode = node.childForFieldName("name") || node.namedChild(0)
    if (nameNode?.type === "identifier") {
      const known = this.inferredTypes.get(nameNode.text)
      if (known) return known
    }

    const use = node.childForFieldName("value") || node.childForFieldName("initializer") || this.findInitializer(node)
    if (use && (use.type === "identifier" || use.type === "member_expression" || use.type === "call_expression")) {
      return this.inferFromInitializer(use)
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }

  inferFromInitializer(node: Node): TypeInfo {
    switch (node.type) {
      case "string":
      case "template_string":
        return { type: "string", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "number":
        return { type: "number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "true":
      case "false":
        return { type: "boolean", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "null":
        return { type: "null", isOptional: false, isNullable: true, isArray: false, source: "inferred" }

      case "undefined":
        return { type: "undefined", isOptional: true, isNullable: false, isArray: false, source: "inferred" }

      case "array":
        const elementType = this.inferArrayElementType(node)
        return { type: `${elementType}[]`, isOptional: false, isNullable: false, isArray: true, source: "inferred" }

      case "object":
        return { type: "object", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "arrow_function":
      case "function":
      case "function_expression":
        const returnType = this.inferFunctionReturnType(node)
        return { type: `() => ${returnType}`, isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "new_expression":
        const className = node.namedChild(0)?.text || "Object"
        return { type: className, isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "call_expression":
        return this.inferFromCallExpression(node)

      case "await_expression":
        const awaitedType = this.inferFromInitializer(node.namedChild(0)!)
        // Unwrap Promise type
        if (awaitedType.type.startsWith("Promise<")) {
          const inner = awaitedType.type.slice(8, -1)
          return { ...awaitedType, type: inner }
        }
        return awaitedType

      case "binary_expression":
        return this.inferFromBinaryExpression(node)

      case "ternary_expression":
      case "conditional_expression":
        // Type is union of consequence and alternative
        const consequence = node.childForFieldName("consequence")
        const alternative = node.childForFieldName("alternative")
        if (consequence && alternative) {
          const t1 = this.inferFromInitializer(consequence)
          const t2 = this.inferFromInitializer(alternative)
          if (t1.type === t2.type) {
            return t1
          }
          return {
            type: `${t1.type} | ${t2.type}`,
            isOptional: false,
            isNullable: false,
            isArray: false,
            source: "inferred",
          }
        }
        return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }

      case "regex":
        return { type: "RegExp", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "as_expression":
        // Type assertion, use the asserted type
        const typeNode = node.childForFieldName("type")
        if (typeNode) {
          return this.parseTypeAnnotation(typeNode)
        }
        break

      case "identifier":
      case "member_expression":
        // Would need symbol table lookup for accurate inference
        return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }

  private findTypeAnnotation(node: Node): Node | null {
    // Look for type_annotation child
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "type_annotation") {
        // Return the actual type node inside the annotation
        return child.namedChild(0) || child
      }
    }

    // Also check for return type in function declarations
    const returnType = node.childForFieldName("return_type")
    if (returnType) {
      return returnType.namedChild(0) || returnType
    }

    return null
  }

  private findInitializer(node: Node): Node | null {
    // Walk children looking for initializer patterns
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue

      // Skip type annotations and identifiers
      if (child.type === "type_annotation" || child.type === "identifier") continue

      // Look for values after = sign
      if (
        node.type === "variable_declarator" ||
        node.type === "property_signature" ||
        node.type === "public_field_definition"
      ) {
        // The value is usually the last named child that's not a type
        if (i === node.namedChildCount - 1 && child.type !== "type_annotation") {
          return child
        }
      }
    }

    return null
  }

  private parseTypeAnnotation(typeNode: Node): TypeInfo {
    const text = typeNode.text

    // Check for optional marker
    let isOptional = typeNode.type === "optional_type"
    let isNullable = false
    let isArray = typeNode.type === "array_type"

    const stack = [typeNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "optional_type") isOptional = true
      if (n.type === "array_type") isArray = true
      if (n.type === "null" || n.type === "undefined" || n.text === "null" || n.text === "undefined") isNullable = true
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    // Extract generic args if present
    let genericArgs: string[] | undefined
    if (typeNode.type === "generic_type") {
      const typeArgs = typeNode.childForFieldName("type_arguments")
      if (typeArgs) {
        genericArgs = []
        for (let i = 0; i < typeArgs.namedChildCount; i++) {
          const arg = typeArgs.namedChild(i)
          if (arg) genericArgs.push(arg.text)
        }
      }
    }

    return {
      type: stripTrailingQuestion(text).trim(),
      isOptional,
      isNullable,
      isArray,
      genericArgs,
      source: "explicit",
    }
  }


  private inferArrayElementType(arrayNode: Node): string {
    if (arrayNode.namedChildCount === 0) return "unknown"

    const firstElement = arrayNode.namedChild(0)
    if (firstElement) {
      const elementType = this.inferFromInitializer(firstElement)
      return elementType.type
    }

    return "unknown"
  }

  public inferFunctionReturnType(funcNode: Node): string {
    // Look for explicit return type
    const returnType = funcNode.childForFieldName("return_type")
    if (returnType) {
      return stripLeadingColon(returnType.text)
    }

    // Try to infer from return statements
    const returns = this.findReturnStatements(funcNode)
    if (returns.length > 0) {
      const types = mapItems(returns, (r) => {
        const arg = r.namedChild(0)
        if (arg) {
          // T3 wave: `return x` where x is a declared parameter reads the
          // parameter's type annotation — otherwise every identifier return
          // degrades to unknown even with full annotations present.
          if (arg.type === "identifier") {
            const paramType = this.findParameterType(funcNode, arg.text)
            if (paramType) return paramType
          }
          return this.inferFromInitializer(arg).type
        }
        return "void"
      })

      const uniqueTypes = [...new Set(types)]
      if (uniqueTypes.length === 1) {
        return uniqueTypes[0]
      }
      return uniqueTypes.join(" | ")
    }

    return "void"
  }

  private findParameterType(funcNode: Node, name: string): string | undefined {
    // `formal_parameters` is a node TYPE, not a field: that second read could
    // never resolve. The positional fallback keeps the original intent for any
    // shape that carries an unnamed parameter list.
    const params =
      funcNode.childForFieldName("parameters") ||
      funcNode.namedChildren.find((c: Node | null) => c?.type === "formal_parameters")
    if (!params) return undefined
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (!p) continue
      const nm = p.childForFieldName("pattern") || p.childForFieldName("name") || p.namedChild(0)
      const matches = !!nm && (nm.type === "identifier" ? nm.text === name : nm.text === name)
      if (!matches) continue
      const t = p.childForFieldName("type")
      if (t) return stripLeadingColon(t.text)
      for (let j = 0; j < p.namedChildCount; j++) {
        const c = p.namedChild(j)
        if (c && c.type === "type_annotation") return stripLeadingColon(c.text)
      }
      return undefined
    }
    return undefined
  }

  private findReturnStatements(node: Node): Node[] {
    const returns: Node[] = []

    const traverse = (n: Node) => {
      if (n.type === "return_statement") {
        returns.push(n)
      }
      // Don't descend into nested functions
      if (n.type !== "arrow_function" && n.type !== "function_declaration" && n.type !== "function_expression") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) traverse(child)
        }
      }
    }

    // Start from function body
    const body = node.childForFieldName("body")
    if (body) {
      for (let i = 0; i < body.namedChildCount; i++) {
        const child = body.namedChild(i)
        if (child) traverse(child)
      }
    }

    return returns
  }

  private inferFromCallExpression(node: Node): TypeInfo {
    const callee = node.namedChild(0)
    if (!callee) return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }

    const calleeName = callee.text

    // Common known function return types
    const knownReturns: Record<string, string> = {
      parseInt: "number",
      parseFloat: "number",
      String: "string",
      Number: "number",
      Boolean: "boolean",
      Array: "unknown[]",
      "Object.keys": "string[]",
      "Object.values": "unknown[]",
      "Object.entries": "[string, unknown][]",
      "JSON.parse": "any",
      "JSON.stringify": "string",
      "Array.from": "unknown[]",
      "Array.isArray": "boolean",
      "Math.floor": "number",
      "Math.ceil": "number",
      "Math.round": "number",
      "Math.random": "number",
      "Date.now": "number",
      "Promise.resolve": "Promise<unknown>",
      "Promise.reject": "Promise<never>",
      "Promise.all": "Promise<unknown[]>",
    }

    if (knownReturns[calleeName]) {
      return {
        type: knownReturns[calleeName],
        isOptional: false,
        isNullable: false,
        isArray: false,
        source: "inferred",
      }
    }

    // Check for .map, .filter, .reduce patterns
    if (callee.type === "member_expression") {
      const property = callee.childForFieldName("property")
      if (property) {
        switch (property.text) {
          case "map":
          case "filter":
          case "slice":
          case "concat":
            return { type: "unknown[]", isOptional: false, isNullable: false, isArray: true, source: "inferred" }
          case "find":
            return {
              type: "unknown | undefined",
              isOptional: true,
              isNullable: false,
              isArray: false,
              source: "inferred",
            }
          case "reduce":
            return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          case "join":
            return { type: "string", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          case "length":
            return { type: "number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          case "toString":
            return { type: "string", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
        }
      }
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }

  private inferFromBinaryExpression(node: Node): TypeInfo {
    const operator = node.childForFieldName("operator")?.text

    switch (operator) {
      case "+":
        // Could be string concatenation or number addition
        const left = node.childForFieldName("left")
        const right = node.childForFieldName("right")
        if (left && right) {
          const leftType = this.inferFromInitializer(left)
          const rightType = this.inferFromInitializer(right)
          if (leftType.type === "string" || rightType.type === "string") {
            return { type: "string", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          }
          if (leftType.type === "number" && rightType.type === "number") {
            return { type: "number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          }
        }
        return { type: "string | number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "-":
      case "*":
      case "/":
      case "%":
      case "**":
      case "<<":
      case ">>":
      case ">>>":
      case "&":
      case "|":
      case "^":
        return { type: "number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "==":
      case "===":
      case "!=":
      case "!==":
      case "<":
      case ">":
      case "<=":
      case ">=":
      case "&&":
      case "||":
      case "in":
      case "instanceof":
        return { type: "boolean", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "??":
        // Nullish coalescing - type is union of sides
        return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }
}

// ============================================================================
// FRAMEWORK DETECTION - Deep pattern recognition for popular frameworks
// ============================================================================

interface FrameworkPattern {
  name: string
  type: string
  location: string
  metadata?: Record<string, any>
}

function extractFrameworkPatterns(symbols: ASTEngine.UniversalSymbol[], content: string): FrameworkPattern[] {
  const patterns: FrameworkPattern[] = []

  for (const symbol of symbols) {
    // React Hooks
    if (symbol.name.startsWith("use") && symbol.kind === ASTEngine.SymbolKind.Function) {
      const isReactHook = symbol.name.length > 3 && symbol.name[3] === symbol.name[3].toUpperCase()
      if (isReactHook) {
        patterns.push({
          name: symbol.name,
          type: "react-hook",
          location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
          metadata: {
            isCustomHook: ![
              "useState",
              "useEffect",
              "useRef",
              "useMemo",
              "useCallback",
              "useContext",
              "useReducer",
              "useLayoutEffect",
            ].includes(symbol.name),
          },
        })
      }
    }

    // React Components - More conservative detection
    // Note: This is heuristic-based and may have false positives
    // Ideal solution would analyze return types for JSX
    if (symbol.kind === ASTEngine.SymbolKind.Function || symbol.kind === ASTEngine.SymbolKind.Variable) {
      if (
        symbol.name.length > 0 &&
        symbol.name[0] >= "A" &&
        symbol.name[0] <= "Z" &&
        everyItem(
          symbol.name.split(""),
          (c) => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9"),
        ) &&
        someItems(symbols, (s) => s.name === "React" || s.name === "jsx")
      ) {
        // Only tag as react-component if React context is present
        patterns.push({
          name: symbol.name,
          type: "react-component",
          location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
          metadata: { confidence: 0.7 }, // Lower confidence for heuristic
        })
      }
    }

    // Vue Composition API / Setup
    if (symbol.name === "setup" && symbol.kind === ASTEngine.SymbolKind.Function) {
      patterns.push({
        name: symbol.name,
        type: "vue-setup",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // NestJS Controllers/Services
    if (symbol.decorators?.includes("Controller")) {
      patterns.push({
        name: symbol.name,
        type: "nestjs-controller",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }
    if (symbol.decorators?.includes("Injectable")) {
      patterns.push({
        name: symbol.name,
        type: "nestjs-service",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // TypeORM Entities
    if (symbol.decorators?.includes("Entity")) {
      patterns.push({
        name: symbol.name,
        type: "typeorm-entity",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Drizzle Schemas (variables ending with 'Table')
    if (symbol.kind === ASTEngine.SymbolKind.Variable && symbol.name.endsWith("Table")) {
      patterns.push({
        name: symbol.name,
        type: "drizzle-table",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Route handlers (NestJS, generic)
    for (const dec of ["Get", "Post", "Put", "Delete", "Patch"]) {
      if (symbol.decorators?.includes(dec)) {
        patterns.push({
          name: symbol.name,
          type: "http-route",
          location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
          metadata: { method: dec.toUpperCase() },
        })
      }
    }

    // Test patterns
    if (symbol.name === "describe" || symbol.name === "it" || symbol.name === "test") {
      patterns.push({
        name: symbol.name,
        type: "test-block",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }
    // HTTP Clients (Axios, Fetch, TanStack Query)
    if (
      symbol.name === "fetch" ||
      symbol.name === "axios" ||
      symbol.name === "useQuery" ||
      symbol.name === "useMutation"
    ) {
      patterns.push({
        name: symbol.name,
        type: "http-client",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Solid.js Primitives
    if (["createSignal", "createMemo", "createResource", "createStore", "createContext"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "solid-primitive",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Qwik Components and Hooks
    if (
      symbol.name.endsWith("$") &&
      (symbol.kind === ASTEngine.SymbolKind.Function || symbol.kind === ASTEngine.SymbolKind.Variable)
    ) {
      patterns.push({
        name: symbol.name,
        type: "qwik-component",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: { isQwikOptimized: true },
      })
    }

    // Astro Components (special .astro files, but can have TS/JS logic)
    if (symbol.name === "Astro" && symbol.kind === ASTEngine.SymbolKind.Variable) {
      patterns.push({
        name: symbol.name,
        type: "astro-global",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Remix Route Exports
    if (
      ["loader", "action", "meta", "links", "headers", "ErrorBoundary"].includes(symbol.name) &&
      (symbol.kind === ASTEngine.SymbolKind.Function || symbol.kind === ASTEngine.SymbolKind.Variable)
    ) {
      patterns.push({
        name: symbol.name,
        type: "remix-route-export",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: { exportType: symbol.name },
      })
    }

    // SvelteKit Route Functions
    if (["load", "actions"].includes(symbol.name) && symbol.kind === ASTEngine.SymbolKind.Function) {
      patterns.push({
        name: symbol.name,
        type: "sveltekit-route",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // TanStack Query Hooks - Only specific ones to avoid conflicts
    if (["useInfiniteQuery", "useQueryClient", "useIsFetching", "useIsMutating"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "tanstack-query-hook",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Zustand Store Functions - Only detect with proper context
    // Note: Removed overly broad "create" detection to prevent false positives

    // tRPC Procedures
    if (["publicProcedure", "protectedProcedure", "createTRPCRouter"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "trpc-procedure",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Vite Environment Detection - Removed invalid symbol-based detection
    // Note: import.meta is not extracted as a variable symbol

    // Modern State Management Patterns - More precise detection
    if (["createSlice", "configureStore"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "state-management",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: { library: "redux-toolkit" },
      })
    }
    // Generic state hooks without library attribution to avoid false positives
    if (["useStore", "useSelector", "useDispatch"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "state-management",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Component Library Patterns (Headless UI, Radix, etc.)
    if (
      symbol.decorators
        ? someItems(symbol.decorators, (d) => ["forwardRef", "memo", "lazy", "Suspense"].includes(d))
        : false
    ) {
      patterns.push({
        name: symbol.name,
        type: "component-wrapper",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: {
          wrapperType: symbol.decorators
            ? findItem(symbol.decorators, (d) => ["forwardRef", "memo", "lazy"].includes(d))
            : undefined,
        },
      })
    }

    // API Route Patterns (Next.js API routes, Astro endpoints)
    if (
      (symbol.name === "GET" ||
        symbol.name === "POST" ||
        symbol.name === "PUT" ||
        symbol.name === "DELETE" ||
        symbol.name === "PATCH") &&
      symbol.kind === ASTEngine.SymbolKind.Function
    ) {
      patterns.push({
        name: symbol.name,
        type: "api-route-handler",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: { httpMethod: symbol.name },
      })
    }
  }

  return patterns
}

// ============================================================================
// THE TYPESCRIPT ANALYZER - Complete implementation
// ============================================================================

/** The syntax-stated receiver facts one file yields, in one walk. `typeMembers` is
 *  typeName -> memberName -> the member's own declared type, so `cfg.worker.run()` can be
 *  typed one hop beyond the root's annotation. */
type ReceiverTypeHint = { type: string; evidence: string }
type ReceiverFacts = {
  /**
   * THE RECEIVER'S LOCAL TYPES, **SCOPED**.
   *
   * A name bound in one function is not bound in another, so a FILE-WIDE map is wrong for it: two
   * unrelated functions that each bind `result` (or `client`, or `state`) with DIFFERENT types
   * would make the second binding CONFLICT with the first, and the conflict rule (drop the name)
   * would delete the type for BOTH. MEASURED (whole population, 2026-10-19):
   * gql-federation/composition-js/src/merging/merge.ts binds `result` FOUR times with four
   * different types (`Sources<R>` line 128, `Sources<T>` line 139, `new FieldMergeContext(sources)`
   * line 1691, a template string line 4402). The first two conflict, so `result` was deleted, and
   * the row `result.setOverrideWithUnknownTarget(idx)` (line 1773) carried NO owner — although
   * `result` there is a `new FieldMergeContext(sources)` and `FieldMergeContext` is a class
   * DECLARED IN THE SAME FILE (line 177), which is exactly the `assignment` evidence class.
   *
   * The map is therefore keyed by SCOPE: the scope id is the nearest enclosing function-like
   * node's start index (0 = the module scope), and a lookup walks OUTWARD from the row's own
   * scope, so an inner scope sees an outer binding and a SIBLING scope does not.
   */
  locals: Map<string, ReceiverTypeHint>
  /** THE SCOPE OF EACH LOCAL BINDING — scope id -> name -> the type. A lookup walks OUTWARD from
   *  the row's scope through the enclosing scopes. An EMPTY map means the facts carry no scope
   *  information, and the lookup then falls back to the flat `locals` map. */
  localsByScope: Map<number, Map<string, ReceiverTypeHint>>
  /** THE SCOPE TREE — scope id -> the id of the scope that encloses it (0 = the module scope). */
  scopeParent: Map<number, number>
  classFields: Map<string, ReceiverTypeHint>
  typeMembers: Map<string, Map<string, string>>
  /** D7 RECEIVER-TYPING CLASSES (each is syntax-proven, unit-pinned, and counted in the gate's
   *  owner channel by `metadata.ownerEvidence`): */
  /** C2 DESTRUCTURED ELEMENT TYPES — `const { worker } = cfg` where `cfg` is a typed local/param. */
  /** C3 ARRAY/COLLECTION ELEMENT TYPES — annotation `T[]`/`Array<T>`/`Set<T>`, `new Array<T>()`; the
   *  receiver is `items[0]` (subscript) or a `for (const item of items)` binding. */
  elementTypes: Map<string, string>
  /** C4 GENERIC TYPE-ARGUMENT PROPAGATION — instantiated type args per local/field (`Box<Widget>`) and
   *  the declared type parameters per class (`Box<T>`), so a member typed `T` resolves to `Widget`. */
  localTypeArgs: Map<string, string[]>
  typeParams: Map<string, string[]>
  /** C5 FACTORY-RETURN TYPING — callable name -> annotated return-type leaf, same file. */
  returnTypes: Map<string, string>
  /** C7 ENUM-MEMBER RECEIVERS — enum name -> member set; a local/field initialised `Status.Active`. */
  enumMembers: Map<string, Set<string>>
  /** C8 CLASS-STATIC RECEIVERS — class name -> member names declared in its body, so `Cls.staticM()`
   *  names an owner only when the class actually declares that member. */
  classMemberNames: Map<string, Set<string>>
}

/**
 * THE SCOPED BINDING LOOKUP — the binding of `name` VISIBLE FROM `scope`.
 *
 * The walk goes OUTWARD through the enclosing scopes: a local declared in an outer function is
 * visible in an inner one, and a local declared in a SIBLING function is not visible at all. A
 * name CONFLICTED WITHIN a scope is invisible in that scope, and the walk CONTINUES outward — an
 * ambiguous inner binding does not hide an unambiguous outer one, because the inner one simply
 * does not answer.
 *
 * WHY IT IS A SEPARATE FUNCTION AND NOT A CLOSURE: the facts are carried in `ReceiverFacts` and
 * are read at the call site, which is a different method from the one that built them.
 */
function lookupLocalInScope(facts: ReceiverFacts, scope: number, name: string): ReceiverTypeHint | undefined {
  let s: number | null = scope
  const seen = new Set<number>()
  while (s !== null && !seen.has(s)) {
    seen.add(s)
    const byScope = facts.localsByScope.get(s)
    if (byScope?.has(name)) return byScope.get(name)
    // THE MODULE SCOPE IS THE LAST STOP. A scope whose parent is 0 walks to 0, and 0's own parent
    // is absent — so the walk ends there. The module scope's own bindings (a module-level
    // `const x = new Widget()`) are visible from EVERY scope, and the walk must reach them.
    s = facts.scopeParent.get(s) ?? (s === 0 ? null : 0)
  }
  return undefined
}

class TypeScriptAnalysisRunner {
  private currentFile: string = ""
  private content: string = ""
  private scopeManager: ScopeManager
  private moduleResolver: TypeScriptModuleResolver | null = null
  private typeInference: TypeInferenceEngine
  private _pendingReExportImports: ASTEngine.ImportInfo[] = []
  /** Per-FILE imported-binding evidence: local name -> the specifier that binds it, for specifiers
   *  that are NOT project-local (external packages and node builtins). Built from this file's own
   *  import relationships, which is exactly the evidence the arbiter verifies the imported-binding
   *  claim against (`metadata.importedBindings` on the imports edges + `metadata.importedBinding` on
   *  the downstream edge). */
  private _importBindingSpecs: Map<string, string> = new Map()
  /** The project root this file was analysed under (see `findProjectRoot`), used by the imported-binding
   *  claim to decide whether a specifier is project-local (a project-local specifier is NOT claimable:
   *  it names a project module, and the claim would launder a resolvable edge as a binding). */
  private _projectRoot: string = ""
  private _projectPackages: Set<string> = new Set()
  // M49 dup-key ruling (#746): dead spans returned by the Phase-2.5
  // collapse, consumed by the post-walk phantom-edge filter.
  private _dupKeyDeadSpans: { name: string; startRow: number; endRow: number; startCol: number; endCol: number }[] | null = null
  // Depth of nested function bodies being walked for symbol extraction.
  // Locals/params/lambda-params inside a function body are NOT symbols
  // (C#-family contract); only module/namespace/class-level declarations are.
  private insideFunctionDepth = 0
  /** Per-FILE facts every payload rule needs, gathered in ONE walk (the walk
   *  the React gate already paid for): JSX presence, a react/preact import, a
   *  solid-js import, and a child_process import. The sink rules need the last
   *  one to tell an imported `exec` from a project's own `exec`, and the solid
   *  flag replaces a whole-file `content.includes("solid-js")` text scan with
   *  an AST fact. */
  /** name -> every symbol declared with that name, in declaration order.
   *  R2b: the relationship passes resolve the enclosing symbol for every
   *  DECLARATION node, and each resolution used to be a linear scan of the
   *  whole symbol array (`findItem`) — O(declarations x symbols) per pass, run
   *  by two passes and by the qualified-calls post-pass. Bucketing by name
   *  keeps the scan inside one bucket, and iterating a bucket in declaration
   *  order preserves `findItem`'s first-match contract exactly, including the
   *  repeated-name case (two classes each declaring `save`). */
  private _symbolIndex: Map<string, ASTEngine.UniversalSymbol[]> | null = null
  private _fileSignals: { hasReact: boolean; importsChildProcess: boolean; solidJs: boolean } = {
    hasReact: false,
    importsChildProcess: false,
    solidJs: false,
  }
  // M3: `qualified_calls` is computed AFTER extraction, not during it. The
  // payload's owner resolution has to see the WHOLE symbol set: a nested
  // `function inner(){}` is pushed to `symbols` only after its enclosing
  // function finishes, so resolving mid-walk could not find it and the
  // callback's calls were charged to the outer symbol. The relationship passes
  // have always run after extraction for the same reason; this payload now
  // does too (the javascript twin likewise computes it in a later phase).
  private _pendingQualifiedCalls: Array<{ symbol: ASTEngine.UniversalSymbol; node: Node }> = []

  constructor() {
    this.scopeManager = new ScopeManager()
    this.typeInference = new TypeInferenceEngine()
  }

  /** Delegates to the module-level `extractTypeParametersOf` (one
   *  implementation, one place the generic-parameter contract can change). */
  /**
   * THE PROJECT-INDEX PASS — the analyzer side of the `complete === true` capability.
   *
   * FAIL-CLOSED BY CONSTRUCTION: with no `context.projectIndex`, or any `complete !== true`, or a
   * payload that predates `symbolCounts`/`modules`, this returns before touching an edge. Every
   * sampled / index-less run is therefore byte-identical to the behaviour before this method
   * existed — that is the contract the wiring states (`ProjectIndex.complete`, "a reader must test
   * `=== true`, never truthiness").
   *
   * TWO OPERATIONS, and their difference is the difference between a resolution and a claim.
   *
   *   · RESOLUTION — an `imports` edge written `module:name` where the SPECIFIER is the project's
   *     own module space (a relative/absolute path, or a package the project's own
   *     `package.json` `workspaces` list declares) and the index says the name is declared
   *     EXACTLY ONCE project-wide. Re-spelling to the bare name gives the resolver a target it can
   *     join (`_res_name.cnt = 1`, production's own strategy). The "exactly once" test is the
   *     difference between a resolution and a gamble and it is what `symbolCounts` exists for: the
   *     first version of this pass tested `symbolNames.has()` and therefore re-spelled an
   *     external-package item that merely SHARED a name with a project class — the measured
   *     false-binding class (432 ts + 276 js external items) — and could not tell one declaration
   *     from two.
   *
   *   · CLAIM — an `imports` edge whose module is NOT in the project's module space names something
   *     outside it. The claim is `externalReason: "module-namespace"` + `externalSpecifier`, which
   *     the gate verifies against the project's own module space and can never REFUTE (it degrades
   *     to unverified), so it cannot launder a project-module import: a module root the project
   *     publishes is refused HERE as well (`projectIndexModuleShadowed`) rather than claimed.
   *     The same claim is then attached to every other edge whose target — or whose receiver ROOT
   *     — is a binding imported from that external module: `computed(…)` imported from `vue`,
   *     `path.join(…)` from `node:path`, a type mention of `Ref` from `vue`. A claim is not a
   *     resolution and nothing here reports it as one.
   *
   * WHAT IS DELIBERATELY NOT CLAIMED: a bare name is never claimed merely because the index does
   * not list it. `symbolNames` under `TYPESCRIPT_DECLARATION_SPEC` covers declared TYPES and their
   * MEMBERS; a free function or a module-scope binding is not in it, so absence from the index is
   * not evidence of externality. The earlier version of this pass did exactly that for `calls`
   * (one measured claim candidate was `h`, the most frequent callee in the sample) and a claim on
   * a local function's name would be a false statement about another file.
   */
  private applyProjectIndexClaims(
    relationships: ASTEngine.UniversalRelationship[],
    context?: ASTEngine.AnalyzeContext,
  ): void {
    const index = context?.projectIndex
    if (index?.complete !== true) return
    const counts: Map<string, number> | undefined = (index as any).symbolCounts
    const modules: Set<string> | undefined = (index as any).modules
    if (!counts || !modules) return
    const projectRoot = String((context as any)?.projectRoot ?? "") || this.findProjectRoot(this.currentFile)
    const projectPackages = this.projectPackageNames(projectRoot)

    /** "the project declares this name exactly once" — the resolver's own binding precondition. */
    const declaredOnce = (name: string) => counts.get(name) === 1
    /** Local binding -> the EXTERNAL module it is imported from. Built by pass 1, read by pass 2. */
    const externalBindings = new Map<string, string>()
    /**
     * THE DOWNSTREAM CLAIM (calls/uses/references/instantiates/… whose target is a binding imported
     * from an external module). It is deliberately NOT a `module-namespace` claim: that kind is
     * verified by looking the module's ROOT up in the project's module-name space, and a project
     * DIRECTORY can share a bare package's spelling (`packages/utils/__tests__/vue/…` makes "vue" a
     * project module name) — measured on element-plus: 3,134 calls claims became `ext?` for that
     * reason alone. The claim that IS checkable here is the bare-name one: the target names
     * something the COMPLETE project index does not declare, and the edge's own metadata says which
     * external module the binding came from. The arbiter verifies a bare name against its key space
     * and never refuses to look at it.
     */
    const claimExternalBinding = (md: Record<string, any>, module: string) => {
      if (md.isExternalTarget === true) return
      md.isExternalTarget = true
      md.externalReason = "imported-from-external-module"
      md.externalSpecifier = module
      md.externalProof = `ProjectIndex.complete === true; the binding is imported from ${JSON.stringify(module)}, which is outside the project's own package/module space`
    }
    const claimModuleNamespace = (md: Record<string, any>, module: string) => {
      if (md.isExternalTarget === true) return
      md.isExternalTarget = true
      // The gate's module-path claim kind is selected by THIS reason string; its verification is
      // the project's module space (`projectModuleNames`), never the symbol table, so the claim is
      // checkable and stays separate from `resolved`. The evidence travels on the edge: a claim
      // without its citation is prose.
      md.externalReason = "module-namespace"
      md.externalSpecifier = module
      md.externalProof = `ProjectIndex.complete === true; the project's own module space and package manifests do not declare ${JSON.stringify(module)}`
    }

    // ── PASS 1: imports ────────────────────────────────────────────────────────────────────────
    for (const rel of relationships as any[]) {
      if (String(rel?.type) !== "imports") continue
      const md: Record<string, any> = (rel.metadata ??= {})
      // A whole-module binding (`:*`) has no item to join and is already clean in the gate's
      // binding column; a relative import already publishes the bare item (see
      // `extractImportRelationships`), so only `module:item` spellings reach the branches below.
      if (md.localBinding === true) continue
      const target = String(rel.target ?? "")
      const at = target.lastIndexOf(":")
      if (at <= 0 || at === target.length - 1) continue
      const module = target.slice(0, at)
      const item = target.slice(at + 1).trim()
      if (!isPlainIdentifier(item)) continue
      if (this.isProjectLocalSpecifier(module, projectPackages)) {
        if (declaredOnce(item)) {
          // RESOLUTION: a name the resolver can join, and only under the "exactly once" rule.
          rel.target = item
          md.resolvedViaProjectIndex = true
          md.projectIndexEvidence = `project-local module; symbolCounts[${JSON.stringify(item)}] === 1`
        } else if ((counts.get(item) ?? 0) > 1) {
          // The project declares the name more than once: re-spelling would pick a stranger, so
          // the binding spelling stays and the ambiguity is recorded rather than gambled.
          md.projectIndexAmbiguous = true
        } else {
          // The module is the project's, the name is not in the index. NOT a claim: an index
          // whose spec does not record this kind of declaration cannot prove externality.
          md.projectIndexItemNotDeclared = true
        }
        continue
      }
      // ── EXTERNAL MODULE: module-path claim, with the project's own module space as the check ──
      const root = firstPathSegment(stripNodePrefix(module))
      if (root !== "" && modules.has(root)) {
        // The project publishes a module with this root; the claim would be refused as
        // unverifiable by the arbiter, and staking it would be a statement about the project that
        // its own index contradicts. Recorded, left unresolved.
        md.projectIndexModuleShadowed = root
        continue
      }
      claimModuleNamespace(md, module)
      externalBindings.set(item, module)
      if (typeof md.alias === "string" && md.alias.length > 0) externalBindings.set(String(md.alias), module)
    }

    // ── PASS 2: edges whose target (or receiver root) is a binding imported from an external module ──
    if (externalBindings.size === 0) return
    for (const rel of relationships as any[]) {
      const type = String(rel?.type ?? "")
      if (type === "imports") continue
      const md: Record<string, any> = (rel.metadata ??= {})
      if (md.isExternalTarget === true || md.localBinding === true || md.importedBinding !== undefined) continue
      const target = String(rel.target ?? "")
      if (target.length === 0) continue
      let module = externalBindings.get(target)
      if (module === undefined) {
        // A MEMBER of an imported binding: `path.join(…)`, `lodash.map(…)`, `defaults.foo`. The
        // receiver ROOT is the binding; the member belongs to the external module's export.
        const callee = String(md.calleeExpression ?? "")
        const dot = callee.indexOf(".")
        if (dot > 0) {
          const receiver = callee.slice(0, dot)
          if (isPlainIdentifier(receiver)) module = externalBindings.get(receiver)
          if (module !== undefined) md.externalReceiver = receiver
        }
      }
      if (module === undefined) continue
      claimExternalBinding(md, module)
    }
  }

  /** package.json `name`s of the project and of every workspace member it declares. Cached per
   *  project root: one read per repo per process, not one per file. A read failure contributes
   *  nothing, which is fail-closed — an unknown package set claims nothing. */
  private static projectPackageCache = new Map<string, Set<string>>()
  private projectPackageNames(projectRoot: string): Set<string> {
    if (!projectRoot) return new Set()
    const cached = TypeScriptAnalysisRunner.projectPackageCache.get(projectRoot)
    if (cached !== undefined) return cached
    const names = new Set<string>()
    const readManifest = (manifest: string): any => {
      try {
        const j = JSON.parse(fs.readFileSync(manifest, "utf8"))
        if (typeof j?.name === "string" && j.name.length > 0) names.add(j.name)
        return j
      } catch {
        return null
      }
    }
    const rootPkg = readManifest(path.join(projectRoot, "package.json"))
    const workspaces: string[] = Array.isArray(rootPkg?.workspaces)
      ? rootPkg.workspaces.filter((w: any) => typeof w === "string")
      : Array.isArray(rootPkg?.workspaces?.packages)
        ? rootPkg.workspaces.packages.filter((w: any) => typeof w === "string")
        : []
    for (const pattern of workspaces) {
      const star = pattern.indexOf("*")
      if (star > 0) {
        // `packages/*` — one level, which is what npm/yarn/pnpm workspaces expand for the
        // `*` form. A deeper pattern contributes nothing rather than being guessed at.
        const dir = path.join(projectRoot, pattern.slice(0, pattern.lastIndexOf("/")))
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) readManifest(path.join(dir, entry.name, "package.json"))
          }
        } catch {
          /* an unreadable workspace directory is not evidence */
        }
      } else if (pattern.length > 0) {
        readManifest(path.join(projectRoot, pattern, "package.json"))
      }
    }
    TypeScriptAnalysisRunner.projectPackageCache.set(projectRoot, names)
    return names
  }

  /** Is this import specifier the PROJECT's own module? Relative/absolute by path algebra;
   *  a bare specifier only when the project's own manifests declare that package (a workspace
   *  member). Node built-ins are never the project's. */
  private isProjectLocalSpecifier(specifier: string, projectPackages: Set<string>): boolean {
    if (specifier.startsWith(".") || specifier.startsWith("/")) return true
    const bare = stripNodePrefix(specifier)
    if (isBuiltinModule(bare)) return false
    const segs = bare.split("/")
    const pkg = bare.startsWith("@") ? segs.slice(0, 2).join("/") : (segs[0] ?? "")
    return pkg.length > 0 && projectPackages.has(pkg)
  }

  private extractTypeParameters(node: Node): string[] {
    return extractTypeParametersOf(node)
  }

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    // Reset state for new analysis
    this.currentFile = filePath
    this.content = content
    this.scopeManager.reset()
    this._symbolIndex = null

    // Initialize module resolver with project root
    const projectRoot = this.findProjectRoot(filePath)
    this.moduleResolver = new TypeScriptModuleResolver(projectRoot)
    // THE BINDING CLAIMS' project facts: which package names this project declares (a workspace
    // package specifier is project-local, so its imports are not claimable as external bindings).
    // `projectPackageNames` is cached per project root, so this is one read per repo per process.
    this._projectRoot = projectRoot
    this._projectPackages = this.projectPackageNames(projectRoot)
    this._importBindingSpecs = new Map()

    // PERF: one pre-pass so `inDecoratorPosition` can answer `false` without an
    // ancestor walk per node. See that method for the measurement — this lane read
    // `.type` 133.7 times per node before it, the worst ratio in the corpus.
    this.hasAnyDecoratorNode = treeContainsNodeType(rootNode, "decorator")

    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // ========================================================================
    // STAGE 3: RESILIENT PARSING & ERROR NODE BYPASS
    // ========================================================================
    if (rootNode.hasError) {
      const collectErrors = (node: Node) => {
        if (node.type === "ERROR" || node.type === "MISSING") {
          errors.push({
            message: `Syntax ${node.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column + 1,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column + 1,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            severity: `warning`,
          })
        }
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) collectErrors(child)
        }
      }
      collectErrors(rootNode)
    }

    // T1 (review wave): the Rules-of-Hooks check only means something in a
    // React file — in Vue/Svelte/Node codebases every `use*` util warned as
    // a parse error. Gate on a React signal (react import or JSX); the
    // SolidJS exclusion stays (different hook rules entirely).
    // R2c: ONE walk for imports AND the per-file signals, run BEFORE symbol
    // extraction. This scan used to be a second full traversal sitting next to
    // the imports walk, and it had to sit here (before the symbol passes)
    // because the taint sink rule reads `importsChildProcess` while building
    // payloads. The resolution is ordering, not a provisional list: the imports
    // walk is a pure tree read that needs no symbols, so running it first hands
    // the signals to everything downstream and the extra traversal is gone.
    // `imports` keeps the same content and the same order — the same walk over
    // the same tree — and the exports pass, which does need symbols, stays put.
    this._fileSignals = { hasReact: false, importsChildProcess: false, solidJs: false }
    this.scanImportsAndFileSignals(rootNode, imports)
    if (this._fileSignals.hasReact && !this._fileSignals.solidJs) {
      errors.push(...this.detectReactHookAntiPatterns(rootNode))
    }

    // ONE module name, computed once, by the one function that owns the rule.
    //
    // This line used to be a second, independent `path.basename(filePath,
    // path.extname(filePath))`, which made the module name an answer with two
    // derivations that agreed on every ordinary file and disagreed on a
    // declaration file: `moduleLeafName()` (fixed 2026-10-05, VERIFY_TS10) said
    // `env`, this one still said `env.d`. The mutation run caught it — an
    // over-stripping mutant of `moduleLeafName()` passed the control fixture
    // precisely because this site was still answering correctly, which is the
    // shape a duplicated rule takes: one lane's fix, half applied, and a green
    // suite over the half that was not the one the edges come from.
    //
    // It matters beyond tidiness: this name is the MODULE SCOPE, so it is the
    // prefix of every `qualifiedName` in the file and the `scope` a symbol
    // carries. Two spellings of one module means a declaration file's symbols
    // were scoped `env.d.*` while its import and export edges were sourced from
    // `env`, and nothing joins those.
    this.scopeManager.pushScope(ScopeKind.Module, this.moduleLeafName(), rootNode)

    // PHASE 1: Inject phantom symbols for better resolution
    // PHANTOM INJECTION REMOVED (Phase 3): fake this/constructor/globals polluted indexes.

    // PHASE 2: Extract all symbols with proper scoping
    this.extractSymbols(rootNode, symbols)

    // PHASE 2.5 (M49 dup-key ruling, Option A — #746): object-literal
    // members collapse last-wins (family contract with the JS analyzer).
    // Runs before the symbol-map build and every relationship phase so
    // exports/calls/contains all derive from the collapsed array.
    // ONE call: this ran the full-tree collapse TWICE per file and threw the
    // first result away — a whole redundant walk, and two equally authoritative
    // looking answers to "which one is the dead-span list?". The pass is
    // tree-derived, so the second call also re-derived the same spans to splice
    // symbols the first call had already spliced.
    this._dupKeyDeadSpans =
      this.collapseDuplicateObjectMembers(rootNode, symbols)

    // R2b: the name index every later resolution reads. Built HERE because it
    // must describe the post-collapse symbol set, and before the first reader
    // (the qualified-calls post-pass below).
    const byName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const sym of symbols) {
      const bucket = byName.get(sym.name)
      if (bucket) bucket.push(sym)
      else byName.set(sym.name, [sym])
    }
    this._symbolIndex = byName

    // M3: fill `qualified_calls` now, with the complete symbol table in hand
    // (see the _pendingQualifiedCalls note). ONE map shared by every symbol's
    // walk, keyed by the SYMBOL (never by name — two classes may each declare
    // `save`), because a call inside a nested function or a callback is
    // charged to the symbol that owns it, not to the symbol whose body the
    // walk started from. That is the javascript twin's `bySource` contract
    // (real-javascript-analyzer.ts:1005 reads the payload out of the map).
    // A symbol the dup-key collapse removed is skipped — its payload died
    // with it.
    const qcByOwner = new Map<ASTEngine.UniversalSymbol, string[]>()
    for (const pending of this._pendingQualifiedCalls) {
      if (symbols.indexOf(pending.symbol) === -1) continue
      this.extractQualifiedCalls(pending.node, pending.symbol, symbols, qcByOwner)
    }
    for (const pending of this._pendingQualifiedCalls) {
      const list = qcByOwner.get(pending.symbol)
      if (list && list.length > 0) pending.symbol.qualified_calls = [...new Set(list)]
    }
    this._pendingQualifiedCalls = []

    // PHASE 3: Extract exports (imports were read before symbol extraction, so
    // the per-file signals were available to the payload rules)
    this._pendingReExportImports = []
    this.extractExports(rootNode, exports, symbols)
    imports.push(...this._pendingReExportImports)
    this._pendingReExportImports = []

    // PHASE 4: Analyze relationships between symbols
    this.extractRelationships(rootNode, relationships, symbols, exports)

    // PHASE 5: Add containment relationships
    this.addContainmentRelationships(symbols, relationships)

    // PHASE 6: Detect frameworks and patterns
    const frameworks = detectFrameworks(content, symbols)
    const frameworkPatterns = extractFrameworkPatterns(symbols, content)

    // PHASE 7: Calculate metrics
    // ONE complexity walk feeds BOTH file-level metadata fields: they are the
    // same number by contract (1 + decision points — the M14 family rule), and
    // they used to be produced by two byte-identical implementations, i.e. two
    // full-tree walks per file whose answers could silently drift apart.
    const complexity = this.calculateComplexity(rootNode)
    // ALL lines, not the non-empty ones: `linesOfCode` is a cross-language
    // metric and the same source analyzed as .ts and as .js must not disagree.
    // This analyzer counted non-empty lines while the javascript twin counts
    // every line (`content.split("\n").length`), so one file reported two
    // different LOC values depending on its extension (measured: 6 vs 9 for the
    // same 7-line source with 2 blank lines). Both forms over-count a trailing
    // newline by one — a family-level nit, left alone here on purpose.
    const linesOfCode = content.split("\n").length
    const cyclomaticComplexity = complexity

    // PHASE 8: Code quality assessment
    const codeQuality = this.assessCodeQuality(symbols, relationships, complexity, cyclomaticComplexity)

    this.scopeManager.popScope()

    // PHASE 6.5: Declared-type reference graph (M14). Every type_annotation
    // in the file (fields, params, returns, locals, interface members,
    // as-casts, instanceof checks) references its named types. Absent until
    // M14 — the corpus oracle never checked it.
    this.extractDeclaredTypeRefs(rootNode, relationships, symbols)
    // PHASE 6.6: the two constructs the lane's rulings name (M14 round 7).
    //
    // `mixes_in` (R3 — no grammar change): a mixin APPLICATION is a class whose extends-expression
    // is a CALL, `class X extends Mixin(Base) {}`. The discriminator against `extends` is THE SHAPE,
    // not the name: a plain name in the heritage position is inheritance, a call is an application.
    // ⇒ MEASURED: the whole admitted population holds ZERO such sites (script/m14/ts-mixin-sites.ts),
    // so this pass adds no row on today's corpus and the cell's totals do not move. The proof that
    // it is a real implementation and not a decoration is the FIXTURE that goes red without it —
    // the csharp lane's `renders` precedent, which the gate counts once inside `implemented` with
    // its corpus-unexercised status reported beside it.
    this.extractMixinApplications(rootNode, relationships)
    // `part_of` (R2 — the grammar is patched by the lane): the triple-slash reference directive.
    // The SERVED build lexes it as a comment, so this pass emits NOTHING until the patched build
    // (b75fa34c…/8586372d… — see script/m14/ts-partof-grammar-proof.ts) is the wired grammar. It is
    // guarded rather than absent on purpose: the analyzer must be ready to read a node that the
    // current bytes do not produce, and the guard is the node type, not a flag.
    this.extractReferenceDirectives(rootNode, relationships, filePath)

    // DERIV_TS (2026-10-03): ONE mention, ONE label.
    //
    // Two passes read a name written in a TYPE position and they disagree about
    // what to call it. `extractUsageRelationships` publishes `uses` at 0.9 with
    // `isTypeReference`; `extractDeclaredTypeRefs` publishes `references` at 0.95
    // with `relationshipType` (`declared_type`, `return_type`, `type_alias`,
    // `cast_target`, `type_argument`, `instanceof_check`, `satisfies_target`).
    // `extractDeclaredTypeRefs` runs LAST, and its `alreadyPublished` set holds
    // only `references` rows — so it cannot see the `uses` row that is already in
    // the array, and the same (source, target) reached the graph under BOTH labels.
    //
    // Measured on 200 tracked files of microsoft/TypeScript: `references` carried
    // 9,445 type-position rows and `uses` 733, and 733+ (source, target) pairs
    // appeared under both — the probe's row list capped at 200 samples, so 733 is
    // the `uses` side's full count and the OVERLAP is at least that. The zig lane
    // called the same shape a defect on the same grounds ("duplicating the
    // declared-type class that already publishes `references (declared-type)` for
    // the same text"), and this lane's own TSD18/TSD28 rulings established the
    // principle for template reads: one read, one label.
    //
    // The `references` row is the one that survives, for two measured reasons.
    // It is the SUPERSET: `uses` fires only when `symbolNames[typeName]` is set,
    // so 733 of the mentions `references` records were never in `uses` at all, and
    // keeping `uses` would delete 8,712 real rows. And it is the richer row — it
    // carries `relationshipType`, which says WHICH type position the mention is in,
    // and 0.95 rather than 0.9. Nothing is lost but the duplicate.
    //
    // The `uses` label therefore means, from here: a value or member READ in an
    // expression position — a field access, a template interpolation, a JSX tag.
    // `references` means: a mention of a TYPE. docs/analyzers/
    // real-typescript-analyzer.md said the opposite for `uses` and was wrong.
    // THE ONE-LABEL RULING, NARROWED TO THE POSITIONS WHOSE FIXTURES PIN IT (2026-10-17, iteration 2).
    // Removing it entirely fixed `type-predicate-and-constraint-refs` and BROKE `usage-references`,
    // whose forbid rows are exactly `uses greet -> User` and `uses main -> User`: a type ANNOTATION
    // is a `references` row alone. The type-predicate and constraint POSITIONS are different — their
    // fixture requires the `uses` row to SURVIVE beside `references`. Same file, two contracts, so
    // the ruling is applied per POSITION instead of per mention: the drop skips a pair whose
    // `references` row was written by one of the labels below.
    this.dropDuplicateTypeMentionLabels(relationships)

    this.classifyEvidenceTier(relationships)

    // M49 dup-key ruling (#746) post-walk half: all relationship phases
    // (calls/uses/contains/references) have run — now drop the phantom
    // edges sourced from collapsed members' dead bodies.
    if (this._dupKeyDeadSpans && this._dupKeyDeadSpans.length > 0) {
      this.filterPhantomDupKeyEdges(relationships, this._dupKeyDeadSpans)
    }
    this._dupKeyDeadSpans = null

    // M60.P1 (#873): ONE row, ONE line base. `line_number` is 1-based
    // (`lineField`, every other analyzer, and the store column), while the
    // `metadata.line` mirror was written as `startPosition.row` at eight call
    // sites — 0-based, and sometimes a different NODE than the one `lineField`
    // stamped. Measured through the production pipeline (script/m14/tmp/
    // probe-metadata-line-base.ts, one file per language from real corpora):
    // typescript 148 of 155 rows off by one and 7 by more, tsx 173 of 179, vue 3
    // of 3 — and ZERO rows on java, kotlin, scala, groovy, cpp, python, js or
    // swift, because only this analyzer writes the mirror. The eight writers now
    // write the 1-based site, and this pass makes the two fields agree BY
    // CONSTRUCTION, so a ninth writer cannot reintroduce a second base by
    // forgetting one of them. It only ever corrects a present number: absence
    // stays absence (the ruled "unknown is a first-class state" contract).
    let baseMismatches = 0
    for (const r of relationships) {
      const meta = r.metadata as { line?: unknown } | undefined
      if (!meta || typeof r.line_number !== "number") continue
      if (typeof meta.line === "number" && meta.line !== r.line_number) {
        meta.line = r.line_number
        baseMismatches++
      }
    }
    // (No logging here: the analyzer is a pure function of the source text, and
    // the count is observable in the payload matrix and in the sweep probe.)
    void baseMismatches

    // THE BINDING CLAIMS (D7 depth round): both attach to rows that already exist.
    //   1. imported-binding EVIDENCE goes on the imports edges first — the arbiter verifies the
    //      downstream claims against it;
    //   2. local bindings are RE-SPELLED to the family binding spelling (this changes a target, so it
    //      runs BEFORE the claim passes, which read the target);
    //   3. the file-local external markers still own their rows (existing accounting must not shrink);
    //   4. imported-binding CLAIMS land only on rows nobody else claimed;
    //   5. the project-index pass stays last and skips both binding classes (see its PASS 2 guard).
    void this.publishImportedBindingEvidence(relationships)
    // LAST, AND DELIBERATELY SO. Every phase that can DROP an edge has run
    // (`dropDuplicateTypeMentionLabels`, `filterPhantomDupKeyEdges`), so a marker can only ever
    // land on a row that is actually published — marking earlier would leave claims on rows that
    // no longer exist, which is a claim about nothing. The pass reads this file's own symbols and
    // import edges as its evidence; it changes no target, no source and no line.
    void this.markExternalTargets(relationships, symbols)
    // THE PROJECT-INDEX PASS — it can only run on a COMPLETE index and it is fail-closed, so it is a
    // no-op in every sampled run (see the method's header). It runs BEFORE the binding passes
    // deliberately: its external claims own their rows, and a binding claim landing on one of them
    // would steal a verified `extOK`/`ext?` row into `bindOK` (the arbiter's binding claims are sole
    // authority) — the measured whole-population defect this ordering fixes.
    void this.applyProjectIndexClaims(relationships, context)
    // THE BINDING PASSES, LAST — they may only claim rows nobody else claimed (see
    // `carriesClaimMarker`). Re-spell before claiming, so a locally-bound target is claimed by its
    // own spelling and never by a stale bare name; each pass re-checks the guard because the spell
    // pass itself marks rows.
    void this.applyLocalBindingSpellings(rootNode, relationships, symbols)
    void this.applyImportedBindingClaims(relationships, symbols)

    return {
      language: "typescript",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity,
        linesOfCode,
        cyclomaticComplexity,
        framework: frameworks.length > 0 ? frameworks[0].name : undefined,
        patterns: mapItems(frameworkPatterns, (p) => p.type),
        detectedFrameworks: mapItems(frameworks, (f) => f.name),
        frameworkPatterns,
        architecturalScore: this.calculateArchitecturalScore(symbols, relationships),
        codeQuality,
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.0-infallible-brain",
      },
    }
  }

  // ========================================================================
  // SYMBOL EXTRACTION - Complete TypeScript construct handling
  // ========================================================================

  private extractSymbols(rootNode: Node, symbols: ASTEngine.UniversalSymbol[]): void {
    const stack: StackEntry[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const entry = stack.pop()!
      if (entry.action) {
        entry.action()
        continue
      }

      const node = entry.node!
      let skipChildren = false

      switch (node.type) {
        case "function_declaration":
        case "generator_function_declaration":
        // A bodyless function DECLARATION is a different node type, and the
        // spec has carried `function_signature` as handled_verified since the
        // lane was declared conformant while the analyzer had no reference to
        // the type at all. It is what `declare function f(): void` parses to,
        // and an ambient module body is nothing but these — so every exported
        // function in a .d.ts was invisible: no symbol, no call edge, no
        // complexity, no api-contract row. The class and interface paths
        // already route `method_signature` and `abstract_method_signature` to
        // their extractors; this is the statement-level counterpart, and the
        // grammar distinction is only the absent body. extractFunction already
        // tolerates that (`if (body)`), and for a signature the api-contract
        // fields are exactly right: it IS a declaration of the API, with no
        // implementation to confuse them.
        case "function_signature":
          skipChildren = this.extractFunction(node, symbols, stack)
          break

        case "class_declaration":
        case "abstract_class_declaration":
          skipChildren = this.extractClass(node, symbols, stack)
          break

        // A NAMED class expression (`const K = class Inner { m(){} }`) is a class
        // DECLARATION named `Inner`: the name is written in the file, it is in
        // scope inside its own body, and `new Inner()` inside that body already
        // resolved to it. There was no `case "class"` at all, so the expression
        // was walked as a bare bag of members and LOST, measurably:
        //   * no `Inner` Class symbol — the class was invisible as a type;
        //   * therefore no `contains` edge either: the member extraction
        //     attributes `m` to owner `Inner`, and addContainmentRelationships
        //     drops an edge whose owner is not a symbol, so a named class
        //     expression contributed NO members to the hierarchy at all, while
        //     the javascript twin emitted a dangling `Inner->m` for the very
        //     same construct;
        //   * and `extends` / `implements` were lost with it, though heritage
        //     is clause structure the generic oracle derives.
        // Anonymous class expressions deliberately keep their existing path:
        // they have no name of their own, so their members belong to the binding
        // that holds the value (`const K = class { m(){} }` -> `K contains m`),
        // which resolves and is reachable.
        case "class":
          skipChildren = this.extractNamedClassExpression(node, symbols, stack)
          break

        case "interface_declaration":
          skipChildren = this.extractInterface(node, symbols, stack)
          break

        case "type_alias_declaration":
          skipChildren = this.extractTypeAlias(node, symbols)
          break

        case "enum_declaration":
          skipChildren = this.extractEnum(node, symbols, stack)
          break

        case "lexical_declaration":
        case "variable_declaration":
          // C#-family contract: variables declared inside a function body are
          // locals — not symbols. Only module/namespace/class-level declarations
          // become symbols (and do not descend into them at function depth).
          // W1 exception (JD18-class, JS parity): a function-body declarator
          // whose value is an OBJECT LITERAL still descends — the object's
          // shorthand methods are their own scopes (probed: class-body-local
          // `const local = { deep() {...} }` -> method:deep + deep -> inside
          // on the JS side; TS must match or the nested calls misattribute to
          // the enclosing method). The declarator symbol is still suppressed
          // (locals stay locals) — only the descent differs.
          if (this.insideFunctionDepth === 0) {
            skipChildren = this.extractVariables(node, symbols, stack)
          } else {
            const w1Descend = (node: Node): boolean => {
              for (let i = 0; i < node.namedChildCount; i++) {
                const d = node.namedChild(i)
                if (!d) continue
                if (d.type !== "variable_declarator") continue
                const v = d.childForFieldName("value")
                if (v && v.type === "object") return true
              }
              return false
            }
            skipChildren = !w1Descend(node)
          }
          break

        case "internal_module":
        case "ambient_declaration":
        case "module":
        case "namespace_declaration":
        case "module_declaration":
          skipChildren = this.extractNamespace(node, symbols, stack)
          break

        case "export_statement":
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child })
          }
          skipChildren = true
          break

        case "method_definition":
          // W1 (JD18-class, web-family parity with JS): shorthand methods on
          // object literals ARE members. JS emits them at ANY depth (probed:
          // class-body-local `const local = { deep() {...} }` -> method:deep
          // + deep -> inside — the nested object's method is its own scope,
          // never misattributed to the enclosing method). Owner resolution:
          // walk up to the enclosing variable_declarator name; at module
          // level that's the object's binding (util/routes), inside a body
          // it's the local binding. Calls inside the method then attribute
          // to the method symbol itself via the rel-walk resolver.
          skipChildren = this.extractObjectLiteralMethod(node, symbols, stack)
          break

        case "arrow_function":
          break
      }

      if (!skipChildren) {
        // A class — DECLARATION, or an EXPRESSION that carries a name — is
        // fully handled by extractClass, which walks its own body, so the generic
        // descent must not descend into it or every member is extracted TWICE.
        // That exclusion has always covered `class_declaration`; the class
        // EXPRESSION node type was missing from it, which is exactly why R1 had
        // to reach class-expression members through the descent instead. An
        // ANONYMOUS class expression is deliberately NOT excluded: it has no
        // name, so its members belong to the binding that holds the value and
        // the descent is what finds them.
        const classOwnsItsMembers = node.type === "class" && !!node.childForFieldName("name")
        if (
          !classOwnsItsMembers &&
          ![
            "class_declaration",
            "abstract_class_declaration",
            "interface_declaration",
            "enum_declaration",
            "internal_module",
            "ambient_declaration",
            "module",
            "namespace_declaration",
            "module_declaration",
          ].includes(node.type)
        ) {
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child })
          }
        }
      }
    }
  }

  private extractFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const modifiers = extractModifiersFromNode(node)
    // An ambient declaration carries NO `declare` child of its own: the grammar
    // puts the keyword on a wrapping `ambient_declaration`, verified by ancestry
    // (`function_signature <- ambient_declaration <- [export_statement]`). So
    // `extractModifiersFromNode` cannot see it, and a bodyless declaration would
    // otherwise be indistinguishable from an implementation — which matters now
    // that these symbols exist: there is no body, and nothing to have measured.
    // Same reason `export` is not a child; that one is already covered by
    // isNodeExported, which walks ancestors.
    const isAmbientDeclaration = node.type === "function_signature" && node.parent?.type === "ambient_declaration"
    const exportStatus = isNodeExported(node)
    const params = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const typeParams = this.extractTypeParameters(node)
    const apiContract = this.extractApiContract(node)
    // ONE complexity walk per symbol: the top-level field and the metadata
    // mirror are the same number by contract, and each call re-walked the whole
    // function subtree.
    const ownComplexity = this.calculateComplexity(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      isStatic: modifiers.isStatic,
      isAsync: modifiers.isAsync,
      parameters: params,
      returnType,
      // Top-level per family contract: DB ingester reads symbol.complexity
      // (|| 1) for gravity scoring.
      complexity: ownComplexity,
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      comments: this.extractComments(node),
      qualified_calls: undefined, // M3: filled in the post-extraction pass
      apiContractPath: apiContract.path,
      taintSources: this.extractTaintSources(node),
      taintSinks: this.extractTaintSinks(node),
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
      metadata: {
        apiMethod: apiContract.method,
        isGenerator: node.type === "generator_function_declaration",
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        // `|| isAmbientDeclaration`: a signature wrapped in ambient_declaration
        // IS a declaration even though the keyword is not its own child.
        isDeclare: modifiers.isDeclare || isAmbientDeclaration,
        complexity: ownComplexity,
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)
    this._pendingQualifiedCalls.push({ symbol, node })

    // Process function body for nested symbols
    this.scopeManager.pushScope(ScopeKind.Function, name, node)
    stack.push({ action: () => this.scopeManager.popScope() })
    const body = node.childForFieldName("body")
    if (body) {
      this.insideFunctionDepth++
      stack.push({ action: () => this.insideFunctionDepth-- })
      stack.push({ node: body })
    }
    return true
  }

  /**
   * A class EXPRESSION that carries a name is a class declaration, and routes to
   * the audited class extractor. An anonymous one keeps the existing path: its
   * members belong to the binding that holds the value, which already resolves.
   */
  private extractNamedClassExpression(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    if (!node.childForFieldName("name")) return false
    return this.extractClass(node, symbols, stack)
  }

  private extractClass(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    let modifiers = extractModifiersFromNode(node)
    const exportStatus = isNodeExported(node)
    // Class decorators live on the wrapping export_statement or as own children.
    // M59 #860: the sibling/export-statement collectors hold the decorator
    // NODES, so the class's decorators are recorded with their own lines.
    for (const d of collectDecoratorsForClass(node)) {
      const n = extractDecoratorName(d)
      if (n) addDecorator(modifiers, n, d.startPosition.row + 1)
    }

    // Extract heritage (extends/implements)
    const heritage = this.extractClassHeritage(node)
    const typeParams = this.extractTypeParameters(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      isAbstract: modifiers.isAbstract,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      comments: this.extractComments(node),
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
      metadata: {
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        isDeclare: modifiers.isDeclare,
        extends: heritage.extends,
        extendsLines: heritage.extendsLines,
        implements: heritage.implements,
        implementsLines: heritage.implementsLines,
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Process class body for methods, properties, constructor
    this.scopeManager.pushScope(ScopeKind.Class, name, node)
    // R10c: the pop must be DEFERRED onto the walk stack, not called here. A
    // member extractor pushes its OWN scope (a method pushes Method, a
    // constructor Constructor) and queues that member's body for later walking,
    // so an eager pop removed the INNERMOST scope — the method's — and the
    // method's own deferred pop then removed the class scope underneath it. The
    // class scope was therefore still on the stack while a method body was walked
    // and already gone by the time the next member was extracted, which is how a
    // function, type alias or interface declared INSIDE a method body came out as
    // a member of the class: `contains K->inner`, measured, and a false edge.
    // The five extractors that already deferred their pop (function, method,
    // constructor, static block, namespace) are the pattern being applied here.
    stack.push({ action: () => this.scopeManager.popScope() })

    const body = node.childForFieldName("body")
    if (body) {
      // Overload dedup (TS allows N declarations + 1 implementation per
      // name): keep the LAST declaration of each name — it carries the body.
      const lastDeclarationOfMethod = new Map<string, number>()
      for (let i = 0; i < body.namedChildCount; i++) {
        const m = body.namedChild(i)
        if (!m) continue
        if (m.type === "method_definition" || m.type === "method_signature" || m.type === "abstract_method_signature") {
          const n = m.childForFieldName("name")?.text
          // constructors included: ctor overload groups previously pushed a
          // DUPLICATE constructor symbol per declaration
          if (n) lastDeclarationOfMethod.set(n, i)
        }
      }
      const seenMethodNames = new Set<string>()
      const seenPropertyNames = new Set<string>()
      for (let i = 0; i < body.namedChildCount; i++) {
        const member = body.namedChild(i)
        if (!member) continue
        // Method/constructor decorators are class_body SIBLINGS immediately
        // preceding the definition — collect them here and pass down.
        const memberDecorators = collectDecoratorsForMember(member, body)

        switch (member.type) {
          case "method_definition":
          case "method_signature":
          case "abstract_method_signature": {
            const memberName = member.childForFieldName("name")?.text
            if (memberName === "constructor") {
              // Last-wins: ctor overload groups previously pushed a duplicate
              // constructor symbol per declaration.
              if (lastDeclarationOfMethod.get("constructor") !== i) break
              this.extractConstructor(member, symbols, stack, memberDecorators)
              break
            }
            // Overload groups (TS allows N declarations + 1 implementation
            // per name): keep ONLY the LAST declaration. First-wins kept the
            // body-less SIGNATURE — complexity 1, no qualified_calls, no
            // taint data — while the relationship walker still emitted
            // body-derived edges sourced from that symbol.
            if (memberName && lastDeclarationOfMethod.get(memberName) !== i) {
              break
            }
            if (memberName) seenMethodNames.add(memberName)
            this.extractMethod(member, symbols, stack, memberDecorators)
            break
          }

          case "public_field_definition":
          case "property_definition":
          case "field_definition": {
            const propName = member.childForFieldName("name")?.text
            if (propName && seenPropertyNames.has(propName)) break
            if (propName) seenPropertyNames.add(propName)
            this.extractProperty(member, symbols)
            break
          }

          case "index_signature":
            this.extractIndexSignature(member, symbols)
            break

          case "static_block":
            this.extractStaticBlock(member, symbols, stack)
            break

        }
      }
    }

    return false
  }

  private extractInterface(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const exportStatus = isNodeExported(node)

    // Extract extends clause
    const extendsClause = this.extractInterfaceExtends(node)
    const typeParams = this.extractTypeParameters(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      comments: this.extractComments(node),
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
      metadata: {
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        extends: extendsClause?.names,
        extendsLines: extendsClause?.lines,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Process interface body for members
    this.scopeManager.pushScope(ScopeKind.Interface, name, node)
    // R10c: the pop must be DEFERRED onto the walk stack, not called here. A
    // member extractor pushes its OWN scope (a method pushes Method, a
    // constructor Constructor) and queues that member's body for later walking,
    // so an eager pop removed the INNERMOST scope — the method's — and the
    // method's own deferred pop then removed the class scope underneath it. The
    // class scope was therefore still on the stack while a method body was walked
    // and already gone by the time the next member was extracted, which is how a
    // function, type alias or interface declared INSIDE a method body came out as
    // a member of the class: `contains K->inner`, measured, and a false edge.
    // The five extractors that already deferred their pop (function, method,
    // constructor, static block, namespace) are the pattern being applied here.
    stack.push({ action: () => this.scopeManager.popScope() })

    const body = node.childForFieldName("body")
    if (body) {
      this.extractInterfaceMembers(body, symbols, name)
    }

    return false
  }

  private extractInterfaceMembers(body: Node, symbols: ASTEngine.UniversalSymbol[], interfaceName: string): void {
    for (let i = 0; i < body.namedChildCount; i++) {
      const member = body.namedChild(i)
      if (!member) continue

      switch (member.type) {
        case "property_signature":
        case "public_field_definition": {
          const propName = member.childForFieldName("name")
          if (propName) {
            const typeAnnotation = member.childForFieldName("type")
            const isOptional = this.hasToken(member, "?")

            symbols.push({
              name: propName.text,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeRange(member),
              scope: interfaceName,
              isStatic: false,
              returnType: typeAnnotation ? stripLeadingColon(typeAnnotation.text) : undefined,
              ownerName: interfaceName,
              ownerKind: ASTEngine.SymbolKind.Interface,
              metadata: {
                isOptional,
                isInterfaceMember: true,
              },
            })
          }
          break
        }

        case "method_signature": {
          const methodName = member.childForFieldName("name")
          if (methodName) {
            const params = this.extractParameters(member)
            const returnType = this.extractReturnType(member)

            symbols.push({
              name: methodName.text,
              kind: ASTEngine.SymbolKind.Method,
              range: this.nodeRange(member),
              scope: interfaceName,
              parameters: params,
              returnType,
              ownerName: interfaceName,
              ownerKind: ASTEngine.SymbolKind.Interface,
              metadata: {
                isInterfaceMember: true,
              },
            })
          }
          break
        }

        case "index_signature": {
          this.extractIndexSignature(member, symbols)
          break
        }

        // A CALL SIGNATURE and a CONSTRUCT SIGNATURE declare no name. TypeScript
        // spells them `interface Event<T> { (listener: T): Disposable }` and
        // `interface Ctor { new (a: A): B }`, and there is no identifier there to
        // take. This used to publish a Method symbol literally named `(call)` and a
        // Constructor named `(new)`, which put a placeholder literal into the
        // symbol table and a `contains Event -> (call)` edge into the graph.
        //
        // That edge is not joinable: no declaration anywhere carries the name
        // `(call)`, so bb_graph cannot follow it, hover has nothing to resolve, and
        // every interface in every file shares ONE target name — so the rows
        // aggregate unrelated declarations into a single node. Standing rule R7
        // names exactly this ("a placeholder literal is not a name"), and the
        // differential agreed independently: on a 200-file draw these were the only
        // two `contains` rows of 6,357 that no oracle could derive, i.e. the
        // oracle read them as fabrications and the analyzer published them anyway.
        // 8 placeholder endpoints per 200 tracked files, all of them this shape.
        //
        // The FACT is not lost — it is recorded on the interface that declares it,
        // which is the symbol a consumer actually asks about. Nothing that read
        // `isCallSignature` / `isConstructSignature` existed to break: zero hits
        // outside this file.
        case "call_signature": {
          this.recordSignatureOnOwner(symbols, interfaceName, member, "hasCallSignature", "isCallSignature")
          break
        }

        case "construct_signature": {
          this.recordSignatureOnOwner(symbols, interfaceName, member, "hasConstructSignature", "isConstructSignature")
          break
        }
      }
    }
  }

  /**
   * Record an UNNAMED member on the declaration that owns it, under a key that
   * says what it is. `hasCallSignature` is a fact about the interface; `(call)` is
   * a name that does not exist. See the `call_signature` case for the measurement.
   */
  private recordSignatureOnOwner(
    symbols: ASTEngine.UniversalSymbol[],
    ownerName: string,
    member: Node,
    flag: string,
    legacyKey: string,
  ): void {
    const params = this.extractParameters(member)
    const returnType = this.extractReturnType(member)
    for (const s of symbols) {
      if (s.name !== ownerName) continue
      const metadata = (s.metadata ??= {})
      metadata[flag] = true
      // The legacy keys are kept because an evidence file or a fixture may name
      // them; they are metadata ON THE OWNER now, not a fabricated member.
      metadata[legacyKey] = true
      metadata.signature = { parameters: params, returnType }
    }
  }

  private extractTypeAlias(node: Node, symbols: ASTEngine.UniversalSymbol[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const exportStatus = isNodeExported(node)
    const typeValue = node.childForFieldName("value")
    const typeParams = this.extractTypeParameters(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      returnType: typeValue?.text,
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      comments: this.extractComments(node),
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
      metadata: {
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        isMappedType: (() => {
          if (!typeValue) return false
          const stack: any[] = [typeValue]
          while (stack.length > 0) {
            const n: any = stack.pop()
            if (!n) continue
            if (n.type === "mapped_type_clause") return true
            for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
          }
          return false
        })(),
        isConditionalType: typeValue?.type === "conditional_type",
        isUnionType: typeValue?.type === "union_type",
        isIntersectionType: typeValue?.type === "intersection_type",
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // For object-shaped type aliases (export type X = { id: string; name: string }),
    // extract members as Property symbols so they appear alongside interface members.
    if (typeValue && typeValue.type === "object_type") {
      this.scopeManager.pushScope(ScopeKind.Type, name, node)
      for (let i = 0; i < typeValue.namedChildCount; i++) {
        const member = typeValue.namedChild(i)
        if (!member) continue
        if (member.type === "property_signature") {
          const propName = member.childForFieldName("name")
          if (!propName) continue
          const typeAnnotation = member.childForFieldName("type")
          symbols.push({
            name: propName.text,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeRange(member),
            scope: name,
            visibility: exportStatus.isExported ? "public" : "private",
            returnType: typeAnnotation ? stripLeadingColon(typeAnnotation.text) : undefined,
            ownerName: name,
            ownerKind: ASTEngine.SymbolKind.Type,
            isStatic: false,
            metadata: {
              isOptional: this.hasToken(member, "?"),
              isTypeAliasMember: true,
            },
          })
        } else if (member.type === "method_signature") {
          const methodName = member.childForFieldName("name")
          if (!methodName) continue
          symbols.push({
            name: methodName.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeRange(member),
            scope: name,
            visibility: exportStatus.isExported ? "public" : "private",
            returnType: this.extractReturnType(member),
            parameters: this.extractParameters(member),
            ownerName: name,
            ownerKind: ASTEngine.SymbolKind.Type,
            isStatic: false,
            metadata: { isTypeAliasMember: true },
          })
        }
      }
      this.scopeManager.popScope()
    }

    return true
  }

  private extractEnum(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const modifiers = extractModifiersFromNode(node)
    const exportStatus = isNodeExported(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Enum,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      comments: this.extractComments(node),
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
      metadata: {
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        isConst: modifiers.isConst,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Extract enum members
    this.scopeManager.pushScope(ScopeKind.Enum, name, node)
    // R10c: the pop must be DEFERRED onto the walk stack, not called here. A
    // member extractor pushes its OWN scope (a method pushes Method, a
    // constructor Constructor) and queues that member's body for later walking,
    // so an eager pop removed the INNERMOST scope — the method's — and the
    // method's own deferred pop then removed the class scope underneath it. The
    // class scope was therefore still on the stack while a method body was walked
    // and already gone by the time the next member was extracted, which is how a
    // function, type alias or interface declared INSIDE a method body came out as
    // a member of the class: `contains K->inner`, measured, and a false edge.
    // The five extractors that already deferred their pop (function, method,
    // constructor, static block, namespace) are the pattern being applied here.
    stack.push({ action: () => this.scopeManager.popScope() })

    const body = node.childForFieldName("body")
    if (body) {
      for (let i = 0; i < body.namedChildCount; i++) {
        const member = body.namedChild(i)
        if (!member) continue

        if (member.type === "enum_assignment" || member.type === "property_identifier") {
          const memberName =
            member.type === "enum_assignment"
              ? member.childForFieldName("name")?.text || member.namedChild(0)?.text
              : member.text

          if (memberName) {
            const valueNode = member.childForFieldName("value")

            symbols.push({
              name: memberName,
              kind: ASTEngine.SymbolKind.EnumMember,
              range: this.nodeRange(member),
              scope: name,
              ownerName: name,
              ownerKind: ASTEngine.SymbolKind.Enum,
              metadata: {
                value: valueNode?.text,
                isEnumMember: true,
              },
            })
          }
        }
      }
    }

    return false
  }

  private extractVariables(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const isConst = node.text.startsWith("const")

    for (let i = 0; i < node.namedChildCount; i++) {
      const declarator = node.namedChild(i)
      if (!declarator || declarator.type !== "variable_declarator") continue

      const nameNode = declarator.childForFieldName("name")
      if (!nameNode) continue

      // Handle destructuring patterns
      if (nameNode.type === "object_pattern" || nameNode.type === "array_pattern") {
        this.extractDestructuringPattern(nameNode, declarator, symbols, isConst)
        continue
      }

      const name = nameNode.text
      const valueNode = declarator.childForFieldName("value")
      const exportStatus = isNodeExported(node)

      // Check if this is an arrow function assignment
      let kind: ASTEngine.SymbolKind = isConst ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable
      let params: ASTEngine.Parameter[] | undefined
      let returnType: string | undefined
      let isAsync = false

      if (valueNode?.type === "arrow_function" || valueNode?.type === "function") {
        kind = ASTEngine.SymbolKind.Function
        params = this.extractParameters(valueNode)
        // M49 #757 (TS self-audit): async arrows reported returnType "void" —
        // actively misleading for a value-returning function. TS semantics:
        // an async function ALWAYS returns a Promise; an expression-bodied
        // arrow has no return statements for the block walker, so infer the
        // body expression directly (T3's sync-arrow precedent, now actually
        // wired for the expression form the T3 probe missed). Explicit
        // annotations stay authoritative and are never re-wrapped.
        let isAsyncArrow = false
        for (let j = 0; j < valueNode.childCount; j++) {
          const child = valueNode.child(j)
          if (child && (child.type === "async" || child.text === "async")) {
            isAsyncArrow = true
            break
          }
        }
        isAsync = isAsyncArrow
        const explicitRet = valueNode.childForFieldName("return_type")
        const fnBody = valueNode.childForFieldName("body")
        const isExprBody = !!fnBody && fnBody.type !== "statement_block"
        if (explicitRet) {
          returnType = stripLeadingColon(explicitRet.text)
        } else if (isExprBody) {
          const info = this.typeInference.inferFromInitializer(fnBody!)
          const inner = info.type !== "unknown" ? info.type : "void"
          returnType = isAsyncArrow ? `Promise<${inner}>` : inner
        } else {
          returnType = this.extractReturnType(valueNode)
          if (isAsyncArrow) returnType = `Promise<${returnType}>`
        }
      } else {
        // Infer type from initializer
        const typeInfo = this.typeInference.inferType(declarator)
        returnType = typeInfo.type !== "unknown" ? typeInfo.type : undefined
      }

      const modifiers = extractModifiersFromNode(node)
      // M5: an arrow/function-valued variable is a Function symbol, so it gets
      // the same API-contract extraction a `function` declaration gets. Without
      // it the dominant handler shape carried no contract at all: the analyzer
      // reported `/api/fn` for `function fnHandler(){ return fetch("/api/fn") }`
      // and nothing for the identical `const arrowHandler = () => fetch(...)` —
      // while `extractApiContract` already had an `arrow_function` branch, so
      // the intent was there and the caller was missing.
      const apiContract =
        valueNode?.type === "arrow_function" || valueNode?.type === "function"
          ? this.extractApiContract(valueNode)
          : { path: undefined, method: undefined }

      const symbol: ASTEngine.UniversalSymbol = {
        name,
        kind,
        range: this.nodeRange(declarator),
        scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
        visibility: exportStatus.isExported ? "public" : "private",
        isStatic: modifiers.isStatic,
        isAsync,
        parameters: params,
        returnType,
        decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
        comments: this.extractComments(node),
        // M3: qualified_calls is filled by the post-extraction pass (see
        // _pendingQualifiedCalls) — only arrow/function-valued declarators are
        // enqueued, and a plain variable has no call paths of its own.
        apiContractPath: apiContract.path,
        taintSources: valueNode ? this.extractTaintSources(valueNode) : undefined,
        taintSinks: valueNode ? this.extractTaintSinks(valueNode) : undefined,
        ...this.scopeManager.getOwnerInfoForDeclaration(node),
        metadata: {
          apiMethod: apiContract.method,
          isExported: exportStatus.isExported,
          isDefault: exportStatus.isDefault,
          isConst,
          isDeclare: modifiers.isDeclare,
          complexity:
            kind === ASTEngine.SymbolKind.Function && valueNode ? this.calculateComplexity(valueNode) : undefined,
          decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
        },
      }

      symbols.push(symbol)
      this.scopeManager.registerSymbol(symbol)
      if (valueNode?.type === "arrow_function" || valueNode?.type === "function") {
        this._pendingQualifiedCalls.push({ symbol, node: valueNode })
      }

      // If arrow function, process body for nested symbols (locals suppressed)
      if (valueNode?.type === "arrow_function" || valueNode?.type === "function") {
        this.scopeManager.pushScope(ScopeKind.ArrowFunction, name, valueNode)
        stack.push({ action: () => this.scopeManager.popScope() })
        const body = valueNode.childForFieldName("body")
        if (body) {
          this.insideFunctionDepth++
          stack.push({ action: () => this.insideFunctionDepth-- })
          stack.push({ node: body })
        }
      }

      // W1 (JD18-class): object-literal VALUES carry members. Returning
      // false lets the walk descend naturally into the declarator's object
      // value, where the method_definition case extracts each member at ANY
      // depth (JS parity — nested object methods are their own scope).
      // R1: a CLASS EXPRESSION value carries members too, and the javascript
      // twin has always descended into it — `const A = class Inner { m() {} }`
      // emitted `method:m` there and NOTHING here, because the `object` test
      // below was the only descent trigger. The whole body was lost with it: no
      // member symbol, no `contains` edge, and the calls inside `m` attributed
      // to the enclosing function instead. The oracle derives nothing for the
      // shape, so no differential could have flagged it; the twin was the only
      // available reference.
      if (valueNode?.type === "object" || valueNode?.type === "class") {
        return false
      }
    }
    return true
  }

  private extractDestructuringPattern(
    pattern: Node,
    declarator: Node,
    symbols: ASTEngine.UniversalSymbol[],
    isConst: boolean,
  ): void {
    // M59 (#825) follow-up, measured on element-plus drawer.vue: every binding
    // gets the range of the node that BINDS it — the old code collected bare
    // names and stamped the whole declarator (`const {` for all of
    // afterEnter/afterLeave/... on lines 155-168). Two latent defects fixed
    // with the same rewrite: `{ renamed: local }` named the KEY (or nothing —
    // a property_identifier is neither identifier branch) instead of the bound
    // VALUE, and `{ withDefault = 5 }` (object_assignment_pattern) was dropped
    // entirely. The line belongs to the name (family contract).
    const extractPairs = (node: Node, out: Array<{ name: string; node: Node }>): void => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child) continue

        if (child.type === "identifier" || child.type === "shorthand_property_identifier" || child.type === "shorthand_property_identifier_pattern") {
          out.push({ name: child.text, node: child })
        } else if (child.type === "pair_pattern") {
          // { key: value } — the VALUE side binds (key is the property read).
          const value = child.childForFieldName("value")
          if (value) {
            if (value.type === "identifier" || value.type === "shorthand_property_identifier" || value.type === "shorthand_property_identifier_pattern") {
              out.push({ name: value.text, node: value })
            } else {
              extractPairs(value, out)
            }
          }
        } else if (child.type === "rest_pattern") {
          const inner = child.namedChild(0)
          if (inner) {
            if (inner.type === "identifier") {
              out.push({ name: inner.text, node: inner })
            } else {
              extractPairs(inner, out)
            }
          }
        } else if (child.type === "assignment_pattern") {
          const left = child.childForFieldName("left") ?? child.namedChild(0)
          if (left) {
            if (left.type === "identifier" || left.type === "shorthand_property_identifier" || left.type === "shorthand_property_identifier_pattern") {
              out.push({ name: left.text, node: left })
            } else {
              extractPairs(left, out)
            }
          }
        } else if (child.type === "object_assignment_pattern" || child.type === "object_pattern" || child.type === "array_pattern") {
          extractPairs(child, out)
        }
      }
    }

    const pairs: Array<{ name: string; node: Node }> = []
    extractPairs(pattern, pairs)
    const exportStatus = isNodeExported(declarator)

    for (const { name, node: nameNode } of pairs) {
      symbols.push({
        name,
        kind: isConst ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
        range: this.nodeRange(nameNode, false),
        scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
        visibility: exportStatus.isExported ? "public" : "private",
        // A destructured binding is a declaration too:  inside a
        // method is a local of that method, not a member of the class. The
        // lexical question is asked of the DECLARATOR, which is the node whose
        // ancestors describe where the binding is written.
        ...this.scopeManager.getOwnerInfoForDeclaration(declarator),
        metadata: {
          isDestructured: true,
          isConst,
        },
      })
    }
  }

  private extractMethod(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    stack: StackEntry[],
    decoratorNodes?: Node[],
  ): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const modifiers = extractModifiersFromNode(node)
    // Member decorators are class_body SIBLINGS, not children of the
    // method_definition — merge the sibling-collected names in.
    // M59 #860: method decorators are siblings, and those nodes carry the line
    // their reference edge must name.
    for (const d of decoratorNodes ?? []) {
      const n = extractDecoratorName(d)
      if (n) addDecorator(modifiers, n, d.startPosition.row + 1)
    }
    const params = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const typeParams = this.extractTypeParameters(node)

    // get/set accessors parse as method_definition with a `get`/`set` token
    // child — classify as Property (family contract: accessors are properties).
    let isAccessor = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && (c.text === "get" || c.text === "set") && (c.type === "get" || c.type === "set" || c.type === "identifier")) {
        isAccessor = true
        break
      }
    }
    // Also check the direct token children (get/set are often anonymous tokens)
    if (!isAccessor) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && (c.text === "get" || c.text === "set") && !c.isNamed) {
          isAccessor = true
          break
        }
      }
    }

    // Determine visibility
    let visibility: "public" | "private" | "protected" = "public"
    if (modifiers.isPrivate || name.startsWith("#")) {
      visibility = "private"
    } else if (modifiers.isProtected) {
      visibility = "protected"
    }

    const ownerInfo = this.scopeManager.getOwnerInfoForDeclaration(node)
    // ONE complexity walk per method: the top-level field and the metadata
    // mirror are the same number by contract.
    const ownComplexity = this.calculateComplexity(node)
    const apiContract = this.extractApiContract(
      node,
      decoratorNodes && decoratorNodes.length > 0 ? decoratorNodes : undefined,
    )
    // T5 (review wave): compose a class-level base path (@Controller("users"),
    // @RequestMapping("/api")) with the method route, like java's
    // basePath+methodRoute composition. A bare @Get() under a base still
    // routes the base itself (NestJS semantics).
    let apiContractPath = apiContract.path
    if (apiContract.method) {
      const basePath = this.extractControllerBasePath()
      if (basePath !== undefined) {
        apiContractPath = joinContractPaths(basePath, apiContractPath)
      } else if (apiContractPath !== undefined) {
        apiContractPath = ensureLeadingSlash(apiContractPath)
      }
    }

    const symbol: ASTEngine.UniversalSymbol = {
      // M49 W15 (#813, owner ruling "symbol keeps the declared name"): a `#x`
      // member declares the name `#x`, and every edge that reads it already
      // carries that spelling — the old strip made the edge target name no
      // symbol at all (the join `edge.target -> symbol.name` failed for every
      // private member). `#` cannot appear in an identifier, so the declared
      // spelling can never collide with a module binding of the same text.
      name,
      kind: isAccessor ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Method,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      visibility,
      isStatic: modifiers.isStatic,
      isAsync: modifiers.isAsync,
      isAbstract: modifiers.isAbstract,
      parameters: params,
      returnType,
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      complexity: ownComplexity,
      comments: this.extractComments(node),
      qualified_calls: undefined, // M3: filled in the post-extraction pass
      apiContractPath,
      taintSources: this.extractTaintSources(node),
      taintSinks: this.extractTaintSinks(node),
      ...ownerInfo,
      metadata: {
        apiMethod: apiContract.method,
        isOverride: modifiers.isOverride,
        isPrivateField: name.startsWith("#"),
        isGenerator: (() => {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)
            if (c && !c.isNamed && c.text === "*") return true
          }
          return false
        })(),
        isAccessor,
        complexity: ownComplexity,
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
    this._pendingQualifiedCalls.push({ symbol, node })

    // Process method body for nested symbols (function depth suppresses locals)
    this.scopeManager.pushScope(ScopeKind.Method, name, node)
    stack.push({ action: () => this.scopeManager.popScope() })
    const body = node.childForFieldName("body")
    if (body) {
      this.insideFunctionDepth++
      stack.push({ action: () => this.insideFunctionDepth-- })
      stack.push({ node: body })
    }
    return true
  }

  private extractConstructor(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    stack: StackEntry[],
    decoratorNodes?: Node[],
  ): boolean {
    const params = this.extractParameters(node)
    const ownerInfo = this.scopeManager.getOwnerInfoForDeclaration(node)
    const modifiers = extractModifiersFromNode(node)
    const apiContract = this.extractApiContract(
      node,
      decoratorNodes && decoratorNodes.length > 0 ? decoratorNodes : undefined,
    )

    const symbol: ASTEngine.UniversalSymbol = {
      name: "constructor",
      kind: ASTEngine.SymbolKind.Constructor,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      visibility: "public",
      parameters: params,
      comments: this.extractComments(node),
      qualified_calls: undefined, // M3: filled in the post-extraction pass
      apiContractPath: apiContract.path,
      ...ownerInfo,
      metadata: { apiMethod: apiContract.method },
    }

    symbols.push(symbol)
    this._pendingQualifiedCalls.push({ symbol, node })

    // Extract parameter properties (public/private/protected/readonly constructor params).
    // Modifier words must come from the parameter's actual keywords — substring
    // matching on default-value text fabricated phantom properties from string
    // defaults like t: string = "private".
    //
    // M59 (#825) follow-up, measured on element-plus cascader-panel/node.ts:
    // each property's range starts at its own PARAMETER's name line, not the
    // constructor's. The old nodeRange(node) stamped `constructor(` for every
    // member of a wrapped header (`readonly data/config/parent/root` all
    // claimed line 58, written on 59-62) — the line belongs to the name.
    const paramNameNodes = new Map<string, Node>()
    const formalParams = node.childForFieldName("parameters")
    if (formalParams) {
      for (let i = 0; i < formalParams.namedChildCount; i++) {
        const p = formalParams.namedChild(i)
        if (!p) continue
        const pat = p.childForFieldName("pattern") ?? p.childForFieldName("name")
        if (pat) paramNameNodes.set(stripPrefix(pat.text, "..."), pat)
      }
    }
    for (const param of params) {
      const mods: string[] = (param as any).modifiers ?? []
      const hasVis = mods.includes("public") || mods.includes("private") || mods.includes("protected")
      const hasRead = mods.includes("readonly")
      if (!hasVis && !hasRead) continue

      const vis: "public" | "private" | "protected" = mods.includes("private")
        ? "private"
        : mods.includes("protected")
          ? "protected"
          : "public"

      const name = param.name.startsWith("...") ? param.name.slice(3) : param.name
      const nameNode = paramNameNodes.get(name)
      const propRange = nameNode ? this.nodeRange(nameNode, false) : this.nodeRange(node)
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Property,
        range: propRange,
        scope: ownerInfo?.ownerName,
        visibility: vis,
        returnType: param.type,
        ...ownerInfo,
        metadata: {
          isParameterProperty: true,
          isReadonly: hasRead,
        },
      })
    }

    // Process constructor body (function depth suppresses locals)
    this.scopeManager.pushScope(ScopeKind.Constructor, "constructor", node)
    stack.push({ action: () => this.scopeManager.popScope() })
    const body = node.childForFieldName("body")
    if (body) {
      this.insideFunctionDepth++
      stack.push({ action: () => this.insideFunctionDepth-- })
      stack.push({ node: body })
    }
    return true
  }

  private extractProperty(node: Node, symbols: ASTEngine.UniversalSymbol[]): void {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const name = nameNode.text
    const modifiers = extractModifiersFromNode(node)
    const typeAnnotation = node.childForFieldName("type")
    const valueNode = node.childForFieldName("value")

    // Infer type if not explicitly annotated
    let returnType = typeAnnotation ? stripLeadingColon(typeAnnotation.text) : undefined
    if (!returnType && valueNode) {
      const typeInfo = this.typeInference.inferFromInitializer(valueNode)
      returnType = typeInfo.type !== "unknown" ? typeInfo.type : undefined
    }

    let visibility: "public" | "private" | "protected" = "public"
    if (modifiers.isPrivate || name.startsWith("#")) {
      visibility = "private"
    } else if (modifiers.isProtected) {
      visibility = "protected"
    }

    const ownerInfo = this.scopeManager.getOwnerInfoForDeclaration(node)

    const symbol: ASTEngine.UniversalSymbol = {
      // #813: the declared spelling is the member's one name (see the method
      // site above). `metadata.isPrivateField` stays as the flag consumers
      // read for the private-ness itself.
      name,
      kind: ASTEngine.SymbolKind.Property,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      visibility,
      isStatic: modifiers.isStatic,
      returnType,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      comments: this.extractComments(node),
      ...ownerInfo,
      metadata: {
        isReadonly: modifiers.isReadonly,
        isPrivateField: name.startsWith("#"),
        isAbstract: modifiers.isAbstract,
        hasInitializer: !!valueNode,
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
  }

  /**
   * M14 — declared-type reference graph. TypeScript's grammar wraps every
   * declared type position in a `type_annotation` node, so hooking that one
   * node type covers interface members, class fields, ctor/method params,
   * return types, and typed locals uniformly. as-casts (`x as T`) parse as
   * as_expression; instanceof checks as binary_expression with the
   * instanceof operator — both handled here with their own labels.
   */
  private extractDeclaredTypeRefs(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[] = [],
  ): void {
    // THE FILE's OWN SYMBOLS — the resolution gate for the `uses` surface below. A type mention
    // of a name THIS FILE DOES NOT DECLARE is a `references` row and no `uses` row, because
    // `uses` has always meant "the target resolves to something here". The gate is the file's own
    // symbol table, never the project index: an imported name is not declared here, and the
    // fixture `type-reference-uses-surfaces` pins BOTH halves of that gate (a declared type gets
    // `uses`, an imported one does not).
    const declaredHere = new Set<string>()
    for (const sym of symbols) if (sym?.name) declaredHere.add(sym.name)
    const emitted = new Set<string>()
    const PRIMITIVES = new Set(["string", "number", "boolean", "any", "unknown", "never", "void", "object", "symbol", "bigint", "undefined", "null"])

    const collectTypeNames = (n: Node, out: string[]): void => {
      if (n.type === "type_identifier" || n.type === "nested_type_identifier") {
        if (!PRIMITIVES.has(n.text) && !out.includes(n.text)) out.push(n.text)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNames(c, out)
      }
    }

    /**
     * M59 (#825): the same walk as `collectTypeNames`, returning each name WITH
     * the node that spells it. A type expression's start is NOT the line of the
     * types inside it — a multi-line generic argument list opens on the base name
     * and puts its arguments on later lines (scala mechanism 2, measured on real
     * source), so the line has to come from the name node and the string-only walk
     * cannot supply it. Kept beside `collectTypeNames` so the two cannot drift: one
     * is that walk's names, the other its names plus their nodes.
     */
    const collectTypeNameNodes = (n: Node, out: Array<{ name: string; node: Node }>): void => {
      // A NODE CAN NAME NOTHING. Tree-sitter's error recovery inserts zero-width MISSING nodes whose
      // text is ""; when such a node sits in a type position it used to become a relationship with an
      // EMPTY target — an edge no resolver can bind and no intent test can place (the gate now counts
      // that class as `noTarget` and discloses it as a lane defect). Measured on
      // redwood/packages/internal/src/__tests__/fixtures/web/src/exports.ts, a `.ts` file containing
      // the JSX fragment `return <>Hello</>`: `myArrowFunctionExport -> ""` as a references/cast_target
      // row. An empty target is not a weaker claim, it is not a relationship at all.
      // `typeof X` NAMES THE VALUE SYMBOL X, and its operand lexes as a plain `identifier`
      // (`nested_identifier` for `typeof ns.X`) — never a `type_identifier`, so the collector used
      // to skip the whole node. The spec-table row `type_query -> declared_type` was therefore
      // declared implemented while emitting NOTHING. Measured on
      // vue-core/packages-private/dts-test/extractProps.test-d.ts: `declare const props:
      // Prettify<ExtractPropTypes<typeof propsOptions>>` produced no edge for `propsOptions`,
      // which the lane's own references/uses oracles DO derive — the differential named it.
      if (n.type === "type_query") {
        let operand: Node | null = null
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) { operand = c; break }
        }
        if (operand) {
          if (operand.type === "identifier") {
            if (operand.text.length > 0 && !PRIMITIVES.has(operand.text) && !out.some((o) => o.name === operand!.text)) out.push({ name: operand.text, node: operand })
          } else {
            // The operand may be a nested_identifier (`typeof ns.X`), whose LAST identifier is the
            // name the file spells (the leaf, matching every other target rule on this lane).
            collectTypeNameNodes(operand, out)
          }
        }
        return
      }
      if (n.type === "type_identifier" || n.type === "nested_type_identifier") {
        if (n.text.length > 0 && !PRIMITIVES.has(n.text) && !out.some((o) => o.name === n.text)) out.push({ name: n.text, node: n })
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNameNodes(c, out)
      }
    }

    /**
     * The symbol that OWNS a type mention, or `null` when nothing does.
     *
     * This pass's walk list is deliberately the ORIGINAL, narrow one — a
     * function, method, class, interface or module-level declarator — and the
     * change here is only to the FALLBACK. It used to answer `"global"` when the
     * walk found no owner, which published edges whose source is not a symbol in
     * the file: `global` appeared as a source 185 times over 700 tracked files and
     * was never once a real symbol, so all of those edges dangled at the source
     * end.
     *
     * The tempting repair was to WIDEN the list so a type alias or enum would
     * claim its own mentions. That is wrong, and measured: every one of those
     * mentions is already emitted by the main reference pass under the correct
     * owner. `type AutoIndexState = { index: IndexDetection }` already produced
     * `AutoIndexState->IndexDetection`; what the fallback added was the SAME edge
     * a second time with `global` in the source column. Widening the list
     * therefore converted 212 wrong-source duplicates into 212 right-source
     * duplicates — the row count did not fall, it rose. Verified on
     * `auto-index.ts`, where `AutoIndexState->IndexDetection` went from one row to
     * two.
     *
     * So the fallback was never carrying information. Where no listed declaration
     * owns the mention, the honest answer is NO EDGE — which is what `null` means
     * and what `emit` now does. A fabricated source is not a weaker claim than
     * silence; it is a wrong one, and it was the only source in the graph that no
     * consumer could resolve.
     */
    // THE OWNING DECLARATIONS — the list is unchanged; what changed is that the owner is now
    // returned WITH ITS NODE, because the `uses` surface below has to tell a DECLARATION that
    // writes a type (an interface property, a type alias's right-hand side, a variable's
    // annotation) from a FUNCTION that mentions one (a parameter, a return type). The two are
    // different surfaces and the fixture pins them differently: the declaration-owned one carries
    // `declaredTypeRole`, the function-scoped one carries `isTypeReference` and comes from the
    // main pass.
    const DECLARATION_OWNERS = new Set([
      "class_declaration",
      "class",
      "abstract_class_declaration",
      "interface_declaration",
      "type_alias_declaration",
      "enum_declaration",
      "internal_module",
      "module",
      "variable_declarator",
    ])
    const resolveOwner = (start: Node): { name: string; node: Node } | null => {
      let p: Node | null = start.parent
      while (p) {
        if (
          p.type === "class_declaration" ||
          p.type === "class" ||
          p.type === "abstract_class_declaration" ||
          p.type === "function_declaration" ||
          p.type === "generator_function_declaration" ||
          p.type === "method_definition" ||
          p.type === "interface_declaration" ||
          p.type === "type_alias_declaration" ||
          p.type === "enum_declaration" ||
          p.type === "internal_module" ||
          p.type === "module" ||
          p.type === "variable_declarator"
        ) {
          const name = this.findNamedChild(p)
          if (name) return { name: name.text, node: p }
        }
        p = p.parent
      }
      return null
    }
    const resolveSource = (start: Node): string | null => resolveOwner(start)?.name ?? null

    /**
     * `references` rows already in the SHARED relationship array, so this pass
     * does not re-add a mention the main reference pass already recorded.
     *
     * Two passes cover type mentions — this one and the main pass — and they
     * overlap: `type AutoIndexState = { index: IndexDetection }` is emitted by
     * both. The main pass keeps its own per-key `processed` set and this pass its
     * own `emitted` set, and NEITHER can see the other, so an overlap used to
     * reach the graph twice. That duplication is invisible while both rows are
     * correct, which is why it survived; it only became visible when the source
     * differed and the two rows stopped agreeing.
     */
    const alreadyPublished = new Set<string>()
    for (const rel of relationships) {
      if (rel.type === ASTEngine.RelationshipType.References) alreadyPublished.add(`${rel.source}|${rel.target}`)
    }

    const emit = (owner: { name: string; node: Node } | null, roots: Node[], relType: string): void => {
      // No owning declaration means no edge. See `resolveSource`.
      if (owner === null) return
      const source = owner.name
      // THE ROLE OF THE OWNER — the declaration that WRITES the mention.
      //
      // `type_alias` for a type alias's right-hand side; `declared_type` for a declaration that
      // writes a type some other way (an interface property, a variable's annotation, a class
      // property); and NOTHING for a function or a method, because a function's parameter and
      // return types are the OTHER surface — the one the main pass publishes with
      // `isTypeReference`, and the one the fixture pins under that name.
      const role: "declared_type" | "type_alias" | undefined =
        owner.node.type === "type_alias_declaration"
          ? "type_alias"
          : DECLARATION_OWNERS.has(owner.node.type)
            ? "declared_type"
            : undefined
      for (const r of roots) {
        if (!r) continue
        // Expression-position targets (instanceof) lex as plain identifiers;
        // type positions use type_identifier — accept both here.
        const pairs: Array<{ name: string; node: Node }> = []
        if (r.type === "identifier") {
          if (!PRIMITIVES.has(r.text)) pairs.push({ name: r.text, node: r })
        } else {
          collectTypeNameNodes(r, pairs)
        }
        for (const { name: t, node: tNode } of pairs) {
          // ERROR-RECOVERY GUARD: a zero-width MISSING node names nothing (see collectTypeNameNodes).
          if (t.length === 0) continue
          const key = `${source}|${t}|${relType}`
          if (emitted.has(key)) continue
          // A mention the main reference pass already published under this owner
          // is not published again here. See `alreadyPublished`.
          const published = `${source}|${t}`
          if (alreadyPublished.has(published)) continue
          emitted.add(key)
          alreadyPublished.add(published)
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            ...this.lineField(tNode),
            metadata: { relationshipType: relType },
          })
          // THE DECLARATION-OWNED `uses` SURFACE.
          //
          // A type mention is a USE of the type it names, from EVERY declaration that can write
          // one — not only from a function body. MEASURED: on 150 files of the corpus the
          // oracle published 718 `uses` rows across 50 files that the analyzer did not publish,
          // all of them from this surface, and that is larger than the `field` (113) and `expr`
          // (19) terms of that label's whole disagreement combined.
          //
          // THE GATE, in both directions, and it is the gate that makes the row a `uses` row and
          // not a `references` row: the target must be DECLARED IN THIS FILE. An imported name is
          // not declared here, so a mention of it stays a `references` row alone.
          //
          // AND THE ROW DOES NOT CARRY `isTypeReference`, so the one-label ruling
          // (`dropDuplicateTypeMentionLabels`) does not drop the `references` row beside it: the
          // two rows are DIFFERENT surfaces (the position, and the use) and the fixture pins both.
          //
          // A SELF-MENTION IS NOT A USE: `interface Rec { next?: Rec }` mentions itself, and a
          // `uses Rec -> Rec` row would be a declaration using itself. The fixture forbids it.
          if (
            role !== undefined &&
            declaredHere.has(t) &&
            t !== source &&
            !alreadyPublished.has(`uses|${source}|${t}`)
          ) {
            alreadyPublished.add(`uses|${source}|${t}`)
            relationships.push({
              source,
              target: t,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              ...this.lineField(tNode),
              metadata: { declaredTypeRole: role },
            })
          }
        }
      }
    }

    const walk = (n: Node): void => {
      switch (n.type) {
        case "type_annotation": {
          // A type_annotation directly on a function/method AFTER its
          // parameter list is the return type — label it distinctly.
          const p = n.parent
          const isReturn =
            (p?.type === "method_definition" || p?.type === "function_declaration") &&
            (() => {
            if (!p) return false
            let sawParams = false
            for (let i = 0; i < p.namedChildCount; i++) {
              const c = p.namedChild(i)
              if (!c) continue
              if (c.type === "formal_parameters") { sawParams = true; continue }
              // Tree-sitter node objects are recreated per access — compare
              // by id, never by reference.
              if (n.id !== undefined && c.id === n.id) return sawParams
              if (c.startIndex === n.startIndex && c.type === n.type) return sawParams
            }
            return false
            })()
          emit(resolveOwner(n), [n], isReturn ? "return_type" : "declared_type")
          break
        }
        case "as_expression": {
          if (n.namedChildCount >= 2) {
            const right = n.namedChild(n.namedChildCount - 1)
            if (!right) break
            emit(resolveOwner(n), [right], "cast_target")
          }
          break
        }
        case "binary_expression": {
          // The operator is an ANONYMOUS child token (no named field in this
          // grammar), so detect it by walking children.
          let isInstanceof = false
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c && !c.isNamed && c.text === "instanceof") { isInstanceof = true; break }
          }
          if (isInstanceof) {
            const right = n.namedChild(n.namedChildCount - 1)
            // Expression position: the target lexes as identifier, not
            // type_identifier — emit() handles both shapes.
            if (right) emit(resolveOwner(n), [right], "instanceof_check")
          }
          break
        }
        case "type_alias_declaration": {
          // M14 #419 T2: the alias RHS references its own types —
          // type Fn = (a: Id) => Id references Id (param + return),
          // type Pair = [Id, Id] references Id, type Rec = { next?: Rec }
          // references Rec (self). Pre-fix the RHS types were silent; the
          // alias symbol emitted but carried no reference edges.
          const aliasName = n.childForFieldName("name")?.text
          const value = n.childForFieldName("value")
          if (aliasName && value) {
            // The value's own type_parameters (T, K) are bindings, not
            // references — collectTypeNames already skips nothing here, so
            // the RHS value node alone carries the referenced types.
            emit({ name: aliasName, node: n }, [value], "type_alias")
          }
          break
        }
        case "type_assertion": {
          // M14 #419 T8: <Foo>x — the angle-bracket cast form. The type
          // lives in the first named child (type_arguments wrapper holds
          // the type_identifier(s)).
          const inner = n.namedChild(0)
          if (inner) emit(resolveOwner(n), [inner], "cast_target")
          break
        }
        case "type_arguments": {
          // M14 #419 T9: explicit generic instantiation — f<Baz>(x) parses
          // as call_expression with a type_arguments child (no
          // instantiation_expression node), and foo<Bar> standalone parses
          // as instantiation_expression with a type_arguments child. The
          // walk recurses into type_arguments either way, so hooking the
          // node itself covers both shapes: the type names inside (Baz) are
          // references, not bindings.
          // SCD7 (M37 #599 pre-wave): when this type_arguments is embedded
          // in a type_annotation (`const local: Map<String, Foo>`), the
          // type_annotation case ALREADY emitted every nested name as
          // declared_type (the java/kotlin family contract: one
          // declared_type per type name). Emitting them again as
          // type_argument double-emitted String/Foo from the same site.
          // Call-site/instantiation type_arguments keep their edge.
          let inAnnotation = false
          for (let a = n.parent; a; a = a.parent) {
            if (a.type === "type_annotation") { inAnnotation = true; break }
          }
          if (inAnnotation) break
          const names: string[] = []
          collectTypeNames(n, names)
          if (names.length > 0) emit(resolveOwner(n), [n], "type_argument")
          break
        }
        case "satisfies_expression": {
          // M14 #419 T5: x satisfies T — T is a type reference (TS 4.9).
          const last = n.namedChild(n.namedChildCount - 1)
          if (last) emit(resolveOwner(n), [last], "satisfies_target")
          break
        }
        // TYPE-PARAMETER CONSTRAINTS — `<T extends C>`. The type PARAMETER's own name is a
        // binding and is NOT a child of `constraint`, so collecting from this node names only
        // the constraint (`C`, and both arms of an intersection). Pre-fix this position was
        // silent: the only row was `references f -> T` (the binding), and `C` — the type the
        // declaration cannot be checked without — never appeared. Pinned by
        // `heritage-parameterized-leaves` (`references shrink -> Shape`), which is the fixture
        // this case is here to pass; the corpus draw in that fixture's rationale measured 53
        // constraint sites in 40 files, 13 of 24 distinct names reached before the fix.
        //
        // A TYPE-PREDICATE writer (`x is Foo` -> `type_predicate_target`) was TRIED BESIDE
        // THIS ONE AND WITHDRAWN, with its measurement: together they added 54 rows,
        // `unresolved` moved 10,103 -> 10,126 (+23) and `arbitraryTwin` +1, and neither
        // type-position fixture passed anyway because both require the `uses` row to SURVIVE
        // beside `references` — the one-label ruling `dropDuplicateTypeMentionLabels`
        // implements. The constraint writer alone pays for itself (one fixture passes,
        // `references` grows by a position that was silent); the predicate writer did not.
        case "type_predicate": {
          // `f(x): x is Foo` / `asserts x is Foo`. The grammar's `name` field is the PARAMETER
          // binding (`x`) and names no type; only the `type` field names a type. Both fixtures
          // pin the pair: a `references` row labelled `type_predicate_target` AND the `uses`
          // row the mention pass publishes for the same position. The binding is forbidden by
          // `type-predicate-and-constraint-refs`' forbid rows (x is not a type).
          const predType = n.childForFieldName("type")
          if (predType) emit(resolveOwner(n), [predType], "type_predicate_target")
          break
        }
        case "constraint": {
          emit(resolveOwner(n), [n], "type_parameter_constraint")
          break
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  private findNamedChild(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier" || c.type === "identifier" || c.type === "property_identifier") return c
    }
    return null
  }

  /**
   * Drop the `uses` half of a type mention that `extractDeclaredTypeRefs` already
   * published as `references`. In-place compaction, order-preserving, and it only
   * ever removes a row whose (source, target) pair is still present under the other
   * label — so no mention loses its edge.
   *
   * `references` is not the only label `extractDeclaredTypeRefs` writes, but it is
   * the only one it writes for a TYPE POSITION, and the test is on the row's own
   * `isTypeReference` metadata rather than on the label, so a `uses` row from the
   * field or template surfaces is untouched: those are reads, not type mentions.
   */
  private dropDuplicateTypeMentionLabels(relationships: ASTEngine.UniversalRelationship[]): void {
    // THE PIN WAS CORRECTED BY RULING (2026-10-17, iteration 2d; Lead-authorised pin-change set).
    // The one-label ruling exists to stop ONE mention being emitted TWICE — it does not say the
    // mention emits NOTHING. A type mention is a USE of the type, so the `uses` row is kept and
    // the DUPLICATE `references` row for that same mention is dropped. Two positions keep BOTH
    // surfaces because `type-predicate-and-constraint-refs` pins uses+references for them.
    // Four fixture pins moved with this contract (stated in each fixture's own source):
    // `usage-references`, `parameter-shadows-file-symbol`, `type-alias-mentions-own-alias`,
    // `unnamed-signature-members`.
    const KEEPS_BOTH = new Set(["type_parameter_constraint", "type_predicate_target"])
    const typeSurfaceUses = new Set<string>()
    for (const r of relationships) {
      const meta = r.metadata as { isTypeReference?: unknown } | undefined
      if (r.type === ASTEngine.RelationshipType.Uses && meta?.isTypeReference === true) {
        typeSurfaceUses.add(`${r.source}|${r.target}`)
      }
    }
    if (typeSurfaceUses.size === 0) return
    let write = 0
    for (let read = 0; read < relationships.length; read++) {
      const r = relationships[read]
      if (r.type === ASTEngine.RelationshipType.References) {
        const label = String((r.metadata as { relationshipType?: unknown } | undefined)?.relationshipType ?? "")
        if (!KEEPS_BOTH.has(label) && typeSurfaceUses.has(`${r.source}|${r.target}`)) continue
      }
      relationships[write++] = r
    }
    relationships.length = write
  }

  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Same rules as the JVM family (structural / usage_contextual /
   * import_based / reference_qualified / inferred).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      // M14 #419 T1: the dedicated `imports` relationship kind carries
      // module dependencies (target module:item) — same evidence class the
      // JVM family gives its import references (isImportDep/import_based).
      // Pre-fix this kind fell through to usage_contextual.
      if (t === "imports") { md.evidenceClass = "import_based"; continue }
      if (t === "references") {
        // `reference_qualified` unconditionally: the JVM family's
        // `isImport` discriminator is never set on a relationship this
        // analyzer emits (its import edges are the dedicated `imports` kind,
        // classified above), so the true branch was unreachable.
        md.evidenceClass = "reference_qualified"
        continue
      }
      if (t === "extends" || t === "implements") {
        md.evidenceClass = conf >= 1 ? "structural" : "inferred"
        continue
      }
      if (t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = conf >= 0.9 ? "structural" : "usage_contextual"
        continue
      }
      // `decorates` is STRUCTURAL unconditionally: the row is read off the decorated declaration's
      // own decorator list (the symbol the analyzer recorded), not inferred from a mention in a
      // body — the same class `contains`/`exports` get for being read off a declaration.
      if (t === "decorates") { md.evidenceClass = "structural"; continue }
      // `renders` follows `instantiates`'s rule, because it is the same kind of fact: the JSX
      // element is the construction site written in the source. Confidence 0.9 (the capitalized-
      // component convention) is what decides structural vs contextual, exactly as it does there.
      if (t === "renders") {
        md.evidenceClass = conf >= 0.9 ? "structural" : "usage_contextual"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // THE BINDING CLAIMS (D7 depth round, 2026-10-19): the two claim kinds the arbiter verifies from
  // evidence the CLAIM DOES NOT SUPPLY. Both are re-spellings or markers on rows the analyzer already
  // publishes — never new rows (the gate's dedupe key is `source\0type\0target\0line`; the JS lane
  // measured +49 rows from adding a second target spelling instead of re-spelling).
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  /**
   * PUBLISH THE IMPORTED-BINDING EVIDENCE ON THIS FILE'S `imports` EDGES.
   *
   * The imported-binding claim ("this target is a local name bound by an import of `specifier`") is
   * verified by the arbiter against the FILE'S IMPORT EDGES (`metadata.importedBindings` on each
   * imports row, keyed by `metadata.module`), never against the claim's own word: a claim and its
   * evidence from one author is not a check. This method is that evidence.
   *
   * It also fills `_importBindingSpecs` — local name -> specifier — for specifiers that are NOT
   * project-local (external packages and node builtins). A project-local specifier (relative,
   * absolute, or a workspace package named in the project's package.json) is EXCLUDED: it names a
   * project module, and a claim over it would launder a resolvable edge as a binding.
   */
  private publishImportedBindingEvidence(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const rel of relationships as any[]) {
      if (String(rel?.type ?? "") !== "imports") continue
      const md: Record<string, any> = (rel.metadata ??= {})
      if (md.isReExport === true) continue
      const modulePath = typeof md.module === "string" ? md.module : ""
      if (modulePath.length === 0) continue
      const target = String(rel.target ?? "")
      // The local names this edge binds: the edge spells `<module>:<item>` for external items, the
      // BARE item for a project-local one, and the whole-module binding spelling (<leaf>NUL<module>:*)
      // for `* as ns` / require / side-effect rows (where the local name, if any, is `metadata.alias`).
      const localNames: string[] = []
      const alias = typeof md.alias === "string" && md.alias.length > 0 && md.alias !== "*" ? md.alias : null
      if (md.localBinding === true) {
        if (alias) localNames.push(alias)
      } else {
        const spelled = target.includes("\u0000") ? target.slice(target.indexOf("\u0000") + 1) : target
        if (spelled.includes(":")) {
          const item = spelled.slice(spelled.lastIndexOf(":") + 1)
          if (item.length > 0 && item !== "*") localNames.push(alias ?? item)
        } else if (isPlainIdentifier(spelled)) {
          localNames.push(alias ?? spelled)
        }
      }
      md.importedBindings = localNames
      // Claimable specifier: NOT project-local. Node builtins are explicitly not project-local
      // (`isProjectLocalSpecifier` returns false for them); external package specifiers are not in
      // the project's package set; relative/absolute/workspace specifiers are.
      if (localNames.length > 0 && !this.isProjectLocalSpecifier(modulePath, this._projectPackages)) {
        for (const nm of localNames) {
          if (!this._importBindingSpecs.has(nm)) this._importBindingSpecs.set(nm, modulePath)
        }
      }
    }
  }

  /**
   * MARK THE EDGES WHOSE TARGET (or whose RECEIVER ROOT) IS A BINDING IMPORTED FROM AN EXTERNAL
   * MODULE with `metadata.importedBinding = { specifier, binding }`.
   *
   * These are exactly the rows the index-side external claims could not reach (an index pass can
   * only claim a binding it built from `module:item` spellings, so namespace imports, shadowed
   * packages and non-indexed runs stayed unresolved). The claim is NOT a resolution: it lands in the
   * gate's `bindOK` column, never in `resolved`, and the arbiter verifies it from this file's own
   * import evidence. Rows already claimed by `markExternalTargets`/the project-index pass are
   * skipped (their existing accounting must not shrink), and a target that names a PUBLISHED
   * declaration is skipped too: the name model may legitimately resolve that row, and a claim over
   * it would steal a resolution into the claim column.
   */
  private applyImportedBindingClaims(
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): number {
    // `symbols` is accepted for symmetry with the other passes and deliberately NOT consulted: the
    // imported-binding claim is read by the arbiter BEFORE every count-based branch (it is the sole
    // authority for its rows), so a same-named declaration elsewhere in the project is exactly the
    // name-model DECOY this claim exists to displace, not a reason to withhold it. A published
    // MEMBER name (`externalHelper.run()` where the file also declares `run()`) is the same case: the
    // claim states where the receiver comes from, and suppressing it would hand the row back to the
    // name model that binds `run` to the wrong class.
    void symbols
    if (this._importBindingSpecs.size === 0) return 0
    let claimed = 0
    for (const rel of relationships as any[]) {
      const label = String(rel?.type ?? "")
      if (label === "imports" || label === "contains") continue
      const md: Record<string, any> = (rel.metadata ??= {})
      if (carriesClaimMarker(md)) continue
      const target = String(rel.target ?? "")
      if (target.length === 0) continue
      const receiverRoot = (() => {
        const callee = typeof md.calleeExpression === "string" ? md.calleeExpression : ""
        const dot = callee.indexOf(".")
        return dot > 0 ? callee.slice(0, dot) : ""
      })()
      let binding: string | null = null
      if (isPlainIdentifier(target) && this._importBindingSpecs.has(target)) binding = target
      else if (receiverRoot.length > 0 && isPlainIdentifier(receiverRoot) && this._importBindingSpecs.has(receiverRoot)) binding = receiverRoot
      if (binding === null) continue
      const specifier = this._importBindingSpecs.get(binding)!
      md.importedBinding = { specifier, binding }
      // Flat scalar mirrors: fixtures can pin scalar metadata (`meta.importedBindingSpecifier`) but
      // cannot pin an object by reference; the object itself is what the arbiter reads.
      md.importedBindingSpecifier = specifier
      md.importedBindingName = binding
      claimed++
    }
    return claimed
  }

  /**
   * COLLECT THIS FILE'S LEXICAL BINDINGS — names bound by something nearer than a published symbol:
   * parameters (incl. destructured/rest/default), type parameters, local declarators, nested
   * function/class declarations inside a function body, catch bindings and loop bindings.
   *
   * Only names INSIDE a function-like body (or a type-parameter list) are collected: a module-scope
   * declaration is a published symbol and its edges may resolve normally. The kind map is carried so
   * a consumer can tell a parameter from a type parameter (`metadata.bindingKind`).
   */
  private collectLocalBindingNames(root: Node): Map<string, string> {
    const out = new Map<string, string>()
    const bindPattern = (pat: Node | null, kind: string) => {
      if (!pat) return
      const walkPat = (p: any) => {
        if (!p) return
        // TYPE PARAMETERS lex as `type_identifier` in this grammar (measured on `class Box<T>`: the
        // name child is `type_identifier`, not `identifier`); requiring only `identifier` left every
        // type-parameter edge bare, which is the same blind spot the receiver collector hit earlier.
        if (
          p.type === "identifier" || p.type === "type_identifier" ||
          p.type === "shorthand_property_identifier" || p.type === "shorthand_property_identifier_pattern"
        ) {
          if (!out.has(p.text)) out.set(p.text, kind)
          return
        }
        if (p.type === "pair_pattern") { walkPat(p.childForFieldName?.("value") ?? p.namedChild(1) ?? p.namedChild(0)); return }
        if (p.type === "object_assignment_pattern" || p.type === "assignment_pattern") { walkPat(p.childForFieldName?.("left") ?? p.namedChild(0)); return }
        if (p.type === "rest_pattern" || p.type === "spread_pattern" || p.type === "object_pattern" || p.type === "array_pattern") {
          for (let i = 0; i < p.namedChildCount; i++) walkPat(p.namedChild(i))
        }
      }
      walkPat(pat)
    }
    const walk = (n: Node, insideFunction: boolean) => {
      const t = n.type
      let next = insideFunction
      if (t === "type_parameter") {
        const nm = n.childForFieldName("name") ?? n.namedChild(0)
        if (nm && (nm.type === "type_identifier" || nm.type === "identifier")) bindPattern(nm, "type_parameter")
      } else if (t === "required_parameter" || t === "optional_parameter") {
        bindPattern(n.childForFieldName("pattern") ?? n.childForFieldName("name") ?? n.namedChild(0), "parameter")
      } else if (
        t === "function_declaration" || t === "generator_function_declaration" || t === "function_expression" ||
        t === "arrow_function" || t === "method_definition"
      ) {
        if (insideFunction) {
          const nm = n.childForFieldName("name") ?? n.namedChild(0)
          if (nm && (nm.type === "identifier" || nm.type === "property_identifier")) bindPattern(nm.type === "identifier" ? nm : null, "nested_declaration")
        }
        next = true
      } else if (t === "variable_declarator" && insideFunction) {
        bindPattern(n.childForFieldName("name") ?? n.namedChild(0), "local")
      } else if (t === "catch_clause") {
        const pat = n.childForFieldName("parameter") ?? n.namedChild(0)
        bindPattern(pat, "catch_binding")
      } else if (t === "for_in_statement" && insideFunction) {
        const left = n.childForFieldName("left") ?? n.namedChild(0)
        if (left && left.type === "identifier") bindPattern(left, "loop_binding")
        else if (left) {
          for (let i = 0; i < left.namedChildCount; i++) {
            const c = left.namedChild(i)
            if (c && c.type === "variable_declarator") bindPattern(c.childForFieldName("name") ?? c.namedChild(0), "loop_binding")
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child, next)
      }
    }
    walk(root, false)
    return out
  }

  /**
   * RE-SPELL THE EDGES THAT TARGET A LOCAL BINDING to the family binding spelling
   * `<callable>\u0000<binding>` and mark them `metadata.localBinding` (D7 local-binding seam).
   *
   * The family publishes no locals/parameters/lambda parameters as symbols, so a bare local name can
   * never name a declaration: the spelled target CANNOT be refuted by the key space, and the arbiter's
   * binding claim verifies it from its own spelling (`verifyBindingClaim`). This is a RE-SPELL of the
   * existing row (the row count does not move; the gate's dedupe key stays one row per edge).
   *
   * Refusals, each measured or contractual: a name the file PUBLISHES is a real symbol (skipped — its
   * edge may resolve); a name bound by an IMPORT is the imported-binding class, not a local one
   * (skipped); a row already carrying a claim/owner marker is left untouched (another author's claim
   * outranks this one); the target must be a plain identifier (a member or qualified spelling is not
   * a local binding).
   */
  private applyLocalBindingSpellings(
    root: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): number {
    const localBindings = this.collectLocalBindingNames(root)
    if (localBindings.size === 0) return 0
    const published = new Set<string>()
    for (const sym of symbols) {
      if (sym?.name) published.add(String(sym.name))
      // ★ NO REGEX (owner's DONE criterion, 2026-10-23). `.split(/[:.]/)` splits on EACH ':' or '.'
      // and keeps empty segments; `filter(Boolean)` then drops them and `.pop()` takes the last.
      // The scan reproduces that order exactly rather than splitting on the first separator only.
      const leaf = (() => {
        const qn = String((sym as { qualifiedName?: string })?.qualifiedName ?? "")
        const parts: string[] = []
        let cur = ""
        for (const ch of qn) {
          if (ch === ":" || ch === ".") { parts.push(cur); cur = "" } else cur += ch
        }
        parts.push(cur)
        const kept = parts.filter(Boolean)
        return kept.length > 0 ? kept[kept.length - 1] : undefined
      })()
      if (leaf) published.add(leaf)
    }
    const labels = new Set(["calls", "uses", "references", "instantiates", "extends", "implements", "decorates"])
    let spelled = 0
    for (const rel of relationships as any[]) {
      const label = String(rel?.type ?? "")
      if (!labels.has(label)) continue
      const md: Record<string, any> = (rel.metadata ??= {})
      if (carriesClaimMarker(md)) continue
      const target = String(rel.target ?? "")
      if (!isPlainIdentifier(target)) continue
      const kind = localBindings.get(target)
      if (kind === undefined) continue
      if (published.has(target) || this._importBindingSpecs.has(target)) continue
      const source = String(rel.source ?? "")
      if (source.length === 0 || !isPlainIdentifier(source)) continue
      rel.target = `${source}${BINDING_SEP}${target}`
      md.localBinding = true
      md.bindingKind = kind
      spelled++
    }
    return spelled
  }

  /**
   * MARK WHAT THIS FILE PROVABLY CANNOT DECLARE — the lane's missing marking subsystem,
   * bounded to the four proofs that need nothing but the file.
   *
   * ## Why this file, and why now
   *
   * `validation/m14/verification/REAL-TYPESCRIPT-NO-MARKING-SUBSYSTEM-AND-THE-SCOPE-SPLIT.md`
   * records the state this method begins to fix, in this lane's own words: *"Every edge to a
   * dependency member, a Node builtin or a runtime global reads as an UNRESOLVED BINDING
   * instead of being MARKED — the shape the fleet gate calls out."* The edges ARE emitted; the
   * MARK is what is absent, and `script/m14/incoming-gate.ts` reads the mark through
   * `EXTERNAL_KEYS` (`isExternalTarget` among them). So this is the ADDITIVE half of that
   * port: no target, no source, no line and no edge is changed — a `metadata` claim is added
   * to edges whose callee this file can prove it does not bind.
   *
   * ## The five proofs, and the evidence for each
   *
   *   bare callee, test-runner global   `describe(...)`, `expect(...)` — a BARE identifier the
   *                                     file neither declares nor imports, in the pinned table.
   *   bare callee, framework package    `describe(...)` under `import { describe } from
   *                                     "@jest/globals"` — the file DOES bind it, and its own
   *                                     import SPECIFIER says the declaration is in node_modules.
   *                                     (Any export of a pinned package, not only tabled names.)
   *   bare callee, runtime global       `setTimeout(...)`, `Symbol(...)` — same test, pinned
   *                                     language/host table.
   *   member of a runtime global        `Object.keys(...)`, `JSON.stringify(...)` — the
   *                                     receiver text is an identifier in the pinned table and
   *                                     the file does not bind it.
   *   member of a framework call        `expect(x).toEqual(y)` — the receiver is a CALL whose
   *                                     head is a test-runner global or a pinned framework
   *                                     binding, so the receiver's type is the framework's.
   *   type-position lib name            `Date`, `Promise`, `Record` in a type position — the
   *                                     name is in the pinned lib table and unbound here.
   *
   * ## THE TRAP THIS AVOIDS, MEASURED
   *
   * The tempting spelling is the QUALIFIED one (`Object.keys` instead of `keys`), because it
   * "publishes the qualifier". MEASURED on this lane's own 400-file population
   * (`validation/m14/fixtures/typescript/tools/unresolved-census.mts --sim`, the gate's own
   * `classifyEdge` as the judge): retargeting the 263 `receiver.member` edges produced **18
   * refuted claims and 14 claims no check can reach**, where keeping the leaf produced **0 of
   * either** — because `verifyExternalClaim` looks a DOTTED target up by its OWNER (`path`),
   * which a project may well publish, while a DOTLESS target is looked up as itself and only
   * on the branch where the project publishes nothing of that name. So this method NEVER
   * rewrites a target, and it refuses any non-identifier target — the guard is what makes a
   * refutation unreachable rather than merely unobserved.
   *
   * ## What this is NOT
   *
   * It is not a resolution: an edge marked here is NOT counted resolved, by this analyzer or
   * by the arbiter — it moves from "no answer" to "a stated, refutable reason", and the
   * arbiter checks the reason against the project's own key space. It also does not touch
   * production: NO resolver reads `isExternalTarget` (`parallel-indexer.ts` and `engine.ts`
   * carry zero occurrences), so a marker can never suppress a binding in the store.
   *
   * The negative control is structural and worth stating: a name this file DECLARES is never
   * marked, whatever table it is in (`class Map {}`), and an import from a package that is NOT
   * a pinned test framework is never marked either (`import { expect } from "chai-adjacent"`,
   * a workspace package, the project's own `./helpers`).
   */
  private markExternalTargets(
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): number {
    // WHAT THIS FILE BINDS. Three sets, because they answer three different questions:
    //   declaredHere  the file DECLARES the name (symbols) — never mark, whatever an import says;
    //   bound         the file binds the name at all (declarations + import locals) — a binding
    //                 with an UNKNOWN origin is not evidence the name is external;
    //   frameworkBound a binding whose own import SPECIFIER names a pinned test-framework
    //                 package — the file itself says where that declaration lives (node_modules).
    // The lane's own `imports` edges are the evidence, exactly as the java twin's
    // `markExternalTargets` reads its own import list rather than guessing.
    const declaredHere = new Set<string>()
    const bound = new Set<string>()
    const frameworkBound = new Map<string, string>()
    for (const s of symbols) {
      const n = String(s?.name ?? "")
      if (n.length > 0) { declaredHere.add(n); bound.add(n) }
      const q = String((s as { qualifiedName?: string })?.qualifiedName ?? "")
      if (q.length > 0) { declaredHere.add(q); bound.add(q) }
    }
    for (const r of relationships) {
      if (String(r?.type ?? "") !== "imports") continue
      const tgt = String(r?.target ?? "")
      const md = r?.metadata as { module?: unknown; alias?: unknown } | undefined
      const module = String(md?.module ?? "")
      if (module.length === 0) continue
      const local = String(md?.alias ?? (tgt.includes(":") ? tgt.slice(tgt.lastIndexOf(":") + 1) : tgt))
      if (local.length > 0 && local !== "*") {
        bound.add(local)
        if (isTestFrameworkModule(module)) frameworkBound.set(local, module)
      }
    }

    let marked = 0
    for (const r of relationships) {
      const target = String(r?.target ?? "")
      if (target.length === 0) continue
      // DOTLESS IDENTIFIERS ONLY — see the docstring's TRAP section. A target with a dot is
      // looked up by its owner, and a claim on it can be refuted; a file (`foo.ts`) or a
      // fragment (`a b`) is refused by the verifier as unreachable. Neither can be earned here.
      if (!isPlainIdentifier(target)) continue
      // A NAME THIS FILE DECLARES is never external — the framework origin cannot outrank the
      // file's own declaration. Otherwise a binding blocks the claim UNLESS its import names a
      // pinned test-framework package, which is the new, stronger proof (see the table).
      if (declaredHere.has(target)) continue
      if (bound.has(target) && !frameworkBound.has(target)) continue
      const fromFramework = frameworkBound.has(target)
      const md = (r.metadata ?? (r.metadata = {})) as Record<string, unknown>
      if (md.isExternalTarget === true) continue
      const t = String(r.type ?? "")
      const callee = String(md.calleeExpression ?? "")
      let reason: string | null = null
      let receiver: string | null = null
      if (t === "calls" || t === "uses" || t === "instantiates") {
        if (callee.length === 0) {
          // No callee text: nothing here can tell the receiver from a local. Refuse.
        } else if (callee === target) {
          if (TS_TEST_RUNNER_GLOBALS.has(target)) reason = "test-runner-global"
          // ANY export of a pinned test package is framework-provided: the specifier is the
          // evidence, not the spelling of the name (`defineConfig` from `vitest/config`).
          else if (fromFramework) reason = "test-runner-global"
          else if (TS_RUNTIME_GLOBALS.has(target)) reason = "runtime-global"
        } else if (callee.endsWith(`.${target}`)) {
          const recv = callee.slice(0, callee.length - target.length - 1)
          if (isPlainIdentifier(recv) && fromFramework) {
            // `jest.fn()`, `vi.fn()`, `sinon.stub()` — a namespace import of a test package.
            reason = "test-runner-global"
            receiver = recv
          } else if (isPlainIdentifier(recv) && !bound.has(recv)) {
            if (TS_RUNTIME_GLOBALS.has(recv)) { reason = "builtin-lib-type"; receiver = recv }
          } else {
            // THE RECEIVER IS A CALL: `expect(trace).toEqual`. Only the receiver's HEAD is
            // consulted, and only against the framework tables — a project function's result
            // (`buildThing().assert`) refuses, because `buildThing` is in neither.
            const head = callHeadName(recv)
            if (head !== null) {
              if (frameworkBound.has(head)) {
                reason = "test-runner-global"
                receiver = head
              } else if (!bound.has(head) && TS_TEST_RUNNER_GLOBALS.has(head)) {
                reason = "test-runner-global"
                receiver = head
              }
            }
          }
        }
      } else if (t === "references" || t === "extends" || t === "implements") {
        // A TYPE POSITION: the name is a lib type the compiler ships. `Record`, `Date` and
        // `Promise` are lib types AND plausible project names, which is why the `bound` test
        // above is what decides, and why the arbiter still resolves the edge if the PROJECT
        // declares the name — a marker that the project's own key space can answer is inert.
        // BOTH TABLES: the utility types are `lib.es5.d.ts`'s generics and the runtime table is
        // its value half — `Date`, `Promise`, `Array` arrive in type positions from the same
        // standard library, and one proof covers the two spellings of one origin.
        if (TS_LIB_TYPE_NAMES.has(target) || TS_RUNTIME_GLOBALS.has(target)) reason = "builtin-lib-type"
      }
      if (reason === null) continue
      md.isExternalTarget = true
      md.externalReason = reason
      if (receiver !== null) md.externalReceiver = receiver
      marked++
    }
    return marked
  }


  private extractIndexSignature(node: Node, symbols: ASTEngine.UniversalSymbol[]): void {
    // [key: string]: T
    const ownerInfo = this.scopeManager.getOwnerInfo()

    // Extract the index parameter and value type
    let indexParam = ""
    let valueType = ""

    // Real grammar shape (tree-sitter-typescript): index_signature >
    //   identifier (key name) + type_annotation (value type).
    // The old branches referenced nonexistent node types
    // (index_signature_parameter/formal_parameter), so indexParam stayed
    // empty and valueType captured the KEY name instead of the value type.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "identifier") {
        indexParam = child.text
      } else if (child.type === "type_annotation") {
        valueType = stripLeadingColon(child.text)
      }
    }

    const symbol: ASTEngine.UniversalSymbol = {
      name: `[${indexParam}]`,
      kind: ASTEngine.SymbolKind.Property,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      returnType: valueType || "unknown",
      ...ownerInfo,
      metadata: {
        isIndexSignature: true,
        indexParameter: indexParam,
        // The name `[key]` is INVENTED — the source writes `[key: string]`, and
        // `[key]` is not a member any caller can pass, which is why the Vue lane
        // suppresses the same shape on its own inline-type-literal path (VSD34).
        // Declaring it with the m60 surface audit's general mechanism keeps it out
        // of the "name not present in source" channel without an allowlist that
        // would have to enumerate every parameter name. Found via the Vue lane's
        // own audit, where it was the last of 125 findings.
        synthesized: true,
      },
    }

    symbols.push(symbol)
  }

  // W1 (JD18-class): object-literal shorthand methods are members of the
  // object's owning variable. Owner resolution: walk up from the
  // method_definition to the enclosing variable_declarator (const util = {
  // run() {...} } -> owner util). Nested objects inherit the same owner
  // (the outermost binding names the value). The resolver's method_definition
  // branch then attributes calls to the method symbol itself (matching the
  // JS contract: run -> helper, never util -> helper).
  private extractObjectLiteralMethod(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text

    // R7: a get/set pair is ONE property in TypeScript's type system, and the
    // CLASS path already rules that way — its body pre-pass keeps the last
    // declaration of each name. The object-literal path had no such pass, so
    // `{ get size(){}, set size(v){} }` produced TWO `size` symbols sharing one
    // owner, and therefore TWO identical `contains owner -> size` rows: a
    // duplicate symbol, a duplicate edge, and an ambiguous name for every
    // consumer that resolves a member by name. Measured: 1 duplicate row per
    // accessor pair, in both the TypeScript and JavaScript lanes.
    //
    // Keeping the LAST accessor mirrors the class rule exactly. Returning false
    // also leaves the walker to descend into the skipped accessor's body, so its
    // calls are still recorded — against the OWNER, which is what the class path
    // does today (a getter body calling `compute()` yields `calls C -> compute`),
    // so this loses no edge that the class path keeps.
    if (accessorKindOf(node) !== undefined) {
      const parent = node.parent
      if (parent) {
        for (let i = 0; i < parent.namedChildCount; i++) {
          const sib = parent.namedChild(i)
          if (!sib || sib.startIndex <= node.startIndex) continue
          if (accessorKindOf(sib) !== undefined && sib.childForFieldName("name")?.text === name) return false
        }
      }
    }
    // R1: the ownership rule is the twin's, ported verbatim
    // (`containerOwnerName`), so an object-literal member, a class-expression
    // member and a class-declaration member are resolved by ONE contract
    // instead of two hand-rolled walks that disagreed.
    const ownerName = containerOwnerName(node)
    // R10: an UNBOUND literal has no owner, and its members must not borrow the
    // enclosing one. This used to fall back to `getOwnerInfo()`, which is
    // invisible at module level (no scope to inherit) and wrong everywhere
    // else: `class K { go() { return { m(){} } } }` emitted `contains K->m`,
    // telling the graph that class K has a member `m` when `m` belongs to a
    // temporary object one of its methods returns. Measured across both twins
    // (typescript and javascript agree on the false edge, so this is a shared
    // defect, not a divergence) and in every enclosing-scope shape: a method
    // body, a static method, a nested callback, a namespace function.
    //
    // The bound case was always right and is untouched: `const o = { m(){} }`
    // inside a method gives `ownerName === "o"`, and `class K { go() { const o
    // = { m(){} } } }` already emitted no `K->m`. So the fallback was never
    // load-bearing for a literal that HAS a name; it only ever fired for the
    // nameless ones, which is exactly where it invented an owner.
    const ownerInfo = ownerName
      ? { ownerName, ownerKind: ASTEngine.SymbolKind.Constant as unknown as ASTEngine.SymbolKind }
      : undefined
    // Reuse extractMethod for full parity (params, complexity, qualified_calls,
    // taint payloads) with the owner info swapped in afterwards.
    const before = symbols.length
    const ok = this.extractMethod(node, symbols, stack)
    if (ok) {
      for (let i = before; i < symbols.length; i++) {
        const s = symbols[i]
        if (ownerInfo) {
          s.ownerName = ownerInfo.ownerName
          s.ownerKind = ownerInfo.ownerKind
          s.scope = ownerInfo.ownerName
        } else {
          // extractMethod seeds owner/scope from the enclosing scope; clear them
          // so a nameless literal's member is ownerless, which is what the
          // module-level case already produced.
          s.ownerName = undefined
          s.ownerKind = undefined
          s.scope = undefined
        }
      }
      // extractMethod pushed a Method scope named after the METHOD — for
      // object-literal members the body must descend with the method scope
      // (same as class methods), which extractMethod already arranged via
      // its own pushScope. Nothing further here.
    }
    return ok
  }

  private extractStaticBlock(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const ownerInfo = this.scopeManager.getOwnerInfo()

    const symbol: ASTEngine.UniversalSymbol = {
      name: "static {}",
      kind: ASTEngine.SymbolKind.Method,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      isStatic: true,
      ...ownerInfo,
      metadata: {
        isStaticBlock: true,
      },
    }

    symbols.push(symbol)

    // Process static block body
    this.scopeManager.pushScope(ScopeKind.Block, "static", node)
    stack.push({ action: () => this.scopeManager.popScope() })
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push({ node: child })
    }
    return true
  }

  private extractNamespace(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) {
      // NAMELESS ambient wrappers (`declare global { ... }`) have no name
      // FIELD at all — bailing here combined with the container no-descent
      // list silently dropped the ENTIRE subtree (jsx.d.ts extracted 0
      // symbols: every global-augmentation interface vanished). Descend
      // into the body so nested declarations are extracted.
      const body = node.childForFieldName("body")
      if (body) {
        stack.push({ node: body })
      } else {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const c = node.namedChild(i)
          if (c) stack.push({ node: c })
        }
      }
      return true
    }
    // String-named modules (`declare module "foo"`) keep their quotes in the
    // AST; strip them so qualified names stay clean.
    const rawName = nameNode.text
    const name = rawName.startsWith('"') || rawName.startsWith("'") ? rawName.slice(1, -1) : rawName
    const exportStatus = isNodeExported(node)
    const modifiers = extractModifiersFromNode(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Namespace,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      comments: this.extractComments(node),
      ...this.scopeManager.getOwnerInfo(),
      metadata: {
        isExported: exportStatus.isExported,
        isDeclare: modifiers.isDeclare,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Process namespace body
    this.scopeManager.pushScope(ScopeKind.Namespace, name, node)
    stack.push({ action: () => this.scopeManager.popScope() })
    const body = node.childForFieldName("body")
    if (body) stack.push({ node: body })
    return true
  }

  // ========================================================================
  // IMPORT/EXPORT EXTRACTION
  // ========================================================================

  /**
   * The file's imports, plus the three per-FILE facts the payload rules need —
   * in ONE walk (R2c).
   *
   * The signals used to come from a separate full traversal that had to run
   * before symbol extraction, because the taint sink rule asks whether the file
   * imports child_process while it is still building a symbol's payload. Since
   * the import walk needs no symbols, running it FIRST removes the second
   * traversal outright rather than deferring the question: every consumer below
   * reads the signals after this returns, and the `imports` array is unchanged
   * in content and order.
   */
  /** The three per-file facts, keyed on an import's module path. */
  private recordFileSignal(modulePath: string): void {
    if (
      modulePath === "react" || modulePath === "react-dom" || modulePath === "preact" ||
      modulePath === "preact/compat" || modulePath.startsWith("react/") || modulePath.startsWith("preact/")
    ) {
      this._fileSignals.hasReact = true
    }
    if (modulePath === "solid-js" || modulePath.startsWith("solid-js/") || modulePath.startsWith("@solidjs/")) {
      this._fileSignals.solidJs = true
    }
    if (modulePath === "child_process" || modulePath === "node:child_process") {
      this._fileSignals.importsChildProcess = true
    }
  }

  private scanImportsAndFileSignals(node: Node, imports: ASTEngine.ImportInfo[]): void {
        // `require("child_process")` and `await import("child_process")` are the
        // CommonJS and dynamic-import spellings of the same fact, and both hide it
        // in a CALL's argument: there is no import_statement and no
        // import_require_clause, so neither the imports walk nor the signal scan
        // that preceded it could see them. The consequence was a false NEGATIVE in
        // the taint sink rule — `const { execSync } = require("child_process")`
        // followed by a bare `execSync` produced no sink, because the rule's
        // evidence that a bare exec is Node's own never arrived. The callee must be
        // the bare `require` identifier or the `import` keyword; `foo.require(...)`
        // is somebody else's method and is deliberately excluded.
        if (node.type === "call_expression") {
          const callee = node.childForFieldName("function")
          if (callee && (callee.type === "import" || (callee.type === "identifier" && callee.text === "require"))) {
            const firstArg = node.childForFieldName("arguments")?.namedChild(0)
            if (firstArg && firstArg.type === "string") {
              this.recordFileSignal(stringContent(firstArg))
            }
          }
        }

    // JSX presence is the React signal the Rules-of-Hooks gate needs.
    if (node.type === "jsx_element" || node.type === "jsx_self_closing_element") {
      this._fileSignals.hasReact = true
    } else if (node.type === "import_require_clause") {
      // `import cp = require("child_process")` — here the node IS the module
      // string, which is why the old standalone scan read it separately.
      this.recordFileSignal(stringContent(node))
    }
    if (node.type === "import_statement") {
      const sourceNode = importStatementSource(node)
      if (!sourceNode) return

      const modulePath = stringContent(sourceNode)
      // `import m = require("./m")` IS a require: same edge shape, same default
      // rule, so it is recorded as one rather than as an ES import with no items.
      if (isImportRequireClause(node)) {
        const clauseNode = node.namedChildren.find((c: any) => c && c.type === "import_require_clause")
        const bindNode = clauseNode?.namedChildren?.find((c: any) => c && c.type === "identifier")
        imports.push({
          module: modulePath,
          items: ["*"],
          isDefault: !!bindNode,
          range: this.nodeRange(node),
          metadata: { type: "require" },
        })
        return
      }
      const items = extractImportItems(node)
      const clause = extractImportClause(node)
      this.recordFileSignal(modulePath)

      // Resolve actual module path
      const resolvedPath = this.moduleResolver?.resolveModulePath(modulePath, this.currentFile) || modulePath

      imports.push({
        module: modulePath,
        items,
        isDefault: !!clause.defaultImport,
        alias: clause.namespaceImport,
        range: this.nodeRange(node),
        metadata: {
          resolvedPath,
        },
      })
    }

    // Dynamic `import()` and CommonJS `require()` are BOTH module dependencies,
    // and the javascript twin records both. typescript recorded only the dynamic
    // form, so every `require` dependency in a TypeScript file was missing from
    // the module graph — silent, because nothing reported it: the file's imports
    // were simply short. Measured on the tracked corpus this is the second-largest
    // edge class, and `require` is how build shims, `.d.ts`-adjacent code and
    // older Node packages actually pull a dependency in. This repository's own
    // shims do it (`require("child_process")`, `require("bun:sqlite")`).
    if (node.type === "call_expression") {
      const callee = node.childForFieldName("function")
      const isImportCall = !!callee && (callee.type === "import" || (callee.type === "identifier" && callee.text === "import"))
      const isRequireCall = !!callee && callee.type === "identifier" && callee.text === "require"
      if (isImportCall || isRequireCall) {
        const args = node.childForFieldName("arguments")
        if (args && args.namedChildCount > 0) {
          const pathArg = args.namedChild(0)
          // `literalModulePath`, for the reason in the helper: a template
          // specifier with a substitution is COMPUTED, and the literal prefix
          // `stringContent` would return is not a module. The relationship pass
          // below reads the same helper, so the `imports` array and the
          // `imports` edges cannot disagree about whether a specifier is one.
          const modulePath = pathArg ? literalModulePath(pathArg) : undefined
          if (modulePath) {
            imports.push({
              module: modulePath,
              items: ["*"],
              isDefault: isRequireCall ? requireBindsDefault(node) : false,
              range: this.nodeRange(node),
              ...(isRequireCall ? { metadata: { type: "require" } } : {}),
            })
          }
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        this.scanImportsAndFileSignals(child, imports)
      }
    }
  }

  private extractExports(node: Node, exports: ASTEngine.ExportInfo[], symbols: ASTEngine.UniversalSymbol[]): void {
    if (node.type === "export_statement") {
      // Check for default export
      const isDefault = this.hasToken(node, "default")
      let foundNamed: boolean = false
      // Names exported by THIS statement (used for re-export dependency
      // records — see the sourceNode block below).
      const namesFromThisStatement: string[] = []
      // THE NAMESPACE-EXPORT LOCAL BINDING — `export * as ns from "./ns"`.
      //
      // THE NAME ASKED FOR IS `*` (the WHOLE MODULE) and the LOCAL BINDING `ns` rides `alias`,
      // which is the field `brain_import.imported_as` is read for. Recording `items: ["ns"]`
      // instead asks "./ns" for a name "./ns" does not export — it is a question with no answer,
      // and the import table is the table the module graph is built from. (The re-export's EXPORT
      // name is still `ns` — that is a different question, and it is answered by the exports
      // edge, which is unaffected.)
      let namespaceAlias: string | undefined

      // Check for re-exports (export { x } from "y")
      const sourceNode = node.childForFieldName("source")

      // Find exported names
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child) continue

        if (child.type === "export_clause") {
          // Named exports: export { a, b as c }
          for (let j = 0; j < child.namedChildCount; j++) {
            const specifier = child.namedChild(j)
            if (specifier && specifier.type === "export_specifier") {              const name = specifier.childForFieldName("name")
              const alias = specifier.childForFieldName("alias")

              if (name) {
                foundNamed = true
                const exportName = alias?.text || name.text
                namesFromThisStatement.push(exportName)
                exports.push({
                  name: exportName,
                  isDefault: false,
                  range: this.nodeRange(specifier),
                })
              }
            }
          }
        } else if (child.type === "namespace_export") {
          // `export * as ns from "./m"` — the re-exported name is the
          // namespace alias. (The '*' token is INSIDE namespace_export, so
          // a bare hasToken('*') check on the statement misses this shape.)
          const nameNode = child.namedChild(child.namedChildCount - 1)
          if (nameNode) {
            foundNamed = true
            namespaceAlias = nameNode.text
            namesFromThisStatement.push(nameNode.text)
            exports.push({
              name: nameNode.text,
              isDefault: false,
              range: this.nodeRange(child),
            })
          }
        } else if (
          child.type === "function_declaration" ||
          child.type === "function_signature" ||
          child.type === "generator_function_declaration" ||
          child.type === "class_declaration" ||
          child.type === "abstract_class_declaration" ||
          child.type === "interface_declaration" ||
          child.type === "type_alias_declaration" ||
          child.type === "enum_declaration" ||
          child.type === "internal_module" ||
          child.type === "module"
        ) {
          // THE EXPORTED DECLARATION FORMS THE FIRST EMITTER MISSED, each measured on the grammar:
          //   `export namespace container {}`   -> internal_module (the namespace NAME is exported)
          //   `export abstract class A {}`      -> abstract_class_declaration
          //   `export function f(): T;`         -> function_signature (the ambient/signature form)
          // A `declare module "x"` child carries a STRING name — that names no exported symbol.
          const nameNode = child.childForFieldName("name") ?? child.namedChild(0)
          if (nameNode && nameNode.type !== "string") {
            foundNamed = true
            exports.push({
              name: nameNode.text,
              isDefault,
              type: declarationKindName(child.type),
              range: this.nodeRange(child),
            })
          }
        } else if (child.type === "ambient_declaration") {
          // `export declare function f(): void` / `export declare const x: number` — the exported
          // name is inside the ambient wrapper, one level down. A wrapper around a STRING-named
          // `module "x"` names no symbol, which is why the string test below is on the inner node.
          const inner = child.namedChild(0)
          if (inner) {
            if (inner.type === "function_signature" || inner.type === "function_declaration" || inner.type === "class_declaration" || inner.type === "abstract_class_declaration" || inner.type === "interface_declaration" || inner.type === "enum_declaration" || inner.type === "type_alias_declaration") {
              const nameNode = inner.childForFieldName("name") ?? inner.namedChild(0)
              if (nameNode && nameNode.type !== "string") {
                foundNamed = true
                exports.push({ name: nameNode.text, isDefault, type: declarationKindName(inner.type), range: this.nodeRange(inner) })
              }
            } else if (inner.type === "lexical_declaration" || inner.type === "variable_declaration") {
              for (let j = 0; j < inner.namedChildCount; j++) {
                const declarator = inner.namedChild(j)
                if (!declarator || declarator.type !== "variable_declarator") continue
                const nameNode = declarator.childForFieldName("name") ?? declarator.namedChild(0)
                if (nameNode && nameNode.type === "identifier") {
                  foundNamed = true
                  exports.push({ name: nameNode.text, isDefault, type: "variable", range: this.nodeRange(declarator) })
                }
              }
            }
          }
        } else if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
          // export const x = ...
          for (let j = 0; j < child.namedChildCount; j++) {
            const declarator = child.namedChild(j)
            if (declarator && declarator.type === "variable_declarator") {
              const nameNode = declarator.childForFieldName("name")
              if (nameNode && nameNode.type === "identifier") {
                foundNamed = true
                exports.push({
                  name: nameNode.text,
                  isDefault,
                  type: "variable",
                  range: this.nodeRange(declarator),
                })
              }
            }
          }
        } else if (child.type === "identifier" && isDefault) {
          // export default identifier
          foundNamed = true
          exports.push({
            name: child.text,
            isDefault: true,
            range: this.nodeRange(child),
          })
        }
      }

      if (isDefault && !foundNamed) {
        exports.push({
          name: "default",
          isDefault: true,
          type: "default_export_expression",
          range: this.nodeRange(node),
        })
      }

      // Re-exports record a module dependency: `export { X } from "./mod"`
      // The analyzer surface includes this in `imports` via a synthetic
      // ImportInfo with `reExport: true`. Names are collected from THIS
      // statement's children during the pass above — an earlier version
      // re-scanned the global exports array by line-range overlap, which
      // fabricated cross-module items when two export statements shared a
      // line (minified/bundled code): `export { alpha } from "./m1";
      // export { beta } from "./m2"` claimed alpha came from m2.
      if (sourceNode) {
        const modulePath = stringContent(sourceNode)
        const reExportedNames = namesFromThisStatement.slice()
        // Star ONLY when the statement actually has one. An EMPTY clause
        // (`export {} from "./m"` — exports nothing) previously misfired
        // as a star re-export because !foundNamed was the only signal.
        if (reExportedNames.length === 0 && this.hasToken(node, "*")) {
          reExportedNames.push("*")
        }
        if (reExportedNames.length > 0) {
          // A NAMESPACE EXPORT asks the module for the MODULE, so the name ASKED FOR is `*` and
          // the local binding rides `alias` — see `namespaceAlias` above. The other re-export
          // shapes ask for the NAMES they list, and are unaffected.
          const askedFor = namespaceAlias !== undefined ? ["*"] : reExportedNames
          this._pendingReExportImports.push({
            module: modulePath,
            items: askedFor,
            ...(namespaceAlias !== undefined ? { alias: namespaceAlias } : {}),
            isDefault: false,
            range: this.nodeRange(node),
            metadata: { reExport: true },
          })
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        this.extractExports(child, exports, symbols)
      }
    }
  }

  // ========================================================================
  // RELATIONSHIP EXTRACTION - All 10 relationship types
  // ========================================================================

  private extractRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
  ): void {
    // 1. Extract inheritance (extends) relationships from classes
    this.extractInheritanceRelationships(symbols, relationships)

    // 2. Extract implementation relationships
    this.extractImplementsRelationships(symbols, relationships)

    // 3. Extract call relationships (and, in the same walk, instantiations)
    this.extractCallRelationships(node, relationships, symbols)

    // 4. Extract usage/reference relationships
    this.extractUsageRelationships(node, relationships, symbols)

    // 6. Extract decorator relationships
    this.extractDecoratorRelationships(symbols, relationships)

    // 7. Extract override relationships
    this.extractOverrideRelationships(symbols, relationships)

    // 8. Extract import relationships
    this.extractImportRelationships(node, relationships, symbols)

    // 9. Extract export relationships
    this.extractExportRelationships(exports, relationships, symbols)
  }

  /**
   * M59 (#825): the `line_number` field for a relationship, taken from the node
   * that CARRIES THE NAME the edge is about.
   *
   * typescript and javascript start where java did: **0 lines on every
   * relationship** — measured by the M59 oracle at 40 files/language before this
   * round: typescript 0 of 444, javascript 0 of 5,818, vue 0 of 3,940, svelte 0 of
   * 526, and the oracle could not even run its mutation self-test because no
   * line-bearing relationship existed. The contract is inherited from scala's
   * corrected reference, not re-invented, and it is one sentence: **the line
   * belongs to the name, never to the construct that contains it.** A
   * `call_expression` starts at its RECEIVER (scala mechanism 1), a type
   * expression's start is not the line of the types inside it (mechanism 2), and
   * a definition node can start at its decorators. So callers pass the NAME node,
   * and this returns nothing at all when there is none — never `0`, because
   * #820/#821 made `0` mean "unknown" to every reader and unknown must be absent.
   *
   * `fallback` exists only for sites whose construct has no name-bearing child.
   */
  private lineField(nameNode: Node | null | undefined, fallback?: Node | null): { line_number?: number } {
    const n = nameNode ?? fallback
    return n ? { line_number: n.startPosition.row + 1 } : {}
  }

  private extractInheritanceRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.kind === ASTEngine.SymbolKind.Class || symbol.kind === ASTEngine.SymbolKind.Interface) {
        const extendsTypes = symbol.metadata?.extends as string[] | undefined
        // M59 (#825): the base NAME's line, parallel to the name list (absent
        // when the heritage collector could not locate a node for it — unknown
        // must be absent, never `0`).
        const extendsLines = symbol.metadata?.extendsLines as number[] | undefined
        if (extendsTypes) {
          for (let i = 0; i < extendsTypes.length; i++) {
            const baseType = extendsTypes[i]
            // A MISSING type (error recovery, `interface I extends {}`) has text "" — an includes a
            // target that names nothing, so it is not published. The parallel line list keeps its
            // index only for entries that are published, so a skipped name never borrows a line.
            if (baseType === undefined || baseType.trim().length === 0) continue
            relationships.push({
              source: symbol.name,
              target: baseType,
              type: ASTEngine.RelationshipType.Extends,
              confidence: 1.0,
              ...(extendsLines?.[i] ? { line_number: extendsLines[i] } : {}),
              metadata: {
                sourceKind: symbol.kind,
              },
            })
          }
        }
      }
    }
  }

  private extractImplementsRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.kind === ASTEngine.SymbolKind.Class) {
        const implementsTypes = symbol.metadata?.implements as string[] | undefined
        // M59 (#825 discipline): the interface NAME's line, parallel to the name
        // list and absent when the collector could not locate a node for it —
        // unknown is absent, never `0`.
        const implementsLines = symbol.metadata?.implementsLines as number[] | undefined
        if (implementsTypes) {
          for (let i = 0; i < implementsTypes.length; i++) {
            const iface = implementsTypes[i]
            if (iface === undefined || iface.trim().length === 0) continue
            relationships.push({
              source: symbol.name,
              target: iface,
              type: ASTEngine.RelationshipType.Implements,
              confidence: 1.0,
              ...(implementsLines?.[i] ? { line_number: implementsLines[i] } : {}),
              metadata: {},
            })
          }
        }
      }
    }
  }

  /**
   * M59 (#861): is this node written in DECORATOR position?
   *
   * A decorator is METADATA on the symbol it decorates, not a call or a
   * reference made by whoever lexically encloses it. The family already rules
   * this way: the JVM analyzers attach annotations as `decorators` metadata and
   * emit no call/reference from them, and the python oracle documents the same
   * rule (PYD1 — "the analyzer treats decorators as metadata on the decorated
   * symbol, not runtime call edges", with its oracle skipping the positions to
   * match). typescript was the exception: because a decorator is syntactically
   * a call expression inside the class body, `@inject("db")` produced
   * `calls Service -> inject` AND `references Service -> inject` from the CLASS
   * — so a class appeared to call a decorator it never mentions in its body —
   * alongside the correct `references pool -> inject` that
   * extractDecoratorRelationships emits from the decorated member.
   *
   * The walk stops at the enclosing statement/declaration boundary rather than
   * walking to the root: a decorator on a METHOD cannot make the method's own
   * body a decorator position (its decorators are siblings of
   * method_definition, never ancestors of the body).
   */
  /**
   * Whether the file being analyzed contains any `decorator` node. Set once per
   * `analyze`; see the short-circuit in `inDecoratorPosition` for the measurement.
   */
  private hasAnyDecoratorNode = false

  /**
   * Is `node` a DECORATOR boundary? Used as the terminating condition of
   * `inDecoratorPosition`.
   *
   * PERF: this used to climb `.parent` from every node, and web-tree-sitter
   * implements `.parent` with a WASM DESCENDANT SEARCH (`ts_node_child_with_descendant`),
   * so the climb was O(depth) expensive calls per node and O(n x depth) per
   * traversal — measured at 5.2% of total wall clock on the vue lane's profile,
   * because a Vue SFC's TypeScript blocks go through this exact walk. The flag is
   * now THREADED down the recursion instead of recomputed: a decorator child sets
   * it true, any boundary sets it false, otherwise it is inherited. Same answer
   * (the decorator on a METHOD is a sibling of `method_definition`, never an
   * ancestor of the body), one boolean per node instead of a walk per node.
   */
  private isDecoratorBoundary(nodeType: string): boolean {
    return (
      nodeType === "class_declaration" ||
      nodeType === "abstract_class_declaration" ||
      nodeType === "class" ||
      nodeType === "function_declaration" ||
      nodeType === "method_definition" ||
      nodeType === "statement_block" ||
      nodeType === "program"
    )
  }

  /**
   * The decorator-position flag for a CHILD of `n`: a decorator opens the region,
   * a boundary closes it, anything else inherits. Pure and total, so the traversal
   * needs no ancestor bookkeeping beyond this one argument.
   */
  private nextDecoratorFlag(n: Node, inherited: boolean): boolean {
    if (n.type === "decorator") return true
    if (this.isDecoratorBoundary(n.type)) return false
    return inherited
  }

  private inDecoratorPosition(n: Node, ancestorInDecorator?: boolean): boolean {
    // BOTH FIXES ARE KEPT, and they are complementary rather than competing.
    //
    // The threading flag above removes the per-node ancestor walk for files that DO
    // use decorators. This short-circuit removes it for files that do NOT, which is
    // the majority: no `decorator` node anywhere in the tree means no decorator
    // ancestor is reachable, so the walk below cannot return `true` for any node.
    // One pre-pass with an early exit decides it.
    //
    // The measurements differ because the two lanes profiled different corpora — this
    // side measured 133.7 `.type` reads per node and 32.1% of samples on
    // `HttpConnection.test.ts` (12,054 nodes), the other measured 5.2% of wall clock
    // on the vue lane. Neither number is wrong and neither subsumes the other, so the
    // union keeps both guards: the global one first, then the threaded one.
    if (!this.hasAnyDecoratorNode) return false
    if (ancestorInDecorator !== undefined) return ancestorInDecorator
    let p: Node | null = n.parent
    while (p) {
      if (p.type === "decorator") return true
      if (this.isDecoratorBoundary(p.type)) return false
      p = p.parent
    }
    return false
  }

  /**
   * RECEIVER TYPES for a member call, read off the syntax — the input to the STORE'S OWN
   * member-owner channel (`metadata.owner`, read by `src/ast/member-owner-resolution.ts` and
   * called from both resolution paths in `parallel-indexer.ts`).
   *
   * Measured 2026-10-17 on a three-file program (src/used.ts, src/orphan.ts, src/main.ts; both
   * classes declare `run`, and main does `const c = new UsedClass(); return c.run()`): the call
   * published nothing but the LEAF NAME `run`, so the store's name-based binding picked
   * `src/orphan.ts:run` — a file main never imports — at confidence 0.9, and bb_graph served it as
   * a callee while the true `src/used.ts:run` edge was absent. `verify-patterns` caught the
   * symptom: orphan.ts could never be reported as an orphaned file because a fabricated edge
   * "referenced" it. The repair is the channel the store already has: a `calls`/`uses` row
   * carrying `metadata.owner` is re-resolved by `resolveMemberTargetsByOwner` inside that class,
   * and its NAME binding is WITHDRAWN, so a wrong name binding is replaced by the receiver's own.
   *
   * FOUR SYNTACTIC FORMS STATE THE TYPE, and each carries its evidence class on the row
   * (`metadata.ownerEvidence`) so the channel's coverage can be priced per form rather than
   * guessed at:
   *
   *   const c = new UsedClass()        -> c: UsedClass          evidence "assignment"
   *   const c: UsedClass = make()      -> c: UsedClass          evidence "annotation"
   *   function f(c: UsedClass)         -> c: UsedClass          evidence "param"
   *   this.field.m() (field: UsedClass)-> the field's type      evidence "this"
   *
   * `this.field` is resolved one hop: the call's receiver is `this.<field>` and the field's OWN
   * declared type is read from the class body. A field map whose entries disagree (two classes in
   * one file declaring the same field name with different types) is DROPPED whole, not picked
   * between — the same rule the local map uses.
   *
   * Deliberately NOT included: assignment after declaration, `as` casts, factory return types
   * (a call's return type is not in the same file's syntax), destructuring patterns (no single
   * variable), and receiver chains deeper than one `this.` hop. Each needs flow analysis this
   * pass does not have, and a WRONG owner is worse than no owner — the store WITHDRAWS the name
   * binding for an owner-carrying row and then declines if the owner does not resolve, so a bad
   * owner deletes a correct binding instead of improving it.
   *
   * MEASURED ON REAL CODE (graphql-js/src, 24,801 `calls` rows, full re-index of a fresh copy both
   * arms, 2026-10-17, for the `new`+annotation forms only): 958 rows carried a receiver type; of
   * the 493 whose target resolves inside a class, 493/493 agree with the receiver
   * (owner-consistent). The cost is visible and was counted the same way: 423 rows the name
   * binding had resolved became UNRESOLVED, and of those, 404 had landed in a DIFFERENT class than
   * the receiver (`Array.push` bound to QueueExecutorOptions.push; `Map.get` bound to spyOn.get),
   * 16 on a free function, and only 3 in the receiver's own class. Those 423 are built-in
   * receivers the index does not model (Array 214, Map 107, AbortController 60, Set 48), so the
   * honest answer for them is "no target symbol", not a stranger.
   */
  private collectLocalReceiverTypes(root: Node): ReceiverFacts {
    const locals = new Map<string, ReceiverTypeHint>()
    // ── THE SCOPE MAPS. A local binding belongs to the SCOPE it is written in, and a lookup
    // walks OUTWARD from the row's own scope. Without this, two unrelated functions that bind
    // the same name with different types DELETE each other's entry (the conflict rule is
    // written for shadowing WITHIN one scope) and BOTH lose their owner. MEASURED instance and
    // the falsifier: `validation/m14/fixtures/typescript/owner-scope-shadowing.ts`.
    const localsByScope = new Map<number, Map<string, ReceiverTypeHint>>()
    const scopeParent = new Map<number, number>()
    /** THE SCOPE ID OF A NODE — the nearest enclosing function-like node's start index, 0 for the
     *  module scope. A scope's PARENT is the scope of the node that contains it, so the outward
     *  walk is a walk up the tree and not a scan of every scope. */
    const scopeOf = (node: Node | null | undefined): number => {
      let p: Node | null = node ?? null
      while (p) {
        if (
          p.type === "function_declaration" || p.type === "generator_function_declaration" ||
          p.type === "function_expression" || p.type === "arrow_function" ||
          p.type === "method_definition"
        ) return p.startIndex
        p = p.parent
      }
      return 0
    }
    /** THE SCOPE TREE — built once, from the same walk, so a scope's parent is known.
     *
     *  A scope's PARENT is the scope of the node that CONTAINS the scope's own node. The subtlety
     *  is that `scopeOf(scopeNode) === scopeNode.startIndex` (the scope node is its own nearest
     *  function-like ancestor), so the parent search must start at the scope node's PARENT, not at
     *  the scope node itself — otherwise every scope would be its own parent and the outward walk
     *  would never leave the scope. THAT WAS THE MEASURED REGRESSION: the walk stopped at the
     *  scope, so a binding recorded in an OUTER function was invisible to an inner one, and the
     *  `param` class fell 1,092 -> 865 on a 2,000-file stride.
     *
     *  THE RULE, stated once: **a scope node's parent scope is `scopeOf(scopeNode.parent)`.** A
     *  node that is NOT a scope node introduces no scope, and the scope it lives in was already
     *  registered when the walk reached that scope's own node. */
    const buildScopeTree = (node: Node): void => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        // IS THIS NODE ITSELF A SCOPE? A scope node is function-like, and `scopeOf` of it is its
        // own start index.
        const isScopeNode =
          c.type === "function_declaration" || c.type === "generator_function_declaration" ||
          c.type === "function_expression" || c.type === "arrow_function" ||
          c.type === "method_definition"
        if (isScopeNode) {
          const own = c.startIndex
          if (!scopeParent.has(own)) scopeParent.set(own, scopeOf(c.parent))
        }
        buildScopeTree(c)
      }
    }
    buildScopeTree(root)
    const classFields = new Map<string, ReceiverTypeHint>()
    const typeMembers = new Map<string, Map<string, string>>()
    const elementTypes = new Map<string, string>()
    const localTypeArgs = new Map<string, string[]>()
    const typeParams = new Map<string, string[]>()
    const returnTypes = new Map<string, string>()
    const enumMembers = new Map<string, Set<string>>()
    const classMemberNames = new Map<string, Set<string>>()
    const conflictedLocals = new Set<string>()
    const conflictedFields = new Set<string>()
    /** THE PER-SCOPE CONFLICT SET — a name ambiguous WITHIN one scope. Sibling scopes do not
     *  conflict with each other (that was the measured defect). */
    const conflictedByScope = new Map<number, Set<string>>()
    /** DESTRUCTURED bindings: `function f({ worker }: Settings)` / `const { worker } = cfg`. Their
     *  binding's type is the TYPE MEMBER's type, which is known only after the class/interface walk
     *  has recorded `typeMembers`, so they are resolved after the walk rather than guessed during it. */
    const pendingPatterns: { pattern: Node; ownerType: string; evidence: string }[] = []
    /**
     * TWO-PHASE COLLECTION. Several of the D7 classes read facts DECLARED ELSEWHERE IN THE FILE — a
     * factory's annotated return type (`makeWidget(): Widget` may be declared after the call), an
     * enum's members, a class's type parameters, a typed source for a destructuring. A single
     * in-order walk resolves them against whatever it has seen so far, so which classes fire depends
     * on source order: measured on the class fixtures, `const w = makeWidget()` carried NO owner when
     * the factory was declared below it and DID when above. Phase 1 collects the declaration facts;
     * phase 2 (below) re-reads the deferred sites in source order against the COMPLETE fact set.
     */
    const pendingDeclarators: Node[] = []
    const pendingFields: Node[] = []
    const pendingAssignments: Node[] = []
    const pendingForIn: Node[] = []
    const pendingDestructured: { pattern: Node; sourceName: string }[] = []
    /** First declaration wins; a second declaration with a DIFFERENT type drops the name from
     *  the map entirely (shadowing makes the file-level answer ambiguous, and a wrong owner is
     *  worse than none — see the docstring).
     *
     *  **AND THE CONFLICT IS PER SCOPE.** The rule above is written for shadowing WITHIN one
     *  scope, and it was applied FILE-WIDE, which made two unrelated functions that bind the same
     *  name delete each other's entry (the measured `result` instance in the `ReceiverFacts`
     *  docstring). `recordLocal` therefore keeps the conflict per scope: a name bound in two
     *  SIBLING scopes with different types is two different bindings, not one ambiguous one.
     *
     *  THE FLAT `locals` MAP IS KEPT AS A DERIVED VIEW for the readers that do not know the
     *  row's scope: it holds the FIRST binding of each name across the file, which is what a
     *  scope-unaware reader can honestly use (and the pre-fix behaviour).
     */
    const record = (
      into: Map<string, ReceiverTypeHint>,
      conflicted: Set<string>,
      name: string,
      type: string,
      evidence: string,
    ) => {
      if (conflicted.has(name)) return
      const previous = into.get(name)
      if (previous === undefined) into.set(name, { type, evidence })
      else if (previous.type !== type) {
        into.delete(name)
        conflicted.add(name)
      }
    }
    /** THE SCOPED VARIANT — a local binding, recorded in the scope it is written in. */
    const recordLocal = (scope: number, name: string, type: string, evidence: string): void => {
      let byScope = localsByScope.get(scope)
      if (!byScope) localsByScope.set(scope, (byScope = new Map()))
      const previous = byScope.get(name)
      if (previous === undefined) {
        byScope.set(name, { type, evidence })
        // THE FLAT VIEW — first binding wins across the file (the pre-fix semantics), so a
        // scope-unaware reader sees the same thing it always saw.
        if (!locals.has(name)) locals.set(name, { type, evidence })
        return
      }
      if (previous.type === type) return
      // A REAL conflict WITHIN this scope: the name is ambiguous here, so it is dropped HERE.
      // The scope's entry is removed; the flat view keeps its FIRST binding (the conflict is
      // between two bindings of the SAME scope, and the flat view cannot express that).
      byScope.delete(name)
      let conflicted = conflictedByScope.get(scope)
      if (!conflicted) conflictedByScope.set(scope, (conflicted = new Set()))
      conflicted.add(name)
    }
    /** THE SCOPED LOOKUP — the binding of `name` VISIBLE from `scope`. The walk goes OUTWARD
     *  through the enclosing scopes, so a local declared in an outer function is visible in an
     *  inner one, and a local declared in a SIBLING function is not visible at all (that is the
     *  whole point of the fix). A name CONFLICTED within a scope is invisible in that scope, and
     *  the walk CONTINUES outward — an ambiguous inner binding does not hide an unambiguous
     *  outer one, because the inner one simply does not answer. */
    const lookupLocal = (scope: number, name: string): ReceiverTypeHint | undefined => {
      if (localsByScope.size === 0) return locals.get(name)
      let s: number | null = scope
      const seen = new Set<number>()
      while (s !== null && !seen.has(s)) {
        seen.add(s)
        const conflicted = conflictedByScope.get(s)
        const byScope = localsByScope.get(s)
        if (byScope?.has(name) && !conflicted?.has(name)) return byScope.get(name)
        // THE MODULE SCOPE IS THE LAST STOP — a module-level binding is visible from every scope.
        s = scopeParent.get(s) ?? (s === 0 ? null : 0)
      }
      return undefined
    }
    // ── PHASE 1: declaration facts that do not depend on other deferred facts ──────────────────
    const stack: Node[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "variable_declarator") {
        pendingDeclarators.push(n)
      } else if (n.type === "public_field_definition" || n.type === "property_signature") {
        pendingFields.push(n)
      } else if (n.type === "assignment_expression") {
        pendingAssignments.push(n)
      } else if (n.type === "for_in_statement") {
        pendingForIn.push(n)
      } else if (
        n.type === "function_declaration" || n.type === "generator_function_declaration" ||
        n.type === "method_definition" || n.type === "method_signature" || n.type === "function_signature"
      ) {
        // C5: the annotated RETURN type of a same-file callable, so `const w = makeWidget()` can be
        // typed by its factory. Every callable declaration kind that can carry `: T` is read.
        const nameNode = n.childForFieldName("name") ?? n.namedChild(0)
        const ret = n.childForFieldName("return_type")
        const retLeaf = ret ? this.typeLeafName(ret.namedChild(0) ?? ret) : null
        if (nameNode && retLeaf && (nameNode.type === "identifier" || nameNode.type === "property_identifier")) {
          if (!returnTypes.has(nameNode.text)) returnTypes.set(nameNode.text, retLeaf)
        }
        // C8: a class's declared member names — the proof that `Cls.staticM()` names THIS class's
        // member rather than a same-named thing elsewhere.
        if (nameNode && (nameNode.type === "property_identifier" || nameNode.type === "identifier")) {
          const owner = this.enclosingTypeName(n)
          if (owner) {
            const members = classMemberNames.get(owner) ?? new Set<string>()
            members.add(nameNode.text)
            classMemberNames.set(owner, members)
          }
        }
      } else if (
        n.type === "class_declaration" || n.type === "abstract_class_declaration" || n.type === "interface_declaration"
      ) {
        const nameNode = n.childForFieldName("name") ?? n.namedChild(0)
        // C4: the class's declared TYPE PARAMETERS, in order, so an instantiated `Box<Widget>` can
        // substitute `T -> Widget` for members typed `T`.
        const tp = this.childOfType(n, "type_parameters")
        if (nameNode && tp) {
          const names: string[] = []
          for (let i = 0; i < tp.namedChildCount; i++) {
            const c = tp.namedChild(i)
            if (!c || c.type !== "type_parameter") continue
            const nm = c.childForFieldName("name") ?? c.namedChild(0)
            if (nm) names.push(nm.text)
          }
          if (names.length > 0 && !typeParams.has(nameNode.text)) typeParams.set(nameNode.text, names)
        }
        if (nameNode && !classMemberNames.has(nameNode.text)) classMemberNames.set(nameNode.text, new Set())
      } else if (n.type === "enum_declaration") {
        // C7: enum name -> declared member names, so an enum-valued local/field names the enum type.
        const nameNode = n.childForFieldName("name") ?? n.namedChild(0)
        const body = n.childForFieldName("body") ?? n.namedChild(n.namedChildCount - 1)
        if (nameNode && body) {
          const members = enumMembers.get(nameNode.text) ?? new Set<string>()
          for (let i = 0; i < body.namedChildCount; i++) {
            const m = body.namedChild(i)
            if (!m) continue
            const nm = m.type === "enum_assignment" ? (m.childForFieldName("name") ?? m.namedChild(0)) : m
            if (nm && (nm.type === "property_identifier" || nm.type === "identifier")) members.add(nm.text)
          }
          enumMembers.set(nameNode.text, members)
        }
      } else if (n.type === "required_parameter" || n.type === "optional_parameter") {
        const pattern = n.childForFieldName("pattern") ?? n.childForFieldName("name") ?? n.namedChild(0)
        if (pattern && pattern.type === "identifier") {
          const type = this.annotationTypeName(n)
          // THE PARAMETER'S SCOPE — the scope of the function the parameter BELONGS to. A
          // parameter is bound in its function's scope, and the call sites that use it are in the
          // SAME function's body, so the two must agree. `scopeOf(n)` on a parameter node returns
          // the nearest enclosing function-like ancestor, which IS the parameter's own function
          // (the function node is an ancestor of the parameter node) — so the scope is right, and
          // the LOOKUP must be in the same scope. The measured regression (param 1,092 -> 865)
          // was therefore NOT here; it is at the lookup, and it is fixed by the scope walk.
          if (type) recordLocal(scopeOf(n), pattern.text, type, "param")
          // C3: a parameter annotated `Widget[]` names its ELEMENT type, so `items[0].m()` is typed.
          const ann = this.typeAnnotationNode(n)
          const elementType = ann ? this.elementTypeOfAnnotation(ann) : null
          if (elementType) elementTypes.set(pattern.text, elementType)
          const args = ann ? this.typeArgsOfAnnotation(ann) : null
          if (args && args.length > 0) localTypeArgs.set(pattern.text, args)
        } else if (pattern && pattern.type === "object_pattern") {
          const ownerType = this.annotationTypeName(n)
          if (ownerType) pendingPatterns.push({ pattern, ownerType, evidence: "param" })
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    // ── PHASE 2: the deferred sites, in SOURCE ORDER, against the complete fact set ────────────
    const order = (nodes: Node[]) => nodes.slice().sort((a, b) => a.startIndex - b.startIndex)
    // (a) FIELDS — annotation, `new X()`, or an enum member; and the type-member table every
    // destructured/one-hop class reads.
    for (const n of order(pendingFields)) {
      const nameNode = n.childForFieldName("name") ?? n.namedChild(0)
      if (!nameNode || (nameNode.type !== "property_identifier" && nameNode.type !== "identifier")) continue
      const value = n.childForFieldName("value")
      const enumType = value ? this.enumMemberType(value, enumMembers) : null
      const type = this.annotationTypeName(n) ?? this.initialiserNewType(n) ?? enumType
      if (type) record(classFields, conflictedFields, nameNode.text, type, enumType ? "enum" : "this")
      const fieldAnn = this.typeAnnotationNode(n)
      const fieldElement = fieldAnn ? this.elementTypeOfAnnotation(fieldAnn) : value && value.type === "new_expression" ? this.elementTypeOfNew(value) : null
      if (fieldElement) elementTypes.set(nameNode.text, fieldElement)
      const fieldArgs = fieldAnn ? this.typeArgsOfAnnotation(fieldAnn) : value && value.type === "new_expression" ? this.typeArgsOfNew(value) : null
      if (fieldArgs && fieldArgs.length > 0) localTypeArgs.set(nameNode.text, fieldArgs)
      const ownerType = this.enclosingTypeName(n)
      if (ownerType && type) {
        const byMember = typeMembers.get(ownerType) ?? new Map<string, string>()
        if (!byMember.has(nameNode.text)) byMember.set(nameNode.text, type)
        typeMembers.set(ownerType, byMember)
      }
    }
    // (b) DECLARATORS — the C1/C2/C3/C4/C6/C7 initialiser and annotation classes.
    for (const n of order(pendingDeclarators)) {
      const nameNode = n.childForFieldName("name") ?? n.namedChild(0)
      const value = n.childForFieldName("value")
      if (nameNode && nameNode.type === "identifier") {
        // C6 THE `as`-CAST CLASS — `const w = x as Widget`: the cast states the type, and it is
        // the strongest same-line evidence available (`x` itself may be an untyped union).
        const castType = value ? this.castTypeName(value) : null
        // C5 FACTORY-RETURN TYPING — `const w = makeWidget()` where `makeWidget` is declared in
        // this file with a return annotation. A call whose callee has no annotated return type
        // states nothing; the initializer's own later members would be a guess.
        const factoryType = value && value.type === "call_expression" ? this.factoryReturnType(value, returnTypes) : null
        // C7 ENUM-MEMBER RECEIVERS — `const status = Status.Active`: the initialiser names a
        // declared enum's declared member, so the local's type is the ENUM.
        const enumType = value ? this.enumMemberType(value, enumMembers) : null
        const isNew = value !== null && value.type === "new_expression"
        // PRECEDENCE: an EXPLICIT annotation is the binding's declared type and beats every
        // inferred form (`const d: Widget = make()` is an `annotation`, not a `factory` row); a cast
        // and an enum member initialiser are explicit statements about the VALUE; a same-file
        // factory's return annotation and a `new` are the remaining proofs of the value's type.
        // The evidence class records WHICH statement produced the owner, so the order is part of the
        // published contract rather than an accident of evaluation.
        const annotated = this.annotationTypeName(n)
        if (annotated) recordLocal(scopeOf(n), nameNode.text, annotated, isNew ? "assignment" : "annotation")
        else if (castType) recordLocal(scopeOf(n), nameNode.text, castType, "cast")
        else if (factoryType) recordLocal(scopeOf(n), nameNode.text, factoryType, "factory")
        else if (enumType) recordLocal(scopeOf(n), nameNode.text, enumType, "enum")
        else {
          const declaredType = this.declaratorTypeName(n)
          if (declaredType) recordLocal(scopeOf(n), nameNode.text, declaredType, isNew ? "assignment" : "annotation")
        }
        // C3/C4: element type and generic instantiation arguments stated by the declaration.
        const ann = this.typeAnnotationNode(n)
        const elementType = ann ? this.elementTypeOfAnnotation(ann) : value && value.type === "new_expression" ? this.elementTypeOfNew(value) : null
        if (elementType) elementTypes.set(nameNode.text, elementType)
        const args = ann ? this.typeArgsOfAnnotation(ann) : value && value.type === "new_expression" ? this.typeArgsOfNew(value) : null
        if (args && args.length > 0) localTypeArgs.set(nameNode.text, args)
      } else if (nameNode && nameNode.type === "object_pattern") {
        const ownerType = this.annotationTypeName(n)
        if (ownerType) pendingPatterns.push({ pattern: nameNode, ownerType, evidence: "annotation" })
        else if (value && value.type === "identifier") pendingDestructured.push({ pattern: nameNode, sourceName: value.text })
      }
    }
    // (c) C2 DESTRUCTURED ELEMENT TYPES FROM A TYPED SOURCE — `const { worker } = cfg` where `cfg`
    // is a typed local/param: the binding's type is the MEMBER's declared type, one hop. The
    // evidence class is DESTRUCTURING (the type was inferred from a VALUE), not the source's own.
    // THE SOURCE IS LOOKED UP IN ITS OWN SCOPE — a `cfg` typed in a sibling function is a
    // different binding, and using it would type the destructured members wrongly.
    for (const { pattern, sourceName } of pendingDestructured) {
      const sourceHint = lookupLocal(scopeOf(pattern), sourceName)
      if (sourceHint) pendingPatterns.push({ pattern, ownerType: sourceHint.type, evidence: "destructured" })
    }
    // (d) C1 ASSIGNMENT-PROVEN LOCAL TYPES — `x = new Widget()` (a later assignment, not the
    // declarator initialiser). An ANNOTATION on the declaration is authoritative and is never
    // overwritten: `let x: Base; x = new Derived()` is a `Base` receiver, and re-typing it from the
    // assignment would be a guess that the store then acts on.
    for (const n of order(pendingAssignments)) {
      const left = n.childForFieldName("left")
      const right = n.childForFieldName("right")
      if (!left || left.type !== "identifier" || !right || locals.has(left.text)) continue
      const assigned = this.initialiserTypeName(right, returnTypes)
      if (assigned) recordLocal(scopeOf(n), left.text, assigned, "assignment")
    }
    // (e) C3 ELEMENT BINDING — `for (const item of items)` types `item` as `items`' element type.
    for (const n of order(pendingForIn)) {
      const right = n.childForFieldName("right") ?? n.namedChild(n.namedChildCount - 1)
      const elem = right ? (right.type === "identifier" ? elementTypes.get(right.text) ?? null : this.elementTypeOfNew(right)) : null
      if (!elem) continue
      const left = n.childForFieldName("left") ?? n.namedChild(0)
      if (!left) continue
      const binders: string[] = []
      if (left.type === "identifier") binders.push(left.text)
      else {
        for (let i = 0; i < left.namedChildCount; i++) {
          const c = left.namedChild(i)
          if (!c) continue
          if (c.type === "variable_declarator") {
            const nm = c.childForFieldName("name") ?? c.namedChild(0)
            if (nm && nm.type === "identifier") binders.push(nm.text)
          } else if (c.type === "identifier") binders.push(c.text)
        }
      }
      for (const b of binders) recordLocal(scopeOf(n), b, elem, "element")
    }
    // ── DESTRUCTURED BINDINGS, typed from the TYPE MEMBER they name ──────────────────────────
    // `function f({ worker }: Settings)` with `Settings { worker: Widget }` makes `worker.other()`
    // a call on a Widget: the binding's type is the MEMBER's declared type, one hop, read off the
    // file's own interface/class declaration. Evidence class is the source's (annotation on the
    // pattern, the parameter, or the VALUE the binding was destructured from); only the member's
    // OWN type is used — a member whose type is unknown stays unowned rather than guessed.
    for (const { pattern, ownerType, evidence } of pendingPatterns) {
      const byMember = typeMembers.get(ownerType)
      if (!byMember) continue
      for (let i = 0; i < pattern.namedChildCount; i++) {
        const child = pattern.namedChild(i)
        if (!child) continue
        if (child.type === "shorthand_property_identifier_pattern") {
          const memberType = byMember.get(child.text)
          if (memberType) recordLocal(scopeOf(pattern), child.text, memberType, evidence)
          continue
        }
        // `{ worker: alias }` (pair) and `{ worker = fallback }` (object_assignment_pattern).
        if (child.type !== "pair" && child.type !== "object_assignment_pattern") continue
        const key = child.childForFieldName("key") ?? child.namedChild(0)
        const value = child.childForFieldName("value") ?? child.namedChild(1) ?? child.namedChild(0)
        if (!key || !value) continue
        const binding = value.type === "identifier" ? value : value.type === "object_assignment_pattern" ? (value.childForFieldName("left") ?? value.namedChild(0)) : null
        if (!binding || binding.type !== "identifier") continue
        const memberType = byMember.get(key.text)
        if (memberType) recordLocal(scopeOf(pattern), binding.text, memberType, evidence)
      }
    }
    return {
      locals, localsByScope, scopeParent, classFields, typeMembers,
      elementTypes, localTypeArgs, typeParams, returnTypes, enumMembers, classMemberNames,
    }
  }

  /** The name of the class/interface a member declaration belongs to, walking up to the body. */
  private enclosingTypeName(n: Node): string | null {
    let p: Node | null = n.parent
    while (p) {
      if (p.type === "class_declaration" || p.type === "abstract_class_declaration" || p.type === "interface_declaration") {
        const name = p.childForFieldName("name") ?? p.namedChild(0)
        return name && (name.type === "type_identifier" || name.type === "identifier") ? name.text : null
      }
      if (p.type === "statement_block" || p.type === "function_declaration" || p.type === "method_definition") return null
      p = p.parent
    }
    return null
  }

  /** The type a field's `= new X(...)` initialiser names, if the value IS a constructor call. */
  private initialiserNewType(n: Node): string | null {
    const value = n.childForFieldName("value")
    if (!value || value.type !== "new_expression") return null
    const ctor = value.namedChild(0)
    return ctor ? this.typeLeafName(ctor) : null
  }

  /** The class a declarator names, from `= new X(...)` or from a `: X` annotation. */
  private declaratorTypeName(n: Node): string | null {
    const value = n.childForFieldName("value")
    if (value && value.type === "new_expression") {
      const ctor = value.namedChild(0)
      const leaf = ctor ? this.typeLeafName(ctor) : null
      if (leaf) return leaf
    }
    return this.annotationTypeName(n)
  }

  /** The type an annotation names, if this declaration carries one: `: X` -> `X`. */
  private annotationTypeName(n: Node): string | null {
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child && child.type === "type_annotation") {
        const inner = child.namedChild(0)
        return inner ? this.typeLeafName(inner) : null
      }
    }
    return null
  }

  /**
   * `UsedClass`, `ns.UsedClass`, `UsedClass<T>` -> `UsedClass`.
   * Unions, intersections and function types return null: they name no single
   * owner, and picking one member of a union would be a guess.
   */
  private typeLeafName(node: Node): string | null {
    if (node.type === "identifier" || node.type === "type_identifier") {
      return isPlainIdentifier(node.text) ? node.text : null
    }
    if (node.type === "nested_identifier" || node.type === "member_expression") {
      const property = node.childForFieldName("property") ?? node.namedChild(node.namedChildCount - 1)
      return property && property.type === "identifier" ? this.typeLeafName(property) : null
    }
    if (node.type === "generic_type") {
      const nameNode = node.childForFieldName("name") ?? node.namedChild(0)
      return nameNode ? this.typeLeafName(nameNode) : null
    }
    return null
  }

  // ── D7 RECEIVER-TYPING HELPERS ──────────────────────────────────────────────────────────────
  // Each helper reads ONE syntax shape and returns the NAME it states, or null. A shape that names
  // no single type (unions, function types, untyped initialisers) returns null rather than a guess:
  // a wrong owner is worse than none (the store acts on it), which is the rule this pass started
  // with and every class below keeps.

  /** The type_annotation node a declaration carries (`: T`), either as the `type` field or a child. */
  private typeAnnotationNode(n: Node): Node | null {
    const ty = n.childForFieldName?.("type")
    if (ty) {
      if (ty.type === "type_annotation") return ty
      return ty
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child && child.type === "type_annotation") return child
    }
    return null
  }

  /** The first named child of the given type (type_parameters, type_arguments, ...). */
  private childOfType(n: Node, type: string): Node | null {
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  /** C6: the type a cast states. `x as T` / `<T>x`; unions give null (no single owner). */
  private castTypeName(value: Node): string | null {
    if (value.type === "as_expression") {
      const right = value.namedChild(value.namedChildCount - 1)
      return right ? this.typeLeafName(right) : null
    }
    if (value.type === "type_assertion") {
      const right = value.namedChild(value.namedChildCount - 1)
      return right ? this.typeLeafName(right) : null
    }
    return null
  }

  /** C5: the annotated return type of a same-file callable the call names, if the callee is a bare
   *  identifier (a member call's return type is not this class's evidence). */
  private factoryReturnType(call: Node, returnTypes: Map<string, string>): string | null {
    if (call.type !== "call_expression") return null
    const callee = call.namedChild(0)
    if (!callee || callee.type !== "identifier") return null
    return returnTypes.get(callee.text) ?? null
  }

  /** C1: the type a right-hand side states for an existing local: `= new T()`, `= x as T`,
   *  `= factory()` with an annotated same-file return. */
  private initialiserTypeName(value: Node, returnTypes: Map<string, string>): string | null {
    if (value.type === "new_expression") {
      const ctor = value.namedChild(0)
      return ctor ? this.typeLeafName(ctor) : null
    }
    const cast = this.castTypeName(value)
    if (cast) return cast
    return this.factoryReturnType(value, returnTypes)
  }

  /** C7: `Status.Active` names the ENUM type when the root is a declared enum and the member is one
   *  of its declared members; otherwise null. */
  private enumMemberType(expr: Node, enumMembers: Map<string, Set<string>>): string | null {
    if (expr.type !== "member_expression") return null
    const root = expr.childForFieldName("object") ?? expr.namedChild(0)
    const member = expr.childForFieldName("property") ?? expr.namedChild(expr.namedChildCount - 1)
    if (!root || !member || root.type !== "identifier") return null
    const members = enumMembers.get(root.text)
    if (!members || !members.has(member.text)) return null
    return root.text
  }

  /** C3: the ELEMENT type an annotation states: `T[]`, `Array<T>`, `ReadonlyArray<T>`, `Set<T>`. */
  private elementTypeOfAnnotation(ann: Node): string | null {
    const inner = ann.type === "type_annotation" ? (ann.namedChild(0) ?? ann) : ann
    if (inner.type === "array_type") {
      const el = inner.namedChild(inner.namedChildCount - 1)
      return el ? this.typeLeafName(el) : null
    }
    if (inner.type === "generic_type") {
      const base = this.typeLeafName(inner.childForFieldName("name") ?? inner.namedChild(0) ?? inner)
      const args = this.childOfType(inner, "type_arguments")
      if (base && args && (base === "Array" || base === "ReadonlyArray" || base === "Set" || base === "ReadonlySet")) {
        const first = args.namedChild(0)
        return first ? this.typeLeafName(first) : null
      }
    }
    return null
  }

  /** C3/C4: type arguments instantiated by `new Foo<A, B>()` and whether the constructor is a
   *  collection whose first argument is its ELEMENT type. */
  private typeArgsOfNew(value: Node): string[] | null {
    if (value.type !== "new_expression") return null
    const args = this.childOfType(value, "type_arguments")
    if (!args) return null
    const out: string[] = []
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (!c) continue
      const leaf = this.typeLeafName(c)
      if (leaf) out.push(leaf)
    }
    return out.length > 0 ? out : null
  }

  private elementTypeOfNew(value: Node): string | null {
    if (value.type !== "new_expression") return null
    const ctor = value.namedChild(0)
    const base = ctor ? this.typeLeafName(ctor) : null
    if (!base || (base !== "Array" && base !== "Set")) return null
    const args = this.typeArgsOfNew(value)
    return args && args[0] ? args[0] : null
  }

  /** C3: the element type a CONSTRUCTION states (`new Array<Widget>()`); the identifier case is read
   *  against the collector's own element-types map at the call site. */
  private elementTypeOfExpression(expr: Node | null): string | null {
    if (!expr) return null
    return this.elementTypeOfNew(expr)
  }

  /** C4: the declared type arguments a type annotation instantiates (`Box<Widget>` -> ["Widget"]). */
  private typeArgsOfAnnotation(ann: Node): string[] | null {
    const inner = ann.type === "type_annotation" ? (ann.namedChild(0) ?? ann) : ann
    const args = this.childOfType(inner, "type_arguments")
    if (!args) return null
    const out: string[] = []
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (!c) continue
      const leaf = this.typeLeafName(c)
      if (leaf) out.push(leaf)
    }
    return out.length > 0 ? out : null
  }

  /**
   * C4: resolve a MEMBER's declared type through the receiver's instantiated type arguments —
   * `class Box<T> { value: T }` + `const b = new Box<Widget>()` makes `b.value` a Widget. Only a
   * member whose declared type IS one of the class's type parameters is substituted, and only when
   * the receiver's own type arguments are known; anything else is returned as declared.
   */
  private substituteMemberType(
    facts: ReceiverFacts,
    receiverName: string,
    receiverType: string,
    memberType: string,
  ): { type: string; substituted: boolean } {
    const params = facts.typeParams.get(receiverType)
    const args = facts.localTypeArgs.get(receiverName)
    if (!params || !args) return { type: memberType, substituted: false }
    const idx = params.indexOf(memberType)
    if (idx < 0) return { type: memberType, substituted: false }
    const arg = args[idx]
    if (!arg) return { type: memberType, substituted: false }
    return { type: arg, substituted: true }
  }

  /**
   * The owner a member call states, plus the evidence class that stated it, or undefined when
   * the syntax states neither. `super` is left alone (no type in the syntax); a bare `this.m()`
   * is left to the SOURCE symbol's own owner, a different and already-implemented channel, so
   * naming an owner here would double-claim. A one-hop `this.field.m()` IS resolved — the
   * receiver's type there is the FIELD's declared type.
   */
  /**
   * THE SCOPE OF A NODE — the nearest enclosing function-like node's start index, 0 for the module
   * scope. THE SAME RULE the receiver-type collector uses to record a binding's scope, so the two
   * agree by construction: a binding is recorded in the scope it is written in, and a row reads
   * the binding visible from the scope it is written in.
   */
  private scopeIdOf(node: Node | null | undefined): number {
    let p: Node | null = node ?? null
    while (p) {
      if (
        p.type === "function_declaration" || p.type === "generator_function_declaration" ||
        p.type === "function_expression" || p.type === "arrow_function" ||
        p.type === "method_definition"
      ) return p.startIndex
      p = p.parent
    }
    return 0
  }

  private receiverOwnerType(callee: Node, facts: ReceiverFacts, scope: number): { type: string; evidence: string } | undefined {
    if (callee.type !== "member_expression") return undefined
    const object = callee.childForFieldName("object") ?? callee.namedChild(0)
    if (!object) return undefined
    if (object.type === "identifier") {
      // THE SCOPED LOOKUP. The binding of this name VISIBLE FROM THE ROW'S OWN SCOPE — a name
      // bound in a SIBLING function is not this row's binding, and reading it would state a
      // receiver's type that the row's scope does not have. The flat map is the fallback for a
      // caller that built the facts without scope information.
      const hint = facts.localsByScope.size > 0
        ? lookupLocalInScope(facts, scope, object.text)
        : facts.locals.get(object.text)
      if (hint) return hint
      // C8 CLASS-STATIC RECEIVERS — `Cls.staticM()`: the receiver root names a CLASS, and the owner
      // is stated only when the class's own body declares that member (the proof that this is the
      // class's member and not a same-named thing elsewhere). A class with no such member keeps no
      // owner: precision over coverage, because the store acts on the owner.
      const members = facts.classMemberNames.get(object.text)
      if (members) {
        const prop = callee.childForFieldName("property") ?? callee.namedChild(callee.namedChildCount - 1)
        if (prop && (prop.type === "property_identifier" || prop.type === "identifier") && members.has(prop.text)) {
          return { type: object.text, evidence: "class-static" }
        }
      }
      return undefined
    }
    // C3 ELEMENT RECEIVERS — `items[0].m()` where `items` states its element type (`Widget[]`,
    // `Array<Widget>`, `new Array<Widget>()`). The subscript states the element, one hop.
    if (object.type === "subscript_expression") {
      const base = object.childForFieldName("object") ?? object.namedChild(0)
      if (base && base.type === "identifier") {
        const elem = facts.elementTypes.get(base.text)
        if (elem) return { type: elem, evidence: "element" }
      }
      return undefined
    }
    if (object.type === "member_expression") {
      // CLASS MEMBER ACCESS THROUGH A TYPED LOCAL/PARAM (`cfg.worker.run()`): the receiver chain's
      // ROOT is a local whose type the syntax states, and the FIRST hop is a member whose type the
      // file's own class/interface declaration states. One hop only — a deeper chain needs the
      // member's member, which is a type-inference walk this pass does not have.
      const root = object.childForFieldName("object") ?? object.namedChild(0)
      const firstProperty = object.childForFieldName("property") ?? object.namedChild(object.namedChildCount - 1)
      if (
        root && root.type === "identifier" && firstProperty &&
        (firstProperty.type === "identifier" || firstProperty.type === "property_identifier")
      ) {
        const rootHint = facts.localsByScope.size > 0
          ? lookupLocalInScope(facts, scope, root.text)
          : facts.locals.get(root.text)
        if (rootHint) {
          const declaredMemberType = facts.typeMembers.get(rootHint.type)?.get(firstProperty.text)
          if (declaredMemberType) {
            // C4 GENERIC PROPAGATION: when the member's declared type IS the class's type parameter
            // and the receiver instantiates it (`Box<Widget>`), the owner is the ARGUMENT (Widget),
            // and the evidence class records that the type came through the arguments.
            const resolved = this.substituteMemberType(facts, root.text, rootHint.type, declaredMemberType)
            return resolved.substituted
              ? { type: resolved.type, evidence: "generic" }
              : { type: declaredMemberType, evidence: rootHint.evidence }
          }
        }
      }
      const inner = object.childForFieldName("object") ?? object.namedChild(0)
      const property = object.childForFieldName("property") ?? object.namedChild(object.namedChildCount - 1)
      // THE FIELD NAME NODE IS A `property_identifier` IN THIS GRAMMAR — not an `identifier`.
      // Measured on the fixture: requiring `identifier` here made the whole `this.<field>.m()`
      // evidence class DEAD (the collector recorded the field, the lookup above found it, and
      // this test rejected the name node, so every such row carried no owner and reported
      // nothing). Both spellings are accepted because a class field is a member in either shape.
      if (
        inner && inner.type === "this" && property &&
        (property.type === "identifier" || property.type === "property_identifier" || property.type === "private_property_identifier")
      ) {
        return facts.classFields.get(property.text)
      }
    }
    return undefined
  }

  /**
   * ONE walk for BOTH edge kinds that need only the enclosing symbol: `calls`
   * and `instantiates`. They were two full-tree traversals that each re-resolved
   * the enclosing symbol at every node (the same `resolveRelationshipSymbol`
   * call, the same module-leaf fallback) and differed only in what they emitted
   * — measured at 25-29% and 5-10% of analyze time respectively. The usage pass
   * stays separate: it carries a per-function `locals` scope, so folding it in
   * would mean carrying that state through a pass that does not want it.
   */
  private extractCallRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    // PERF: `ancestorInDecorator` is threaded rather than recomputed per node.
    // See `inDecoratorPosition`: web-tree-sitter's `.parent` is a WASM descendant
    // search, so the old per-node climb was O(n x depth) of expensive calls and
    // profiled at 5.2% of the vue lane's wall clock.
    // Read once per file, before the walk: the declaration of a receiver is not
    // guaranteed to precede its call in every construct (hoisted function
    // bodies, closures), so an in-walk map would miss it on order alone.
    const receiverTypes = this.collectLocalReceiverTypes(node)
    const processNode = (
      n: Node,
      currentSymbol: ASTEngine.UniversalSymbol | null,
      ancestorInDecorator = false,
    ): void => {
      currentSymbol = this.resolveRelationshipSymbol(n, symbols, currentSymbol)
      // M59 (#861): no call edge is emitted for a decorator invocation — see
      // inDecoratorPosition. The subtree is skipped whole, so a call nested in a
      // decorator's ARGUMENTS (`@inject(makeToken())`) is decorator position too,
      // which is exactly what the oracle now skips.
      if (this.inDecoratorPosition(n, ancestorInDecorator)) return

      // Extract call expressions, instantiations and JSX component usages
      // TSD4 (JAD2-class): the top-level fallback is the file's module LEAF
      // name — the same source imports/exports use — never a "(script)"
      // placeholder no consumer can resolve (JS parity: moduleName).
      const callSource = currentSymbol || { name: this.moduleLeafName(), scope: undefined, kind: "module" as any, range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 }, metadata: {} as any }
      if (
        (n.type === "call_expression" || n.type === "new_expression" || n.type === "jsx_self_closing_element" || n.type === "jsx_element")
      ) {
        if (n.type === "call_expression") {
          const callee = n.namedChild(0)
          if (callee) {
            // M14 #858: the constructor call of a wrapped `new` is not a call at
            // all — it is the instantiation the grammar failed to build. Emit it
            // through the same helper the new_expression path uses, walk the
            // arguments (nested real calls live there), and emit nothing else.
            if (this.isWrappedNewConstructor(n)) {
              this.pushInstantiation(callee, n, callSource, relationships)
              for (let i = 0; i < n.namedChildCount; i++) {
                const child = n.namedChild(i)
                if (child) processNode(child, currentSymbol, this.nextDecoratorFlag(n, ancestorInDecorator))
              }
              return
            }
            // M14 #419 T7: dynamic import() is a module dependency, not a
            // call — skip it here so no spurious calls edge to `import` is
            // emitted (the imports edge comes from extractImportRelationships).
            //
            // M49 W4 (T3, rotated-sample finding): skipping the EDGE must not
            // skip the SUBTREE. `return` here (and on the subscript branch
            // below) aborted processNode before its child recursion, so every
            // real call inside the arguments vanished — probe: TS emitted
            // NOTHING for `console[method](message.text())` while the oracle
            // derived calls->text (svelte repo runtime-browser/test.ts:203,
            // surfaced as MISSING once #760's rotation sampled the file).
            // Same defect class as the M49 W1 javascript `continue`-skips-
            // subtree fix; walk the children, then stop.
            // `require` is a module loader, not a call, exactly like `import`:
            // the twin skips both and emits a dependency edge instead. Pre-fix
            // typescript skipped only `import`, so `require("./m")` published
            // `calls -> require` — the file appearing to call a function named
            // `require`, which is not in the program — while the dependency it
            // actually names went unrecorded. The callee must be the BARE
            // identifier; `foo.require(...)` is somebody else's method.
            if (
              callee.text === "import" || callee.type === "import" ||
              (callee.type === "identifier" && callee.text === "require")
            ) {
              for (let i = 0; i < n.namedChildCount; i++) {
                const child = n.namedChild(i)
                if (child) processNode(child, currentSymbol, this.nextDecoratorFlag(n, ancestorInDecorator))
              }
              return
            }
            const fullCallee = callee.text
            // THE TARGET IS A NAME, REDUCED BY SHAPE — see `calleeLeafName` for the
            // measured ten callee shapes and the corpus defects this replaces. A callee
            // that names nothing (a call of a call, a subscript, `super`, an anonymous
            // function) publishes NO edge; the subtree is still walked below, so calls
            // inside an IIFE body are kept.
            const targetName = calleeLeafName(callee)

            if (targetName === null) {
              // Skip the EDGE, never the SUBTREE.
            } else if (this.isTypeScriptBuiltinCall(targetName, fullCallee)) {
              // Filtered builtins (console output, Object leaf methods, super)
            } else {

            // The receiver's type, when the syntax states one. See
            // collectLocalReceiverTypes for why this is the difference between
            // a fabricated edge and the real one on `const c = new Foo(); c.m()`.
            //
            // TWO KEYS, ONE COMPUTATION, and they are not duplicable state: `owner` is the STORE
            // channel's spelling (src/ast/member-owner-resolution.ts withdraws the name binding
            // and re-resolves inside this class); `ownerEvidence` records WHICH syntactic form
            // stated it — the four original classes ({assignment, annotation, param, this}) plus the
            // D7 extension classes ({destructured, element, generic, factory, cast, enum,
            // class-static}) — so the channel's coverage is a queryable number per evidence class
            // rather than a claim. The field is deliberately named `ownerEvidence`, not a second
            // type key: one value, one spelling.
            const ownerHint = this.receiverOwnerType(callee, receiverTypes, this.scopeIdOf(callee))
            relationships.push({
              source: callSource.name,
              target: targetName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              // M59 (#825): the callee LEAF — for `a.b.c()` the property node, so
              // a chain's call does not take the chain's opening line.
              ...this.lineField(callee.type === "member_expression" ? (callee.childForFieldName("property") ?? callee) : callee),
              metadata: {
                calleeExpression: callee.text,
                // The receiver's declared type, when the syntax states one. The
                // store re-resolves the row inside that class (member-owner pass),
                // which is what stops `c.run()` binding to another file's `run`.
                ...(ownerHint ? { owner: ownerHint.type, ownerEvidence: ownerHint.evidence } : {}),
                // WHICH WRAPPER THE LEAF WAS REDUCED THROUGH, recorded only when there was
                // one. A consumer can then tell `(foo)()` from `foo()` and `foo!()` from
                // `foo()` without re-parsing, and an audit of `calleeLeafName`'s allowlist
                // can enumerate exactly the shapes it fired on. Absent means the callee was
                // already an identifier or a member expression — the two shapes that need
                // no reduction — so the field cannot be mistaken for "shape unknown".
                ...(callee.type !== "identifier" && callee.type !== "member_expression"
                  ? { calleeShape: callee.type }
                  : {}),
                line: n.startPosition.row + 1,
              } as any,
            })
          }
          } // closes if(callee)
        } else if (n.type === "new_expression") {
          // Fused in from the former extractInstantiationRelationships: the
          // instantiation edge for a constructor the parser DID build. A `new`
          // whose constructor sits on the next line never reaches this branch
          // (the grammar does not build a new_expression for it — #858); it is
          // emitted above through the same helper, so both spellings produce
          // identical edges rather than merely similar ones.
          const constructor = n.namedChild(0)
          if (constructor) this.pushInstantiation(constructor, n, callSource, relationships)
        } else {
          // ── JSX IS A `renders` RELATIONSHIP ────────────────────────────────────────────────
          // A component rendered in a template is not a name MENTIONED in a body; the owner
          // admitted `renders` (src/ast/types.ts) because `uses` could not say which of the two
          // it was. The relabel is 1:1 by construction: same enclosing-symbol source, same
          // component target, same line, same capitalized-name rule (`Foo`, `Foo.Bar` via
          // nested_identifier), same one-row-per-element rule.
          //
          // ONE ROW PER JSX ELEMENT, NOT ONE PER OPENING TAG: `jsx_element` is visited once and
          // its OPENING element is read for the name; the opening node itself never matches this
          // branch (`jsx_self_closing_element` / `jsx_element` are the two matched types), so
          // `<Foo>…</Foo>` emits exactly one row and `<Foo/>` exactly one.
          //
          // WHAT DOES NOT FIRE, each for its own reason: a lowercase intrinsic tag (`<div>`) is
          // an HTML element, not a component — the capitalization test is the language's own
          // component convention; a fragment (`<>…</>`) has no opening identifier to name; a
          // `React.createElement(Foo, …)` call is a CALL of `createElement` with `Foo` as an
          // argument, so it stays a `calls` row (and `Foo` is reached, if at all, by the
          // ordinary argument walk) — it is not a rendered element in the syntax.
          const opening = n.type === "jsx_self_closing_element" ? n : n.namedChild(0)
          if (opening && (opening.type === "jsx_self_closing_element" || opening.type === "jsx_opening_element")) {
            const identifier = opening.namedChild(0)
            if (identifier && (identifier.type === "identifier" || identifier.type === "nested_identifier")) {
              const char = identifier.text[0]
              // Only components (capitalized)
              if (char && char === char.toUpperCase() && char !== char.toLowerCase()) {
                relationships.push({
                  source: callSource.name,
                  target: identifier.text,
                  type: ASTEngine.RelationshipType.Renders,
                  confidence: 0.9,
                  ...this.lineField(identifier),
                  metadata: {
                    // The pre-relabel key is KEPT: a consumer written against the old row should
                    // not have to learn a second metadata spelling for the same fact.
                    jsxElement: identifier.text,
                    line: n.startPosition.row + 1,
                  } as any,
                })
              }
            }
          }
        }
      }

      // Recurse (avoid descending into nested functions for call context)
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          processNode(child, currentSymbol, this.nextDecoratorFlag(n, ancestorInDecorator))
        }
      }
    }

    processNode(node, null, false)
  }

  private extractUsageRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    // The usage pass only links usages to KNOWN project symbols. This map
    // was previously declared but never populated, making every References/
    // type-Uses/JSX-Instantiates edge structurally impossible.
    const symbolNames: Record<string, boolean> = {}
    for (const s of symbols) symbolNames[s.name] = true
    const processed: Record<string, boolean> = {}

    // M14 #419 T6 / M37 TSD2: function-local bindings shadow same-named
    // symbols. The binding names are collected per enclosing function (a
    // fresh set on function/method entry, so sibling functions never
    // suppress each other); an identifier reference to a shadowed name is a
    // local usage, never a cross-symbol reference (const { name } = u in
    // main must not emit main --references--> the User.name property, and a
    // plain `const name = ...` must not either — pre-fix the declaration-skip
    // compared web-tree-sitter node OBJECTS (fresh per access), never
    // matched, and the template pass read the local as a symbol usage).
    /**
     * The names a symbol's PARAMETERS bind, read off the symbol's `parameters`
     * payload. That payload stringifies each binding as text — `a`, `{b}`,
     * `...rest` — so the identifier runs are pulled out with plain string
     * splitting rather than a pattern. Destructuring and rest parameters are
     * included because they bind names too.
     */
    const parameterNamesOf = (sym: ASTEngine.UniversalSymbol | null): Set<string> => {
      const out = new Set<string>()
      for (const prm of sym?.parameters ?? []) {
        const raw = typeof prm === "string" ? prm : ((prm as any)?.name ?? "")
        let token = ""
        for (let i = 0; i <= raw.length; i++) {
          const ch = raw[i] ?? ""
          const isWord = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$"
          if (isWord) token += ch
          else {
            if (token) out.add(token)
            token = ""
          }
        }
      }
      return out
    }
    const collectPatternNames = (pat: Node): string[] => {
      const out: string[] = []
      const walk = (p: Node): void => {
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (!c) continue
          if (c.type === "identifier" || c.type === "shorthand_property_identifier" || c.type === "shorthand_property_identifier_pattern" || c.type === "property_identifier") {
            out.push(c.text)
          } else if (c.type === "object_pattern" || c.type === "array_pattern" || c.type === "pair_pattern" || c.type === "assignment_pattern" || c.type === "rest_pattern" || c.type === "object" || c.type === "array") {
            walk(c)
          }
        }
      }
      walk(pat)
      return out
    }
    const processNode = (n: Node, currentSymbol: ASTEngine.UniversalSymbol | null, locals: Set<string>, refShadowed: Set<string>): void => {
      const prevSymbol = currentSymbol
      currentSymbol = this.resolveRelationshipSymbol(n, symbols, currentSymbol)
      // M59 (#861): the usage/reference pass is the one that produced the
      // duplicate `references Service -> inject` beside the member-scoped
      // decorator reference. Same rule as the call pass: decorator position is
      // metadata, not a usage by the enclosing scope.
      if (this.inDecoratorPosition(n)) return

      // TSD2: fresh locals set per function/method scope. resolveRelationship
      // Symbol rebinds ONLY on function-like nodes, so a symbol change here
      // means we just entered one; siblings restore their own set via the
      // parameter (automatic on recursion return).
      if (currentSymbol && currentSymbol !== prevSymbol && (currentSymbol.kind === ASTEngine.SymbolKind.Function || currentSymbol.kind === ASTEngine.SymbolKind.Method)) {
        // LEXICAL SCOPE IS INHERITED, NOT RESET — a nested function reads its ENCLOSING function's
        // locals, so those names must stay shadowed inside it. The first version reset both sets,
        // and a nested `compileCode` read of the enclosing handler's `let lastSuccessfulCode`
        // published a name-resolved `references` edge to a name that is not a file declaration at
        // all (the differential classified it UNEXPLAINED, 196 rows over two draws). The enclosing
        // PARAMETERS are carried into `refShadowed` for the same reason; they are deliberately not
        // put in `locals`, because the template-interpolation emitter WANTS `uses` edges to
        // parameters (interp-uses pins `greet -> name`).
        locals = new Set(locals)
        refShadowed = new Set(refShadowed)
        for (const b of parameterNamesOf(prevSymbol)) refShadowed.add(b)
      }

      // M14 #419 T6: record destructuring bindings (object_pattern /
      // array_pattern / rest_pattern in variable_declarator name position)
      // so later identifier usages of the same name resolve as locals.
      if ((n.type === "object_pattern" || n.type === "array_pattern" || n.type === "rest_pattern") && currentSymbol && (currentSymbol.kind === ASTEngine.SymbolKind.Function || currentSymbol.kind === ASTEngine.SymbolKind.Method)) {
        // ONLY inside a function body. Module/class-level destructuring
        // produces real symbols (extractDestructuringPattern), and references
        // to those from elsewhere must keep resolving to the symbol.
        for (const b of collectPatternNames(n)) locals.add(b)
      }
      // `const name = ...` inside a function must not resolve later reads to
      // a same-named module symbol. Only inside function/method scope:
      // module/class-level declarators ARE symbols.
      if (n.type === "variable_declarator" && currentSymbol && (currentSymbol.kind === ASTEngine.SymbolKind.Function || currentSymbol.kind === ASTEngine.SymbolKind.Method)) {
        const nameNode = n.childForFieldName("name")
        if (nameNode) {
          if (nameNode.type === "identifier") locals.add(nameNode.text)
          else {
            for (const b of collectPatternNames(nameNode)) locals.add(b)
          }
        }
      }

      // R13: a `for (const x of xs)` / `for (let k in o)` loop variable and a
      // `catch (e)` binding shadow a same-named file-level symbol, and the
      // reference pass resolved reads of them to that symbol — so a function
      // iterating a list of `file` published `references audit->file` against an
      // unrelated module-level `function file()`. Neither binding is reachable
      // through the `variable_declarator` handler above: tree-sitter places the
      // loop variable as a DIRECT child of `for_in_statement` (a for-of/for-in
      // head contains no `variable_declarator` node at all), and a catch binding
      // hangs off `catch_clause`.
      //
      // WHY THIS IS A SEPARATE SET and not `locals`: `locals` also gates the
      // `uses` edge, and a `uses` edge to a loop variable or catch binding is
      // wanted — the graph records `` `${e}` `` inside a catch as a use of
      // `e`, exactly as R12 keeps `greet -> name` for a parameter. Seeding
      // `locals` with these names removed 891 `uses` edges over 1200 files with
      // zero additions, which is the same over-suppression that mistake already
      // made once in R12. `refShadowed` is read by the `references` guard alone,
      // where the question is only "does this name resolve to a declaration here".
      if (currentSymbol && (currentSymbol.kind === ASTEngine.SymbolKind.Function || currentSymbol.kind === ASTEngine.SymbolKind.Method)) {
        if (n.type === "for_in_statement") {
          // The loop variable is the first named child: a bare `identifier`, or
          // a pattern node (patterns are already covered by the
          // object_pattern/array_pattern handler above, so only the bare form
          // is new here — which is why `for (const { a } of xs)` was already
          // right while `for (const file of xs)` was not).
          const lhs = n.namedChild(0)
          if (lhs && lhs.type === "identifier") refShadowed.add(lhs.text)
        }
        if (n.type === "catch_clause") {
          // The binding is the first named child ONLY when there is one; a bare
          // `catch { … }` has `statement_block` first and binds nothing,
          // and a read there genuinely does reach the outer declaration.
          const binding = n.namedChild(0)
          if (binding && binding.type === "identifier") refShadowed.add(binding.text)
        }
      }

      // R14: an ARROW FUNCTION's or FUNCTION EXPRESSION's parameters shadow, and
      // nothing covered them. R12 covered a named function's parameters via
      // `parameterNamesOf(currentSymbol)`; R13 covered loop variables and catch
      // bindings. This is the third binding form, and it fell through both for a
      // structural reason: an arrow is not a named declaration, so
      // `resolveRelationshipSymbol` never rebinds on it and the enclosing
      // function stays the current symbol — whose parameter list is a different
      // one. `function f(bbEntry: string) { return (root) => root() }` published
      // `f->root` against a module-level `function root()`, because `root` binds
      // the arrow and the shadow set was built from `f`'s parameters, which are
      // `bbEntry`.
      //
      // Measured: 227 false `references` over 1000 tracked files across 66 of
      // them, the largest of the three shadowing defects, led by the names that
      // collide most — `root`, `env`, `c`, `e`, `name`, `file`, `kind`.
      //
      // The bindings go into `refShadowed` and NOT `locals`, for the reason R13
      // established: `locals` also gates `uses`, and a use of an arrow's
      // parameter is a real use. A fresh set is built rather than adding to the
      // caller's, so the parameters shadow inside the arrow's own extent and
      // nowhere else — an arrow that shadows `root` does not make a later
      // `root()` in the enclosing function a local read.
      if (currentSymbol && currentSymbol === prevSymbol && (n.type === "arrow_function" || n.type === "function_expression" || n.type === "generator_function")) {
        const params = n.childForFieldName("parameters")
        if (params) {
          const scoped = new Set(refShadowed)
          for (const p of params.namedChildren) {
            // `required_parameter` / `optional_parameter` hold the binding in
            // their `pattern` field; a bare `identifier` parameter is its own
            // name. Destructuring and rest parameters are already covered by the
            // pattern handler above, and re-adding them is harmless.
            if (!p) continue
            const pattern = p.childForFieldName("pattern") ?? (p.type === "identifier" ? p : null)
            if (pattern && pattern.type === "identifier") scoped.add(pattern.text)
          }
          refShadowed = scoped
        }
      }

      // JSX component usage detection
      if ((n.type === "jsx_element" || n.type === "jsx_self_closing_element") && currentSymbol) {
        const opening = n.type === "jsx_element" ? n.namedChild(0) : n
        const id = opening?.namedChild(0)
        if (id) {
          const tag = id.text
          const name = tag.indexOf(".") !== -1 ? tag.split(".").pop() || tag : tag
          const isUpper = name.length > 1 && name[0] === name[0].toUpperCase()
          if (isUpper && name !== currentSymbol.name) {
            const known = !!symbolNames[name]
            if (known) {
              const key = `${currentSymbol.name}:${name}:jsx`
              if (!!!processed[key]) {
                processed[key] = true
                relationships.push({
                  source: currentSymbol.name,
                  target: name,
                  type: ASTEngine.RelationshipType.Instantiates,
                  confidence: 0.95,
                  ...this.lineField(id),
                  metadata: {
                    isJsxComponent: true,
                    jsxTag: tag,
                    line: n.startPosition.row + 1,
                  },
                })
              }
            }
          }
        }
      }

      // Check identifiers that reference other symbols
      // (template substitutions are owned by the template walk above —
      // letting both walks emit produced Uses+References for one read).
      if (n.type === "identifier" && currentSymbol) {
        let inTemplate = false
        for (let tp = n.parent; tp; tp = tp.parent) {
          if (tp.type === "template_substitution") { inTemplate = true; break }
          if (tp.type === "function_declaration" || tp.type === "method_definition" ||
              tp.type === "arrow_function" || tp.type === "function_expression" ||
              tp.type === "class_declaration") break
        }
        if (!inTemplate) {
        const name = n.text

        // Skip if this is a declaration, not a usage. web-tree-sitter hands
        // out FRESH wrapper objects per access — compare by id, never by
        // reference (the JS J4 quirk; the old `nameField === n` never
        // matched, so declarations leaked through as references).
        const parent = n.parent
        if (
          parent &&
          (parent.type === "variable_declarator" ||
            parent.type === "function_declaration" ||
            parent.type === "class_declaration" ||
            parent.type === "method_definition")
        ) {
          const nameField = parent.childForFieldName("name")
          if (nameField && nameField.id === n.id) {
            // This is a declaration, not a usage
            for (let i = 0; i < n.namedChildCount; i++) {
              const child = n.namedChild(i)
              if (child) processNode(child, currentSymbol, locals, refShadowed)
            }
            return
          }
        }

        // M14 #419 T6 / M37 TSD2: a name bound by a function-local pattern
        // or plain declarator is a local — the identifier usage refers to
        // the local, never to a same-named module/class symbol.
        // TSD5: an identifier in instanceof-RHS position is a TYPE check —
        // extractDeclaredTypeRefs emits the instanceof_check reference, so
        // a second plain references edge here is double-emission.
        // M14 #858 NOTE: the callee of a wrapped `new` is deliberately NOT
        // suppressed here. The unwrapped control (`new Engine(1)` with Engine a
        // declared symbol) also emits this `references` edge today — measured on
        // the fixture at this commit — and the contract this fix establishes is
        // that the wrapped form is INDISTINGUISHABLE from the unwrapped one. An
        // extra suppression limited to the wrapped spelling would have created
        // the very asymmetry the issue is about. Whether a constructed class
        // name should emit `references` at all is a separate, wider question
        // (the oracle derives only `instantiates` for new_expression) and is
        // filed rather than changed inside this fix.
        const rhsOfTypeCheck =
          n.parent?.type === "binary_expression" &&
          (() => {
            const p2 = n.parent!
            for (let i = 0; i < p2.childCount; i++) {
              const c = p2.child(i)
              if (c && !c.isNamed && c.text === "instanceof") return true
            }
            return false
          })()
        // A PARAMETER shadows every module- and class-level name for the whole
        // body of its function, and this pass resolves by NAME: with an
        // `interface Deps { root }` in the file, `function f(root) { return root
        // }` published `f->root`, recording the function as referencing an
        // interface property it never touches. Measured: 160 of 2,880 references
        // (5.6%) over 700 tracked files, led by `n`, `root`, `name`, `src`.
        //
        // The test belongs HERE and not in `locals`, because `locals` is also
        // what suppresses the `uses` edge — and a `uses` edge to a parameter is
        // wanted (interp-uses pins `greet -> name` for a template interpolation of
        // its own parameter). Seeding `locals` with parameters silenced those and
        // the fixture caught it. So: suppress the NAME-RESOLVED reference only.
        if (locals.has(name) || refShadowed.has(name) || parameterNamesOf(currentSymbol).has(name) || rhsOfTypeCheck) {
          // still recurse into children (e.g. nested member paths)
        } else if (!!symbolNames[name] && name !== currentSymbol.name) {
          const key = `${currentSymbol.name}:${name}`
          if (!!!processed[key]) {
            processed[key] = true

            relationships.push({
              source: currentSymbol.name,
              target: name,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.8,
              ...this.lineField(n),
              metadata: {
                line: n.startPosition.row + 1,
              },
            })
          }
        }
        } // !inTemplate
      }

      // Check type references
      if ((n.type === "type_identifier" || n.type === "generic_type") && currentSymbol) {
        const typeName = n.type === "generic_type" ? n.namedChild(0)?.text : n.text

        if (typeName && !!symbolNames[typeName] && typeName !== currentSymbol.name) {
          const key = `${currentSymbol.name}:${typeName}:type`
          if (!!!processed[key]) {
            processed[key] = true

            relationships.push({
              source: currentSymbol.name,
              target: typeName,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              // A `generic_type` starts at its base name, but the USED name here
              // is that base too — take the base node so a multi-line type
              // argument list cannot pull the line onto a bracket (scala
              // mechanism 2).
              ...this.lineField(n.type === "generic_type" ? (n.namedChild(0) ?? n) : n),
              metadata: {
                isTypeReference: true,
                line: n.startPosition.row + 1,
              },
            })
          }
        }
      }

      // M14 #419 T3: template_literal interpolation — `hi ${name} x${n + 1}`
      // reads name and n inside the enclosing function. The substituted
      // identifiers are expression usages, so emit Uses on each identifier
      // child of template_substitution — UNLESS the name is bound by a
      // function-local declarator/pattern (TSD2: the interpolation reads the
      // local, not a same-named module symbol).
      if (n.type === "template_substitution" && currentSymbol) {
        // M49 W4 (J6 twin, javascript/j6): a substituted identifier is a READ
        // only when it is not part of a call's callee expression and not an
        // assignment target — the same gates the field-access rule below
        // applies (a callee is covered by `calls`; a receiver belongs to that
        // callee). Pre-fix `${fn(x)}` fabricated `uses fn` and `${obj.m(x)}`
        // fabricated `uses obj`; the javascript twin's five edges were the
        // measured defect, this is the same rule one language over.
        const inCalleeOrWritePosition = (id: Node): boolean => {
          let cur: any = id
          while (cur) {
            const p = cur.parent
            if (!p || p.type === "template_substitution") break
            if (p.type === "call_expression") {
              const fn = p.childForFieldName("function")
              if (fn && fn.startIndex <= id.startIndex && id.endIndex <= fn.endIndex) return true
            }
            if (p.type === "assignment_expression" || p.type === "augmented_assignment_expression") {
              const left = p.childForFieldName("left") ?? p.namedChild(0)
              if (left && left.startIndex <= id.startIndex && id.endIndex <= left.endIndex) return true
            }
            cur = p
          }
          return false
        }
        const sub = (nn: Node): void => {
          for (let i = 0; i < nn.namedChildCount; i++) {
            const c = nn.namedChild(i)
            if (!c) continue
            if (c.type === "identifier" && c.text !== currentSymbol!.name) {
              if (locals.has(c.text)) continue
              if (inCalleeOrWritePosition(c)) continue
              const key = `${currentSymbol!.name}:${c.text}:template`
              if (!processed[key]) {
                processed[key] = true
                relationships.push({
                  source: currentSymbol!.name,
                  target: c.text,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.85,
                  ...this.lineField(c),
                  metadata: {
                    isTemplateInterpolation: true,
                    line: c.startPosition.row + 1,
                  },
                })
              }
            } else if (c.type !== "identifier") {
              sub(c)
            }
          }
        }
        sub(n)
      }

      // M14 #419 T4: field-access Uses — member reads are usages of the
      // accessed member. Skip the member when it is the callee of a call
      // (calls edges cover that — TSD6: the old `=== n` object comparison
      // never matched web-tree-sitter's fresh wrappers, so every method call
      // double-emitted calls + uses), skip JSX element tags, and skip the
      // ASSIGNMENT-LHS span (TSD1, JAD1-class: `this.count = 0` is a write,
      // not a read; augmented `+=` shares the left field).
      if ((n.type === "member_expression" || n.type === "subscript_expression") && currentSymbol) {
        const isCallCallee =
          n.parent?.type === "call_expression" && n.parent.childForFieldName("function")?.id === n.id
        const isOptionalChainRoot = n.parent?.type === "optional_chain"
        const pType = n.parent?.type
        let isWrite = false
        if (pType === "assignment_expression" || pType === "augmented_assignment_expression") {
          const lhs = n.parent!.childForFieldName("left") ?? n.parent!.namedChild(0)
          isWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
        }
        if (!isCallCallee && !isOptionalChainRoot && !isWrite) {
          const prop = n.childForFieldName("property") ?? (n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null)
          if (prop) {
            const name = prop.text
            // M49 W13 fixed a blind spot here: a PRIVATE member read
            // (`this.#count`) emitted nothing while a public one
            // (`this.count`) and a private METHOD call (`this.#step()`) both
            // did — the membership test compared the node's raw text against
            // a symbol set that stored the stripped name, so it was always
            // false. W13 normalized the LOOKUP against the then-stripped
            // symbols; M49 W15 (#813) instead made the SYMBOL carry the
            // declared `#` spelling, so the node's own text is now exactly the
            // symbol key and both sides agree without normalization. The
            // TARGET keeps the `#` spelling, which is what the calls edge
            // already carried (`calls run->#step`) and what the javascript
            // twin emits (`uses Store->#update_version`).
            // #813: symbols now carry the DECLARED `#` spelling, so the
            // membership test uses the node's own text directly (this rule's
            // old `#`-strip normalization existed only because symbols were
            // stored stripped).
            const lookupName = name
            if (!!symbolNames[lookupName] && lookupName !== currentSymbol.name) {
              const key = `${currentSymbol.name}:${name}:field`
              if (!processed[key]) {
                processed[key] = true
                relationships.push({
                  source: currentSymbol.name,
                  target: name,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.85,
                  ...this.lineField(prop),
                  metadata: {
                    isFieldAccess: true,
                    line: prop.startPosition.row + 1,
                  },
                })
              }
            }
          }
        }
      }

      // Recurse
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          processNode(child, currentSymbol, locals, refShadowed)
        }
      }
    }

    processNode(node, null, new Set(), new Set())
  }


  /**
   * M14 #858: emit the instantiation edge for a constructor node. Extracted from
   * the new_expression branch so the wrapped-`new` path (below) and the parser's
   * own new_expression path cannot drift apart — same leaf-identity rule (TSD3),
   * same generic-argument strip, same intrinsic filter.
   */
  private pushInstantiation(
    constructor: Node,
    expressionNode: Node,
    source: { name: string },
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    // X8 (RULED 2026-09-27): construction candidates are NAMEABLE LEAVES only.
    //
    // Without this, an ANONYMOUS constructor publishes a span of SOURCE TEXT as a
    // name. Measured on this analyzer's own output: `new (e.constructor as any)(...)`
    // published `instantiates -> "constructor as any)"`, `new (getCtor())()` published
    // `"(getCtor())"`, and `new (class {})()` published `"(class {})"` — against a
    // correct `new Foo()` -> `Foo` control. A target that is source text names nothing
    // a consumer can navigate to, which is the unresolvable-identity class reached
    // through a malformed CONSTRUCT rather than a missing edge.
    //
    // This went unnoticed because the typescript ORACLE had the identical bug, so the
    // two agreed and the differential reported 100% — the same shared-premise shape as
    // the svelte reserved-namespace finding. Fixing the truth side is what exposed it;
    // see validation/m49/ledger.json SVELTE1/X8 and the D12-era commit.
    //
    // The list is the javascript twin's, which already carries this guard with the
    // comment "deriving their raw expression text fabricated unmatchable oracle edges
    // (lodash corpus)", plus `nested_identifier`, which the TypeScript grammar emits
    // for a qualified name and which excluding would suppress `new ns.Thing()`. Verified
    // by tree-walk over vue-core: the ONLY non-nameable constructor there is
    // `parenthesized_expression`.
    const NAMEABLE_CTOR = new Set([
      "identifier", "member_expression", "nested_identifier", "qualified_identifier",
      "generic_type", "template_type", "type_identifier", "type_descriptor", "primitive_type",
    ])
    if (!NAMEABLE_CTOR.has(constructor.type)) return

    let className = constructor.text

    // Handle generic instantiation: new Map<K, V>()
    if (constructor.type === "generic_type") {
      const typeName = constructor.namedChild(0)
      if (typeName) className = typeName.text
    }
    // TSD3 (leaf identity contract): qualified `new ns.Thing()` — target is the
    // LEAF (Thing), matching the JS analyzer and TS's own member-call reduction;
    // emitting "ns.Thing" fabricated targets no symbol index could join (the
    // import alias is not a type). Also strip generic arguments from member ctors.
    const dot = className.lastIndexOf(".")
    if (dot !== -1 && dot < className.length - 1) className = className.slice(dot + 1)
    const lt = className.indexOf("<")
    if (lt !== -1) className = className.slice(0, lt)

    // Global constructor intrinsics/DOM APIs: `new Promise()` is construction of
    // the RUNTIME, not of a project type — same rationale as the JVM stdlib
    // filters (family parity with JS).
    if (JS_GLOBAL_CONSTRUCTORS.has(className)) return

    relationships.push({
      source: source.name,
      target: className,
      type: ASTEngine.RelationshipType.Instantiates,
      confidence: 1.0,
      // The CLASS NAME node: for `new ns.Thing()` that is the property leaf,
      // since the target is the leaf (TSD3 leaf identity).
      ...this.lineField(constructor.type === "member_expression" ? (constructor.childForFieldName("property") ?? constructor) : constructor),
      metadata: {
        // #873: the site line is the SAME node `lineField` stamps above, in the
        // SAME base — a row must not carry two different sites, let alone two
        // different bases (this one differed by up to 5 rows on element-plus).
        line: (constructor.type === "member_expression" ? (constructor.childForFieldName("property") ?? constructor) : constructor).startPosition.row + 1,
      } as any,
    })
  }

  /**
   * M14 #858: a `new` whose constructor is written on the NEXT line is not a
   * new_expression in the pinned tsx/typescript grammar. Verified on the wasm:
   *
   *   const b = new        lexical_declaration[ ..., identifier("new") ]
   *     Other(2)           expression_statement[ call_expression[ identifier("Other") ] ]
   *
   * The grammar closes the statement at the bare `new`, so the instantiation was
   * silently lost while a `calls` edge AND a bare-identifier `references` edge
   * were fabricated for a class name that is never called as a method. Recognised
   * from the tree rather than heuristically: the call_expression's previous
   * statement sibling must END with a bare `new` identifier written on an
   * earlier line than the call.
   */
  private isWrappedNewConstructor(call: Node): boolean {
    if (call.type !== "call_expression") return false
    const stmt = call.parent
    if (!stmt || stmt.type !== "expression_statement") return false
    const prev = stmt.previousSibling
    if (!prev) return false
    let last: Node | null = prev
    while (last && last.namedChildCount > 0) last = last.namedChild(last.namedChildCount - 1)
    if (!last || last.type !== "identifier" || last.text !== "new") return false
    return last.startPosition.row < call.startPosition.row
  }

  /**
   * A DECORATOR IS A `decorates` RELATIONSHIP — not a `references` row.
   *
   * THE RELABEL, and why it is not cosmetic. `@sealed` on a class is a declaration modifier the
   * JVM/F# family stores as metadata and this lane used to publish as a `references` edge from
   * the decorated symbol to the decorator. A `references` row is a claim that the symbol's body
   * MENTIONS a type/name; a decorator is applied TO the declaration, and the ten stored values
   * had no honest spelling for that. The owner admitted `decorates` (src/ast/types.ts) for it, so
   * the row becomes `Decorates` with the SAME source (the decorated declaration), the SAME target
   * (the decorator's name leaf, `@module.Decorator` -> `Decorator`, from `extractDecoratorName`),
   * the SAME line (the decorator's own line, M59 #860) and the SAME one-row-per-decorator rule.
   *
   * A DECORATOR'S ARGUMENT IS NOT A ROW: `@Get('/path')` publishes `decorates: handler -> Get`
   * only; `/path` is an argument of the decorator, not a declaration the decorator names.
   *
   * NO DOUBLE EMISSION: the call/reference walks skip decorator position (`inDecoratorPosition`),
   * so replacing this type cannot leave the old `references` row behind for the same site — and
   * the `isDecorator` metadata key is kept as the edge's own provenance marker for consumers that
   * were written against the old row.
   *
   * M59 #860: the line travels in metadata.decoratorLines, parallel to symbol.decorators (the
   * same lockstep pattern as extendsLines/implementsLines). A decorator whose line was never
   * recorded stays line-less rather than borrowing the declaration's line — never invent a line
   * (#823).
   */
  private extractDecoratorRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.decorators && symbol.decorators.length > 0) {
        const lines = symbol.metadata?.decoratorLines as Array<number | null> | undefined
        for (let i = 0; i < symbol.decorators.length; i++) {
          const decorator = symbol.decorators[i]
          const line = lines?.[i]
          relationships.push({
            source: symbol.name,
            target: decorator,
            type: ASTEngine.RelationshipType.Decorates,
            confidence: 1.0,
            ...(typeof line === "number" ? { line_number: line } : {}),
            metadata: {
              isDecorator: true,
              decoratorLine: typeof line === "number" ? line : null,
            },
          })
        }
      }
    }
  }

  /**
   * The first symbol with this name satisfying `pred`, in DECLARATION order —
   * `findItem`'s exact contract, answered from the name index when one exists
   * (R2b). One helper for all three call sites that used to be independent
   * linear scans over the whole symbol array: the enclosing-symbol resolver
   * (twice per declaration node, in two passes) and the override-keyword arm
   * (once per `override` member). Repeated names keep first-wins, which is the
   * contract rather than an accident: two classes each declaring `save()`
   * resolve to the same owner the array scan always chose.
   */
  private firstSymbolNamed(
    name: string,
    pred: (s: ASTEngine.UniversalSymbol) => boolean,
    symbols: ASTEngine.UniversalSymbol[],
  ): ASTEngine.UniversalSymbol | undefined {
    const bucket = this._symbolIndex?.get(name)
    if (bucket) {
      for (const s of bucket) if (pred(s)) return s
      return undefined
    }
    // No index (a caller outside the normal phase order): fall back to the
    // array, so resolution can never be WORSE than it was.
    return findItem(symbols, (s) => s.name === name && pred(s))
  }

  private extractOverrideRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.metadata?.isOverride && symbol.ownerName) {
        // Find the parent class
        const parentClass = this.firstSymbolNamed(
          symbol.ownerName,
          (s) => s.kind === ASTEngine.SymbolKind.Class,
          symbols,
        )
        if (parentClass && parentClass.metadata?.extends) {
          const baseClasses = parentClass.metadata.extends as string[]
          for (const baseClass of baseClasses) {
            relationships.push({
              source: `${symbol.ownerName}.${symbol.name}`,
              target: `${baseClass}.${symbol.name}`,
              type: ASTEngine.RelationshipType.Overrides,
              confidence: 0.95,
              // The OVERRIDING declaration's own range (M59 #825): the edge names
              // the member, so it takes the member's line, not the class's.
              ...(symbol.range?.startLine ? { line_number: symbol.range.startLine } : {}),
              metadata: {
                baseClass,
              },
            })
          }
        }
      }
    }

    // M49 #759 (svelte-wave verification, Spring.subscribe -> Readable.subscribe):
    // interface-heritage member overrides emitted NOTHING — the class pass
    // above requires metadata.isOverride (an `override` keyword concept) and
    // a Class-kind parent, so interface_declaration members were invisible.
    // Structural tier, in-file only, transitive BFS mirroring the oracle's
    // truth walk (deriveTreeEdges depth-10): a member declared in the
    // interface AND anywhere up the heritage chain overrides. Honest
    // abstention: if the interface overloads a name (same name declared
    // twice), no pairing — the oracle's signature gate would decide and the
    // analyzer carries no textual-signature truth.
    const ifaceMembers = new Map<string, ASTEngine.UniversalSymbol[]>()
    const ifaceByName = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Interface) ifaceByName.set(s.name, s)
      if (s.ownerKind === ASTEngine.SymbolKind.Interface &&
          (s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Property)) {
        const list = ifaceMembers.get(s.ownerName!) ?? []
        list.push(s)
        ifaceMembers.set(s.ownerName!, list)
      }
    }
    for (const iface of symbols) {
      if (iface.kind !== ASTEngine.SymbolKind.Interface) continue
      const bases = iface.metadata?.extends as string[] | undefined
      if (!bases || bases.length === 0) continue
      const members = ifaceMembers.get(iface.name) ?? []
      if (members.length === 0) continue
      // Overload abstention: a name declared twice in this interface cannot
      // be paired name-only.
      const nameCounts = new Map<string, number>()
      for (const m of members) nameCounts.set(m.name, (nameCounts.get(m.name) ?? 0) + 1)
      const seenBase = new Set<string>()
      const queue: string[] = [...bases]
      let depth = 0
      while (queue.length && depth < 10) {
        depth++
        const base = queue.shift()!
        if (seenBase.has(base)) continue
        seenBase.add(base)
        const baseDecl = ifaceByName.get(base)
        if (!baseDecl) continue // external/unresolved base: the analyzer's job, not in-file truth
        const baseMembers = ifaceMembers.get(base) ?? []
        for (const m of members) {
          if ((nameCounts.get(m.name) ?? 0) > 1) continue
          if (baseMembers.some((bm) => bm.name === m.name)) {
            relationships.push({
              source: `${iface.name}.${m.name}`,
              target: `${base}.${m.name}`,
              type: ASTEngine.RelationshipType.Overrides,
              confidence: 0.95,
              // The redeclaring member's own line (M59 #825), from its symbol
              // range rather than the interface's.
              ...(m.range?.startLine ? { line_number: m.range.startLine } : {}),
              metadata: {
                baseInterface: base,
              },
            })
          }
        }
        const baseBases = baseDecl.metadata?.extends as string[] | undefined
        if (baseBases) queue.push(...baseBases)
      }
    }

    // M49 W22 (rotation-found, vue-core `packages/reactivity/src/effect.ts`):
    // a CLASS implementing an in-file INTERFACE emitted no override for the
    // members it supplies, so `ReactiveEffect.notify -> Subscriber.notify` was
    // permanently MISSING. The contract is the one java already carries
    // (clojure `TransformerIterator`: `Empty.add -> Buffer.add`, probe-verified)
    // and the one the oracle derives generically — `declParents` takes
    // `extends` AND `implements` edges whose target resolves in-file, which is
    // why java's lane reads 0 missing while typescript's carried this gap.
    //
    // Lockstep with the oracle's member set, deliberately asymmetric:
    //   - the CLASS side is METHODS only. A class field is
    //     `public_field_definition`, which the oracle excludes by name so truth
    //     cannot outrun the analyzer (`property_signature` is an INTERFACE
    //     member and stays in, because the analyzer's interface-heritage arm
    //     does emit those);
    //   - the BASE side is the interface's methods and properties, walked
    //     transitively along `extends` (depth 10, mirroring the oracle's
    //     declParents walk and this method's interface arm above);
    //   - abstention matches the arm above: an overloaded name on either side
    //     cannot be paired name-only, because the analyzer carries no textual
    //     signature truth — the oracle's `sigCompatible` gate would decide.
    //   - the base name is used VERBATIM (metadata.implements is what emits the
    //     `implements` edge the oracle reads). A qualified or generic target is
    //     therefore unresolved on both sides, which is what lockstep means.
    const classMethods = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of symbols) {
      if (s.ownerKind === ASTEngine.SymbolKind.Class &&
          s.kind === ASTEngine.SymbolKind.Method && s.ownerName) {
        const list = classMethods.get(s.ownerName) ?? []
        list.push(s)
        classMethods.set(s.ownerName, list)
      }
    }
    const seenOverride = new Set<string>(
      relationships
        .filter((r) => r.type === ASTEngine.RelationshipType.Overrides)
        .map((r) => `${r.source}\u0000${r.target}`),
    )
    // M1: the same structural arm now walks a class's EXTENDS bases too, not
    // only its `implements`. `override` is OPTIONAL in TypeScript (it is only
    // required under `noImplicitOverride`), so the keyword arm above fires for
    // a minority of real overrides: `class Sub extends Base { run() {} }`
    // emitted nothing, while the identical member under `implements` paired.
    // The oracle already derives these as truth — `declParents` takes `extends`
    // AND `implements` edges whose target resolves in-file
    // (script/m14/differential.ts:12469) — so this was a live MISSING, proven
    // by running the oracle on the shape: truth `Sub.run -> Base.run`,
    // analyzer nothing.
    //
    // Lockstep rules, unchanged from the implements arm:
    //   - the CLASS side is METHODS only (a class field is
    //     `public_field_definition`, which the oracle excludes by name so truth
    //     cannot outrun the analyzer);
    //   - the BASE side is an interface's methods+properties, or a base CLASS's
    //     methods — the same member sets the oracle pools per declaration;
    //   - abstention: an overloaded name on either side cannot be paired
    //     name-only (no textual signature truth here; the oracle's
    //     `sigCompatible` gate would decide);
    //   - a base that resolves to no in-file declaration abstains, which is
    //     also how a QUALIFIED base (`extends ns.Base`) abstains — the oracle
    //     skips dotted declParents for the same reason;
    //   - a keyword-emitted edge is never duplicated (seenOverride is seeded
    //     from the edges already pushed).
    const classByName = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Class) classByName.set(s.name, s)
    }
    for (const cls of symbols) {
      if (cls.kind !== ASTEngine.SymbolKind.Class) continue
      const implemented = (cls.metadata?.implements as string[] | undefined) ?? []
      const extended = (cls.metadata?.extends as string[] | undefined) ?? []
      const bases = [...implemented, ...extended]
      if (bases.length === 0) continue
      const members = classMethods.get(cls.name) ?? []
      if (members.length === 0) continue
      const memberCounts = new Map<string, number>()
      for (const m of members) memberCounts.set(m.name, (memberCounts.get(m.name) ?? 0) + 1)
      const seenBase = new Set<string>()
      const queue: string[] = [...bases]
      let depth = 0
      while (queue.length && depth < 10) {
        depth++
        const base = queue.shift()!
        if (seenBase.has(base) || base === cls.name) continue
        seenBase.add(base)
        const ifaceDecl = ifaceByName.get(base)
        const classDecl = classByName.get(base)
        const baseDecl = ifaceDecl ?? classDecl
        if (!baseDecl) continue // external/unresolved base: not in-file truth
        const isInterfaceBase = ifaceDecl !== undefined && classDecl === undefined
        const baseMembers = isInterfaceBase ? (ifaceMembers.get(base) ?? []) : (classMethods.get(base) ?? [])
        for (const m of members) {
          if ((memberCounts.get(m.name) ?? 0) > 1) continue
          const matching = baseMembers.filter((bm) => bm.name === m.name)
          // Overload abstention on the base side too: two declarations of the
          // name in the base cannot be paired name-only.
          if (matching.length !== 1) continue
          const key = `${cls.name}.${m.name}\u0000${base}.${m.name}`
          if (seenOverride.has(key)) continue
          seenOverride.add(key)
          relationships.push({
            source: `${cls.name}.${m.name}`,
            target: `${base}.${m.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.95,
            // The IMPLEMENTING member's own line (M59 #825): the edge names the
            // member, so it takes the member's line, not the class's.
            ...(m.range?.startLine ? { line_number: m.range.startLine } : {}),
            metadata: isInterfaceBase ? { implementedInterface: base } : { extendedClass: base },
          })
        }
        // transitive: an interface base continues along `extends`; a class base
        // along ITS extends/implements — the same links the oracle's declParents
        // pools for that declaration.
        const baseExtends = baseDecl.metadata?.extends as string[] | undefined
        if (baseExtends) queue.push(...baseExtends)
        const baseImplements = baseDecl.metadata?.implements as string[] | undefined
        if (baseImplements) queue.push(...baseImplements)
      }
    }
  }


  /**
   * M49 dup-key ruling (Option A — #746): object-literal members collapse
   * last-wins. JS executes the LAST same-key declaration; the TS analyzer
   * must match (web-family contract: same shape, same graph regardless of
   * file extension). Slot model mirrors the JS analyzer's ruled
   * accessor-slot-semantics contract exactly:
   *   - get/set accessor members occupy kind-keyed slots (`x#get`, `x#set`)
   *     and COEXIST (B5 family contract);
   *   - a later PLAIN member (method or data pair) takes the plain slot and
   *     KILLS all accessor slots of that name (data replaces the descriptor);
   *   - class bodies are OVERLOAD territory — never collapsed (this pass
   *     only descends `object` nodes).
   * Dead members are spliced from the symbols array (before the symbol map
   * build); the dead-span list is RETURNED so phantom calls/uses emitted in
   * later phases can be dropped by a post-walk filter
   * (filterPhantomDupKeyEdges) — the calls/uses phases run AFTER this pass,
   * so filtering here would see an empty relationship array.
   */
  private collapseDuplicateObjectMembers(
    rootNode: Node,
    symbols: ASTEngine.UniversalSymbol[],
  ): { name: string; startRow: number; endRow: number; startCol: number; endCol: number }[] {
    type Dead = { name: string; startRow: number; endRow: number; startCol: number; endCol: number }
    const dead: Dead[] = []
    const accessorKind = (m: Node): "get" | "set" | undefined => {
      for (let i = 0; i < m.childCount; i++) {
        const c = m.child(i)
        if (c && !c.isNamed && (c.text === "get" || c.text === "set")) return c.text as "get" | "set"
      }
      for (let i = 0; i < m.namedChildCount; i++) {
        const c = m.namedChild(i)
        if (c && (c.type === "get" || c.type === "set")) return c.type as "get" | "set"
      }
      return undefined
    }
    const visit = (n: Node): void => {
      if (n.type === "object") {
        const slots = new Map<string, { node: Node; plain: boolean; name: string }>()
        for (let i = 0; i < n.namedChildCount; i++) {
          const m = n.namedChild(i)
          if (!m || (m.type !== "method_definition" && m.type !== "pair")) continue
          const raw = m.childForFieldName("name")?.text ?? m.childForFieldName("key")?.text
          if (!raw) continue
          const acc = m.type === "method_definition" ? accessorKind(m) : undefined
          const slot = acc ? `${raw}#${acc}` : raw
          const prev = slots.get(slot)
          if (prev) {
            // Later same-slot declaration wins; earlier one dies.
            dead.push({ name: prev.name, startRow: prev.node.startPosition.row, endRow: prev.node.endPosition.row, startCol: prev.node.startPosition.column, endCol: prev.node.endPosition.column })
          }
          slots.set(slot, { node: m, plain: !acc, name: raw })
          // A plain member replaces the whole descriptor: kill accessor
          // halves of the same name regardless of position order.
          if (!acc) {
            for (const kind of ["get", "set"] as const) {
              const half = slots.get(`${raw}#${kind}`)
              if (half) {
                dead.push({ name: half.name, startRow: half.node.startPosition.row, endRow: half.node.endPosition.row, startCol: half.node.startPosition.column, endCol: half.node.endPosition.column })
                slots.delete(`${raw}#${kind}`)
              }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(rootNode)
    if (dead.length === 0) return []

    // Splice dead member symbols (positional match on 1-based range).
    for (let i = symbols.length - 1; i >= 0; i--) {
      const s = symbols[i]
      if (!s.range) continue
      const dl = dead.find(
        (d) =>
          d.name === s.name &&
          s.range.startLine === d.startRow + 1 &&
          s.range.startColumn === d.startCol + 1,
      )
      if (dl) symbols.splice(i, 1)
    }
    return dead
  }

  /**
   * M49 dup-key ruling (#746) post-walk half: drop phantom edges sourced
   * from a collapsed (dead) object member's body. Calls/uses/references
   * carry metadata.line — the site row, 1-based and equal to the row's own
   * `line_number` since #873 (it used to be a 0-based `startPosition.row`, so
   * the same row carried two bases); an edge whose source is
   * the dead member's name AND whose site lies inside the dead span
   * belonged to the body runtime never executes.
   */
  private filterPhantomDupKeyEdges(
    relationships: ASTEngine.UniversalRelationship[],
    dead: { name: string; startRow: number; endRow: number; startCol: number; endCol: number }[],
  ): void {
    if (dead.length === 0) return
    // #873: `dead[*].startRow/endRow` are 0-based rows; `metadata.line` is now
    // 1-based (the same base as `line_number`), so the span comparison moves with
    // it. Comparing a 1-based site against 0-based bounds would silently widen the
    // dead span by a line at each end.
    const inDead = (name: string, line: unknown): boolean => {
      if (typeof line !== "number") return false
      return dead.some((d) => d.name === name && line >= d.startRow + 1 && line <= d.endRow + 1)
    }
    const kept = relationships.filter((r) => {
      const meta = r.metadata as { line?: unknown } | undefined
      if (!meta || typeof meta.line !== "number" || typeof r.source !== "string") return true
      return !inDead(r.source, meta.line)
    })
    relationships.length = 0
    relationships.push(...kept)
  }

  private extractImportRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    if (node.type === "import_statement") {
      const sourceNode = importStatementSource(node)
      if (!sourceNode) return

      const modulePath = stringContent(sourceNode)
      // `import type { T } from "m"` names a dependency the COMPILER erases.
      // The edge was already emitted (the specifiers are read either way), so
      // this adds no edge and removes none; it records which of the two kinds
      // this is, so a consumer reading the graph can tell a type dependency from
      // a runtime one instead of inferring it. Measured before the change: 271
      // of 271 element-plus files with a type-only import emitted an edge and 0
      // of those edges carried any type-only marker.
      const typeOnly = isTypeOnlyImport(node)
      if (isImportRequireClause(node)) {
        const clauseNode = node.namedChildren.find((c: any) => c && c.type === "import_require_clause")
        const bindNode = clauseNode?.namedChildren?.find((c: any) => c && c.type === "identifier")
        // ── THE MODULE-DEPENDENCY CLASS (`*`: require clause, side-effect, namespace, dynamic) ──
        // These edges name a MODULE, not a symbol, and the old spelling `${modulePath}:*` used a
        // COLON: the resolver's key space is `name + qualifiedName`, so a target carrying `:` could
        // never match, and it is not the family's binding spelling either. Measured on the cap-50
        // stride: imports 669 edges / 0 resolved / 0 bindOK (369 of the 669 were this class).
        // The family mechanism for "this edge names a local binding, not a declaration" is
        // `<scope>\u0000<binding>` (BINDING_SEP, src/ast/types.ts) and the gate has the bucket
        // (`bindOK`, verified by incoming-rule.verifyBindingClaim: a non-empty part after the
        // separator verifies). The binding part here is `*` — the whole-module binding — which can
        // never name a declaration, so the claim is unrefutable BY CONSTRUCTION.
        //
        // WHAT THIS DOES NOT DO: package imports (`vue:cloneVNode`, `@scope/pkg:Name`) stay
        // unresolved. Their correct fix is `AnalyzeContext.projectIndex` (resolve the specifier to
        // its project file, then the name to that file's declaration); a bare-name spelling was
        // measured to bind to a project-local symbol that merely SHARES THE NAME (432 ts + 276 js
        // + 5 py external items, recorded at the `bareLocalItem` comment below) — a false binding
        // is worse than an unresolved edge. projectIndex is LEAD-SCOPED separately.
        relationships.push({
          source: this.moduleLeafName(),
          target: `${this.moduleLeafName()}${BINDING_SEP}${modulePath}:*`,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          ...this.lineField(bindNode ?? sourceNode),
          metadata: {
            module: modulePath, isRequire: true, isDefault: !!bindNode, isTypeOnly: typeOnly, localBinding: true,
            ...(bindNode ? { alias: bindNode.text } : {}),
          },
        })
        return
      }
      const items = extractImportItemsWithNodes(node)

      // A SIDE-EFFECT-ONLY import — `import './style.css'` — has no clause and so
      // contributes no items, and the loop below emitted nothing for it. That is a
      // dependency the file plainly has: element-plus's every component does
      // `import '@element-plus/theme-chalk/src/<name>.scss'` and
      // `import '@element-plus/components/<name>/style'`, and none of them were in
      // the graph, so the style half of every component was invisible. Found by
      // the lane's new `imports` oracle, which derived 12 such rows against an
      // analyzer that published none on a 152-file draw while agreeing on 1,201 of
      // 1,201 named rows.
      //
      // The distinction is `import_clause` ABSENT, not "no items": `import {} from
      // "m"` names a module too, but it is an empty binding list rather than a
      // dependency on the module for its side effects, and only the absent clause
      // says the latter. The target is `*`, the same whole-module shape a namespace
      // import and a `require` publish, because nothing was asked for by name.
      const hasClause = node.namedChildren.some((c: any) => c && c.type === "import_clause")
      if (!hasClause) {
        relationships.push({
          source: this.moduleLeafName(),
          // the module-dependency class — binding spelling, reason at the require-clause site above
          target: `${this.moduleLeafName()}${BINDING_SEP}${modulePath}:*`,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          ...this.lineField(sourceNode),
          metadata: { module: modulePath, isSideEffectImport: true, isTypeOnly: typeOnly, localBinding: true },
        })
        return
      }

      // Create import relationships (leaf identity: source is the module leaf)
      for (const { item, node: itemNode, typeOnly: itemTypeOnlyFlag } of items) {
        const itemName = item.split(" as ")[0].replace("* as ", "")
        // Statement-level `import type` erases everything it names, so it wins;
        // otherwise the INLINE `type` modifier on this specifier decides, and a
        // specifier with neither is a runtime dependency.
        const itemTypeOnly = typeOnly || itemTypeOnlyFlag

        // THE BARE ITEM NAME, FOR A LOCAL MODULE ONLY. THREE lanes emit `<module>:<item>` — this one,
        // javascript and python — and a
        // colon makes the target path-like to the gate's `pathLikeTarget` AND is refused by
        // `_i13_pick`'s own predicate (`instr(target_external,':') = 0`, parallel-indexer.ts:4484)
        // — two independent refusals, measured: `imports` resolved 0 with 0 ambiguous in every lane.
        // The edge's target is the SYMBOL it refers to; the module is already in `metadata.module`.
        //
        // NOT JAVA, and the count was corrected here after being written wrong: `real-java-analyzer.ts`
        // emits `target: moduleName` with no colon at all (`:600`, `:658`), and `grails-core` measures
        // 0 colon edges across 1,942 java files — java's `imports` zero has a different cause and must
        // not be priced with this change.
        //
        // LOCAL ONLY, and the restriction is the difference between a fix and a defect: measured on
        // the recorded ceiling, 432 (ts) + 276 (js) + 5 (py) EXTERNAL items would resolve to a
        // project-local symbol that merely SHARES THE NAME — a false binding, not a fix. A relative
        // (`./`, `../`) or absolute specifier is local by the grammar of the source itself; anything
        // else keeps its current spelling untouched, which is what makes the external half provably
        // unmoved.
        const bareLocalItem = (modulePath.startsWith(".") || modulePath.startsWith("/")) && itemName !== "" && itemName !== "*"
        // A NAMESPACE import (`import * as ns from "m"`) is the module-dependency class: the written
        // binding is the whole module, so it takes the binding spelling, not `${modulePath}:*`.
        const wholeModuleBinding = itemName === "*"
        relationships.push({
          source: this.moduleLeafName(),
          target: wholeModuleBinding
            ? `${this.moduleLeafName()}${BINDING_SEP}${modulePath}:*`
            : bareLocalItem ? itemName : `${modulePath}:${itemName}`,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          // M59 (#825): the imported NAME's own line, not the `import` line.
          ...this.lineField(itemNode),
          metadata: {
            module: modulePath,
            ...(wholeModuleBinding ? { localBinding: true } : {}),
            alias: item.indexOf(" as ") !== -1 ? item.split(" as ")[1] : undefined,
            isTypeOnly: itemTypeOnly,
          },
        })
      }
      return
    }

    // ── RE-EXPORTS ARE MODULE DEPENDENCIES ──────────────────────────────────────────────────────
    // `export { a } from "./m"`, `export * from "./m"` and `export * as ns from "./m"` cannot be
    // evaluated without `./m`: a barrel file re-exporting forty modules depends on forty. The
    // dependency was recorded only in ParseResult.imports (the brain_import table) and NEVER as a
    // relationship (the graph bb_graph/bb_impact/bb_migrate read), so a barrel appeared to depend
    // on nothing. Fixture `re-export-module-dependency` (authored before this emission) pins the
    // exact contract, including three refusals that are decisions rather than omissions:
    //   * `export * from` publishes the DEPENDENCY (whole-module binding spelling) but NO exports
    //     edge: `*` names no symbol, the X8/R7 unresolvable-endpoint class.
    //   * `export {} from` publishes NOTHING — an empty binding list asserts nothing about the
    //     module's evaluation, unlike a bare `import "./x"` (side effects ARE asserted there).
    //   * the dependency item is the name ASKED FOR (`beta`), never the published alias
    //     (`renamedBeta`): an alias is what THIS file calls it; asking another module for its own
    //     alias asks it for a name it does not export.
    if (node.type === "export_statement") {
      let sourceNode: Node | null = null
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "string") { sourceNode = c; break }
      }
      // NOT A RE-EXPORT (e.g. `export function f() {...}`) FALLS THROUGH: the subtree can carry
      // dynamic `import(...)` calls, which the dynamic-import branch below must still see. An
      // early return here silently deleted those edges — caught by the lane's own
      // `imports-computed-specifier` fixture, whose literal-template rows vanished while every
      // other row in the file stayed green.
      if (sourceNode) {
      const modulePath = stringContent(sourceNode)
      if (modulePath.length === 0) return
      const typeOnlyReExport = isTypeOnlyExport(node)
      const localModule = modulePath.startsWith(".") || modulePath.startsWith("/")
      const exportClause = node.namedChildren.find((c: any) => c && c.type === "export_clause")
      if (exportClause) {
        // An EMPTY clause is a refusal, not an omission — see the fixture's forbid row.
        const specifiers = (exportClause.namedChildren ?? []).filter((c: any) => c && c.type === "export_specifier")
        if (specifiers.length === 0) return
        for (const spec of specifiers) {
          // NARROW THE NULLABLE ELEMENT. `namedChildren` is `(Node | null)[]`, and the filter that
          // builds `specifiers` narrows only inside its predicate — so every dereference here was a
          // TS18047 under the project's strict null checks (measured: 6 errors, whole-project tsc).
          if (!spec) continue
          const nameNode = spec.childForFieldName("name") ?? spec.namedChild(0)
          const aliasNode = spec.childForFieldName("alias") ?? (spec.namedChildCount > 1 ? spec.namedChild(spec.namedChildCount - 1) : null)
          const itemName = nameNode ? nameNode.text : ""
          if (itemName.length === 0) continue
          relationships.push({
            source: this.moduleLeafName(),
            target: localModule ? itemName : `${modulePath}:${itemName}`,
            type: ASTEngine.RelationshipType.Imports,
            confidence: 1.0,
            // The ITEM's own line — the specifier, exactly where the name is written.
            ...this.lineField(nameNode),
            metadata: {
              module: modulePath,
              isReExport: true,
              ...(aliasNode ? { alias: aliasNode.text } : {}),
              ...(typeOnlyReExport ? { isTypeOnly: true } : {}),
            },
          })
        }
        return
      }
      // Star / namespace forms: the module itself is the dependency, so it takes the family's
      // whole-module BINDING spelling (same shape a namespace or side-effect import publishes).
      const namespaceExport = node.namedChildren.find((c: any) => c && c.type === "namespace_export")
      const aliasNode = namespaceExport ? namespaceExport.namedChild(namespaceExport.namedChildCount - 1) : null
      relationships.push({
        source: this.moduleLeafName(),
        target: `${this.moduleLeafName()}${BINDING_SEP}${modulePath}:*`,
        type: ASTEngine.RelationshipType.Imports,
        confidence: 1.0,
        ...this.lineField(sourceNode),
        metadata: {
          module: modulePath,
          isReExport: true,
          localBinding: true,
          ...(aliasNode && aliasNode.type === "identifier" ? { alias: aliasNode.text } : {}),
          ...(typeOnlyReExport ? { isTypeOnly: true } : {}),
        },
      })
      return
      }
    }

    // M14 #419 T7: dynamic import('./lazy') is a module dependency identical
    // in kind to a static import. Pre-fix the module landed in the imports
    // array but no imports relationship was emitted — and the call walk
    // produced a spurious calls edge to the `import` keyword.
    if (node.type === "call_expression") {
      const callee = node.childForFieldName("function")
      // `require("m")` is a module dependency in the same sense as
      // `import("m")`, and the twin emits it. Pre-fix typescript emitted a
      // `calls → require` edge instead: the dependency was missing AND the
      // module loader was published as if the file called a function named
      // `require` — two wrong edges from one construct.
      const isDynamicImport = !!callee && (callee.text === "import" || callee.type === "import")
      const isRequireCall = !!callee && callee.type === "identifier" && callee.text === "require"
      if (isDynamicImport || isRequireCall) {
        const args = node.childForFieldName("arguments")
        const pathArg = args && args.namedChildCount > 0 ? args.namedChild(0) : null
        // `literalModulePath`, not `stringContent`: a template argument with a
        // substitution is a COMPUTED specifier and its literal prefix is not a
        // module. See the helper for the measured row this replaces.
        const modulePath = pathArg ? literalModulePath(pathArg) : undefined
        if (modulePath) {
          relationships.push({
            source: this.moduleLeafName(),
            // the module-dependency class — binding spelling, reason at the require-clause site above
            target: `${this.moduleLeafName()}${BINDING_SEP}${modulePath}:*`,
            type: ASTEngine.RelationshipType.Imports,
            confidence: 1.0,
            // M59 (#825): a dynamic import's target is named by its path argument.
            ...this.lineField(pathArg),
            metadata: {
              module: modulePath,
              // A `require` is a STATIC CommonJS dependency, not a dynamic import.
              // Labelling it `isDynamic` was wrong in the first cut of the require
              // port, which reused the dynamic branch wholesale — the edge was
              // right and its metadata claimed the module was loaded lazily.
              localBinding: true,
              ...(isDynamicImport ? { isDynamic: true } : { isRequire: true, isDefault: requireBindsDefault(node) }),
            },
          })
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        this.extractImportRelationships(child, relationships, symbols)
      }
    }
  }

  private extractExportRelationships(
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    for (const item of exports) {
      // M4: an ANONYMOUS default export (`export default function(){}`,
      // `export default 42`) has no binding name, so `default` names no symbol
      // in this or any other file. The ExportInfo row stays — "this module has
      // a default export" is true and worth storing — but the graph edge did
      // not: every `module -> default` edge was a target no index could join,
      // one per statement in a file that default-exports twice.
      if (item.name === "default" && item.type === "default_export_expression") continue
      relationships.push({
        source: this.moduleLeafName(),
        target: item.name,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        // M59 (#825): the exported NAME's line, from the export's own range when
        // the collector recorded one. Absent rather than invented when it did not
        // — an absent line reads as "unknown" and a guessed one reads as true.
        ...(item.range?.startLine ? { line_number: item.range.startLine } : {}),
        metadata: {
          isDefault: item.isDefault,
          kind: item.type,
        },
      })
    }
  }

  /**
   * The MODULE an `imports` / `exports` edge is sourced from.
   *
   * Leaf identity is the family contract (see the comment block above
   * `hasToken`): sources and targets are leaf names, never file-qualified ids.
   * The leaf is the basename minus its last extension.
   *
   * A DECLARATION file is the one place where that rule names a module nobody
   * else spells. `path.extname("env.d.ts")` is `.ts`, so the leaf came out
   * `env.d` — while TypeScript, and every consumer that joins these edges, calls
   * that module `env`. Measured by script/m14/ts-production-drop.mjs on
   * element-plus: 368 `imports` + `exports` edges across 3 `.d.ts` files were
   * sourced from `env.d` / `components.d` / `index.d`, and a lane oracle run
   * against the same corpus disagreed with the analyzer on 365 of them for that
   * reason alone before the comparison was moved onto the target half.
   *
   * So the `.d` goes too. It is a spelling fix, not a new rule: the module of
   * `foo.d.ts` is `foo`, exactly as the module of `foo.ts` is `foo`.
   *
   * Deliberately NOT fixed here, because it is a family convention rather than a
   * bug and changing it would be a cross-lane decision: leaf identity is
   * ambiguous by construction. Measured on the same run, 10 module leaves are
   * shared by more than one file — `index` by 43 files, `css` by 21, `instance`
   * by 9, `types` by 3, `constants` by 5. Reported, not changed.
   */
  private moduleLeafName(): string {
    const base = path.basename(this.currentFile)
    const ext = path.extname(base)
    let leaf = ext.length > 0 ? base.slice(0, base.length - ext.length) : base
    // `env.d.ts`, `env.d.mts`, `env.d.cts` all declare module `env`. A file
    // literally named `.d.ts` keeps its name: the guard is on the stem being
    // longer than the suffix, not on the pattern.
    if (leaf.length > 2 && leaf.endsWith(".d")) leaf = leaf.slice(0, leaf.length - 2)
    return leaf
  }

  // ========================================================================
  // RELATIONSHIP HELPERS (regex-free)
  // ========================================================================

  private addContainmentRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    // R2a: one name -> FIRST-declared-symbol index, built in a single pass.
    // This loop was O(n^2): a linear `findItem` per member that has an owner,
    // which is the one surviving half of the "no O(n^2] scans" claim the
    // analyzer doc used to make. `findItem` returned the FIRST name match, so
    // the index keeps the first occurrence per name and the resolution is
    // behaviour-identical — including for the repeated-name case (two classes
    // each with a `save()`), where first-wins is the contract, not an accident.
    const firstByName = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      if (!firstByName.has(s.name)) firstByName.set(s.name, s)
    }
    for (const symbol of symbols) {
      if (symbol.ownerName) {
        const owner = firstByName.get(symbol.ownerName)
        if (owner) {
          // Leaf identity: container is the namespace full name (Example.Domain)
          // or class/interface/enum leaf (UserService); member is the leaf name.
          relationships.push({
            source: owner.name,
            target: symbol.name,
            type: ASTEngine.RelationshipType.Contains,
            confidence: 1.0,
            // M59 (#825): the MEMBER's declaration line — the edge names the
            // member, so it takes the member's range, not the container's.
            ...(symbol.range?.startLine ? { line_number: symbol.range.startLine } : {}),
            metadata: {},
          })
        }
      }
    }
  }

  private resolveRelationshipSymbol(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    current: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    // T6 (review wave): symbol ranges are 1-based (nodeRange +1) but the
    // lookup passed raw 0-based rows/columns, so positional resolution never
    // matched and everything fell back to first-name-match. Overloads and
    // same-named nested/top-level functions resolved positionally blind.
    // R2b: the shared indexed lookup (see firstSymbolNamed) — the scan is
    // shorter, the answer is identical.
    const firstMatchIn = (name: string, pred: (s: ASTEngine.UniversalSymbol) => boolean) =>
      this.firstSymbolNamed(name, pred, symbols)
    const byPos = (name: string, kind: ASTEngine.SymbolKind, line: number, col: number, owner?: string) =>
      firstMatchIn(
        name,
        (s) =>
          s.kind === kind &&
          s.range.startLine === line + 1 &&
          s.range.startColumn === col + 1 &&
          (!owner || s.ownerName === owner),
      )

    if (node.type === "function_declaration" || node.type === "generator_function_declaration") {
      const name = node.childForFieldName("name")?.text
      if (!name) return current
      return (
        byPos(name, ASTEngine.SymbolKind.Function, node.startPosition.row, node.startPosition.column) ||
        firstMatchIn(name, (s) => s.kind === ASTEngine.SymbolKind.Function) ||
        current
      )
    }

    if (node.type === "class_declaration" || node.type === "abstract_class_declaration") {
      // W3 (web-family contract, JS J5 precedent): static blocks and
      // property initializers have no enclosing function — their calls
      // belong to the CLASS. Pre-fix they fell through to the module leaf
      // ("si -> init" instead of "Service -> init" on the probed shape).
      // Instance method bodies resolve to the method first (this node is
      // only reached when no closer function exists), so this never
      // misattributes method calls (same reasoning as the JS analyzer).
      const nm = node.childForFieldName("name")?.text
      if (nm) {
        const ownerSym = firstMatchIn(nm, (s) => s.kind === ASTEngine.SymbolKind.Class)
        if (ownerSym) return ownerSym
      }
      return current
    }

    if (node.type === "method_definition") {
      const raw = node.childForFieldName("name")?.text
      if (!raw) return current
      const name = stripPrivatePrefix(raw)
      // R1: ONE owner rule for every member kind, the twin's
      // `containerOwnerName` — the same helper that named the SYMBOL now names
      // the EDGE's source, so the two can never disagree. That disagreement was
      // live and cost a whole class of edges: the old walk only recognised
      // `class_declaration`, so for `const A = class Inner { m() { helper() } }`
      // it fell through to the nearest `variable_declarator` and computed owner
      // `A` while the symbol's ownerName was `Inner`; the owner-scoped lookup
      // then matched nothing and every call inside `m` was emitted against the
      // MODULE leaf (`x -> helper`). The hand-rolled walk also had to
      // re-implement the function-boundary rule that W1 needed, in two places.
      const owner = containerOwnerName(node)
      return (
        byPos(name, ASTEngine.SymbolKind.Method, node.startPosition.row, node.startPosition.column, owner) ||
        firstMatchIn(
          name,
          (s) => s.kind === ASTEngine.SymbolKind.Method && (!owner || s.ownerName === owner),
        ) ||
        current
      )
    }

    if (node.type === "arrow_function" || node.type === "function_expression" || node.type === "function") {
      const parent = node.parent
      if (parent?.type === "variable_declarator") {
        const name = parent.childForFieldName("name")?.text
        if (!name) return current
        return (
          byPos(name, ASTEngine.SymbolKind.Function, parent.startPosition.row, parent.startPosition.column) ||
          firstMatchIn(name, (s) => s.kind === ASTEngine.SymbolKind.Function) ||
          current
        )
      }
    }

    return current
  }


  // ========================================================================
  // HELPER METHODS
  // ========================================================================

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const params: ASTEngine.Parameter[] = []

    // Same correction as findParameterType: `formal_parameters` is a node type,
    // not a field name in the pinned grammar — positional fallback instead.
    const paramsNode =
      node.childForFieldName("parameters") ||
      node.namedChildren.find((c: Node | null) => c?.type === "formal_parameters")
    if (!paramsNode) return params

    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const paramNode = paramsNode.namedChild(i)
      if (!paramNode) continue

      // Skip decorators
      if (paramNode.type === "decorator") continue

      // Handle rest parameters
      if (paramNode.type === "rest_pattern") {
        const inner = paramNode.namedChild(0)
        if (inner) {
          params.push({
            name: `...${inner.text}`,
            isOptional: false,
          })
        }
        continue
      }

      // Handle required vs optional parameters
      const pattern =
        paramNode.childForFieldName("pattern") || paramNode.childForFieldName("name") || paramNode.namedChild(0)
      if (!pattern) continue

      let name = pattern.text
      let type: string | undefined
      let defaultValue: string | undefined
      let isOptional = false

      // Check for TypeScript parameter properties (public/private/protected/readonly)
      const modifierTexts: string[] = []
      for (let j = 0; j < paramNode.childCount; j++) {
        const child = paramNode.child(j)
        if (child) {
          if (["public", "private", "protected", "readonly"].includes(child.text)) {
            modifierTexts.push(child.text)
          }
        }
      }

      // Extract type annotation
      const typeAnnotation = paramNode.childForFieldName("type")
      if (typeAnnotation) {
        type = stripLeadingColon(typeAnnotation.text)
        // Check for optional type T?
        if (type.endsWith("?")) {
          isOptional = true
          type = type.slice(0, -1)
        }
      }

      // Check for optional marker (?)
      if (this.hasToken(paramNode, "?")) {
        isOptional = true
      }

      // Extract default value. Modifier keywords are carried on
      // param.modifiers — stuffing them into defaultValue made substring
      // checks fabricate parameter properties from string defaults like
      // x: string = "private".
      const valueNode = paramNode.childForFieldName("value")
      if (valueNode) {
        defaultValue = valueNode.text
        isOptional = true // Parameters with defaults are optional
      }

      // Handle assignment pattern (destructuring with defaults)
      if (paramNode.type === "assignment_pattern") {
        const left = paramNode.namedChild(0)
        const right = paramNode.namedChild(1)
        if (left) {
          name = left.text
        }
        if (right) {
          defaultValue = right.text
          isOptional = true
        }
      }

      params.push({
        name,
        type,
        defaultValue,
        isOptional,
        modifiers: modifierTexts.length > 0 ? modifierTexts : undefined,
      } as any)
    }

    return params
  }

  private extractReturnType(node: Node): string {
    const returnType = node.childForFieldName("return_type")
    if (returnType) {
      return stripLeadingColon(returnType.text)
    }

    // Try to find type annotation in the node
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "type_annotation") {
        return stripLeadingColon(child.text)
      }
    }

    // T3 (review wave): absence of an annotation is not evidence of void —
    // infer from return statements (unannotated `() => 42` is number, not
    // void). Bodies without returns still yield "void" from the helper,
    // so the default is unchanged where no information exists.
    return this.typeInference.inferFunctionReturnType(node)
  }

/**
   * The heritage base NAME for one clause child, with type arguments removed.
   *
   * Applied to CLASS `implements` only, and only after measuring which clause
   * shapes tree-sitter-typescript 0.23.2 actually produces. It produces THREE:
   *
   *   class `extends GenBase<string>`   -> [type_identifier, type_arguments]
   *   class `extends ns.QBase<string>`  -> [member_expression, type_arguments]
   *   class `implements Gen<string>`    -> [generic_type]            <-- ONE node
   *   interface `extends A<string>`     -> [generic_type]            <-- ONE node
   *
   * So a generic heritage entry arrives EITHER as a sibling `type_arguments`
   * node (both class-extends shapes, handled by the existing sibling skip) OR as
   * a single `generic_type` child whose `.text` still carries the arguments
   * (class-implements, and interface-extends, which is why
   * `extractInterfaceExtends` has stripped since M49 #759). The
   * `type_arguments` skip cannot see the second kind, and that is the whole bug.
   *
   * Measured costs when class `implements` kept its arguments:
   *
   *  1. PRODUCTION DELETED THE EDGE. `filterNoiseRelationships`
   *     (src/ast/pool-worker.ts:654) drops any target whose leaf contains `<`
   *     or `>`, so `implements Observer<T>` never reached the index. Measured by
   *     running the analyzer and `parseFile` on the same file and diffing:
   *       rxjs    implements  51 raw ->  43 production,  8 lost (15.69%), 6 files
   *       nest    implements 252 raw -> 213 production, 39 lost (15.48%), 39 files
   *       typeorm implements 158 raw -> 127 production, 31 lost (19.62%), 30 files
   *     78 losses over three corpora, every one of them this shape and nothing
   *     else. After the fix all three read 0 lost.
   *  2. THE ENDPOINT COULD NOT BIND. `Observer<T>` is not a declared name.
   *  3. THE STRUCTURAL OVERRIDE ARM COULD NOT PAIR, because it resolves the base
   *     by name: `ifaceByName.get("Subscribable<T>")` never matches the declared
   *     `Subscribable`, so `ObservableImpl.subscribe -> Subscribable.subscribe`
   *     was missing while both members were in the same file. That one file went
   *     from 1 `overrides` edge to 7.
   *
   * The oracle already does this and has for a long time — differential.ts's
   * heritage `collect` strips at the first `<` for every TYPE node, citing the
   * identical groovy `Cache<T>` case. So this brings the analyzer into lockstep
   * instead of inventing a third spelling.
   *
   * The dotted path was KEPT here for a while (`ns.Base` stayed `ns.Base`), on the argument
   * that the oracle's TYPE branch did the same and the override arms relied on it. That
   * argument is now MEASURABLY WRONG for `implements`: the lane's own fixture
   * `heritage-parameterized-leaves` pins a QUALIFIED parameterised interface
   * (`class Qualified implements Ns.Shape<number>`) to the LEAF `Shape` and FORBIDS
   * `Ns.Shape` — the same TSD4/TSD3 leaf-identity rule `extractInterfaceExtends` has applied
   * since M49 #759. A namespace-imported base's stored `qualified_name` is
   * `<module>.<Type>`, never `<alias>.<Type>`, so the dotted spelling cannot join either;
   * the leaf can (by unique name). The class-EXTENDS arm still publishes its base verbatim
   * and that asymmetry is left alone rather than changed silently — no fixture pins it.
   *
   * No regular expression: `indexOf` + `slice`.
   */
  private static heritageBaseName(text: string): string {
    const lt = text.indexOf("<")
    const head = (lt === -1 ? text : text.slice(0, lt)).trim()
    const dot = head.lastIndexOf(".")
    return dot === -1 ? head : head.slice(dot + 1)
  }

  private extractClassHeritage(node: Node): { extends?: string[]; implements?: string[]; extendsLines?: number[]; implementsLines?: number[] } {
    const result: { extends?: string[]; implements?: string[]; extendsLines?: number[]; implementsLines?: number[] } = {}

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue

      if (child.type === "class_heritage") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const heritageClause = child.namedChild(j)
          if (!heritageClause) continue

          if (heritageClause.type === "extends_clause") {
            result.extends = []
            result.extendsLines = []
            for (let k = 0; k < heritageClause.namedChildCount; k++) {
              const type = heritageClause.namedChild(k)
              if (!type) continue
              // Generic heritage `extends Base<string>` parses with the
              // type_arguments as a SEPARATE sibling node — pushing it
              // wholesale fabricated an Extends edge to "<string>". Skip
              // argument nodes; take the base type text only.
              if (!isNameableHeritageNode(type.type)) continue
              // MEASURED, and the reason this call site is NOT stripped even
              // though the implements one below is: every class-extends shape
              // tree-sitter-typescript 0.23.2 produces carries its arguments as a
              // SIBLING `type_arguments` node, so the skip above already removed
              // them. Probed all three shapes:
              //   extends GenBase<string>    -> [type_identifier, type_arguments]
              //   extends ns.QBase<string>   -> [member_expression, type_arguments]
              //   extends ns2.Plain          -> [member_expression]
              // A strip added here was mutant-tested and SURVIVED — no fixture can
              // kill it, because no shape reaches it with arguments still attached.
              // Shipping it would be untestable defensive code, so it is not here.
              // (INTERFACE heritage is the opposite case and does need the strip:
              // `extends A<string>` is a single `generic_type` child, which is why
              // extractInterfaceExtends has carried one since M49 #759.)
              // ⇒⇒⇒ A CALL-SHAPED HERITAGE IS A MIXIN APPLICATION, AND ITS BASE NAME IS THE CALLEE.
              // MEASURED (the fixture `mixin-application` failed on the first run because of this):
              // `class Post extends Tagged(Timestamped)` published an `extends` edge whose target was
              // the WHOLE CALL TEXT, `Tagged(Timestamped)` — a target that names NO SYMBOL, which is
              // the exact defect class this fleet keeps finding. The javascript lane, from the same
              // grammar family, publishes the callee: 76 call-shaped heritage clauses give 76
              // `extends` edges and 83 `mixes_in` edges. So the base name is the callee's name here
              // too, and the site carries BOTH labels (the family convention, measured there).
              // The `mixes_in` row itself is published by `extractMixinApplications`, which is the
              // pass that owns the SHAPE test; this line only keeps `extends` from naming a call.
              const callCallee = type.type === "call_expression"
                ? type.childForFieldName?.("function") ?? null
                : null
              if (callCallee && callCallee.text.length > 0) {
                result.extends.push(callCallee.text)
                result.extendsLines.push(callCallee.startPosition.row + 1)
                continue
              }
              result.extends.push(type.text)
              // M59 (#825): the base TYPE NAME's line, kept parallel to the
              // name list. The subclass's own declaration line is NOT it —
              // `class A extends\n  B {}` writes B on the next line.
              result.extendsLines.push(type.startPosition.row + 1)
            }
          } else if (heritageClause.type === "implements_clause") {
            result.implements = []
            result.implementsLines = []
            for (let k = 0; k < heritageClause.namedChildCount; k++) {
              const type = heritageClause.namedChild(k)
              if (!type || !isNameableHeritageNode(type.type)) continue
              // See heritageBaseName: an implements entry written with type
              // arguments arrives as ONE `generic_type` child, so the
              // `type_arguments` skip above cannot see the arguments.
              result.implements.push(TypeScriptAnalysisRunner.heritageBaseName(type.text))
              // M59.A7 (corpus sweep after the M49 W22 fix): the M59 round gave
              // `extends` its base-name line but left `implements` unstamped, so
              // every `implements` edge was the ONE relationship kind the web
              // round's "every edge carries its name's line" claim did not cover
              // (measured: 6 in the four TS corpora + 1 delegated from svelte).
              // The 40-file oracle sample happened to draw none of them, which is
              // why the milestone's own instrument read 0 noLine for typescript.
              result.implementsLines.push(type.startPosition.row + 1)
            }
          }
        }
      }
    }

    return result
  }

  private extractInterfaceExtends(node: Node): { names: string[]; lines: number[] } | undefined {
    // Interface heritage parses as extends_type_clause — NOT extends_clause
    // (that is the CLASS heritage node) and interface_declaration has no
    // "extends" FIELD. The old lookup missed both and returned undefined,
    // silently dropping every interface-inheritance edge.
    let clause: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "extends_type_clause") { clause = c; break }
    }
    if (!clause) return undefined

    const types: string[] = []
    const lines: number[] = []
    for (let i = 0; i < clause.namedChildCount; i++) {
      const type = clause.namedChild(i)
      if (!type || !isNameableHeritageNode(type.type)) continue
      // M49 #759: `extends Readable<T>` parses with the type_arguments as a
      // SIBLING subtree folded into the text — pushing it raw emitted
      // extends Spring->"Readable<T>" while the oracle (and every consumer)
      // resolves the clean head. Strip args to the type head, then take the
      // leaf segment (TSD3 convention: TS heritage targets are leaves).
      let t = type.text
      const lt = t.indexOf("<")
      if (lt !== -1) t = t.slice(0, lt).trim()
      const dot = t.lastIndexOf(".")
      const name = dot !== -1 ? t.slice(dot + 1) : t
      // ERROR-RECOVERY GUARD: `interface I extends {}` parses with a zero-width MISSING type_identifier
      // whose text is ""; publishing it would emit an extends edge that names nothing (the gate's
      // `noTarget` disclosure). No name, no row — and no parallel line for it either.
      if (name.trim().length === 0) continue
      types.push(name)
      // M59 (#825): parallel line list — the base type node's own line.
      lines.push(type.startPosition.row + 1)
    }

    return types.length > 0 ? { names: types, lines } : undefined
  }

  /**
   * `mixes_in` — THE MIXIN APPLICATION, R3, NO GRAMMAR CHANGE.
   *
   * TypeScript composes a mixin with `class X extends Mixin(Base) {}`. The extends-expression is a
   * `call_expression`, and THAT is the discriminator against `extends`: the heritage clause of a
   * plain subclass names a type (`extends Base`), while a mixin application CALLS a factory.
   * The javascript lane measured the same shape from the same node types, so the two lanes'
   * `mixes_in` counts are comparable — 76 call-shaped heritage clauses there, 0 here, which is a
   * fact about the two corpora and not about the two instruments.
   *
   * WHY THE TARGET IS THE CALLEE AND NOT THE ARGUMENT: the relation is "this class mixes in the
   * thing the factory produces", and the factory is the name a reader follows. The arguments are
   * captured as metadata (`mixinArgCount`, `mixinCalleeShape`) so a reader can tell
   * `Mixin(Base)` from `ns.Mixin(Base)` without a second edge.
   *
   * IT EMITS NOTHING OVER TODAY'S CORPUS, and that is a MEASURED zero, not an unimplemented type:
   * the census found 0 call-shaped heritage clauses in 17,689 files (2,186 class heritage clauses,
   * 1,107 interface-merging clauses, 0 bases named `*mixin*`). The fixture is what proves the edge
   * fires when the shape IS present.
   */
  private extractMixinApplications(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const emitted = new Set<string>()
    const visit = (node: Node): void => {
      if (node.type === "class_heritage") {
        // The owning class: `class_heritage` sits under the class declaration, and the name is the
        // declaration's `name` field. An ANONYMOUS class expression (`class extends Base {}`) has no
        // name field, so it has no source and no edge — see the census, which counts those 10 sites
        // separately because they extend a TYPE PARAMETER inside a mixin factory's body.
        let owner: Node | null = node.parent
        while (owner && owner.type !== "class_declaration" && owner.type !== "abstract_class_declaration") {
          owner = owner.parent
        }
        const classNode = owner?.childForFieldName?.("name") ?? null
        const source = classNode?.text ?? ""
        if (source.length > 0) {
          for (let i = 0; i < node.namedChildCount; i++) {
            const clause = node.namedChild(i)
            if (!clause || clause.type !== "extends_clause") continue
            for (let j = 0; j < clause.namedChildCount; j++) {
              const expr = clause.namedChild(j)
              // THE SHAPE TEST, and it is the whole discriminator: only a CALL in the heritage
              // position is a mixin application.
              if (!expr || expr.type !== "call_expression") continue
              const callee = expr.childForFieldName?.("function") ?? null
              const target = callee?.text ?? ""
              if (target.length === 0) continue
              const key = `${source}|${target}`
              if (emitted.has(key)) continue
              emitted.add(key)
              const args = expr.childForFieldName?.("arguments") ?? null
              relationships.push({
                source,
                target,
                type: ASTEngine.RelationshipType.MixesIn,
                confidence: 0.9,
                ...this.lineField(expr),
                metadata: {
                  relationshipType: "mixin_application",
                  mixinCalleeShape: callee?.type ?? "unknown",
                  mixinArgCount: args?.namedChildCount ?? 0,
                },
              })
            }
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) visit(child)
      }
    }
    visit(rootNode)
  }

  /**
   * `part_of` — THE TRIPLE-SLASH REFERENCE DIRECTIVE, R2, AND THE GRAMMAR IS PATCHED BY THIS LANE.
   *
   * `/// <reference path="…" />`, `/// <reference types="…" />` and `/// <reference lib="…" />` are
   * lexed as COMMENTS by the served build (8515404d…), so this pass finds nothing there. The lane's
   * patched build (`8586372d…`, one rule and one program in the derived grammar, proven by
   * `script/m14/ts-partof-grammar-proof.ts`) makes each directive a `reference_directive` node that
   * CARRIES ITS ROLE AND TARGET AS FIELDS — so this pass reads STRUCTURE (`childForFieldName`) and
   * never a comment's text. That distinction is the lane's contract: a relation may not be resolved
   * by matching text, and a directive's role is a field, not a pattern.
   *
   * `metadata.partRole` IS MANDATORY ON EVERY ROW (the lane's ruling): a `part_of` edge that does not
   * say WHICH kind of part it is cannot be checked against the directive that produced it.
   */
  private extractReferenceDirectives(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    file: string,
  ): void {
    const emitted = new Set<string>()
    const stem = file.split("/").pop()?.replace(/\.[^.]*$/, "") ?? file
    const visit = (node: Node): void => {
      if (node.type === "reference_directive") {
        // TWO SHAPES, ONE RULE. A build that exposes the directive as FIELDS hands them over; a build
        // that exposes it as ONE ATOMIC TOKEN has already decided STRUCTURALLY that this node is a
        // directive (nothing else can match that token), and its `role` and `target` are read out of
        // the node's OWN fixed spelling. That is not a regex over the file: it is the grammar's own
        // guarantee being unwrapped, the same operation as reading an import's string source.
        const roleField = node.childForFieldName?.("role") ?? null
        const targetField = node.childForFieldName?.("target") ?? null
        let role = roleField?.text ?? ""
        let raw = targetField?.text ?? ""
        if (role === "" || raw === "") {
          const text = node.text ?? ""
          const m = /<reference\s+(path|types|lib)\s*=\s*("([^"]*)")/.exec(text)
          if (m) {
            if (role === "") role = m[1]
            if (raw === "") raw = m[2]
          }
        }
        // The target is the QUOTED literal; the relation's target is the path inside it.
        const target = raw.replace(/^"|"$/g, "")
        if (role.length > 0 && target.length > 0) {
          const key = `${stem}|${role}|${target}`
          if (!emitted.has(key)) {
            emitted.add(key)
            relationships.push({
              source: stem,
              target,
              type: ASTEngine.RelationshipType.PartOf,
              confidence: 0.95,
              ...this.lineField(node),
              metadata: { relationshipType: "reference_directive", partRole: role },
            })
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) visit(child)
      }
    }
    visit(rootNode)
  }

  private extractComments(node: Node): string[] | undefined {
    const comments: string[] = []

    // Look for leading comments. For exported/declare-wrapped declarations
    // (`export class X`, `export default class X`, `declare class X`), the
    // JSDoc comment precedes the export/declare keyword, not the declaration
    // node itself — so walk up to the wrapper parent first.
    const scanNode: Node = node.parent && node.parent.type === "export_statement" ? node.parent : node

    let prev = scanNode.previousSibling
    // Contiguity boundary: a blank line between the comment and the anchor
    // ends the leading-comment run. Without this, trailing remarks about the
    // PREVIOUS declaration were stolen across the gap.
    let anchorRow = scanNode.startPosition.row
    while (prev && prev.type === "comment") {
      if (prev.endPosition.row + 1 < anchorRow) break
      comments.unshift(stripCommentMarkers(prev.text))
      anchorRow = prev.startPosition.row
      prev = prev.previousSibling
    }

    // Also check named children for JSDoc comments
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "comment") {
        comments.push(child.text)
      }
    }

    return comments.length > 0 ? comments : undefined
  }

  /**
   * Class-level route base (@Controller("users"), @RequestMapping("/api"),
   * @Path/@Route equivalents) for T5 composition. Reads the nearest
   * enclosing class node's decorators; first string/template argument wins.
   */
  private extractControllerBasePath(): string | undefined {
    const classNode = this.scopeManager.findEnclosingClassNode()
    if (!classNode) return undefined
    const decorators = collectDecoratorsForClass(classNode)
    for (const d of decorators) {
      const stack: Node[] = [d]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "call_expression") {
          const callee = n.namedChild(0)
          let base = callee
          if (callee && callee.type === "member_expression") {
            base = callee.childForFieldName("property") || callee.namedChild(callee.namedChildCount - 1) || callee
          }
          const decName = base?.text || ""
          if (decName === "Controller" || decName === "RequestMapping" || decName === "Path" || decName === "Route") {
            const args = n.childForFieldName("arguments")
            if (args && args.namedChildCount > 0) {
              const firstArg = args.namedChild(0)
              if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
                return stringContent(firstArg)
              }
            }
            return undefined
          }
          break
        }
        for (let j = 0; j < n.namedChildCount; j++) {
          const c = n.namedChild(j)
          if (c) stack.push(c)
        }
      }
    }
    return undefined
  }

  private extractApiContract(
    node: any,
    decoratorNodes?: Node[],
  ): { path?: string; method?: string } {    let contractPath: string | undefined = undefined
    let contractMethod: string | undefined = undefined

    // Decorator-based routes (@Get("/users"), @PostMapping("/api")). The
    // decorator NODES are passed in by the caller because placement is
    // asymmetric: method decorators are class_body siblings, not children
    // of the method_definition.
    const methods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
    const scanDecorator = (child: any): { path?: string; method: string } | null => {
      let decName = ""
      // T4 (review wave): no path argument means no path — the old default
      // "/" turned every bare @Get() into a phantom root endpoint.
      let route: string | undefined = undefined
      let sawCall = false
      const scan = (n: any) => {
        if (sawCall) return
        if (n.type === "call_expression") {
          sawCall = true
          const callee = n.namedChild(0)
          if (callee) {
            let base = callee
            if (callee.type === "member_expression") {
              base = callee.childForFieldName("property") || callee.namedChild(callee.namedChildCount - 1) || callee
            }
            decName = base.text || ""
          }
          const args = n.childForFieldName("arguments")
          if (args && args.namedChildCount > 0) {
            const firstArg = args.namedChild(0)
            if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
              route = stringContent(firstArg)
            }
          }
          return
        }
        for (let j = 0; j < n.namedChildCount; j++) {
          const c = n.namedChild(j)
          if (c) scan(c)
        }
      }
      scan(child)
      // Collapsed form: `@Get` / `@Get()` with no call_expression child —
      // the name rides as a bare identifier/member child. Without this the
      // match below never runs and base-path composition (T5) can't see
      // path-less mappings under a controller base.
      if (!decName) {
        for (let j = 0; j < child.namedChildCount; j++) {
          const c = child.namedChild(j)
          if (!c) continue
          if (c.type === "identifier") { decName = c.text; break }
          if (c.type === "member_expression") {
            const prop = c.childForFieldName("property") || c.namedChild(c.namedChildCount - 1)
            if (prop) { decName = prop.text; break }
          }
        }
      }
      // T2 (review wave): EXACT match after stripping a Mapping suffix —
      // the old prefix match turned @Getter into GET and @PostConstruct
      // (a NestJS lifecycle hook) into POST /. @GetMapping still resolves
      // (strip → Get); bare lifecycle/helper names match nothing.
      let upper = decName.toUpperCase()
      if (upper.endsWith("MAPPING") && upper.length > "MAPPING".length) {
        upper = upper.slice(0, upper.length - "MAPPING".length)
      }
      if (methods.has(upper)) {
        return { path: route, method: upper }
      }
      return null
    }

    if (decoratorNodes) {
      for (const child of decoratorNodes) {
        const hit = scanDecorator(child)
        if (hit) {
          contractPath = hit.path
          contractMethod = hit.method
          break
        }
      }
    } else {
      // Function declarations carry their own decorators as direct children.
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === "decorator") {
          const hit = scanDecorator(child)
          if (hit) {
            contractPath = hit.path
            contractMethod = hit.method
            break
          }
        }
      }
    }

    const searchCalls = (n: any) => {
      if (contractPath) return
      if (n.type === "call_expression") {
        const callee = n.namedChild(0)
        if (callee) {
          const calleeText = callee.text
          if (calleeText === "fetch" || calleeText.startsWith("axios.")) {
            const args = n.childForFieldName("arguments")
            if (args && args.namedChildCount > 0) {
              let url = ""
              const firstArg = args.namedChild(0)
              if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
                url = stringContent(firstArg)
              }

              let method = "GET"
              if (calleeText.startsWith("axios.")) {
                const parts = calleeText.split(".")
                if (parts.length > 1) {
                  method = parts[1].toUpperCase()
                }
              } else if (calleeText === "fetch" && args.namedChildCount > 1) {
                const secondArg = args.namedChild(1)
                if (secondArg && secondArg.type === "object") {
                  for (let i = 0; i < secondArg.namedChildCount; i++) {
                    const prop = secondArg.namedChild(i)
                    if (prop && prop.type === "pair") {
                      const key = prop.childForFieldName("key")
                      const val = prop.childForFieldName("value")
                      if (key && key.text === "method" && val) {
                        method = stringContent(val).toUpperCase()
                      }
                    }
                  }
                }
              }

              if (url) {
                contractPath = url
                contractMethod = method
                return
              }
            }
          }
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) searchCalls(child)
      }
    }

    if (node.type === "method_definition" || node.type === "function_declaration" || node.type === "arrow_function") {
      const body = node.childForFieldName("body")
      if (body) {
        searchCalls(body)
      }
    }

    // A method-only result (bare @Get(): method known, path not) must
    // survive — the old path-only gate discarded the method, which also
    // blinded T5 base composition (it keys off apiContract.method).
    return contractPath || contractMethod ? { path: contractPath, method: contractMethod } : {}
  }

  /** Dotted call paths made by `ownerName`'s body — the java convention
   *  (no argument text: `db.list(user).map` is stored as `db.list.map`).
   *
   *  M3: the walk now crosses nested-function boundaries and REBINDS on every
   *  function-like node through the SAME resolver the relationship pass uses
   *  (`resolveRelationshipSymbol`), which is what the javascript twin's
   *  `qcWalk` does. The old walk stopped at every nested function, so:
   *    - a callback's calls were missing from the payload while the graph
   *      carried the edge (`items.map(i => helper())` emitted `outer->helper`
   *      and listed only `items.map`) — payload and graph disagreed about the
   *      same call, and the two analyzers disagreed with each other
   *      (javascript listed `["items.map","helper"]` for the same source);
   *    - deleting the boundary alone would have been wrong the other way: a
   *      nested function that IS a symbol (a nested `function inner(){}` is
   *      extracted) would list its calls on BOTH symbols.
   *  Rebinding is what makes both correct. Decorator position needs no guard
   *  here: a decorator is a sibling of the definition it decorates, so it
   *  never appears inside the body subtree this walk starts from. */
  private extractQualifiedCalls(
    node: Node,
    owner: ASTEngine.UniversalSymbol,
    symbols: ASTEngine.UniversalSymbol[],
    out: Map<ASTEngine.UniversalSymbol, string[]>,
  ): void {
    const walk = (n: Node, currentOwner: ASTEngine.UniversalSymbol) => {
      // Same rebinding contract as extractCallRelationships: a function-like
      // node that resolves to a symbol owns the calls inside it; anything else
      // (a callback, a local arrow) keeps the enclosing symbol.
      const rebound = this.resolveRelationshipSymbol(n, symbols, null)
      const ownerSym = rebound ?? currentOwner

      if (n.type === "call_expression") {
        const callee = n.namedChild(0)
        if (callee) {
          // T8 (review wave): dynamic import() is a module dependency, not a
          // call — the relationship walk already skips the `import` callee
          // (T7 fix); the qualified-calls payload did not, leaking "import"
          // into symbol call lists.
          // `require` joins `import` here: both are module loaders, not calls.
          // The twin skips both, so a symbol's call list must not contain
          // "require" — it is a dependency edge, emitted above.
          const calleeIsImport = callee.type === "import" ||
            (callee.type === "identifier" && (callee.text === "import" || callee.text === "require"))
          if (!calleeIsImport) {
            // Dotted path WITHOUT argument text (family contract with java).
            // Raw callee.text embedded inner-call arguments on chains:
            // `db.list(user).map` was stored as "db.list(user).map".
            const parts: string[] = []
            let cur: Node | null = callee
            while (cur) {
              if (cur.type === "member_expression") {
                const prop = cur.childForFieldName("property")
                parts.unshift(prop ? prop.text : cur.namedChild(cur.namedChildCount - 1)?.text ?? "")
                cur = cur.childForFieldName("object")
              } else if (cur.type === "call_expression") {
                cur = cur.namedChild(0)
              } else {
                parts.unshift(cur.text)
                break
              }
            }
            const path = parts.filter(Boolean).join(".")
            if (path) {
              const list = out.get(ownerSym) ?? []
              list.push(path)
              out.set(ownerSym, list)
            }
          }
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child, ownerSym)
      }
    }

    const body = node.childForFieldName("body")
    if (body) walk(body, owner)
  }

  private extractTaintSources(node: Node): { type: string; snippet: string }[] | undefined {
    const sources: { type: string; snippet: string }[] = []

    const traverse = (n: Node) => {
      if (n.type === "member_expression") {
        // T9 (review wave): receiver-leaf match, not substring — indexOf
        // flagged `myreq.body` (or any `*req.body` suffix) as user input.
        // Only exact receiver roots with exact sensitive leaves qualify.
        const segs: string[] = []
        for (const part of n.text.split(".")) {
          const t = part.trim()
          if (t) segs.push(t)
        }
        const isReqInput =
          segs.length >= 2 && segs[0] === "req" &&
          (segs[1] === "body" || segs[1] === "query" || segs[1] === "params")
        const isEnvRead = segs.length >= 2 && segs[0] === "process" && segs[1] === "env"
        if (isReqInput || isEnvRead) {
          sources.push({ type: "user_input", snippet: n.text })
        }
      } else if (n.type === "identifier") {
        if (n.text === "prompt" || n.text === "readLine") {
          sources.push({ type: "user_input", snippet: n.text })
        }
      } else if (n.type === "subscript_expression") {
        // M49 #757-2: bracket-form access `req['body']` never produced a
        // taint source (neither dotted nor pre-T9 substring form matched).
        // Same receiver-leaf contract as the dotted branch: exact root +
        // exact sensitive leaf; the bracket index must be a string literal.
        const obj = n.childForFieldName("object")
        const idx = n.childForFieldName("index")
        if (obj && idx && idx.type === "string") {
          const segs: string[] = []
          for (const part of obj.text.split(".")) {
            const t = part.trim()
            if (t) segs.push(t)
          }
          segs.push(stringContent(idx))
          const isReqInput =
            segs.length >= 2 && segs[0] === "req" &&
            (segs[1] === "body" || segs[1] === "query" || segs[1] === "params")
          const isEnvRead = segs.length >= 2 && segs[0] === "process" && segs[1] === "env"
          if (isReqInput || isEnvRead) {
            sources.push({ type: "user_input", snippet: n.text })
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) traverse(child)
      }
    }
    traverse(node)

    // Deduplicate
    const seen = new Set<string>()
    const uniqueSources: { type: string; snippet: string }[] = []
    for (const source of sources) {
      if (!seen.has(source.snippet)) {
        seen.add(source.snippet)
        uniqueSources.push(source)
      }
    }

    return uniqueSources.length > 0 ? uniqueSources : undefined
  }

  private extractTaintSinks(node: Node): { type: string; snippet: string; vulnerability_type: string }[] | undefined {
    const sinks: { type: string; snippet: string; vulnerability_type: string }[] = []

    // The sink rules are RECEIVER-based, matching the family contract: java
    // flags `stmt.executeQuery`, python flags `cursor.execute` — never a bare
    // `execute()`. The pre-fix rules matched a bare name or a bare LEAF, so
    // `re.exec(input)` (RegExp.prototype.exec — not a shell at all) and any
    // project-local `execute(q)` were reported as command_injection /
    // sql_injection. That is not a payload-only defect: parallel-indexer
    // multiplies every source by every sink in a symbol into
    // `brain_taint_flow`, and `bb_security` reports that table — so one
    // `req.body` read in a function that also called `.exec()` manufactured a
    // persisted command-injection finding. The source-side rules were already
    // receiver-leaf (TSD17); this aligns the sink side with them.
    const segmentsOf = (text: string): string[] => {
      const out: string[] = []
      for (const part of text.split(".")) {
        const t = part.trim()
        if (t) out.push(t)
      }
      return out
    }

    const traverse = (n: Node) => {
      if (n.type === "call_expression") {
        const calleeText = n.childForFieldName("function")?.text || ""
        const segs = segmentsOf(calleeText)
        const leaf = segs.length > 0 ? segs[segs.length - 1] : ""
        const hasReceiver = segs.length >= 2
        const receiver = hasReceiver ? segs[0] : ""

        // shell execution: a child_process-shaped RECEIVER plus an exec-family
        // LEAF, or a BARE exec-family name in a file that imports
        // child_process (that import is the evidence the name is Node's).
        if (
          (hasReceiver && TS_SHELL_RECEIVERS.has(receiver) && TS_SHELL_LEAVES.has(leaf)) ||
          (!hasReceiver && this._fileSignals.importsChildProcess && TS_SHELL_LEAVES.has(leaf))
        ) {
          sinks.push({ type: "shell_execution", snippet: n.text, vulnerability_type: "command_injection" })
        }
        // database write: a member call on a query/execute leaf — receiver-based,
        // exactly like the java/python family rules.
        if (hasReceiver && (leaf === "query" || leaf === "execute")) {
          sinks.push({ type: "database_write", snippet: n.text, vulnerability_type: "sql_injection" })
        }
        // http response: unchanged, already receiver-shaped.
        if (calleeText === "res.send" || calleeText === "res.html" || calleeText.endsWith(".innerHTML")) {
          sinks.push({ type: "http_response", snippet: n.text, vulnerability_type: "xss" })
        }
        // filesystem: unchanged, already receiver-shaped.
        if (
          calleeText === "fs.readFile" ||
          calleeText === "fs.writeFile" ||
          calleeText === "fs.readFileSync" ||
          calleeText === "fs.writeFileSync"
        ) {
          sinks.push({ type: "file_system", snippet: n.text, vulnerability_type: "path_traversal" })
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) traverse(child)
      }
    }
    traverse(node)

    // Deduplicate
    const seen = new Set<string>()
    const uniqueSinks: { type: string; snippet: string; vulnerability_type: string }[] = []
    for (const sink of sinks) {
      if (!seen.has(sink.snippet)) {
        seen.add(sink.snippet)
        uniqueSinks.push(sink)
      }
    }

    return uniqueSinks.length > 0 ? uniqueSinks : undefined
  }

  private nodeRange(node: Node, preferParentStatement: boolean = true): ASTEngine.UniversalSymbol["range"] {
    let targetNode = node

    if (preferParentStatement) {
      // If it's a variable declarator and it's the ONLY declarator in the declaration
      if (
        node.type === "variable_declarator" &&
        node.parent &&
        (node.parent.type === "lexical_declaration" || node.parent.type === "variable_declaration")
      ) {
        let declaratorCount = 0
        for (let i = 0; i < node.parent.namedChildCount; i++) {
          if (node.parent.namedChild(i)?.type === "variable_declarator") declaratorCount++
        }
        if (declaratorCount === 1) {
          targetNode = node.parent
        }
      }

      // If the resulting node is wrapped in an export statement, include the export
      if (targetNode.parent?.type === "export_statement") {
        targetNode = targetNode.parent
      } else if (targetNode.parent?.type === "declaration" && targetNode.parent?.parent?.type === "export_statement") {
        targetNode = targetNode.parent.parent
      }
    }

    // M59 (#861): a DECORATED declaration's node STARTS AT ITS DECORATOR in this
    // grammar family — measured on the pinned wasm:
    //
    //   @sealed
    //   export class Service      export_statement children
    //                             [decorator@18, export@19, class_declaration@19]
    //   @inject("db")
    //   private pool: unknown     public_field_definition children
    //                             [decorator@20, accessibility_modifier@21, ...]
    //
    // so the symbol's own line, its `exports` line and its `contains` line all
    // named the line the DECORATOR is written on (18 and 20) instead of the line
    // the declaration's own name is written on (19 and 21) — the M59 contract is
    // the line the named token appears on. Method decorators are class_body
    // SIBLINGS rather than children, which is why methods were already correct.
    // The family rule is the one scala fixed in scala/declaration-lines-825
    // (leading annotations excluded from the range); this makes typescript's the
    // same rule. Advancing to the first NON-decorator child keeps the range
    // coherent — startLine/startColumn/startIndex all move together, to the
    // `export` keyword of a class or the accessibility modifier of a field,
    // which are on the declaration's own line.
    let startSource = targetNode
    {
      let i = 0
      while (i < targetNode.childCount && targetNode.child(i)?.type === "decorator") i++
      const first = i < targetNode.childCount ? targetNode.child(i) : null
      if (i > 0 && first) startSource = first
    }

    return {
      // tree-sitter rows are 0-indexed; the index convention is 1-based.
      startLine: startSource.startPosition.row + 1,
      startColumn: startSource.startPosition.column + 1,
      endLine: targetNode.endPosition.row + 1,
      endColumn: targetNode.endPosition.column + 1,
      startIndex: startSource.startIndex,
      endIndex: targetNode.endIndex,
    }
  }

  private isTypeScriptBuiltinCall(targetName: string, fullCallee?: string): boolean {
    if (targetName === "super") return true
    // Full expression match first: console.log, console.warn, ...
    if (TS_CONSOLE_BUILTINS.has(fullCallee || "")) return true
    // console.* accessed via optional chaining (console?.log) or spaces
    const trimmed = stripWhitespace(fullCallee || "")
    if (TS_CONSOLE_BUILTINS.has(trimmed)) return true
    // Leaf Object universal methods are always filtered (toString, valueOf,
    // hasOwnProperty, isPrototypeOf, toLocaleString, ...)
    if (TS_OBJECT_LEAF_METHODS.has(targetName)) return true
    return false
  }

  // Relationship identity contract (C#-family): sources/targets are LEAF names
  // — the enclosing method/class/namespace leaf, never file-qualified ids.
  // Calls: Distance -> Sqrt; contains: Example.Features -> Status (namespace
  // qualified for top-level containers, class leaf for members); overrides:
  // UserService.format -> BaseService.format (qualified on both sides).
  // Containers qualify by owner (namespace/class); members use their leaf name.
  private hasToken(node: Node, token: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === token || child.text === token) return true
    }
    return false
  }

  // Project-root lookup, memoized per directory: the walk itself is still
  // filesystem-backed (baseDir anchors absolute imports), but it now runs
  // once per directory per process instead of once per analyzed file.
  private static projectRootCache = new Map<string, string>()

  private findProjectRoot(filePath: string): string {
    let dir = path.dirname(filePath)
    const cache = TypeScriptAnalysisRunner.projectRootCache
    const cached = cache.get(dir)
    if (cached !== undefined) return cached

    let cur = dir
    while (cur !== path.dirname(cur)) {
      const packageJson = path.join(cur, "package.json")
      try {
        if (fs.statSync(packageJson).isFile()) {
          cache.set(dir, cur)
          return cur
        }
      } catch {
        // Continue searching
      }
      cur = path.dirname(cur)
    }

    cache.set(dir, dir)
    return dir
  }

  // ========================================================================
  // METRICS AND QUALITY ASSESSMENT
  // ========================================================================

  private calculateComplexity(node: Node): number {
    // FAMILY CONTRACT (M14 cross-language parity): cyclomatic complexity =
    // 1 + decision points. Decision points are branch constructs and
    // short-circuit operators; an `else` clause NEVER adds (it is not an
    // independent decision). Previously this counter had no base AND
    // double-counted else_clause — two errors that happened to cancel on
    // common shapes, hiding the inconsistency from casual checks.
    let decisions = 0

    const countNode = (n: Node) => {
      // Count control flow structures (else_clause deliberately absent —
      // see contract note above)
      switch (n.type) {
        case "if_statement":
        case "for_statement":
        case "for_in_statement":
        case "while_statement":
        case "do_statement":
        case "switch_case":
        case "catch_clause":
        case "ternary_expression":
        case "conditional_expression":
          decisions++
          break
        case "binary_expression":
          const op = n.childForFieldName("operator")?.text
          if (op === "&&" || op === "||" || op === "??") {
            decisions++
          }
          break
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) countNode(child)
      }
    }

    countNode(node)
    return decisions + 1
  }

  private calculateArchitecturalScore(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): number {
    let score = 100

    // Deduct for high coupling
    const avgRelationships = relationships.length / Math.max(symbols.length, 1)
    if (avgRelationships > 10) score -= 15
    else if (avgRelationships > 5) score -= 5

    // Deduct for missing documentation
    const documentedCount = filterItems(symbols, (s) => s.comments !== undefined && s.comments.length > 0).length
    const docRatio = documentedCount / Math.max(symbols.length, 1)
    if (docRatio < 0.3) score -= 10
    else if (docRatio < 0.5) score -= 5

    // Deduct for too many large classes
    const largeClasses = filterItems(
      symbols,
      (s) => s.kind === ASTEngine.SymbolKind.Class && filterItems(symbols, (m) => m.ownerName === s.name).length > 20,
    ).length
    score -= largeClasses * 5

    // Deduct for deep inheritance
    const hasDeepInheritance =
      filterItems(relationships, (r) => r.type === ASTEngine.RelationshipType.Extends).length > 5
    if (hasDeepInheritance) score -= 10

    // Bonus for good patterns
    const hasTests = someItems(
      symbols,
      (s) => s.name.indexOf("test") !== -1 || s.name.indexOf("spec") !== -1 || s.name.indexOf("Test") !== -1,
    )
    if (hasTests) score += 5

    const hasTypeAnnotations = filterItems(symbols, (s) => !!s.returnType).length / Math.max(symbols.length, 1)
    if (hasTypeAnnotations > 0.7) score += 5

    return Math.max(0, Math.min(100, score))
  }

  private assessCodeQuality(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    complexity: number,
    cyclomaticComplexity: number,
  ): string {
    let qualityScore = 100

    // Complexity penalty
    if (cyclomaticComplexity > 50) qualityScore -= 30
    else if (cyclomaticComplexity > 30) qualityScore -= 20
    else if (cyclomaticComplexity > 15) qualityScore -= 10

    // Large symbol count can indicate god files
    if (symbols.length > 100) qualityScore -= 15
    else if (symbols.length > 50) qualityScore -= 5

    // Low documentation penalty
    const docRatio = filterItems(symbols, (s) => !!s.comments).length / Math.max(symbols.length, 1)
    if (docRatio < 0.2) qualityScore -= 10

    // Type annotation bonus
    const typeRatio =
      filterItems(symbols, (s) => !!s.returnType || (s.parameters ? someItems(s.parameters, (p) => !!p.type) : false))
        .length / Math.max(symbols.length, 1)
    if (typeRatio > 0.8) qualityScore += 10

    if (qualityScore >= 90) return "excellent"
    if (qualityScore >= 75) return "good"
    if (qualityScore >= 50) return "moderate"
    if (qualityScore >= 25) return "poor"
    return "critical"
  }


  private detectReactHookAntiPatterns(rootNode: Node): ASTEngine.ParseError[] {    const errors: ASTEngine.ParseError[] = []
    const seen: Record<string, boolean> = {}

    const warn = (node: Node, callee: string, message: string) => {
      const key = `${node.startPosition.row}:${node.startPosition.column}:${message}`
      if (!!seen[key]) return
      seen[key] = true
      errors.push({
        message: `React Hook "${callee}" ${message}`,
        range: {
          // T7 (review wave): 1-based like every other range in the file
          // (nodeToRange convention) — raw 0-based rows misplaced every
          // hook warning by a line next to 1-based syntax errors.
          startLine: node.startPosition.row + 1,
          startColumn: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column + 1,
          startIndex: node.startIndex,
          endIndex: node.endIndex,
        },
        severity: "warning",
      })
    }

    const fnName = (node: Node): string | undefined => {
      const direct = node.childForFieldName("name")?.text
      if (direct) return direct
      const p = node.parent
      if (p?.type === "variable_declarator") return p.childForFieldName("name")?.text
      if (p?.type === "pair") return p.childForFieldName("key")?.text
      return undefined
    }

    const traverse = (node: Node) => {
      if (node.type === "call_expression") {
        const callee = node.childForFieldName("function") || node.namedChild(0)
        if (
          callee &&
          callee.type === "identifier" &&
          callee.text.startsWith("use") &&
          callee.text.length > 3 &&
          callee.text[3] === callee.text[3].toUpperCase()
        ) {
          let nearestFn: Node | null = null
          let higherFn = false
          let current: Node | null = node.parent
          while (current) {
            if (
              ["function_declaration", "function_expression", "arrow_function", "method_definition"].includes(
                current.type,
              )
            ) {
              if (!nearestFn) {
                nearestFn = current
              } else {
                higherFn = true
              }
            }
            if (
              ["if_statement", "for_statement", "while_statement", "do_statement", "switch_statement"].includes(
                current.type,
              )
            ) {
              warn(node, callee.text, "is called conditionally or in a loop, which violates the Rules of Hooks.")
            }
            current = current.parent
          }

          const name = nearestFn ? fnName(nearestFn) : undefined
          const valid = !!name && (name.startsWith("use") || name[0] === name[0].toUpperCase())
          if (!valid) {
            warn(node, callee.text, "is called outside a React component or custom hook.")
          }
          if (higherFn) {
            warn(node, callee.text, "is called inside a nested function, which violates the Rules of Hooks.")
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(rootNode)
    return errors
  }
}

function mapItems<T, U>(arr: T[], mapper: (item: T) => U): U[] {
  const result: U[] = []
  if (!arr) return result
  for (let i = 0; i < arr.length; i++) {
    result.push(mapper(arr[i]))
  }
  return result
}

function filterItems<T>(arr: T[], predicate: (item: T) => boolean): T[] {
  const result: T[] = []
  if (!arr) return result
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) result.push(arr[i])
  }
  return result
}

function findItem<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
  if (!arr) return undefined
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return arr[i]
  }
  return undefined
}

function someItems<T>(arr: T[], predicate: (item: T) => boolean): boolean {
  if (!arr) return false
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return true
  }
  return false
}

function everyItem<T>(arr: T[], predicate: (item: T) => boolean): boolean {
  if (!arr) return true
  for (let i = 0; i < arr.length; i++) {
    if (!predicate(arr[i])) return false
  }
  return true
}

function getObjectKeys(obj: any): string[] {
  const keys: string[] = []
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      keys.push(k)
    }
  }
  return keys
}

// Taint sink vocabulary (H1). Receivers and leaves are listed SEPARATELY so the
// rule can demand both: a shell sink needs a child_process-shaped RECEIVER and
// an exec-family LEAF, which is exactly what `RegExp.prototype.exec` and a
// project's own `spawn()` fail. Pure string sets — no regex, no text search.
const TS_SHELL_RECEIVERS = new Set([
  "child_process", "childProcess", "cp", "proc", "shell", "sh", "bash", "zsh", "execa",
])
const TS_SHELL_LEAVES = new Set([
  "exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork",
])

// Global constructor intrinsics/DOM APIs: `new Promise()` is construction
// of the RUNTIME, not of a project type — instantiates edges to these are
// noise (same rationale as the JVM stdlib filters).
const JS_GLOBAL_CONSTRUCTORS = new Set([
  "Promise", "Date", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Proxy",
  "Error", "TypeError", "RangeError", "SyntaxError", "URIError", "EvalError",
  "AggregateError", "RegExp", "Array", "Object", "Function", "Boolean",
  "Number", "String", "BigInt", "ArrayBuffer", "SharedArrayBuffer",
  "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array",
  "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "WeakRef", "FinalizationRegistry",
  "AbortController", "FormData", "Blob", "File", "URL", "URLSearchParams",
  "Headers", "Request", "Response", "Intl", "Image", "Worker", "SharedWorker",
  "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "ResizeObserver",
  "MutationObserver", "IntersectionObserver", "PerformanceObserver",
  "FileReader", "XMLHttpRequest", "WebSocket", "TextEncoder", "TextDecoder",
  "DOMParser", "Notification", "BroadcastChannel", "MessageChannel",
  "FocusEvent", "InputEvent", "PointerEvent", "TouchEvent", "DragEvent", "ErrorEvent", "UIEvent", "StorageEvent", "PromiseRejectionEvent", "HashChangeEvent", "PageTransitionEvent", "PopStateEvent", "ProgressEvent", "SpeechSynthesisEvent", "AnimationEvent", "TransitionEvent", "ClipboardEvent", "WheelEvent", "CompositionEvent", "BeforeUnloadEvent",
])

export class RealTypeScriptAnalyzer implements ASTEngine.LanguageAnalyzer {

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    return new TypeScriptAnalysisRunner().analyze(rootNode, content, filePath, context)
  }
}
