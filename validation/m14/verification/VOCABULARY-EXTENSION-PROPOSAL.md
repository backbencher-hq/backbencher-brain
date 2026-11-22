# Vocabulary extension proposal — the applied-callable boundary

Status: **proposal record, not an ontology change.** The fourteen relationship
values are unchanged; this page records the boundary the lanes have had to
adjudicate repeatedly, so a future lane can cite it instead of re-arguing it.

## Decorates

`Decorates` means the runtime **applies** the decorator to the declaration, and
the decorator is an applied callable (`src/ast/types.ts`, Decorates). Passive
metadata a tool reads later — comments, docstrings, pragmas, annotations,
attributes read by reflection — is **not** a decorates edge. The distinction is
why the C, C++, Erlang, Nim, R and PHP lanes rule their annotation families
`ontological` rather than emitting a decorator row.

## Mixes_in

`Mixes_in` composes a mixin into a type's **supertype chain**. A construct that
merges options into a flat object, or carries a compiler pragma, is not a
mixin; the near miss is measured in the lane census and ruled.

## Part_of

`Part_of` is about a library unit including a part **file** that shares the
unit's scope. A SQL table partition is a table-level storage division, not a
file-level part; it is a near miss, not the relation.

## Renders

`Renders` requires the target to be a **component** the renderer constructs. A
SQL view renders a query, not a component; a macro DSL over calls does not name
a component type. Those are measured near misses.

## Why this page exists

The coverage gate checks that each ruling cites a file that exists; this page is
the shared rationale the rulings cite when the reason is the vocabulary's own
contract rather than a grammar absence. It does not add a relationship value.
