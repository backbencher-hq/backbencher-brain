/// The TARGET of `import-resolution.dart`'s relative and bare imports. It exists so the claim
/// that an import edge names a FILE can be checked in one run, from both ends: this file's
/// library node publishes `fixtures/dart/import-resolution-sibling.dart` as its identity (the
/// project-relative path), and the importing fixture's edge names that same string.
class ImportResolutionSibling {
  String helper() => 'sib';
}
