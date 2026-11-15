// SwiftUI/Combine-flavored fixture — pins the swift analyzer's relationship +
// payload surface on real iOS architecture (repository/protocol/actor/view):
// protocol contracts, actor concurrency, enum hierarchies with raw types,
// class inheritance, extension members, init instantiates, calls from method
// bodies (leaf targets), self. member reads, override edges, imports, and
// per-symbol complexity (guard/if/switch/&&/||/ternary).

import Foundation
import Combine
import SwiftUI

/// Contract for the order domain — the store depends on this, not the
/// concrete implementation.
protocol OrderRepository {
    func createOrder(businessId: String, total: Double) async throws -> Order
    func getUserOrders(userId: String) async throws -> [Order]
}

/// Concrete implementation — actor-isolated, delegates to the API client.
actor OrderRepositoryImpl: OrderRepository {
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func createOrder(businessId: String, total: Double) async throws -> Order {
        let payload = ["businessId": businessId, "total": total]
        return try await self.apiClient.post("/orders", body: payload)
    }

    func getUserOrders(userId: String) async throws -> [Order] {
        let orders = try await self.apiClient.get("/users/\(userId)/orders")
        return orders.map(Order.fromJson)
    }
}

/// View state hierarchy — every state conforms to the sealed base.
enum OrderState {
    case initial
    case loading
    case loaded([Order])
    case failed(String)
}

/// Base store — the in-file hierarchy the override edge resolves against.
class BaseStore: ObservableObject {
    func prepare() async {
        self.state = .initial
    }
}

/// The store itself — extends the in-file base, drives state transitions.
final class OrderStore: BaseStore {
    @Published var state: OrderState = .initial

    private let repository: OrderRepository

    init(repository: OrderRepository) {
        self.repository = repository
    }

    /// Pins the override edge: OrderStore.prepare overrides
    /// BaseStore.prepare (in-file hierarchy, managed-OO family contract).
    override func prepare() async {
        self.state = .initial
    }

    func loadOrders(userId: String) async {
        self.state = .loading
        do {
            let orders = try await self.repository.getUserOrders(userId: userId)
            self.state = .loaded(orders)
        } catch {
            self.state = .failed("failed: \(error)")
        }
    }

    /// Classifies an order — pins per-symbol complexity (guard + if +
    /// switch cases + logical operators + ternary all counted).
    func classify(_ order: Order) -> String {
        guard order.total > 0 else { return "invalid" }
        if order.total > 100 && order.items.count > 5 { return "bulk" }
        if order.total > 50 || order.priority { return "priority" }
        return order.items.isEmpty ? "empty" : "normal"
    }

    func retry(userId: String) async {
        await self.loadOrders(userId: userId)
    }
}

/// Convenience members on the state enum via extension.
extension OrderState {
    var isLoaded: Bool {
        if case .loaded = self { return true }
        return false
    }
}

/// Repository helper type.
struct Order: Equatable {
    let id: String
    let total: Double
    let items: [String]
    let priority: Bool

    static func fromJson(_ json: [String: Any]) -> Order {
        Order(id: "", total: 0, items: [], priority: false)
    }
}

/// Protocol witness for the API client.
protocol APIClient {
    func post(_ path: String, body: [String: Any]) async throws -> Order
    func get(_ path: String) async throws -> [Order]
}

// F6 coverage (2026-09-02): associatedtype_declaration,
// availability_condition, didset_clause / willset_clause /
// willset_didset_block, for_statement, macro_declaration,
// ownership_modifier, property_behavior_modifier,
// repeat_while_statement, switch_entry, switch_statement,
// type_parameters, typealias_declaration, where_clause,
// while_statement — declared handled_verified, now exercised.
protocol Storing {
    associatedtype Item

    func add(_ item: Item)
}

typealias Handler = (Int) -> Void

macro assertment(_ value: Int) = #externalMacro(module: "AssertMacros", type: "AssertMacro")

struct Box<T> {
    var load: Int = 0 {
        willSet(newLoad) {
            load = newLoad
        }
        didSet(oldLoad) {
            load = oldLoad + 1
        }
    }

    unowned(unsafe) var buddy: Box<Int>? = nil

    lazy var lazy_total: Int = 0

    func iterate(items: [Int]) {
        while items.isEmpty == false {
            break
        }
        repeat {
            break
        } while false
        for item in items {
            load += item
        }
        if #available(iOS 16, *) {
            load += 1
        }
        switch load {
        case 0:
            load = 1
        case 1, 2:
            load = 2
        default:
            load = 3
        }
    }
}
