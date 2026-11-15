/// Negative: locals, params, closures, builtins, field access
/// must NOT become symbols or relationships.
library negative;

import 'Features.dart';

void processList(List<int> items) {
  final local = items.length;
  var count = 0;
  for (var i = 0; i < items.length; i++) {
    count += i;
  }
  print(count);
  assert(count >= 0);
  items.map((x) => x * 2).toList();
}

class Hidden {
  int _secret = 0;

  int _helper(int x) => x + _secret;

  void run() {
    final fn = (int a) => a + 1;
    print(fn(1));
  }
}
