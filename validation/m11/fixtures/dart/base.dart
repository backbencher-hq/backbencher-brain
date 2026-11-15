class BaseService {
  final Map<String, User> store;

  BaseService(this.store);

  String format(String value) => value.trim();
}

class User {
  final String id;
  final String name;

  User({required this.id, required this.name});
}
