// DARTD18 (OO family closure): a cascade_section may hold SEVERAL
// invocations (`..a(x)..b(y)`) — one calls edge per selector immediately
// followed by its own argument_part. `..stream.listen(h)` calls listen (the
// getter `stream` is not invoked). DARTD19: `factory X() = _Y;` instantiates
// the implementation class _Y.
class Sink {
  final List<String> log = [];
  Stream<String> stream() => const Stream.empty();
  void onRecord(void Function(String) cb) {}
  Sink transform(String tag) {
    log.add(tag);
    return this;
  }
  Sink listen(void Function() cb) {
    cb();
    return this;
  }
}

abstract base mixin class Reporter {
  factory Reporter() = _Reporter;
}

final class _Reporter implements Reporter {
  _Reporter();
}

class Runner {
  Sink make(String tag) => Sink()
    ..transform(tag)
    ..listen(() {});
  void wire(Sink s) {
    s
      ..onRecord((r) {})
      ..listen(() {});
  }
  void getterChain(Sink s) {
    s
      ..stream().listen(() {})
      ..listen(() {});
  }
}
