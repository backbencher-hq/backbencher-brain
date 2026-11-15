package B;
sub flow {
    my ($x) = @_;
    if ($x > 1) { return 1 } elsif ($x == 0) { return 0 } else { return -1 }
    unless ($x) { return 2 }
    while ($x-- > 0) { $x += 1 }
    until ($x > 5) { $x++ }
    for my $i (1..3) { $x += $i }
    foreach my $k (keys %h) { $x += 1 }
    for ($x = 0; $x < 3; $x++) { }
    my $y = $x ? 1 : 2;
    $x += 1 if $y;
    return $x <=> $y;
}
sub builtins {
    my ($o) = @_;
    say "hello";
    my $c = chr(65);
    system("ls");
    accept(my $s, $o);
    my $f = fc($o);
    return bless {}, 'B';
}
1;
