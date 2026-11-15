/// PINS the import-target rules (see `LIBRARY IDENTITY` in `real-dart-analyzer.ts`): a Dart
/// specifier is a PATH, so the edge names the FILE it names — or, where this checkout cannot
/// say which file that is, the specifier is kept so the edge stays VISIBLY unresolved instead
/// of pointing at a wrong file or being quietly marked external.
///
/// Four rules, all pinned in the expectation beside this file:
///   1. a RELATIVE specifier naming a sibling of this file -> that file's project-relative path.
///      The sibling exists and is a fixture of its own, so BOTH sides of the claim are produced
///      by the same run: the import edge names it, and the sibling's own library node publishes
///      that same string.
///   2. the same for a BARE specifier, which Dart resolves against this file's own directory.
///   3. a specifier naming a file that is NOT present -> still the path it names. A dangling
///      internal import is a finding; a specifier string would hide which file it meant.
///   4. `package:` naming a package this checkout does not declare, and `dart:` naming an SDK
///      library this checkout does not carry -> the specifier form (`uri:*`). The population
///      cannot say which file was meant and must not pretend it can.
import 'import-resolution-sibling.dart';
import 'import-resolution-missing.dart';
import 'package:not_declared_in_this_checkout/x.dart';
import 'dart:async';
import 'dart:io' show Platform;

class ImportResolution {
  final String label;
  const ImportResolution(this.label);
}
