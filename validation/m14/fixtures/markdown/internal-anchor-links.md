# Internal anchor references

A link whose destination is only a fragment names a heading in THIS document, and
it is written as the heading's ANCHOR, not as its text. Those are different
strings: this heading's text is "Internal anchor references" and its anchor is
`#internal-anchor-references`. Before this round the lane published the heading's
text where a link names the anchor, so the two spellings could never meet, and
every same-document reference was an edge to a name no symbol declared.

[forward reference](#install-now), to a heading that appears LATER in the document.

## Install Now!

Body.

## C++ and Rust: a Punctuation Test

Body.

## Duplicate

Body.

## Duplicate

Body.

## Spaced Anchor

Body.

## Anchor registry

Every link below comes from a section OTHER than the one it names, which is what
makes the resolved edge observable. A link inside the section it points at is a
self-edge, and a self-edge is not a containment — see `Self reference` at the end.

[to the install heading](#install-now)

[to it again, percent-encoded](#install%2Dnow) — the same heading, written with
an escaped hyphen, so the fragment has to be decoded before it can match.

[to the punctuated heading](#c-and-rust-a-punctuation-test) — `+` and `:` are
dropped from the anchor and the spaces become hyphens.

[to the first duplicate](#duplicate)

[to the second duplicate](#duplicate-1) — two identical headings are two sites and
therefore two anchors, and the second cannot share the first one's.

[to the spaced heading, whose anchor is not what this link says](#spaced%20anchor)
— that heading's anchor is `#spaced-anchor`, so this link is broken, and a broken
internal reference is not published.

[to a heading that does not exist](#no-such-heading)

[and to another that does not](#also-missing)

## Self reference

[self](#self-reference) names this very section, so it would be a section
containing itself. The sites are distinct but there is no containment to record, and
the edge is not published.
