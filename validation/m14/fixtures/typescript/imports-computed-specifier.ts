// VERIFY_TS / M14: a COMPUTED module specifier is not a module.
//
// `stringContent` returns the first `string_fragment` of a `template_string`, which
// for a template with a substitution is the text BEFORE the first `${`. That is the
// right answer to "what is the literal part of this template" and a fabricated
// answer to "what module does this file depend on".
//
// Found by the lane's own independent oracle
// (script/lanes/typescript/ts-deriv-audit.ts against
// script/m14/oracles/typescript-imports-exports.ts) on 198 git-tracked corpus
// files, as three ANALYZER-ONLY `imports` rows — emitted, and reproduced by no
// independent derivation:
//
//   tools/scripts/tsc/generate-enums.ts
//     `data:text/javascript;charset=utf-8,${encodeURIComponent(enumSource)}`
//       -> imports generate-enums -> "data:text/javascript;charset=utf-8,:*"
//   tsc/internal/stringutil/_scripts/generate-unicode-data.mts
//     `${PACKAGE}/${property}/code-points.js`
//       -> imports generate-unicode-data -> "/:*"        (first fragment is "/")
//
// Both targets name no module in any resolution model, so both are dependency edges
// that cannot be resolved, stored, and looked like dependencies.
//
// A template with NO substitution is a literal path and is still honoured, so the
// negative half of this fixture matters as much as the positive half: the guard is
// "has a substitution", not "is a template".
//
// Authored BEFORE the analyzer run.
declare const dir: string;
declare const entry: string;

/** Computed: `${}` present. No `imports` edge — `${dir}/thing.ts` names no module. */
export async function lazyComputed(): Promise<unknown> {
  return import(`${dir}/thing.ts`);
}

/** Computed through a `require`. Same rule, same silence. */
export function requireComputed(): unknown {
  return require(`${dir}/${entry}.js`);
}

/** Computed as an import SPECIFIER position. */
export function importComputed(): void {
  void import(`${dir}/side-effect.css`);
}

/** NO substitution: a literal TEMPLATE (backticks, no `${}`). The edge is still
 *  published — the guard is "carries a substitution", not "is a template". */
export async function lazyLiteralTemplate(): Promise<unknown> {
  return import(`./literal-template.ts`);
}

/** NO substitution: a plain string specifier. The ordinary case, unchanged. */
export async function lazyLiteral(): Promise<unknown> {
  return import("./literal.ts");
}

/** A literal string import SPECIFIER: the ordinary case, unchanged. */
import { helper } from "./named.ts";
export function usesNamed(): number {
  return helper(1);
}
