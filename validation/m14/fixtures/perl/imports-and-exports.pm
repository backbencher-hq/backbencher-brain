use v5.36;
use 5.010;
no strict;
no warnings;
use feature "class";
use lib "./t/lib";
use constant PI => 3.14159;
use constant { MAX => 10, MIN => 1 };
use parent -norequire, 'Base';
use Mojo::Base -base;
require Runtime::Only;
our @EXPORT = qw(alpha beta);
our @EXPORT_OK = (gamma => 1, delta => 2);
our %EXPORT_TAGS = (all => \@EXPORT_OK);
our $ISA = ('Alpha', 'Beta');
sub alpha { 1 }
sub beta { 2 }
sub gamma { 3 }
sub delta { 4 }
sub all { 5 }
package Impl;
has 'name' => (is => 'ro');
with 'Role::One';
use role 'Role::Two';
1;
