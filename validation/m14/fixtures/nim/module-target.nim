# NIM module-identity fixture — the construct the module symbol exists for.
#
# Every import below is a MODULE. Nim resolves `import std/[os, strutils]` to the
# modules `os` and `strutils` on its search path; the `std/` prefix is a directory,
# not part of a module's name. So the edge's target is the module NAME, and the
# written path is kept on `meta.nimModulePath`.
#
# The three spellings that matter, all three in one file because the rule has to
# hold for each and a fixture that pins one proves the other two by nothing:
#   `std/[os, strutils]`  a module LIST — one edge per element, prefix stripped
#   `std/private/globs`   a nested path — last segment is the module
#   `../shared`           a parent-relative path — still one edge, still a name
#
# Nothing here calls anything and nothing is declared: the file exists so the
# module edges have a site, and so the module symbol has a file to be published by.

import std/[os, strutils]
import std/private/globs
import ../shared

# ── The two spellings the stdlib marker reads but NO earlier fixture pinned ──────
#
# `isStdlibModulePath` is the predicate that sets `meta.nimStdlibModule`, and it has
# THREE branches beyond the plain `std/x` the rows above cover: a QUOTE, because an
# `include` path is a string literal, and WHITESPACE around the separator, because
# Nim's path syntax permits `std / os` and the corpus writes it (see this lane's
# doc, limitation 33). Both were carried by a regex until the no-regex pass replaced
# it with a character scan, and neither had a fixture — so the scan could have
# dropped both branches and this file would still have passed.
#
# `include` also produces `nim_include` rather than `nim_import`, so the two are
# pinned as separate rows and the include's marker is asserted TRUE, which is the
# half that cannot be reached by an `import`.

include "std/prelude"

# `std / x` — spaces around the separator. This is not a hypothetical spelling:
# upstream writes it in the corpus (`nim/tools/grammar_nanny.nim:4`
# `import std / [strutils, sets]`, `nim/tools/atlas/parse_requires.nim:4`
# `import std / strutils`, and 15 further files), so a predicate that rejected it
# would silently mis-mark real upstream source as a local module.
import std / monotimes
