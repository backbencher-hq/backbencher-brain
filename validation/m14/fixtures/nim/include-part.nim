# NIM part_of fixture — `include` is a TEXTUAL SCOPE-SHARING inclusion, not an import.
#
# The included file's declarations join THIS module's single declaration space; no module is
# created, no binding scope is imported, and nothing can `import` what was included. That is the
# `part_of` contract (src/ast/types.ts:164-190), and this fixture pins the R3 relabel of the
# `include` row from `imports` to `part_of` (2026-10-23): same source, same target, same line,
# same confidence — plus `partRole: "library"` (nim has only the host role of Dart's two) and
# `targetResolution: "module-name"` (the RECORDED divergence from fsharp/php, which emit paths).
#
# The included target is the sibling `helpers.nim` (`proc helper*(): int = 1`), so the source is
# accepted by the real Nim 2.2.12 compiler (`nim check`) as an include of an existing file.
include helpers

proc usesHelper*(): int =
  helper() + 1
