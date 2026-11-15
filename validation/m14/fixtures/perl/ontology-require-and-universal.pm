# perl/ontology-require-and-universal — two `references`/`imports` shapes perl
# writes and the lane read neither.
#
#   require './lib/Bootstrap.pm'   a FILENAME specifier, not a module name
#   UNIVERSAL::isa($obj, 'Class')  the FUNCTION spelling of the type test
use strict;
use warnings;
sub via_path   { return 1 }
sub via_module { return 1 }
sub via_universal {
  my ($self) = @_;
  return UNIVERSAL::isa($self, 'Ontology::Universal');
}
sub via_universal_last_arg {
  my ($self) = @_;
  return UNIVERSAL::isa($self, ref($self), 'Ontology::Universal');
}
sub not_a_type {
  my ($self) = @_;
  return UNIVERSAL::can($self, 'maybe');
}
sub not_a_type2 {
  my ($self) = @_;
  return UNIVERSAL::isa($self, $class);
}
sub via_isa { my ($self) = @_; return $self->isa('Ontology::Universal') }
require './lib/Bootstrap.pm';
require Ontology::Runtime;
require "./lib/Late$stage.pm";
require $computed;
require constant;
import constant HAVE_THREADS => 1;
1;
