## NIM bare-`case` discriminator fixture — the variant-discriminator fabrication.
##
## Nim writes an object-variant discriminator as `case <name>`, adjacent:
##
##     type Shape = object
##       case kind: Kind          <- genuine; `kind` IS a field of Shape
##
## It ALSO permits the bare form, where there is no name to write and the next
## line is the branch list:
##
##     type Node = ref object
##       case
##       of AddOpr, SubOpr:
##         a, b: Node             <- `AddOpr` is a CONSTRUCTOR, not a field
##
## tree-sitter-nim has no slot for a missing name, so error recovery attaches the
## NEXT LINE to `variant_discriminator_declaration`. The slot then holds a
## `symbol_declaration_list` whose first entry is a constructor, and the analyzer
## published it as a `property` of the owning type plus a `contains` edge to it —
## a field the object does not have, asserted by the graph.
##
## The node SHAPE is identical in both forms. Measured over 1,508 `nimony` files
## (43 discriminator slots) by `variant-discriminator.ts`:
##
##   tcaseobjectrange.nim:15  `case kind: Kind`      symbol_declaration_list, 1 decl
##   opt.nim:33-34            bare `case`/`of None:` symbol_declaration_list, 1 decl
##
## So shape cannot separate them, and neither can the recovery ERROR: it is a
## CHILD of `variant_declaration` in msumtype.nim and a SIBLING under
## `field_declaration_list` in tsumtype.nim, so an ERROR test catches 14 of 19 and
## misses 5. A reserved-word test catches 5 of 19 and misses 14, because `None`,
## `Some`, `AddOpr`, `float` and `T` are legal identifiers and not keywords.
##
## The ROW is the separator: a genuine discriminator shares a source row with the
## `case` token, and an absorbed line is necessarily on a later one. That rule
## scored TP 19 / FN 0 / FP 0 / TN 24 on the same 43 slots.
##
## This fixture pins BOTH directions, because a one-sided pin cannot tell a fix
## from a blanket suppression:
##   POSITIVE — `kind` is a real field of `Tagged` and must still be published,
##              with its `contains` edge, or the fix has silently dropped every
##              discriminator in the language.
##   NEGATIVE — the constructor `AddOpr`, the branch label `None`, and the type
##              name `float` must NOT become fields, and must carry no `contains`
##              edge. `float` is the case that defeats a reserved-word guard.

type
  Kind = enum
    kCircle, kSquare

  Tagged = object
    label: string
    case kind: Kind          # GENUINE discriminator — `kind` is a real field
    of kCircle:
      radius: float
    of kSquare:
      side: float

  Node = ref object          # bare `case` — every branch name below is a
    case                     # constructor, and none of them is a field
    of AddOpr, SubOpr:
      a, b: Node
    of Value:
      val: int

  Opt = object               # single-branch variant, the shape that produced
    case                     # `property None` in nimony/lib/std/opt.nim:34
    of None:
      discard
    of Some:
      val: int

  # A bare `case` after several ordinary fields. Recovery reached further here
  # and published a field named after a field's TYPE (`float`), which is the
  # fabrication no keyword list catches — nimony/tests/nimony/object/
  # tsumtype_shared.nim:9 published `property float` on `Shape` this way.
  Shape = object
    x, y: float
    color: int
    case
    of Circle:
      radius: float