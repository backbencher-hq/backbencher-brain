// Pins M60 D1, half one: the DECLARED library name, dotted, read from the parse tree.
//
// The file's stem is `library-source-pins`, so a name function that regresses to the
// stem publishes the wrong node and this fixture fails — which is the point of naming
// the file differently from the library it declares.
//
// Measured at 600 files: the analyzer emitted `imports`/`exports` edges FROM the library
// and published no library node at all, so 1,755 of 1,815 `imports` sources and 10 of 10
// `exports` sources resolved to nothing. The declared name is dotted in real Dart
// (`_fe_analyzer_shared.scanner.characters`), so a first-token match truncates it to a
// name no other file ever imports.
library _pins.explicit_library;

import 'package:path/path.dart' as p;
export 'package:path/path.dart';

class Consumer {
  Consumer(this.path);

  final String path;

  String joined(String other) => p.join(path, other);
}