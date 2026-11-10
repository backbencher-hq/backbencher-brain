# Grammar sources and their licenses

`grammars/` holds the pinned [Tree-sitter](https://tree-sitter.github.io/) grammar sources behind
bb's language analyzers, and the frozen wasm parsers in `wasm/` are built from them. Keeping the
sources here is what lets a clone index without fetching a grammar toolchain, and what lets a
reader check a parser claim against the exact tree it came from.

## Every grammar keeps its own license

Nothing in this directory is relicensed. Each grammar is untouched third-party work published
under its own license:

- the upstream license text sits next to the source, inside each `grammars/<grammar>/` directory;
- `THIRD-PARTY-NOTICES.md` lists every grammar with its package, license, upstream project,
  local-change record and license-file location;
- the npm package ships those license texts and the notices next to the wasm binaries, so a
  redistributed parser always travels with its license.

Where an upstream project declares a license in its package metadata but does not ship a license
file, this directory reproduces the declared license and `THIRD-PARTY-NOTICES.md` records that.
If an attribution or license record here is wrong or incomplete, that is a bug: open an issue and
we will fix it promptly.

## Why these sources are here, and what we changed

bb targets one parser per language and needs the parse to be reproducible. A grammar is pinned
per analyzer; where we had to adjust one (a pin, a generated-table fix, a measurement probe), the
change and its measurement are recorded in that grammar's `PIN.md` or `PROVENANCE.md` — the
record names the upstream source the change applies to, so a reader can see exactly what differs
from upstream. Rejected experiments are preserved under `_vendored/` with their own account in
`_vendored/VENDORED.md`, because a measured "no" is data too.

Our build tooling around the grammars (scripts, patches we author, the wasm build and pin
records) is MIT, like the rest of the repository. A modification to a grammar is a derivative
work of that grammar and remains under that grammar's upstream license.

## Thank you to the people who made these grammars

bb would not exist without the [Tree-sitter](https://github.com/tree-sitter/tree-sitter) project
and the authors and maintainers of every grammar listed in `THIRD-PARTY-NOTICES.md`. Thank you
for writing these grammars and for licensing them so that other tools can build on them. We are
grateful for the care that goes into a parser, and we have tried to keep the record here worthy
of it.

## Contributions are welcome — including from upstream maintainers

Maintainers and contributors of these grammars are welcome here. If you maintain one of these
projects and want to review what we changed, or want a local fix upstreamed, open an issue or a
pull request in this repository (or in your upstream project) and we will follow your lead on
your grammar. Missing attribution or a license record that does not match your intent is the
fastest kind of fix for us, so please say so.

## The wasm parsers

The binaries under `wasm/` are built from these sources. They carry the same licenses as the
grammar they were built from; `THIRD-PARTY-NOTICES.md` maps sources to licenses and both are
included in the npm package.
