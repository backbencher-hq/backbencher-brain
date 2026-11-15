## NIM concept-refinement fixture — the `implements` edge.
##
## The construct: `type A = concept x of B`. The grammar puts the clause in a
## `refines` field of type `refinement_list` (grammar.js: `optional(seq(keyword("of"),
## field("refines", $.refinement_list)))`), and the Nim compiler's own grammar
## comment in the corpus states the same production
## (`nim/compiler/parser.nim:2265`:
## `conceptDecl = 'concept' COMMENT? (conceptParam ^* ',')? pragma? ('of' typeDesc ^* ',')?`).
##
## Both spellings appear below and BOTH must produce an edge: the old-styled
## `concept of A` (no formal parameter) and the parameterised `concept x of A`.
## The keyword is `of`, not `is` — `concept x is A` puts the declaration into an
## ERROR node, which is measured, not assumed.
##
## `implements` and not `extends`: a concept is satisfied structurally and
## implicitly, there is no vtable and no nominal subtype relation in a concept
## refinement, and `extends` is already the label for the nominal class hierarchy
## (`object_declaration.inherits`). The elixir lane publishes `implements` for a
## duck-typed `@impl Protocol` and graphql for `type X implements Y`; this is the
## same fact.
##
## `of Number, Container` is two refinements and must yield two edges.

type Number = concept x, y
  (x + y) is SomeNumber

type Container = concept
  ## no formal parameter, and no refinement of its own

type Addable = concept x of Number
  (x + x) is SomeNumber

type Both = concept a, b of Number, Container
  (a + a) is SomeNumber

type Superset = concept of Number
  ## the old-styled form: `of` on the same line, no parameters

proc useContract(x: Addable): int =
  ## A concept parameter is a BINDING, not a read — the frame rule this lane
  ## already pins. This proc must not publish `uses -> x` for `x`.
  discard x
  1

## ── the SECOND spelling of the same fact ────────────────────────────────
##
## `doc/manual_experimental.md:1205-1213` names the two as alternatives for one
## relationship: "When the matched type within a concept is directly tested
## against a different concept, we say that the outer concept is a refinement of
## the inner concept … As an alternative way of defining concept refinements, you
## can use the object inheritance syntax involving the `of` keyword". So `x is B`
## in a concept body refines B exactly as `concept x of B` does, and a reader
## that takes only the clause misses the spelling real code uses — measured over
## 4,101 corpus files: the `of` clause occurs 0 times against 216 concepts.
type
  Shape = concept s
    area(s): float

  Sized = concept s
    sizeof(s): int

  ## guard 1 POSITIVE: the LEFT side is a bare formal parameter and the RIGHT is a
  ## concept of this file — the refinement spelling proper.
  HasArea = concept x
    x is Shape
    label(x): string

  ## guard 1 NEGATIVE: `o.length` is a FIELD. `o.length is Sized` constrains that
  ## field's type and refines nothing. Corpus shape: nim/tests/concepts/texplain.nim:136
  ## reads `o.foo is RegularConcept`.
  HasField = concept o
    o.length is Sized

  ## guard 3: a concept naming ITSELF is not a relationship — the corpus's own
  ## recursion tests are all of this shape (trecursive_concepts.nim:26
  ## `distinctBase(x) is Primitive`; tconcepts_issues.nim:421 `bend(x is Bendable)`).
  Recursive = concept r
    r is Recursive
    count(r): int

  ## guard 2 NEGATIVE: `x is int` is a type constraint on the matched parameter.
  ## `int` implements nothing, and the corpus's most frequent concept-body `is`
  ## right-hand sides are exactly these: T (31), int (23), bool (15), string (10).
  Numeric = concept x
    x is int

  ## guard 2, the chain shape: the parameter is tested against one contract, and
  ## the RESULT of a call is tested against another. Only the first is a
  ## refinement by this lane's rule; `distinctBase(x) is Shape` is a constraint on
  ## a computed value (corpus shape: trecursive_concepts.nim:26).
  Chained = concept x
    x is Shape or name(x) is Sized

## ── the fabrication guard's subject ──────────────────────────────────────
##
## An ordinary object type that structurally satisfies nothing above. Nim has NO
## syntax for declaring that a type implements a concept — satisfaction is the
## compiler's structural match at instantiation time, from the concept's own
## body — so no `implements` edge may name this type. An analyzer that "helpfully"
## inferred satisfaction from the members it can see would publish one edge per
## (object type × concept) pair, every one of them fabricated.
type Meters = object
  v: float

## ── the shapes REAL CODE writes, found by a corpus walk and not by inspection ──
##
## Everything above is the spelling the grammar documents. These three are the
## spellings `nim-lang/nimony` actually uses, and they were NOT pinned here until
## that repo entered the corpus on 2026-10-04 and took `implements` off zero. The
## gap was invisible from the fixture alone: a family can be 100% fixture-covered
## and still be unpinned on the shape 39 of its 47 corpus edges use.
##
## `nimony/tests/nimony/concepts/tconceptinheritnotgeneric.nim:7` reads
## `Bar = concept of Foo[T]`, and `tconceptinvocationbody.nim:39` reads
## `MutableIndexable*[T] = concept of Indexable[T]` — 2 of the 47 corpus edges.
## The name is the CONSTRUCTOR, never the type argument, and an implementation
## that takes the last segment of the refinement list publishes `implements -> T`
## where the truth is `implements -> Foo`. That is a fabricated edge pointing at
## a generic parameter, and it is the same confusion the `references` side
## records for `BlenderRgb[Rgba8]`.

type
  Source = concept
    proc `-`(a, b: Self): Self

  ## the GENERIC-target shape: `of Foo[T]` refines `Foo`, not `T`
  Wrapped = concept x of Source[T]

  ## the SELF-CYCLE shape: `nimony/tests/nimony/concepts/tconceptcycle.nim` is
  ## exactly `type Cycle = concept of Cycle` and its upstream `.msgs` reads
  ## `Error: concept inheritance cycle detected`. A concept refining itself is
  ## not a relationship. This is the `of`-form twin of the `Recursive` row above,
  ## which guards the `is`-form; without it the self-reference guard is only
  ## half-pinned, and the corpus half is 1 real file.
  Cycle = concept of Cycle
