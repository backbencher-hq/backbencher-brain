// validation/m12/fixtures/swift/UserService.swift
// M12.21 Swift positive fixture: protocol -> interface with associatedtype +
// methods; class hierarchy (BaseService superclass, Repository protocol);
// extension -> extension symbol (no self-owner); enum with raw type (no
// implements edge); struct with properties; init -> constructor; override ->
// qualified overrides edge; member calls -> leaf targets; capitalized bare
// call -> instantiates only; self. reads -> uses; imports -> references.

import Foundation

protocol Repository {
    associatedtype Item
    func find(id: String) -> Item?
    func save(item: Item) -> Bool
}

open class BaseService {
    var name: String
    private var count: Int

    init(name: String) {
        self.name = name
        count = 0
    }

    func describe() -> String {
        return "BaseService(\(name))"
    }
}

class UserService: BaseService, Repository {
    typealias Item = User

    var users: [User] = []
    var lastUser: User?

    struct User {
        var id: String
        var email: String
    }

    override func describe() -> String {
        return "UserService(\(self.name))"
    }

    func find(id: String) -> User? {
        let result = users.first { $0.id == id }
        lastUser = result
        return result
    }

    func save(item: User) -> Bool {
        users.append(item)
        lastUser = item
        return true
    }

    func makeUser() -> User {
        let user = User(id: "u1", email: "a@b.c")
        _ = self.users
        return user
    }
}

extension UserService {
    func countUsers() -> Int {
        let s = Status.active
        switch s {
        case .active:
            return 1
        default:
            return 0
        }
    }
}

enum Status: String {
    case active
    case inactive
}

actor Account {
    var balance: Int = 0

    func deposit(_ amount: Int) {
        balance += amount
    }
}
