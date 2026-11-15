package Negative;
use strict;

sub execute {
  my ($self) = @_;
  my $local = $self->factory();
  $local->new();
  my $closure = sub { return $local; };
  return $local;
}

1;
