package Remote::Silent;

# This base declares a method, but NOT the one the subclass below claims to
# override. It has to declare SOMETHING: `mergeSymbolsIntoOverrideCompanion`
# creates an entry only for an owner that declares a method, so a base with an
# empty body never enters the companion and is then indistinguishable from a base
# outside the project. See the fixture's rationale -- that limitation is the
# reason this file cannot be `package Remote::Silent; 1;`.
sub unrelated { 1 }

1;
