package RQ;

sub run {
  my $loop = Mojo::IOLoop->start;
  Mojo::Util->encode_json({});
  app->start;
  $loop->remove($loop);
  $self->helper;
  app->log->level("fatal");
  Mojo::IOLoop->reset;
  $self->${\(Moo::IOLoop->next_tick) };
}

1;
