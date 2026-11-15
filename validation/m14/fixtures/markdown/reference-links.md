# Reference links, autolinks, and what is deliberately not a link

A reference link's destination lives in a `link_reference_definition` elsewhere in
the document, so before this fixture the whole form produced **no `uses` edge at
all** — measured on this lane's pinned corpus (scala3@18df09c0, 738 tracked `.md`
files) at 671 sites across 66 files, while the lane doc claimed "Links (inline and
reference destinations)".

## Full reference form

See the [install guide][setup] and the [API][api-ref].

[setup]: ../install.md "Install"
[api-ref]: https://example.com/api

## Collapsed and shortcut forms

The [collapsed][] and the [shortcut].

[collapsed]: https://example.com/c

## Inline form and autolinks

An [inline link](https://example.com/inline), a <https://example.com/auto> and a
<dev@example.com>.

## An image in reference form

![the logo][logo]

[logo]: ./assets/logo.png

## A code span, and a closed code fence, are not links

`[not a link](https://bad.example/code-span)` and:

```md
[also not a link](https://bad.example/fence)
```

Only [this one](https://good.example) is.

## A reference with no definition is literal text, not a link

An [undefined][nowhere] reference and a [bare-citation] in prose.
