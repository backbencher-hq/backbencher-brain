/// Domain entities
library domain;

import 'base.dart';

class UserId {
  final int value;

  UserId(this.value);

  @override
  String toString() => 'UserId($value)';
}

class User {
  final UserId id;
  String name;
  late String email;

  User(this.id, {required this.name});

  factory User.anonymous() => User(UserId(0), name: 'anon');

  String greet() => 'Hi $name';

  @override
  String toString() => 'User(${id.value}, $name)';
}
