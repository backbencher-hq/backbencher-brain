// fixture: javascript/decorator-declaration-lines-861
// M59 (#861), javascript twin of the typescript fixture. This grammar nests the
// decorator INSIDE the declaration (unlike typescript, where a method decorator
// is a class_body sibling), and it does so for classes, fields AND methods:
//
//   @sealed
//   class Service {            class_declaration [decorator@34, class@35, ...]
//     @inject("db")
//     pool = 1                 field_definition  [decorator@36, property_identifier@37, ...]
//     @sealed
//     method() {}              method_definition [decorator@39, property_identifier@40, ...]
//
// so all three symbols and their `contains` lines named the DECORATOR's line.
// Pinned here as the same contract as the typescript fixture: the line is the
// one the name is written on.
//
// #868 landed the attribution half that this fixture left unpinned: a decorator
// is METADATA on the symbol it decorates, so each decorator's name is a
// `references` edge from that symbol (34/36/39, at the decorator's own line).
// The two `uses` rows this fixture pinned before #868 (the bare-read spelling)
// are now forbidden here — they were the decorator's only trace while the
// metadata layer did not exist. See javascript/decorator-metadata-868 for the
// full contract (field attachment, the exported-class placement, and the
// call/read suppression).

function sealed(target) {
  return target
}

function inject(name) {
  return () => undefined
}

@sealed
class Service {
  @inject("db")
  pool = 1

  @sealed
  method() {}
}
