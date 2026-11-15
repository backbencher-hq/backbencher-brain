// THE NAMED PART-OF DIRECTIVE — `part of my.lib;` names the LIBRARY, not a file, and the lane
// published NOTHING for it.
//
// Dart lets a library declare a name (`library my.lib;`) and a part file belong to it by THAT
// name (`part of my.lib;`). The URI form (`part of 'lib.dart';`) reports `part_of` with
// `partRole: "part"`; the named form was silently dropped, so a whole class of part-library
// coupling was invisible in the file graph.
//
// SHAPE (probed on the pinned grammar — a part file cannot legally carry a `part` directive,
// so this fixture is only the directive and its declarations):
//   (part_of_directive (part_of_builtin) (dotted_identifier_list (identifier) (identifier)))
//
// The target is the library NAME as written, with inner whitespace stripped by the same helper
// the library-name reader uses — so `part of a . b;` and `library a.b;` spell one string, which
// is the module symbol's name in the store.

part of my.lib;

class NamedPartDemo {
  int value = 1;
}

void useDemo(NamedPartDemo d) {
  print(d.value);
}
