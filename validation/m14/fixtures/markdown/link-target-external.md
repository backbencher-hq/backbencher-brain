# What a link destination points at: external, in-repo, or neither

A markdown link's destination is one of three kinds of place, and before this
fixture every one of them produced the same `uses` edge with the same shape. That
made a resolution-rate column unreadable: on the 600-file prefix of this lane's
17,456-file admitted population, 4,107 of the 4,951 targets that bind to no local
declaration carry a URI scheme, and a consumer could not tell "this document links
to a website" from "this reference to a heading failed to bind".

The split is three-way on purpose, and the middle case is the one that matters most:
`docs/guide.md` names a file **in this repository**, so calling it external would be
a false statement about where the target lives. It is a modelling gap, not an
external reference, and it is counted separately so the two never merge.

## Remote schemes are external

An [https link](https://example.com/a), an [http link](http://example.com/b), a
[mailto](mailto:dev@example.com), a [custom scheme](some:thing) and a
[network-path reference](//cdn.example.com/x.js).

## A one-character scheme is a Windows drive, not a URI

RFC 3986 admits `X:`, so [a drive path](X:/src/lib.rs) satisfies the grammar for a
scheme. It is not remote. It is a path in the repository.

## In-repo paths are not external

A [sibling file](./install.md), a [document](docs/guide.md), a [parent](../README.md)
and an [anchor-free relative](LICENSE.txt).

## Wrapped destinations: one wrapper is syntax, the other is not

[An angle-bracketed link](<https://example.com/angled>) is legal CommonMark, and the
angle brackets are the enclosing syntax — they are **not** part of the destination, so
the edge's target is `https://example.com/angled`.

[A doubly-parenthesised link]((https://example.com/parens)) is also legal CommonMark,
but here the parentheses **are** part of the destination: CommonMark permits unescaped
parentheses inside a bare destination when they form a balanced pair, so this edge's
target is `(https://example.com/parens)`. Both must classify as external, and the
second one only classifies if the scheme scan sees through the parentheses.

## An empty destination is not a link target

An [empty](<>) destination and an [unclosed](<https://example.com/unclosed) one.

## A bare token names no place at all

Documenter.jl writes [a cross-reference](@ref) and other template dialects write
`@`-prefixed directives. Neither is a path.

## Autolinks are external by construction

<https://example.com/auto> and <dev@example.com>.

## The classification reads the DESTINATION, never the label

The label below looks exactly like a URL and the destination is a file in this
repository. Classifying the label — the obvious implementation, since the label is
the text a reader sees — would report this edge as external.

[see the changelog][looks-like-a-url]

[looks-like-a-url]: CHANGELOG.md

And the reverse: an innocuous label with a remote destination.

[read the docs][plain-label]

[plain-label]: https://example.com/docs
