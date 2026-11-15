// Pins M60 D1, half three: NO `library` directive at all.
//
// 2,882 of 3,000 sampled files are in this state. The Dart spec defines such a file's
// library name as its file stem, so here the stem is the LANGUAGE's answer rather than a
// guess — which is the one case where publishing the stem needs no justification beyond
// following the spec, and the reason the implicit case can be published unconditionally.
import 'package:meta/meta.dart';

class Implicit {
  @mustCallSuper
  void run() {}
}
