package Service;
use strict;
use parent 'BaseService';
use Role::Cache;
our @EXPORT = qw(run);

has 'name' => (is => 'ro');
with 'Role::Thing';

sub new {
  my ($class) = @_;
  return bless {}, $class;
}

sub fetch {
  my ($self, $id) = @_;
  $self->helper();
  BaseService->new();
  my $local = Service->new();
  return $id;
}

sub run {
  my ($self) = @_;
  Service::Util::format();
  return $self->fetch(1);
}

1;
