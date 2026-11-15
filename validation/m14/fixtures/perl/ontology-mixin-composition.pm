# perl/ontology-mixin-composition — a role composition states TWO facts on ONE
# statement, and this fixture pins both.
#
#   `with 'Role'` / `with qw(A B)` / `use role 'R'` compose a role's
#   IMPLEMENTATION into the consuming class. That is `mixes_in`: the role's
#   methods are copied in, and no is-a relation is declared (the class is not a
#   subclass of the role — `extends`/`@ISA` own that fact, and this file writes
#   neither).
#
#   The SAME line also CONFORMS to the role's declared interface — a Moose role
#   can declare required methods, and the class answers `DOES` for the role —
#   which is `implements`. Two predicates, two edges; publishing one and not the
#   other would be choosing which half of the statement to believe.
#
# The corpus census for THIS construct is measured separately
# (validation/m14/measurements/perl-extended-census.json: 0 `with` role-
# composition sites over 656 admitted files — every `with` in the corpus is POD
# prose or a string value). This file is therefore the LIVE CONTROL that proves
# the emission can fire at all, which is what a corpus-unexercised declaration
# owes.
package Ontology::Composed;
use Moo;

with 'Role::Plain';
with qw(Role::One Role::Two);
use role 'Role::Legacy';

# A COMPUTED role names nothing: the file writes no name, so no edge for it.
with $dynamic;
use role $other;

sub own { 1 }
1;
