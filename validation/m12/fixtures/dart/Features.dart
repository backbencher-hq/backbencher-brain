/// Features: enums, generics, extensions, mixins, overrides
library features;

import 'base.dart';
import 'Domain.dart';

enum Status { active, inactive, pending }

class Box<T> {
  final T item;

  Box(this.item);

  T unwrap() => item;
}

extension StringUtils on String {
  String shout() => toUpperCase();
}

class Counter extends BaseService with Loggable implements Repository {
  int value = 0;

  Counter([this.value = 0]);

  @override
  String format(int v) => 'n=$v';

  @override
  Future<String> fetch(int id) async {
    log('fetching $id');
    await Future.delayed(const Duration(seconds: 1));
    return format(id);
  }

  @override
  void save(String data) {
    log(data);
  }

  void increment() {
    value++;
    if (value > 10) {
      log('high');
    } else {
      log('low');
    }
  }
}
