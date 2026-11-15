"""A name that is not there is not a symbol, and not an endpoint either.

This file opens as python and stops being python. Everything below `BEGIN` is ASN.1
notation, and the `otp` corpus carries 29 such files under a `.py` extension —
`lib/asn1/examples/Int.py` opens `Int DEFINITIONS ::= BEGIN` on line 1. tree-sitter is
error-tolerant and parses them anyway, which is correct: an analyzer asked about a
`.py` file should report what the parse found. What it must not do is publish a name
that is not in the source.

TWO defects lived in that accident, and they are different shapes, which is why both
are pinned here.

**The empty SYMBOL.** `small SmallInt ::= 17` parses as an assignment whose
left-hand side is a zero-width, EMPTY `identifier` node, and the module-Variable path
published it:

    { name: "", kind: "variable", startLine: 27, startIndex: 731, endIndex: 731 }

A symbol whose name is the empty string is not a weak symbol — it is a node that joins
to nothing and that every consumer downstream can count, match and display.
`docs/analyzers/ONTOLOGY-WORKSTREAM.md` names empty names as a completion failure
alongside unknown symbols.

**The empty ENDPOINT**, which is the worse of the two and the one a `!value` guard
does not catch. The same line is ALSO read as a `type` clause, and the declared-type
walk published `references asn2 -> ` — a real relationship row whose TARGET is the
empty string. `pushRel` has `if (!source || !target) return`, and it never saw this
shape, because `extractDeclaredTypeRefs` builds its rows directly instead of going
through `pushRel`. The honest state is ABSENCE: there is no type name in the source,
so there is no reference to publish.

MEASURED over the 679-file INCOMING_PY corpus by
`script/m60/python-resolution-census.ts`: before, **2** empty-named symbols (both in
`otp/lib/asn1/examples/Int.py`) and **2** empty-target `references` rows; after,
**0** and **0**. Nothing else moves, because the tree carries no other name for these
nodes.

WHAT IS STILL PUBLISHED, and why that matters more than what is not: the identifiers
this file genuinely writes — `SmallInt`, `OrInt`, `DECLARED`, `Placeholder` — are
published, with their real ranges. A rule that discarded every symbol out of a damaged
file would pass a fixture that only asserted absences, so the expect rows below pin the
survivors. Reporting a damaged file is not the same as inventing a graph node in it.
"""


class Placeholder:
    """A real python class, so a blanket 'discard damaged files' rule cannot pass."""


DECLARED = 1


BEGIN

	small SmallInt ::= 17
	or OrInt ::= 20

END