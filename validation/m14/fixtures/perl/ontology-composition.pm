# perl/ontology-composition — a role composition is a NAME LIST, and the three
# shapes that are not.
package Ontology::Roles;
use strict;
use warnings;
use Moo;
with 'Role::Plain';
with qw(Role::One Role::Two);
with 'Role::Three', { -excludes => ['gone'], -alias => { old => 'new' } }, 'Role::Four';
with 'Role::Five' => { -excludes => ['bye'] }, 'Role::Six' => { -alias => { a => 'b' } };
has 'name' => (is => 'ro', clearer => 1, predicate => 1);
has 'has spaces' => (is => 'ro');
sub old { 1 }
sub new { 2 }
1;
