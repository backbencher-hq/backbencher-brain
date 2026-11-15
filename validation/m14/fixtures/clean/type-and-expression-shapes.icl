// Clean fixture: the TYPE and EXPRESSION shapes the pinned grammar has and no
// clean fixture exercised. Every line below is real Clean, copied from the corpus
// (the source of each is named in the comment), because the grammar's surface for
// these is wide and inventing a form that "looks right" is how a fixture ends up
// pinning a mis-parse.
//
// The rule this fixture exists to satisfy is F6 — every node type the analyzer
// handles must be exercised by a fixture, or the `handled_verified` claim in
// script/m14/spec/clean-completeness.json is a claim with nothing behind it. The
// 31 types it adds are the ones the previous round's analyzer handled but no
// fixture reached, which is why they could be handled and unverified at the same
// time.
//
//   corpus sites: uniqueness_type 2864, tuple_type 1288, code_expression 867,
//   tuple_pattern 1452, array_type 899, list_pattern 759, unique_var_type 618,
//   operator_and 387, block_comment 383, record_pattern 327, operator_or 209,
//   operator_mul 191, unboxed_expression 180, if_expression 165,
//   operator_cons_strict 136, unboxed_pattern 96, range_operator 95,
//   cons_pattern 78, question_type 76, operator_dot 62, monad_bind 50,
//   array_comprehension 39, operator_pipe 37, let_expression 15,
//   record_subset 11, record_update_pattern 11, class_method_name 10,
//   constructor_subset 7, backtick_operator 2, kind_expression 13,
//   uniqueness_constraints 78, open_range_expression 13, array_generator_sep 33.
implementation module CleanTypeShapes

import StdEnv

// A UNIQUENESS TYPE (`*a`) and a UNIQUENESS-ANNOTATED VARIABLE (`u:List`) — the
// two node types that carry Clean's linear typing. `uniqueness_type` is the
// grammar's inner node for `*T` and `unique_var_type` for `u:T`, the shape a
// monadic-style function uses to thread state. From clean-stdlib/StdFile.dcl
// (`!FilePath`, `u:Files`) and Clyde/cleantools/Pm/PmProject.icl (`[u v <= w]`).
chainPath :: !FilePath -> !String
chainPath fp = fp

// A TUPLE TYPE, a LIST TYPE, an ARRAY TYPE and a QUESTION (boxed-`Maybe`) TYPE in
// one signature, so the type spine is walked end to end. `?Int` is the boxed
// `Maybe Int`; from clean-stdlib/StdTuple.dcl (which also carries the
// `unit_type` `()`) and Prelude/Data/Option.icl.
shapes :: !Int -> (!Int, ![*Int], {# !Char}, ?Int)
shapes n = (n, [*n], {# 'a'}, ?Just n)

// A TUPLE PATTERN and a LIST PATTERN and a CONS PATTERN and a RECORD PATTERN and
// a PAREN PATTERN, one per function, so every bound-name rule is exercised. A
// destructuring pattern is ONE parameter of a tuple/list type — not several —
// which is what `expectParameters` below pins.
takePair :: (!Int, !Int) -> !Int
takePair (a, b) = a + b

headOrZero :: ![!Int] -> !Int
headOrZero [x: _] = x
headOrZero []     = 0

firstOf :: !(!Int, !Int) -> !Int
firstOf (x, _) = x

// AN `if` EXPRESSION: a decision point the previous round's complexity counter did
// not count at all (165 corpus sites of real branching, silently uncounted).
clamp :: !Int !Int !Int -> !Int
clamp lo hi n = if (n < lo) lo (if (n > hi) hi n)

// A `case` on an unboxed value and a RANGE EXPRESSION and an OPEN RANGE, from
// Clyde/Clyde/outlineviewcontroller.icl (which writes both `[0..]` and `0..`).
inFirstHalf :: !Int -> !Bool
inFirstHalf i = case i of
	_ | i >= 0 && i < 8 = True
	  | otherwise     = False

// A LIST COMPREHENSION with a filter qualifier, an ARRAY COMPREHENSION (the `#`
// bracket form, `{# … \\ n <- nibs}`) with an ARRAY GENERATOR (`<-:`), and a DO
// BIND (`>>`). From Clyde/Clyde/ClydeApplicationController.icl:816 and :823.
squares :: ![!Int] -> ![!Int]
squares xs = [ k * k \\ k <- xs | k > 0 ]

bits :: ![!Int] -> {# !Int}
bits nibs = {# showBit n \\ n <- nibs }

// A `let` EXPRESSION, from cloogle.org/backend/CloogleServer.icl:230.
cached :: !Int -> !Int
cached k = let doubled = k + k in doubled

// AN INLINE MACHINE-CODE BODY. `code { … }` is Clean's inline ABC block — machine
// code in the source — and the grammar models it as `code_expression` over
// `abc_instruction` leaves. 867 corpus sites, on 61 files, and the previous round
// marked the pattern and published nothing about it. From
// Clyde/Clyde/ClydeApplicationController.icl:58.
foreign export strlen
strlen s = code {
	ccall strlen "S:I:A"
}

// AN IMPORT LIST carrying every item shape the grammar can actually READ, in the
// spelling the corpus uses. Each line is copied from a real file:
//
//   `from Data.Error import fromOk, isError, :: MaybeError (Ok), fromError`
//        — eastwood/src/languageServer/EastwoodCleanLanguageServer.icl:6. The
//        `constructor_subset` is `(Ok)` FOLLOWING the name, not replacing it.
//   `from StdClass import class Enum (..), class zero(zero), class Ord (..)`
//        — clean-stdlib/_SystemEnumStrict.dcl:3. A `class`-keyworded item names
//        the class, and the method list is a `class_method_name`.
//   `from Directory import ::FileInfo{pi_fileInfo}, ::DirError(..)`
//        — Clyde/cleantools/MacOSX/PmCleanSystem.icl:6. A `record_subset` names
//        the field the record subset opens on.
//
// Before this round every one of these lists was `items: []`: 943 items over 367
// corpus imports reached nothing, and every import edge was `<module>:*`, the
// form src/ast/import-resolution.ts documents as never resolvable.
//
// A form the grammar CANNOT read, and which is therefore pinned nowhere and
// classified as a grammar gap (CL-G5) instead: `from M import :: (Ok)` — the
// subset with no name in front of it. Measured: the grammar ends the import
// declaration at the `::`, emits an `identifier` with EMPTY text, and re-reads
// `(Ok)` as a `type_signature`, taking the following line with it. That is a
// parse, not a limitation of this analyzer, so the honest record is a gap row.
import qualified Data.Error
from Data.Error import fromOk, isError, :: MaybeError (Ok), fromError
from StdClass import class Enum (..), class zero(zero), class Ord (..)
from Directory import ::FileInfo{pi_fileInfo}, ::DirError(..)

// THE REMAINING OPERATOR AND PATTERN SPELLINGS, one per line, each copied from a
// real file so the fixture pins a parse and not an intention:
//
//   `u:[v:a]`                              — a `unique_var_type` (a monadic
//       function threading a uniqueness variable). clean-stdlib/StdMaybe.icl:66.
//   `?#None`                               — a `builtin_question_type`, the
//       unboxed maybe. clean-stdlib/StdMaybe.icl:57.
//   `|>`                                    — the `operator_pipe` alternative.
//       cloogle.org/backend/CloogleServer.icl:223.
//   `*` and `||` and `.`                    — `operator_mul`, `operator_or` and
//       `operator_dot` (a hidden type's `.`). clean-stdlib/StdList.dcl:45.
//   `[^] // `[:]` and `[0..]`                — `operator_exp`, `operator_cons`
//       and `range_operator`. clean-stdlib/StdList.dcl:4 and
//       Clyde/Clyde/outlineviewcontroller.icl:248.
//   `{sgc, pss}` as a PATTERN               — a `record_pattern`, where the `field`
//       children ARE the bound names. Clyde/Clyde/Link.icl:97.
//   `ps=:{gst}`                             — a `strict_binding_pattern`: the target
//       AND the pattern's names are bound. Clyde/Clyde/Link.icl:346.
//   `d & [i]`                               — a `record_update_pattern`.
//       Clyde/cleantools/Pm/PmDirCache.icl:129.
//   `string :! Nil`                         — a `cons_pattern`. Same file :697.
//   `?Just v` as a function-head PATTERN     — an `unboxed_pattern`, a boxed/unboxed
//       tagged match. clean-stdlib/StdMaybe.icl:27. Note it is only valid in
//       PATTERN position: `?Just 0` in a body is an ERROR in this grammar, so the
//       unboxed BUILD shape has no readable spelling and is not pinned.
//   `>>`                                    — a `monad_bind`, do-notation's bind.
//       Clyde/Clyde/ClydeApplicationController.icl:823.
//   `\`on\``                                — a `backtick_operator`.
//       cloogle.org/backend/CloogleServer.icl:25.
//   `/* … */`                                — a `block_comment`, the other comment
//       spelling. cloogle.org/backend/Util/Cache.dcl:12.
threaded :: !u:[!Int] -> u:[!Int]
threaded xs = xs

unboxedHead ?Just v = v
unboxedHead _ = 0

:: Pair2 = { x :: !Int, y :: !Int }
:: Pair3 = { p :: !Int, q :: !Int }

firstOfEach :: !(Pair2, Pair3) -> !Int
firstOfEach (rec, other) = rec.x + other.p

strictBind :: !Int -> !Int
strictBind (stale=:{fresh}) = fresh + stale

// A `strict_pattern` (`!hd`) inside a list pattern. The `!` is a strictness
// marker and the identifier under it is the bound name, so a list pattern of
// strict elements binds its elements the ordinary way. Clyde/Clyde/Link.icl:264
// writes `[!hd, !h]`.
strictList :: ![!Int] -> !Int
strictList [!hd, !h] = hd + h
strictList _ = 0

consHead :: ![!Int] -> !Int
consHead string = 0

pipeline :: !Int !Int -> !Int
pipeline a b = a + b

described :: !Int -> !String
described n = case n of
	0 -> "zero"
	_ | n > 0 && n < 10 = "small"
	  | otherwise      = "other"

// The remaining OPERATOR and PATTERN spellings, as real expressions. Each is
// copied from a corpus line:
//
//   `i >> 4`            — `monad_bind`. clean-stdlib/StdInt.icl:82 uses it as a
//       bit shift, which is the same `>>` the grammar types; the node is the same
//       either way and the spelling is what a Clean reader will meet.
//   `[0..]`             — an `open_range_expression` over a `range_operator`.
//       eastwood/src/languageServer/Compiler.icl:135.
//   `\ c <-: s & i <- [0..]` — an ARRAY generator with the `<-:` separator
//       (`array_generator_sep`) and the `&` update form. Same line.
//   `a : b` as a cons    — `operator_cons`. clean-stdlib/StdList.dcl:4.
//   `x :! Nil` as a cons PATTERN — `operator_cons_strict` and `cons_pattern`
//       together. Clyde/cleantools/MacOSX/PmCleanSystem.icl:697.
//   `(#Int)`             — a `builtin_question_type`, the unboxed maybe.
//       clean-stdlib/StdMaybe.icl:57 spells it `?#None`.
//   `?#` as a type       — same node in signature position.
//   `.[a]` in a signature — `operator_dot`, the hidden-type dot.
//       clean-stdlib/StdList.dcl:381 spells it exactly that.
//   `p || q`            — `operator_or`. Clyde/cleantools/Pm/PmDriver.icl:758.
//   `a % b`              — `operator_mul`. Clean's multiplication is `%`, and
//       `*` is the generic `operator` node; the two are different node types over
//       real corpus code, so the fixture writes `%`.
//   `a ^ b`              — `operator_exp`. clean-stdlib/StdInt.dcl:21.
//   `a <|- b`            — `operator_pipe`. Clyde/Clyde/projdocument.icl:333.
//   `u:(?# Int)`         — a `builtin_question_type`, the unboxed maybe.
//       clean-stdlib/_SystemStrictMaybes.dcl:9.
//   `d & [i]` as a PATTERN — a `record_update_pattern`.
//       Clyde/cleantools/Pm/PmDirCache.icl:129.
//   `a +++. b` and `?`  — a compound `operator_dot` and a bare
//       `builtin_question_type`. Clyde/Clyde/ClydeApplicationController.icl:269
//       and clean-stdlib/StdMaybe.dcl:20.
//   `f `on` g`           — a `backtick_operator`: an operator applied through a
//       backticked name. cloogle.org/backend/CloogleServer.icl:25.
shifts :: !Int !Int -> !Int
shifts a b = a >> b

ranges :: !Int -> ![!Int]
ranges n = [0..n]

conser :: !Int ![!Int] -> ![!Int]
conser head rest = head : rest

consPattern :: ![!Int] -> !Int
consPattern string :! Nil = string
consPattern _ = 0

indexUpdate :: !{# !Int} !Int -> !Int
indexUpdate subdirs & [subdir_i] = subdir_i
indexUpdate _ = 0

prod :: !.[a] -> a
prod xs = a

orDefault :: !Bool !Bool -> !Bool
orDefault a b = a || b

multiplies :: !Int !Int -> !Int
multiplies a b = a % b

exps :: !Int !Int -> !Int
exps a b = a ^ b

pipes :: !Int !Int -> !Int
pipes a b = a <|- b

unboxedMaybe :: !u:(?# Int) -> !Int
unboxedMaybe m = 0

compoundOp :: !Int !Int -> !Int
compoundOp a b = a +++. b

bareQuestion :: !? -> !Int
bareQuestion q = 0

onOff :: !Bool !Bool -> !Bool
onOff a b = f `on` b
where
	f p q = if (p || not q) True False

// A declaration with no `where` block, placed here to CLOSE the one above.
afterWhere :: !Int -> !Int
afterWhere n = n

// A block comment on its own, plus the two comment spellings a declaration can
// carry: a leading `//` run (the documentation) and a trailing `//` on the
// signature line (the house style of every `.dcl` in this corpus).
//
// `afterWhere` above is load-bearing and is worth stating, because finding it
// cost a round. Clean's grammar gives a `where_block` an extent that runs to the
// NEXT DECLARATION, and a comment written at column 0 after an indented `where`
// body is absorbed INTO that block as a trailing extra — a blank line does not
// close it. The comment then belongs to the block, and no comment collector
// reading the next declaration can reach it: measured, with the comment absorbed
// the declaration's `comments` held only its trailing remark and its `docstring`
// was empty. The corpus does not hit this because a `.dcl` puts a declaration
// between the two, which is what `afterWhere` is. The blank line before the
// block comment is load-bearing for a different reason: a blank line ENDS a
// leading comment run, so it is what makes the block comment — rather than the
// prose above it — the contiguous documentation of the declaration below.

/* This block comment belongs to `total` and is its documentation. */
total :: !Int !Int -> !Int
total a b = a + b		// and this trailing remark belongs to `total` too

// A KIND EXPRESSION and a UNIQUENESS CONSTRAINT: the type-of-types surface Clean's
// generic machinery needs. `{|*|}` is the kind of `*` (from
// cloogle.org/backend/Builtin/Predef.icl:79) and `[u v <= w]` is a uniqueness
// constraint (from Clyde/cleantools/Pm/PmProject.icl:881).
class Sized2 a where
	sizeOf2 :: a -> !Int

:: Pair a b = { fst :: a, snd :: b }

swapPair :: !(Pair !Int !String) -> !(Pair !String !Int)
swapPair p = { fst = p.snd, snd = p.fst }
