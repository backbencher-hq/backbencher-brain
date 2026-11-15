// Clean fixture: a DEFINITION MODULE's declared interface.
//
// A `.dcl` is declarations only — its entire content is the module's interface —
// and the analyzer used to publish a symbol for `function_declaration` alone, so
// every line below was invisible in the index.
//
// The four shapes the pinned grammar puts inside `signature_name`, one each:
//   identifier              `interfaceFunction`
//   constructor             `NSMakeSize` — Clean lets an uppercase name be a
//                           FUNCTION, and the grammar types such a name
//                           `constructor`
//   parenthesized_operator  `(%.`    — the name is `%.`
//   parenthesized_name      `(bitxor)` — the name is `bitxor`
//
// Each must publish a symbol AND appear in the export list: the exports are the
// index's importable-unit set, and for a definition module that set is exactly
// these lines.
definition module DefinitionModuleInterface

import StdEnv

interfaceFunction :: !Int -> Bool
NSMakeSize :: !Int !Int -> Int
(%.) infixl 9 :: !Int !Int -> Int
(bitxor) :: !Int !Int -> Int
