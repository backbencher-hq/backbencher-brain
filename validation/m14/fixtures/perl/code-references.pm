package Code::Ref;
use strict;
use warnings;

our $TIMEOUT = 30;

sub build {
  my ($class, %args) = @_;
  my $self = bless {}, $class;
  return $self;
}

sub run {
  my ($self) = @_;

  # 17 -- a code reference: the sub is NAMED and nothing is invoked.
  my $plain   = \&helper;
  # 20 -- qualified. Same edge as line 17 (one `uses run -> helper`), and the
  #       qualifier is kept in metadata rather than used as the target.
  my $qual    = \&Code::Ref::helper;
  # 24 -- a reference to a CALL. The grammar types this child as
  #       function_call_expression, so the `uses` rule finds no `function` node
  #       and the CALL is filed once, under `calls`.
  my $callref = \&helper();
  # 26 -- a computed slot: nothing is written to name. REFUSED.
  my $dyn     = \&{ $self->{slot} };
  # 29 -- a variable slot: the varname is `$slot`, which the written-name
  #       allowlist rejects. REFUSED.
  my $dyn2    = \&$plain;
  # 31 -- a ref to an array, not to code: no `function` child at all. REFUSED.
  my $aref    = \@LIST;
  # 33 -- a ref to a scalar. REFUSED.
  my $sref    = \$TIMEOUT;

  # 36 -- a class named in a query. `isa` IS invoked; `Other::Class` is not.
  my $is  = $self->isa('Other::Class');
  # 38 -- the query's name is a VARIABLE, so the file states no name. REFUSED.
  my $not = $self->isa($self->{cls});
  # 40 -- a role named in a query.
  my $does = $self->DOES('Some::Role');
  # 42 -- a method named in a query. `can` IS invoked; `later` is not.
  my $can  = $self->can('later');
  # 44 -- self-reference by method: `can('run')` inside `sub run`. REFUSED.
  my $selfcan = $self->can('run');
  # 46 -- self-reference by package: `isa('Code::Ref')` inside it. REFUSED.
  my $selfisa = $self->isa('Code::Ref');
  # 48 -- an INTERPOLATED literal is not a name. REFUSED.
  my $interp  = $self->isa("Other::$suffix");

  # 53 -- a package global the file declares, READ. This is a `uses` edge and it
  #       is NOT emitted by this change: see the rationale. Pinned as absent so
  #       the gap is an assertion rather than an oversight.
  my $t = $TIMEOUT;

  # 56 -- self-reference by CODE REFERENCE: `\&run` inside `sub run`. REFUSED.
  my $selfref = \&run;

  # 62 -- a method call whose ARGUMENT is a literal that names nothing this
  #       query asks about. `render` is not isa/DOES/can, so there is no type
  #       being named and no `references` edge. The control for the query-method
  #       gate: without the gate this line publishes a class named `Not::AClass`.
  my $r = $self->render('Not::AClass');

  # 68 -- `&print(...)` is perl's EXPLICIT-CALL syntax for the BUILTIN `print`.
  #       The `&` is sigil, so the builtin probe has to see through it; a probe
  #       handed `&print` misses the set and the edge comes back for a word the
  #       LANGUAGE owns.
  my $printed = &print("hello\n");

  return $plain;
}

sub helper { 42 }
sub later  { 43 }

1;
