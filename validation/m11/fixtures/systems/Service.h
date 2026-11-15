// validation/m11/fixtures/systems/Service.h
// M11.10 C++ fixture: classes, templates, namespaces, inheritance,
// interfaces, methods, fields, constructors, virtual functions.
#pragma once

#include <string>
#include <vector>

namespace example {

class ILogger {
public:
  virtual ~ILogger() = default;
  virtual void log(const std::string &message) = 0;
};

template <typename T>
class Repository {
public:
  virtual ~Repository() = default;
  virtual void add(const T &item) = 0;
  virtual T find(int id) = 0;
};

class ConsoleLogger : public ILogger {
public:
  void log(const std::string &message) override;
};

class User {
public:
  User(int id, const std::string &name);
  int getId() const;
  std::string getName() const;

private:
  int id_;
  std::string name_;
};

class UserRepository : public Repository<User> {
public:
  void add(const User &item) override;
  User find(int id) override;

private:
  std::vector<User> users_;
};

class UserService {
public:
  explicit UserService(UserRepository *repository);
  User createUser(const std::string &name);
  User getUser(int id);

private:
  UserRepository *repository_;
};

} // namespace example
