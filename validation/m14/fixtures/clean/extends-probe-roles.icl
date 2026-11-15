// Clean fixture: the `extends` RULING PROBE's slot roles.
//
// `script/m14/clean-ruled.ts` rules `extends` on instrument B — a PARSE-TREE POSITION
// CENSUS, not a node-name list. The census walks every `class_declaration`,
// `instance_declaration`, `derive_declaration` and `class_context`, and reports any
// direct named child that no measured slot accounts for. UNCLASSIFIED is the only bucket
// a supertype clause could occupy, and it is empty on both populations (312 tracked
// files: 1,430 declarations, 0 unclassified. 2,181 wide files: 5,567 declarations, 0).
//
// A whitelist nobody has exercised is indistinguishable from a whitelist fitted to the
// answer, so this file exercises every ROLE the census assigns and
// `extends-probe-roles.probe.json` pins the exact per-declaration child inventory. The
// slots that took two iterations to reach are the point of the fixture:
//
//   name       `Box` (class_name), `Thing` (instance_class), `Eq` and `==` in a
//              constraint (constructor / operator_compare), a bare class name in a
//              derive declaration (identifier)
//   member     a class method signature, an instance implementation
//   parameter  `.a` (type_variable), the kind annotation `.(a .e)` (dotted_type),
//              `!` (uniqueness_star), `? a` (question_type), `()` (unit_type)
//   context    `| Eq a` on a class, `| == e` on an instance
//   body       the `:== code { … }` foreign-code instance body (`code_expression`)
//   fixity     a class-level `infix` annotation, which the corpus spells on an
//              operator-named class
//
// The two shapes the census had to be taught, here because a reader should be able to
// check them rather than take them:
//
//   1 An OPERATOR is a class name in Clean. `class (==) infix 4 a :: !a !a -> Bool`
//      declares a class named `==` — the corpus's own spelling, at
//      clean-stdlib/StdOverloaded.icl:23 — and `| == e` constrains on it. So
//      `class_context > operator_compare` — 160 corpus sites — is the constraint's
//      NAME, the same role `constructor` plays 1,496 times for `| Eq a`. Without this,
//      the census reports 160 false supertypes.
//   2 `class Box .a e` puts a `dotted_type` in the class declaration. It is the KIND
//      annotation on a type parameter, not a supertype; all 11 corpus sites are this.
//
// Every declaration below is spelled the way the corpus spells it, and the file parses
// with 0 ERROR nodes and 0 MISSING tokens, so a role assertion here is a statement
// about the grammar's shape and not about error recovery. The analyzer rows live in the
// companion `.expectation.json` so `runLang("clean")` keeps exercising the file too.
definition module ExtendsProbeRoles

import StdEnv

// ── name + parameter + fixity: an operator-named class, the corpus's own spelling
class (==) infix 4	a	:: !a	!a	->	Bool

// ── name + member: the SAME operator-named class in the `where` form, which is the
// shape that makes the class MEMBER set readable and therefore the shape the
// `overrides` in-file guard needs. The corpus spells its operator-named classes on one
// line (`class (==) … ::`, StdOverloaded.icl:23), which gives the member set nothing to
// read, so without this second declaration the bare-spelling lookup would never be
// exercised by any fixture and the 24-edge correction it carries would be untested.
class (>>=) a where
	(>>=)	:: .a .a .a -> .a

// ── name + member + parameter: a kind annotation on a type parameter, two members
class Box .a e
where
	unbox	:: !(Box .a e) -> .a
	pack	:: .a -> Box .a e

// ── context: a dictionary REQUIREMENT, not a supertype — Ord2 is not a kind of Eq
class Ord2 a | Eq a where
	cmp	:: .a .a -> Bool

// ── parameter: uniqueness on a class parameter
class Slot u a | Eq a where
	read	:: .u:(Slot u a) -> .a

data Thing = Thing Int

// ── name + member + body: an instance for an operator-named class
instance == Thing where
	(==) t1 t2 = True

instance Ord2 Thing where
	cmp t1 t2 = True

instance Eq Thing where
	(==) t1 t2 = True

instance Show Thing where
	show t = "thing"

// ── name: a DERIVE declaration names its class with a bare identifier
derive Eq Thing

// ── context: an operator-named constraint on an instance, the same role as `Eq`
instance Box .a e | == e where
	unbox b = pack (unbox b)

// ── parameter: a question-type-annotated instance target, and a unit one
instance Ord2 ? a where
	cmp a1 a2 = True

instance Ord2 () where
	cmp u1 u2 = True

// ── body: the FOREIGN-CODE instance form, whose `:== code { … }` is the only spelling
// in the corpus that carries the `body` role (135 sites in the 2,181-file census).
instance Ord2 Thing :: !Thing -> Bool :== code { no_op }

instance >>= Thing where
	(>>=) a b c = a
