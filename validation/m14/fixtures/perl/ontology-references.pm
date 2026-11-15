# perl/ontology-references — `references` is a TYPE the file NAMES.
package Ontology::Types;
use strict;
use warnings;
sub make     { my $class = shift; return bless {}, $class }
sub literal  { my $self = shift; return bless $self, 'Ontology::Types' }
sub tested   { my $obj = shift; return $obj->isa('Ontology::Other') }
sub claims   { my $obj = shift; return $obj->DOES('Ontology::Role') }
sub kind     { my $obj = shift; return ref($obj) eq 'Ontology::Types' }
sub notkind  { my $obj = shift; return ref($obj) eq 'ARRAY' }
sub notkind2 { my $obj = shift; return ref($obj) eq 'HASH' }
sub dynamic  { my $obj = shift; return $obj->isa($class) }
sub runtime  { my $self = shift; return bless $self, $class }
sub computed { my $obj = shift; return ref($obj) eq "${class}::Thing" }
1;
