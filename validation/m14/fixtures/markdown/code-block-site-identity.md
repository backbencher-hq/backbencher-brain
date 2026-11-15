# A fenced code block is a SITE, not a declaration.

## Two blocks of one language under one heading

```scala
val first = 1
```

Prose between them, so they are two distinct blocks and not one.

```scala
val second = 2
```

## A third, in a different section

```scala
val third = 3
```

## And one of another language

```bash
echo hi
```

Before this fixture, `code_block.<lang>` was keyed by `owner + name`, so the
SECOND `scala` block under `Two blocks of one language under one heading`
collapsed into the first and took its `contains` edge with it. The third block is
under a different owner, so it survived — which is why the lane measured clean:
the one-block-per-heading case is the only case it had ever seen, and it is
exactly the case that hides the defect.

Measured on the lane's own pinned corpus (scala3@18df09c0, 738 tracked `.md`
files): 1,584 of 3,742 fenced code blocks were erased this way, in 406 of 738
files. Worst case `docs/_spec/05-classes-and-objects.md`, 79 sites -> 24
symbols.
