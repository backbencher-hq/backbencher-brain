// Clean fixture: the declaration/definition merge, and an operator as a callable.
//
// Two contracts, both measured defects before the ruling:
//
//  1. `mergeTarget :: ...` and `mergeTarget x = ...` are ONE entity — the
//     definition wins, range and all (the C prototype/definition merge). Kept
//     as two entities they export the same name twice, which the exports-family
//     invariant rejects: a duplicate cannot identify its provider.
//
//  2. `(++.) x y = helper x` is an `operator_definition`, a DIFFERENT node from
//     `function_declaration`. It is a callable, so the call it makes belongs to
//     `++.` — and ONLY to `++.`: the operator's attribution must be released
//     when its scope ends, or it swallows the next module-level application
//     (`laterFn z = tweak z`) and fabricates `++. -> tweak`.
implementation module SignatureDefinitionMerge

import StdEnv

mergeTarget :: !Int -> Int
mergeTarget x = helper x

(++.) infixr 5 :: !Int !Int -> Int
(++.) x y = helper x

laterFn :: !Int -> Int
laterFn z = tweak z

tweak :: !Int -> Int
tweak w = w - 1

helper :: !Int -> Int
helper y = y + 1
