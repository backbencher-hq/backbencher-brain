package UsesParent;
use parent -norequire, 'Base';
sub run { 1 }
package UsesBase;
use base 'Other::Base';
sub run { 2 }
package MojoStyle;
use Mojo::Base -base;
sub run { 3 }
package MojoNamed;
use Mojo::Base 'Mojo::Base';
sub run { 4 }
package IsaArray;
our @ISA = ('Alpha', 'Beta');
sub run { 5 }
package SelfNamed;
use Mojo::Base 'SelfNamed';
sub run { 6 }
1;
