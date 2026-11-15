# A GFM table and its columns are sites

## One table, two columns

| Name | Meaning |
| --- | --- |
| `uses` | a relationship of class `uses` |

A table publishes as a site under its heading, and each header cell publishes as a
site under the TABLE — not under the heading, and not shared with any other table.
The column endpoint is the column's own published name, so the edge resolves; for
a full review cycle the edge was emitted for every column of every table while no
column symbol was ever declared.

## The same header twice under one heading

| Name | Meaning |
| --- | --- |
| `uses` | a relationship of class `uses` |

A second table under the same heading is a second SITE, so it publishes as `Name Meaning#2`
and its columns are addressed under that table's own id. Two same-header tables must
not share a column endpoint, or a column on the second table would be
indistinguishable from one on the first.

## A column named after its own table

## Reading

| Reading |
| --- |
| tight |
| loose |

A single-column table is named after that one column, so the table and its column
spell the same string and the `contains` edge reads as a self-edge. The two are
distinct sites — the column's identity is qualified by the table's — so the edge is
a real containment and must survive. This is the control that keeps the self-edge
filter from being "fixed" by deleting the edge instead of by asking about identity.

Body.
