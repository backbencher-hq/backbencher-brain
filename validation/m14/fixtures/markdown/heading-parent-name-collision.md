# Changelog

## Changelog

A parent and a child whose TEXT is identical are two different sections, and the
child is contained by the parent. The two sites are distinct — the child's
identity is qualified by its parent — but both contract spellings are the word
`Changelog`, so an edge filter that asks "are these two strings equal?" erases a
real containment.

### Changelog

The same collision one level down, where the owner is already a nested site.

# Setup

## Setup

The most common shape of this in real documents: a top-level section and a
subsection that repeats its name, which is how a lot of vendored changelogs and
READMEs are written.

## Example

## Example

A REPEATED sibling is the other half of the rule and must not be confused with it.
Two `## Example` sections under the same parent are two sites, so the second is
addressable as `Example#2` — and it is a child of `Setup`, not a child of the
first `Example`.

Body.

## Distinct

The control case: a child whose text differs from its parent, which has always
worked and must keep working.
