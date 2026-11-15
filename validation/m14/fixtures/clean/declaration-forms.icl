// Clean fixture: the Clean-specific DECLARATION FORMS the pinned grammar has and
// no earlier clean fixture reached.
//
// Every one of these was a hole with a measured size, and the four pre-existing
// clean fixtures could not have caught any of them because none of the node types
// occurs in their parse trees (which is exactly what the F6 spec->fixture coverage
// gate is for):
//
//   macro_definition          583 corpus sites  — a module-level macro published
//                                                    NOTHING before this round
//   generic_declaration         11 corpus sites  — Clean type-level dispatch
//   generic_case_definition     52 corpus sites  — the third callable-defining
//                                                    shape; neither older fixture
//                                                    nor the older analyzer named it
//   derive_declaration          43 corpus sites  — a generic derived at a type
//   special_member             507 corpus sites  — `special a=Int` inside a signature
//   fixity_declaration          17 corpus sites  — `($) infixr 9`
//   foreign_export              41 corpus sites  — `foreign export f`
//   class_context              474 corpus sites  — `| Eq a, Ord a`
//
// Written the way this grammar accepts it. The generically-derived shapes come
// from clean-stdlib/StdGeneric.{dcl,icl} and the special/fixity/foreign shapes
// from Clyde/Cocoa, so the fixture is real Clean rather than an invention.
implementation module CleanDeclForms

import StdEnv
import StdGeneric

// A CLASS CONTEXT: the superclass constraint names a class and publishes a
// `references` edge from the class to it. Before this round the constraint
// published nothing (spec gap CL-G3, 474 corpus sites).
class Sized a | Ord a where
	sizeOf :: a -> !Int

// A MODULE-LEVEL MACRO: a Clean definition macro. The kind is `macro`, it is a
// frame (a macro body is expanded at its use site, so the calls inside it are the
// module's calls), and it is in the export surface.
MaxBound :== 3

// A MACRO WITH A PARENTHESIZED NAME: the second of the four name shapes
// `macro_definition.name` carries (constructor, identifier, parenthesized_operator,
// parenthesized_name). `declarationName`'s comma/brace test is what keeps
// `(<*>, <>)` — the grammar's mis-shape for a PATTERN — from publishing a name.
(<*>) :== 0

// A GENERIC: a class over TYPES rather than values (Clean's type-level dispatch).
generic bimap a b | bimap b a :: .a -> .b

// A GENERIC CASE DEFINITION: the third shape that DEFINES a callable. The three
// `bimap{|…|}` case equations are ONE function and merge into one symbol, with
// the case kinds recorded in `caseKinds`.
bimap{|c|} x = x
bimap{|PAIR|} fx _ fy _ (PAIR x y) = PAIR (fx x) (fy y)

// A DERIVE: the generic `bimap` is derived at the type `PAIR`, which is the same
// shape as an instance — an implementation of a class at a type — so it is an
// `implements` edge from the type to the generic.
derive bimap PAIR

// A CLASS CONTEXT ON AN INSTANCE: `instance Eq a | Ord a where` — the constraint
// is a requirement the instance itself is parametrised by.
instance Sized Int where
	sizeOf _ = MaxBound

// A SPECIAL MEMBER: `special a=Int` declares the TYPES the enclosing callable is
// specialised for. It declares no new NAME (the variable is the signature's own
// type parameter), so it publishes no symbol and emits one `references` edge per
// special type.
sizedOf :: !Int -> !Int
sizedOf n = n
	special a=Int; a=Real

// A FOREIGN EXPORT: a C function re-exported under Clean's calling convention.
// A real callable and an explicit export. The form is a bare name — the corpus
// has 41 of them and none carries a type, so nothing here is invented.
foreign export strlen

// AN OPERATOR FIXITY, BOTH SPELLINGS. `($) infixr 9` is the standalone
// `fixity_declaration` form and `swapWith infixl 9 :: …` is the same fact written
// ON a signature (a `fixity_annotation` node in the `fixity` FIELD). 17 and 93
// corpus sites respectively, and the round's first implementation read only the
// first. Neither names an operator declared elsewhere, so neither publishes a
// symbol: the fixity is attached to that operator's symbol and the record is kept
// on the file.
($) infixr 9

(%.) infixl 9 :: !Int !Int -> !Int
(%.) a b = a + b

// A `with` BLOCK binder. Each binder is a real symbol owned by the frame that
// encloses it, resolvable as a call target, and NOT exported. The `with` and the
// `where` forms are separate functions on purpose: a `where` clause follows a
// function's guard equations, so pairing it with a function that already ended in
// a `with` block leaves the keyword dangling and the grammar does not name a
// `where_block` for it (verified — the stray keyword parses as a bare
// `constructor` and publishes a symbol named `where`, which is the grammar's
// mis-shape and is classified in the spec rather than papered over).
withLocals :: !Int -> !Int
withLocals n = helper n
with
	helper k = k + delta

// A `where` BLOCK binder, with its own local signature — the shape 449 times over
// the corpus, where the binder is a signature pair rather than a definition.
whereLocals :: !Int -> !Int
whereLocals n = bump n
where
	delta :: !Int
	delta = 1
	bump k = k + delta

// A RECORD FIELD READ AND AN UPDATE, on a type declared here so the `uses` edges
// are provable rather than inferred.
:: Wrapper = { inner :: !Int, tag :: String }

readInner :: !Wrapper -> !Int
readInner w = w.inner

rewriteTag :: !Wrapper !String -> !Wrapper
rewriteTag w s = { w & tag = s }

// The FFI in BOTH ORDERS. `foreign export f` and the function it names are ONE
// entity, so the flag rides the merged symbol and the symbol is anchored at the
// DEFINITION — but the export SITE is its own per-line fact, so it is recorded
// as `foreignExportLine` and not lost when the range moves three lines down.
// `lateExport` is the case the first implementation got wrong: a `foreign export`
// appearing AFTER its definition, which the early return dropped whole.
foreign export leadingExport
leadingExport :: !Int -> !Int
leadingExport n = n + 1

trailingExport :: !Int -> !Int
trailingExport n = n + 2
foreign export trailingExport

// A CONSTRAINED INSTANCE HEAD. The argument list of an instance is
// `constraint* Type`, so the TYPE is the LAST argument that names one and a bare
// uniqueness constraint names none:
//
//   instance Sized {#} Int      args = [ array_type({#}), constructor(Int) ]
//   instance Sized {!} a        args = [ array_type({!}), type_variable(a) ]
//   instance Sized {32#} Real    args = [ array_type({32#}), constructor(Real) ]
//   instance Sized {#Char}       args = [ array_type({#Char}) ]  <- one arg, and it
//                                                                    IS the type
//
// The CLASS is always the `name` field and always comes first; writing the
// constraint first (`instance {#} Sized Int`) is not the language, and the pinned
// grammar reads it with an EMPTY `instance_class` and the class demoted to an
// argument — which the analyzer skips rather than fabricating an edge from.
//
// The first implementation took the FIRST argument, so these were named after
// their CONSTRAINT — `{#} -> Sized` and, for `{32#}`, after the NUMBER `32`,
// because an `array_type` holds the constraint level and the type together. The
// three rows below pin the real targets, so a mutant that reverts to "first
// argument" or to "the inner child" fails.
instance Sized {#} Int
instance Sized {!} a
instance Sized {32#} Real
instance Sized {#Char}
