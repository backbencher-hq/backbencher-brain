# Template includes

`imports` is the one file-level relation a markdown document can carry that the block
grammar cannot see. A Jekyll or Liquid `{% include %}` directive reads another file from
disk and inlines it into the rendered page, and to CommonMark `{% … %}` at the start of a
line is an ordinary paragraph — so there is no node to dispatch on.

The corpus population is measured and it is small, and the population that must NOT be
published is fifteen times larger, which is the reason this fixture is mostly forbids.

    53  {% include-markdown "includes/traefik-for-business-applications.md" %}
    12  {% include properties.md %}
     1  {% include table-of-contents.yml %}
     1  {% include docs/elements/primary-colors.html %}
     1  {% include docs/elements/background-foreground-row.html %}

against 317 `{% include type t="Number" %}`, 94 `{% include example spec=… %}` and 60+
`{% include tag ver="5.0" %}` — macro calls that name no file. An `imports` edge to
`Number` or to `5.0` would be a fabricated endpoint, so the argument must end in a known
file extension. That is the discriminator this document exercises in both directions.

## Quoted argument

{% include-markdown "includes/partials/release-notes.md" %}

## Bare argument, and the unquoted form

{% include properties.md %}

## The heading half

### A heading whose text carries a directive {% include_relative footer.md %}

A directive inside a heading is the same construct as one inside a paragraph. The DFS
`continue`s on a heading and never reaches its `inline` child, so this row is the only
thing that separates the two call sites from one.

## Macro calls that name no file

{% include type t="Number" %}
{% include tag ver="5.0" %}
{% include example spec=page.spec %}

## A near miss

{% includes properties.md %}
{% inclusion properties.md %}
{% include propertys %}