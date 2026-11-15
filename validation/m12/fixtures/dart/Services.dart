/// Services: async calls, cascades, generics, field access
library services;

import 'base.dart';
import 'Domain.dart';
import 'Features.dart';

class UserService {
  final BaseService base;

  UserService(this.base);

  Future<String> load(int id) async {
    final result = await base.fetch(id);
    final u = User(UserId(id), name: result);
    return u.greet();
  }

  String formatAll(List<int> values) {
    final sb = StringBuffer();
    values.forEach((v) => sb.write(format(v)));
    return sb.toString();
  }

  String format(int v) => base.format(v);

  void demo() {
    final statuses = [Status.active, Status.inactive];
    final box = Box('hello');
    final msg = box.unwrap();
    final counter = Counter(5)
      ..increment()
      ..increment();
    print(msg);
    print(statuses.length);
    print(counter.value);
  }
}
