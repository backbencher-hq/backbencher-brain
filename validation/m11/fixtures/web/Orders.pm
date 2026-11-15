package Orders;
use strict;
use warnings;
use Moose;

use Data::Dumper;

our $VERSION = '1.0.0';

has 'name' => (is => 'ro', isa => 'Str', default => 'orders');
has 'items' => (is => 'ro', isa => 'ArrayRef', default => sub { [] });

sub add_item {
    my ($self, $item) = @_;
    push @{ $self->items }, $item;
    return scalar @{ $self->items };
}

sub total {
    my ($self) = @_;
    my $sum = 0;
    for my $item (@{ $self->items }) {
        $sum += $item->{price} * $item->{qty};
    }
    return $sum;
}

sub as_string {
    my ($self) = @_;
    return sprintf "%s: %d items", $self->name, scalar @{ $self->items };
}

sub _normalize {
    my ($item) = @_;
    $item->{price} ||= 0;
    return $item;
}

sub import_legacy {
    my ($class, $file) = @_;
    open my $fh, '<', $file or die "cannot open $file: $!";
    my @rows = <$fh>;
    close $fh;
    return \@rows;
}

1;
