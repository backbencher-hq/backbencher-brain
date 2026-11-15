// VERIFY_TS / M14 JAD2-class: a `calls` target is a NAME, reduced from the callee
// by SHAPE. `callee.text` as the target was a denylist problem: it published the
// raw expression text for every callee shape the reducer did not understand.
//
// Measured callee shapes over 32,672 `call_expression` nodes on 400 git-tracked
// corpus files (bb_tests/repositories/typescript): identifier 18,529 ·
// member_expression 14,030 · parenthesized_expression 51 · import 22 ·
// non_null_expression 11 · super 10 · await_expression 8 · call_expression 6 ·
// subscript_expression 3 · unary_expression 2. The eight shapes that are neither an
// identifier nor a member expression are the eight the denylist had to enumerate
// garbage from, one at a time.
//
// The corpus defects this pins, verbatim from the pre-fix run:
//
//   bb_tests/repositories/typescript/packages/vscode-typescript/src/extension.ts
//     calls activate -> "!context.globalState.get"
//   bb_tests/repositories/typescript/tsc/testdata/fixtures/compiler/sys.ts
//     calls watchFile -> "ensureDynamicPollingWatchFile()"
//     calls nonRecursiveWatchDirectory -> "ensureFixedChunkSizePollingWatchFile()"
//
// Both files ALSO published the correct edge, because the callee is a NAMED child
// of the call_expression and the recursion reaches it — so the fabricated edge was
// a DUPLICATE carrying a pseudo-name that no symbol index can join.
//
// Authored BEFORE the analyzer run, from the corpus probe and the grammar's own
// node-types.json. Every case below is a shape the probe measured.
declare const state: { get(k: string): string | undefined };

/** unary_expression callee — `!a.b.get(x)` reduces THROUGH the negation to `get`. */
export function readNegated(key: string): string | undefined {
  return !state.get(key);
}

/** non_null_expression callee — `foo!()` reduces through the `!` to `foo`. */
declare function maybe(): { run(): number } | undefined;
export function runNonNull(): number {
  return maybe()!.run();
}

/** parenthesized_expression callee — `(foo)()` reduces to `foo`. */
export function runParen(): string {
  const inner = (readNegated)("k");
  return inner ?? "";
}

/** call_expression callee — `f()(x)`. The INNER call is its own node and publishes
 *  its own edge; publishing here too produced `f()` as a target. */
declare function factory(): (x: number) => number;
export function runIIFE(x: number): number {
  return factory()(x);
}

/** await_expression callee. */
declare function fetchIt(): Promise<string>;
export async function runAwait(): Promise<string> {
  return (await fetchIt());
}

/** An anonymous IIFE names nothing and must publish NO calls edge at all, while its
 *  body is still walked — the edge is skipped, never the subtree. */
export function runAnonymousBody(): number {
  return (function () {
    return state.get("k") ? 1 : 0;
  })();
}
