# Brace-directive file inclusion

`part_of` is the file-inclusion relation: an included file's content is spliced
into THIS document, so it shares this document's single scope, imports nothing,
and cannot be resolved as a separate unit. The vocabulary's own contract
(`src/ast/types.ts`, PartOf) is the dart/erlang/php/fsharp one, and markdown has
a directive that does exactly that — the MyST brace-directive fence, which to
CommonMark is an ordinary fenced code block whose info string happens to begin
with a brace:

    ```{include} ../client/README.md
    ```

The pinned block grammar models it as `fenced_code_block > info_string >
language`, with the directive name as the `language` child — so the construct is
AST-visible today, at R3, with no grammar change.

The population this fixture pins is measured over the whole admitted corpus and
is small: the brace-directive family is a MyST- and docutils-dialect construct,
and most of the corpus's fences carry a plain language (`python`, `bash`) or no
info string at all. A fence with a LANGUAGE is code, not an inclusion — that is
the first near miss.

## A whole-file include (splice — the `part_of` positive)

```{include} ../../includes/partials/dest-a.md
```

## A literal include of a whole file (also splice)

```{literalinclude} ../../includes/partials/dest-b.md
```

## A fragment include (near miss — quotes lines, not a scope-sharing part)

```{literalinclude} ../../includes/partials/dest-b.md
:lines: 1-10
```

## A fence with a language (near miss — code, not an inclusion)

```python
print("not an inclusion")
```

## A markdown link (near miss — a reference, not an inclusion)

[linked](../../includes/partials/dest-a.md) and [rem](dest-b.md).

## An image (near miss — a reference to an asset, not an inclusion)

![alt](../../includes/partials/diagram.png)

## A brace directive that is not an inclusion (near miss — an admonition)

```{note} This is an admonition, not a file
content
```

## Include with no argument (near miss — nothing is named)

```{include}
```
