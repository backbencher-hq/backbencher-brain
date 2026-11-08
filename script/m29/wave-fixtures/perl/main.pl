#!/usr/bin/env perl
# PINS the perl wave fixture pack (M29 wave 3, language-onboarding protocol).
# Uniform wave convention: a Greeter package with a greet method, exercised in
# main, plus a named constant whose references must be resolvable.

use strict;
use warnings;

package Greeter;

sub new {
    my ($class, @items) = @_;
    return bless { items => \@items }, $class;
}

sub greet {
    my ($self) = @_;
    return "hello " . scalar @{ $self->{items} };
}

package main;

our $GREETING = "hello";

my $g = Greeter->new("a", "b");
print $g->greet(), "\n";
print $GREETING, "\n";
