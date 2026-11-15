// A LIBRARY ANNOTATION — `@TestOn('vm') library annotated.lib;` annotates the LIBRARY, and its
// type mention was published by nothing.
//
// The pinned grammar puts the annotation INSIDE the library directive:
//   (program (library_name (annotation name: (identifier) (arguments ...)) (dotted_identifier_list ...)) ...)
// (probed). That is a third annotation position, different from both the CHILD-of-declaration
// form (`@deprecated class C`) and the SIBLING-of-declaration form (`class_body (annotation)
// (method_signature)`), and it is why the position table in this lane's annotation reader has
// three shapes rather than two.
//
// The annotated declaration is the library, whose published symbol is the module node: its name
// is the DECLARED library name here (`annotated.lib`), and for an unnamed/implicit library it is
// the file-stem convention the module node already uses.

@TestOn('vm')
library annotated.lib;

void libraryBody() {
  print('x');
}
