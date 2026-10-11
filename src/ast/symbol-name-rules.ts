/**
 * THE universal symbol-name denylist, and the reason it is a module instead of a
 * literal in each consumer.
 *
 * Two places decide whether an analyzer's symbol may exist: `keepSymbol` in
 * `pool-worker.ts` (applied on the parse path, and exported so audits can ask the
 * production function instead of re-stating its rules) and `SYMBOL_NAME_DENYLIST`
 * in `parallel-indexer.ts` (applied on the STORE path, per file, to the symbols the
 * worker returned). They began as the same list. Then this set was measured and
 * corrected — R 12 symbols deleted across 9 files, graphql 1 of 8,796 (`Query.me`),
 * sql 3 of 18,325, lua 236 declarations (leaving 677 edges pointing at nothing), hcl
 * H10, solidity's store-vs-analyzer divergence — and the indexer's copy was not, so
 * seven names were RE-ADMITTED by the corrected filter and dropped one layer
 * downstream, on the production path, where nothing reported the loss.
 *
 * The sharpest instance, because it is a name the source literally writes and a
 * consumer literally imports: `export function self(fn)` at
 * `packages/svelte/src/internal/client/dom/legacy/event-modifiers.js:27` is published
 * by the analyzer, passes `keepSymbol`, and appeared in NO symbol row project-wide.
 *
 * A list in two places is a register problem, not a copy problem: fixing the copy
 * re-creates the trap. So the shared half lives here, both admission points read
 * THIS object, and a name can only leave it with a measurement attached — the way
 * the entries below did.
 *
 * Reserved in essentially every language parsed here, kept unconditionally because
 * no lane has produced a legitimate declaration of any of them:
 */
export const SYMBOL_NAME_UNIVERSAL_DENYLIST: ReadonlySet<string> = new Set([
  "this",
  "super",
  // Synthetic artifact names the analyzers themselves mint. These are OURS, not
  // the language's, so no user program can declare them.
  "SCSS_FILE_SCOPE",
  "GlobalScope",
  "module_declaration",
  "package_manifest",
])

/**
 * The names REMOVED from the set above, each with the measurement that removed it.
 * Kept as a register rather than a comment so a future edit that "restores a missing
 * entry" has to argue with the evidence:
 *
 *   self, Self    deleted R/Python/Zig `self`; lua declares `local this`
 *   me, My        legitimate in every language (graphql `me`, lua `me`)
 *   destructor    a real method name in C++/Rust/Go
 *   root          lua `local root` at lazy.nvim/lua/lazy/core/loader.lua:497
 *   program       a legal SQL column name
 *   source_file   an ordinary R function (r-testthat/R/source.R:18)
 *   unknown       hcl declares a variable literally named `unknown`
 *
 * `unknown` is the one that cannot simply be deleted: R7 counts it as a PLACEHOLDER
 * and 46 registered placeholder sites depend on that, so it is refused for the
 * REGEX FALLBACK path only (see `isFallbackResult` in parallel-indexer.ts and
 * RESERVED in pool-worker.ts), which keeps a placeholder refused while a declared
 * `unknown` survives.
 */
/**
 * Names reserved in ONE language, consulted only for a language that reserves
 * them. These cannot live in the universal set: `self` is reserved in PHP and a
 * LEGAL variable in Lua, Python 3, Rust and Zig, all parsed by this project, and
 * `program` is reserved in Haskell/Elm-ish contexts and a legal SQL column name.
 */
export const SYMBOL_NAME_LANGUAGE_RESERVED: Record<string, ReadonlySet<string>> = {
  php: new Set(["self", "parent"]),
  sql: new Set(["program"]),
}

/**
 * The whole name half of symbol admission, as ONE pure function of (name, language).
 * `keepSymbol` in pool-worker.ts calls it, and so does `storeableName` in
 * parallel-indexer.ts — the two decisions that used to be two lists.
 *
 * Behaviour beyond the language check (the `__global__` sentinel, the JS-family
 * globals, the artifact-name patterns) stays with its own caller, because those are
 * properties of the CALLER's input shape rather than of the name.
 */
export function isDenylistedSymbolName(name: string, lang: string): boolean {
  if (SYMBOL_NAME_UNIVERSAL_DENYLIST.has(name)) return true
  return SYMBOL_NAME_LANGUAGE_RESERVED[(lang || "").toLowerCase()]?.has(name) === true
}

export const SYMBOL_NAME_DENYLIST_REMOVED: ReadonlyMap<string, string> = new Map([
  ["self", "deleted R/Python/Zig `self`"],
  ["Self", "deleted R/Python/Zig `self`"],
  ["me", "legitimate in every language (graphql `me`, lua `me`)"],
  ["My", "legitimate in every language"],
  ["destructor", "a real method name in C++/Rust/Go"],
  ["root", "lua `local root` at lazy.nvim/lua/lazy/core/loader.lua:497"],
  ["program", "a legal SQL column name"],
  ["source_file", "an ordinary R function (r-testthat/R/source.R:18)"],
  ["unknown", "hcl declares a variable literally named `unknown`"],
])
