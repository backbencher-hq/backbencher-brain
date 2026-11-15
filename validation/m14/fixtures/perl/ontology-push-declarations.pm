# perl/ontology-push-declarations — perl builds two of its declarations with `push`,
# not with `=`, and the lane read only the assignment spelling.
#
# The export half is at FILE SCOPE for the reason `ontology-exports.pm` is, and
# the reason is recorded here rather than repeated in prose: the harness's export
# invariant resolves an export name against TOP-LEVEL symbols, and a perl `sub`
# inside a `package` is a `method`. A module that exports its own methods — which
# is what a class-based perl module does — therefore cannot satisfy the
# invariant as written. The invariant is a java-family rule ("bare member names
# are not importable; membership rides Contains"); in perl the exported symbol IS
# the package's method and `use Foo;` makes `foo()` callable in the caller. That
# is reported to master as a per-language hole in the invariant; the fixture is
# file-scope so it is satisfiable today.
use strict;
use warnings;
sub assigned     { 1 }
sub pushed_one   { 1 }
sub pushed_two   { 1 }
sub pushed_three { 1 }
our @EXPORT_OK = qw(assigned);
push @EXPORT_OK, qw(pushed_one pushed_two);
push @EXPORT    => qw{pushed_three};
push @EXPORT_OK, @Ontology::Other::EXPORT_OK;
push @ISA, 'Ontology::Base', 'Exporter';
package Ontology::Push {
  sub own { 1 }
  push @ISA => 'Ontology::Second';
  push @ISA, @Ontology::Other::ISA;
  push \@ISA, __FILE__;
}
1;
