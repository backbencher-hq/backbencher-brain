import 'dart:async';
import 'package:flutter/material.dart';
import 'base.dart';
import 'service.dart' as svc;
export 'base.dart' show Repository;

abstract class Repository<T> {
  Future<T> save(T value);
}

mixin Loggable {
  void log(String message) {
    print('[${runtimeType}] $message');
  }
}

extension StringExtension on String {
  String repeat(int times) => times <= 0 ? '' : this * times;
}

enum Role { admin, user }

@immutable
class UserService extends BaseService implements Repository<User> {
  final RegExp _pattern = RegExp(r'^user:');

  UserService({required Map<String, User> store}) : super(store);

  @override
  String format(String value) => '${super.format(value)}:user';

  @override
  Future<User> save(User value) async {
    store[value.id] = value;
    return value;
  }

  bool matches(String value) => _pattern.hasMatch(value);
}

class UserWidget extends StatelessWidget {
  final UserService service;

  const UserWidget({super.key, required this.service});

  @override
  Widget build(BuildContext context) {
    return Container(
      child: Text(service.format('Ada')),
    );
  }
}

Future<User> createDefault() async {
  final store = <String, User>{};
  final service = UserService(store: store);
  return service.save(User(id: '1', name: 'Ada'));
}
