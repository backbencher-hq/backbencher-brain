package BaseService;
use strict;
use warnings;
our $VERSION = '1.0';

sub new {
  my ($class) = @_;
  return bless {}, $class;
}

sub fetch {
  my ($self, $id) = @_;
  return $id;
}

sub helper {
  my ($self) = @_;
  return 1;
}

1;
