# perl/ontology-uses — `uses` is a name that is READ and not invoked.
package Ontology::Reads;
use strict;
use warnings;
our $HANDLER;
our @QUEUE;
our %TABLE;
sub slot   { \&Ontology::Reads::handler }
sub top    { \&SIGINT }
sub typed  { defined &builtin::is_bool }
sub called { &Ontology::Reads::handler(1) }
sub config { $Config::SSL_ERROR }
sub queue  { @Ontology::Reads::QUEUE }
sub table  { %Ontology::Reads::TABLE }
sub dynamic { $Config{ $key }::SSL_ERROR }
sub blessed { my $self = shift; return ref($self) eq 'Ontology::Reads' }
sub check   { my $obj = shift; return $obj->isa('Ontology::Other') }
sub claims  { my $obj = shift; return $obj->DOES('Ontology::Role') }
sub probe   { my $obj = shift; return $obj->can('maybe_missing') }
sub built   { my $self = shift; return bless $self, $class }
sub listed  { return ref($self) eq 'ARRAY' }
1;
