// Pins M60 D1, half two: `library;`, legal Dart, declares a library with NO name.
//
// Measured at 3,000 files: 101 of them use this form, against 17 that declare a name
// and 2,882 that declare nothing at all — so it is the COMMONEST directive form in this
// corpus and the one where the published name is a convention rather than a fact. The
// analyzer records which form it was in `libraryName`'s `kind` and publishes the stem,
// because a library with no declared name still needs a node for the edges to hang from.
library;

import 'dart:async';

class Unnamed {
  Future<void> go() async => await Future<void>.value();
}
