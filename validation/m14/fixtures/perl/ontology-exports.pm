# perl/ontology-exports — the `exports` EDGE, not the `exports` payload.
#
# File-scope on purpose, like `imports-and-exports.pm`: a perl `sub` inside a
# `package` becomes a `method` symbol owned by that package, and the harness's
# export invariant resolves an export against TOP-LEVEL symbols only. A fixture
# that put these subs in a package would therefore be asserting a harness rule
# rather than an analyzer rule. See the report: a perl package's own exported
# subs cannot satisfy `expectExports`' resolution invariant.
use strict;
use warnings;
use Exporter 'import';
our @EXPORT = qw(alpha beta);
our @EXPORT_OK = qw(gamma delta);
our %EXPORT_TAGS = (all => \@EXPORT_OK, some => [qw(epsilon)]);
sub alpha   { 1 }
sub beta    { 2 }
sub gamma   { 3 }
sub delta   { 4 }
sub epsilon { 5 }
# `all` and `some` are TAG names, not subs, and a tag does not resolve to a
# symbol. The harness's export invariant requires every export name to resolve to
# a top-level symbol, so they are declared here for the same reason
# `imports-and-exports.pm` declares `sub all` — the fixture has to be
# satisfiable, and the shape it is pinning is the EDGE, not the resolver.
sub all { 1 }
sub some { 1 }
1;
