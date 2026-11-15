// process.ts — the EVIDENCE-AT-RISK fixture (file name is load-bearing: the module leaf is `process`,
// which is in the shared worker's JS_GLOBALS denylist).
//
// The shared worker (src/ast/pool-worker.ts, `keepSymbol`) DROPS a JS-family symbol named `process`
// even though THIS file genuinely declares and exports it; its dropped-symbol invariant then deletes
// every relationship whose SOURCE or TARGET is `process` — and the module-leaf source of
// imports/exports rows IS `process`. So `imports` evidence for this file never reaches the product.
// The arbiter verifies imported-binding claims against that evidence, so claims here would be
// REFUTED (measured: bindFAIL 2 on the whole-population arm, both in shopify's
// process.ts). The lane withholds imported-binding claims in such files until the shared invariant
// stops applying to the synthetic module-leaf source (Lead-owned fix). The imports evidence itself is
// still emitted by the analyzer and pinned below.
import { StatusCode } from '@shopify/network'

export interface HandlerCallResult {
  statusCode: StatusCode
}

export function process(): HandlerCallResult {
  return { statusCode: StatusCode.Ok }
}
