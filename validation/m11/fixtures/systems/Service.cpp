// validation/m11/fixtures/systems/Service.cpp
// M11.10 C++ fixture: definitions, calls, instantiation, overrides.
#include "Service.h"

namespace example {

void ConsoleLogger::log(const std::string &message) {
  // write message to console
}

User::User(int id, const std::string &name) : id_(id), name_(name) {}

int User::getId() const {
  return id_;
}

std::string User::getName() const {
  return name_;
}

void UserRepository::add(const User &item) {
  users_.push_back(item);
}

User UserRepository::find(int id) {
  for (const User &user : users_) {
    if (user.getId() == id) return user;
  }
  return User(-1, "unknown");
}

UserService::UserService(UserRepository *repository) : repository_(repository) {}

User UserService::createUser(const std::string &name) {
  User user(42, name);
  repository_->add(user);
  return user;
}

User UserService::getUser(int id) {
  return repository_->find(id);
}

} // namespace example
