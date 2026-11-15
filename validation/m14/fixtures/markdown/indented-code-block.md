# An indented code block is a code block

A fenced block declares its language in an info string. An indented one — four
spaces, no fence — has nowhere to declare anything, so it publishes `code_block` and
carries no `language` at all. The lane used to publish NOTHING for it, while the
fenced form beside it published a symbol, and a reader of the graph could not tell
"this document has no code" from "this document has code the lane dropped".

## An indented block on its own

    val indented = 1

## Sharing a site identity with the fenced form

```scala
val fenced = 1
```

```
val noLanguageFence = 2
```

    val indentedToo = 3

The first block keeps its language in its name. The second declares none, so it
publishes `code_block` — and the indented block beside it publishes `code_block` too,
which means the two SHARE a site base and the second of them is `code_block#2`. The
site counter is shared because they are the same construct written two ways, and two
symbols with one name would be the identity defect the fence's own ordinal exists to
prevent. The indented block is the one that gets the ordinal here, and that asymmetry
is the whole point: the fence arrived first.

## The reverse order

    val indentedFirst = 3

```scala
val fencedSecond = 4
```

A fenced block with a language keeps `code_block.scala` whatever came before it,
because the language is part of its name and the site base is the qualified path.

## Not a code block

*   a bullet whose continuation is

    indented once and therefore a nested list item, not a code block
