go-immutable-radix [![CircleCI](https://circleci.com/gh/hashicorp/go-immutable-radix/tree/master.svg?style=svg)](https://circleci.com/gh/hashicorp/go-immutable-radix/tree/master)
==============================================================================================================

Both heading forms do not hold their text the same way, and this document is written so
that the difference is visible in its own source. An ATX heading puts its text in a
DIRECT `inline` child:

    atx_heading > atx_h1_marker, inline

and the form below — the H1 at the top of this file — does not. The text lives one level
down, inside the paragraph the underline terminates:

    setext_heading > paragraph > inline , setext_h1_underline

`emitInlineUses` resolved the heading's inline with a DIRECT-child lookup, so it found
nothing in the setext form and returned before emitting anything. Every link, image,
autolink and reference link inside a setext heading was therefore dropped, and the three
corpus instances of that construct are all badge banners of exactly this shape — the H1
of `docker/vendor/github.com/hashicorp/go-immutable-radix/README.md`, the H1 of its
`v2/` sibling, and line 4 of `packer/README.md`.

## A setext heading carrying two destinations and an autolink

A setext H2 with a [link](https://example.com/setext-h2), a second [one](https://example.com/setext-h2-b) and an <https://example.com/setext-h2-auto>
--------------------------------------------------------------------------------------------------------------------------------------------

## A setext heading whose reference link resolves through the document's own definition

A setext H2 naming [the reference][setext-ref], which is defined at block level below
--------------------------------------------------------------------------------------------------------------------

[setext-ref]: https://example.com/setext-reference

## A setext heading whose text wraps, with the link on the continuation line

This setext heading's text is two lines long and the second carries a [wrapped link](https://example.com/setext-wrapped), so the paragraph the
underline ends is wider than the heading NAME the lane publishes
----------------------------------------------------------------------------------------------------------------------------------

## A setext heading holding a code span is still not a link

`setext [not a link](https://bad.example/setext-code-span)` in a setext heading
------------------------------------------------------------------------------------

## The ATX control, which worked before this fixture existed

An [atx destination](https://example.com/atx-control) in an ATX heading, so a reader can
see that the setext rows above are a fix and not a behaviour change.