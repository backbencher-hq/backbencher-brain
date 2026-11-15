use strict;
use warnings;
use feature 'class';

our @EXPORT = qw(alpha beta);
our @EXPORT_OK = (
    gamma,
    delta,
);
our %EXPORT_TAGS = (all => \@EXPORT_OK);

use Runtime::Only;
require Lazy::Load;

sub beta { 2 }
sub alpha { 1 }
sub gamma { 3 }
sub delta { 4 }
sub all { 5 }

package Ontology;
our $VERSION = '1.00';

sub reads_packages {
    my $limit = $Config::Limits::MAX;
    my $own   = Ontology::VERSION;
    my $name  = Config::Limits;
    Config::Limits::helper(1);
    my %seen  = (Config::Limits::MAX => 1);
    my $same  = $seen{Config::Limits::MAX};
    my %only  = (Config::Only::Key => 1);
    my $again = $only{Config::Only::Key};
    my $slot  = ${'Ontology::hidden'}{name};
    my $built = $name ? Config::Limits::->new($limit) : undef;
    return [ $limit, $own, $name, \%seen, $same, \%only, $again, $slot, $built ];
}

sub takes_code_slots {
    my $runner = \&beta;
    my $other  = \&Ontology::alpha;
    my $anon   = \&{ 'Ontology::beta' };
    local *Ontology::slot = \&gamma;
    $runner->();
    $other->();
    $anon->();
    return 1;
}

1;
