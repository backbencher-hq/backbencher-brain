// base.dart — shared base types
library base;

abstract class BaseService {
  String format(int value);

  Future<String> fetch(int id);
}

mixin Loggable {
  void log(String message) {
    print(message);
  }
}

abstract class Repository {
  void save(String data);
}
