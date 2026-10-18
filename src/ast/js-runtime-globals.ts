/**
 * JS RUNTIME + TEST-RUNNER GLOBALS — the SECOND closed, cited list a `uses`/`calls` target may be
 * claimed EXTERNAL with, beside `HOST_GLOBALS` in `js-builtin-prototypes.ts`.
 *
 * WHY A SECOND LIST. `HOST_GLOBALS` answers "is this a property of the ECMAScript global object or
 * the HTML `Window` surface" — the names the LANGUAGE and the HTML platform install. It does not
 * carry `process`, `Buffer`, `module`, `require`, `__dirname` (Node.js's host surface) or `it`,
 * `describe`, `test`, `expect`, `jest` (test-runner globals), which are installed by the RUNTIME and
 * by a test framework. Those names are exactly as external to a repository as `document` is, but
 * they come from a different authority, so they need their own citations rather than a wider
 * platform list. Folding them into `HOST_GLOBALS` would make one table serve two questions and lose
 * the ability to cite either.
 *
 * THE DISCIPLINE IS THE POINT: a name not in this table gets NO claim. A heuristic ("looks like a
 * test runner", "starts with `process`") would be the closed-list lie this fleet keeps catching
 * itself violating. Every entry below is documented as a GLOBAL by the official API page named in
 * its citation; no blog posts, no secondary sources.
 *
 * CITED SOURCES (official documentation only):
 *   Node.js API — https://nodejs.org/api/globals.html            (`process`, `Buffer`, `global`,
 *                                                                 `setImmediate`, `clearImmediate`)
 *   Node.js API — https://nodejs.org/api/modules.html            (`require`, `module`, `exports`,
 *                                                                 `__dirname`, `__filename` — the
 *                                                                 CommonJS wrapper locals, available
 *                                                                 bare in every CommonJS module)
 *   Node.js API — https://nodejs.org/api/process.html            (`process`'s own page)
 *   Node.js API — https://nodejs.org/api/buffer.html             (`Buffer`'s own page)
 *   Node.js API — https://nodejs.org/api/timers.html             (`setImmediate`, `clearImmediate`)
 *   Jest Globals — https://jestjs.io/docs/api                   (`describe`, `test`, `it` alias,
 *                                                                 `beforeAll`, `afterAll`,
 *                                                                 `beforeEach`, `afterEach`)
 *   Jest Expect  — https://jestjs.io/docs/expect                 (`expect`)
 *   Jest Object  — https://jestjs.io/docs/jest-object            (`jest`)
 *   Vitest API   — https://vitest.dev/api/                       (`vi`, plus the Jest-shaped names it
 *                                                                 deliberately mirrors)
 *   Mocha        — https://mochajs.org/                          (BDD interface: `describe`,
 *                                                                 `context`, `it`, `specify`,
 *                                                                 `before`, `after`, `beforeEach`,
 *                                                                 `afterEach`)
 *   QUnit API    — https://qunitjs.com/api/                      (`QUnit` — QUnit exposes its API
 *                                                                 through the `QUnit` object, not as a
 *                                                                 bare `test`/`describe`; the older
 *                                                                 `api.qunitjs.com/QUnit/` redirects
 *                                                                 here, verified 2026-10-18)
 *
 * WHAT THIS LIST DOES **NOT** PROVE, stated so it is not "fixed" with a wider list:
 *
 *   · A MANIFEST IS NOT VISIBLE TO A PER-FILE ANALYZER. A name like `expect` is a Jest/Vitest/
 *     Mocha global only when the project actually uses that runner; without a file bound at the
 *     name, a bare `expect(...)` in a repository that neither imports nor declares it is far more
 *     likely the runner's global than a project invention, but the analyzer cannot READ the
 *     manifest (`package.json`, `jest.config.*`, `.mocharc.*`) to prove which runner. The closed
 *     list plus the claim's refutability — the FILE's own binding/declaration refuses the claim,
 *     and the project's key space answers the name — is the honest substitute; a project that
 *     installs its own GLOBAL `test` through a setup file is a declared limitation, not a case
 *     this list can see.
 *   · A MEMBER OF THESE GLOBALS IS NOT CLAIMED FROM THIS TABLE. `jest.fn()`, `process.argv.slice`
 *     and `QUnit.test()` name a LEAF (`fn`, `slice`, `test`) that a project may genuinely declare
 *     as a member somewhere; claiming the leaf here would be the same refutable-target mistake the
 *     host-global member rule avoids by requiring the receiver ROOT to be on its list. Those rows
 *     stay unresolved and are counted as a class in
 *     `validation/m14/verification/JAVASCRIPT-RESOLUTION-CLASSIFICATION.md`.
 */

/** name -> the official citation that documents it as a global, in this order of authority. */
const RUNTIME_GLOBALS: Readonly<Record<string, string>> = {
  // ── Node.js host surface ──────────────────────────────────────────────────────────────────────
  process: "Node.js API §process (https://nodejs.org/api/process.html) — a global",
  Buffer: "Node.js API §Buffer (https://nodejs.org/api/buffer.html) — a global class",
  global: "Node.js API §global (https://nodejs.org/api/globals.html#global)",
  setImmediate: "Node.js API §setImmediate (https://nodejs.org/api/timers.html#setimmediatecallback-args)",
  clearImmediate: "Node.js API §clearImmediate (https://nodejs.org/api/timers.html#clearimmediateimmediate)",
  require: "Node.js API §require (https://nodejs.org/api/modules.html#requireid) — the CommonJS wrapper local, available bare",
  module: "Node.js API §module (https://nodejs.org/api/modules.html#the-module-object) — the CommonJS wrapper local, available bare",
  exports: "Node.js API §exports (https://nodejs.org/api/modules.html#exports) — the CommonJS wrapper local, available bare",
  __dirname: "Node.js API §__dirname (https://nodejs.org/api/modules.html#__dirname)",
  __filename: "Node.js API §__filename (https://nodejs.org/api/modules.html#__filename)",

  // ── Test-runner globals (Jest-canonical spellings; Vitest mirrors them by design) ────────────
  describe: "Jest Globals §describe (https://jestjs.io/docs/api) — also a Mocha BDD global (https://mochajs.org/) and mirrored by Vitest (https://vitest.dev/api/)",
  context: "Mocha BDD §context (https://mochajs.org/) — an alias of describe",
  it: "Jest Globals §test, of which `it` is the alias (https://jestjs.io/docs/api) — also a Mocha BDD global and mirrored by Vitest",
  test: "Jest Globals §test (https://jestjs.io/docs/api) — also a Mocha BDD global and mirrored by Vitest",
  specify: "Mocha BDD §specify (https://mochajs.org/) — an alias of it",
  expect: "Jest API §expect (https://jestjs.io/docs/expect) — mirrored by Vitest (https://vitest.dev/api/)",
  beforeAll: "Jest Globals §beforeAll (https://jestjs.io/docs/api) — mirrored by Vitest",
  afterAll: "Jest Globals §afterAll (https://jestjs.io/docs/api) — mirrored by Vitest",
  beforeEach: "Jest Globals §beforeEach (https://jestjs.io/docs/api) — also a Mocha BDD global; mirrored by Vitest",
  afterEach: "Jest Globals §afterEach (https://jestjs.io/docs/api) — also a Mocha BDD global; mirrored by Vitest",
  before: "Mocha BDD §before (https://mochajs.org/) — the TDD/BDD hook",
  after: "Mocha BDD §after (https://mochajs.org/) — the TDD/BDD hook",
  jest: "Jest Object (https://jestjs.io/docs/jest-object) — a global",
  vi: "Vitest API §vi (https://vitest.dev/api/) — a global",
  QUnit: "QUnit API (https://qunitjs.com/api/) — QUnit exposes its API through the QUnit global",
}

/**
 * The citation for a bare name that is a documented RUNTIME or TEST-RUNNER global, or `null` when
 * it is not on the cited list. Returns the CITATION (not a boolean) because the caller publishes
 * it as the claim's stated reason — a claim without its citation is prose.
 */
export function runtimeGlobalCitation(name: string): string | null {
  return RUNTIME_GLOBALS[name] ?? null
}

/**
 * WHICH AUTHORITY INSTALLS THE NAME — the two halves of this table are different claims, and the
 * arbiter's reason column keeps them apart so neither can hide inside the other's count.
 *
 *   node-runtime-global   installed by the Node.js host (`process`, `Buffer`, the CommonJS wrapper
 *                         locals, the timer immediates)
 *   test-runner-global    installed by a test framework (`describe`, `it`, `test`, `expect`, `jest`, …)
 */
export function runtimeGlobalReason(name: string): "node-runtime-global" | "test-runner-global" | null {
  if (!isRuntimeGlobal(name)) return null
  return NODE_RUNTIME_NAMES.has(name) ? "node-runtime-global" : "test-runner-global"
}

/** Which entries are the Node.js host surface (the rest are test-runner globals). */
const NODE_RUNTIME_NAMES: ReadonlySet<string> = new Set([
  "process", "Buffer", "global", "setImmediate", "clearImmediate",
  "require", "module", "exports", "__dirname", "__filename",
])

/** The closed list itself, for callers that must show what the vocabulary contains. */
export function isRuntimeGlobal(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(RUNTIME_GLOBALS, name)
}

/** The cited names, for instruments that must declare the population of the list. */
export function runtimeGlobalNames(): string[] {
  return Object.keys(RUNTIME_GLOBALS)
}
