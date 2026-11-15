// CANONICAL `part_of` — a part/library coupling is its own relationship, and its DIRECTION
// is the directive's own direction.
//
// WHY THIS FIXTURE EXISTS. Until 2026-10-18 both `part 'x.dart'` (the library lists a part) and
// `part of 'lib.dart'` (the part file names its library) published an `imports` row with ad-hoc
// `isPart`/`isPartOf` flags. Two problems, both measured rather than argued:
//
//   * a part is NOT an import. The label said a file depends on a package/specifier it imports;
//     `imports` is also the label whose targets the external-claim machinery verifies against
//     the project's pubspec facts. Putting a file-coupling fact on it made a clause that no
//     package can ever contain look like a dependency that was never declared.
//   * the ROLE was metadata-only, so a consumer that cannot read metadata could not tell which
//     end of the directive the emitting file is — and the two ends point in OPPOSITE directions.
//     `part_of` rows now carry `metadata.partRole`: "part" when this file is the part, "library"
//     when this file is the library listing parts.
//
// SHAPES (pinned grammar; both directives wrap their URI in a `string_literal`/`uri` child, and
// the URI resolves through `dartImportTargetPath` exactly like an import specifier):
//   (part_directive (uri (string_literal)))       this library -> a part file it lists
//   (part_of_directive (uri (string_literal)))    this part file -> the library it belongs to
//
// THE ONE FILE carries both roles because the fixture pins DIRECTIVES, not a legal library
// layout: the analyzer reads nodes, and the two node shapes are what the emission rule is about.
// The `import` below is the boundary in the other direction — it must stay `imports`.
//
// NO ROW for an UNRESOLVABLE specifier: the `package:not_in_this_checkout/...` part below names a
// package this checkout does not carry, `dartImportTargetPath` refuses it, and the rule is that a
// part_of row is published ONLY with a resolved target — the old `uri:*` specifier form is what
// this label exists to stop publishing.

part 'part_role_part.dart';

part of 'part_role_library.dart';

part 'package:not_in_this_checkout/missing.dart';

import 'dart:async';

/// A library-side symbol, so the module is not the only thing in the file.
class PartRolesDemo {
  int value = 1;
}
