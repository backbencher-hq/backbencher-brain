# A heading's name is its display text

## Closed with a trailing run ##

An ATX heading may close with a run of `#`, and that run is not part of the
heading's text. Before this fixture the closing run was published as part of the
name, so a document that closed its headings and one that did not produced two
different symbols for the same section.

### A hash with no space before it stays

A heading whose text ends in a-hash# keeps the hash, because a closing sequence must
be preceded by a space or tab. The closing run arrives inside the `inline` child as
anonymous `#` tokens, so this is a read of the grammar's own shape, not a pattern
match over the line.

## Ends in a-hash#

Body.

## Empty headings publish nothing

#
## 
### 

The three empty headings above are ABSENCE. Before this round each published a
symbol named after its own marker — `#`, `##`, `###` — and chained into a
`contains` hierarchy of punctuation. That is the M60 R7 class: a name that is not
a name. A reader cannot navigate to a section called `##`, and two sibling `##`
headings both called `##` collided and lost a level.

## A setext heading is its first line

Multi Line Setext Title
and this second line is continuation
------------------------------------

Setext Child
------------

## And a sibling after the setext pair

Body.
