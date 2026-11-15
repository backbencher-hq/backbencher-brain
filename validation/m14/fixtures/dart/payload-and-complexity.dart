/// ProxiCall-style Dart fixture: cubit/bloc + repository patterns.
/// Authored before the analyzer's M14 run (adversarial: pins what must be
/// true of a real Flutter app's architecture, not what the analyzer emits).

// F6 coverage (2026-09-02): library/export/import-combinator/part directives
// (probe-verified: the `library` directive must precede imports, and ALL
// directives must precede any declaration).
library f6.lib;

export 'f6-other.dart' show Alpha hide Beta;

import 'f6-x.dart' as f6pfx show one hide two;

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'order_repository.dart';
import 'f6-io.dart' as _iIo;
import 'f6-async.dart' as _iAsync;
import 'f6-dart.dart' as _iDart;

part 'f6-part.dart';


/// Abstract contract for the order domain — the service depends on this,
/// not the concrete implementation.
abstract class OrderRepository {
  Future<Order> createOrder(String businessId, {required double total});
  Future<List<Order>> getUserOrders(String userId);
}

/// Concrete implementation — delegates to the remote API client.
class OrderRepositoryImpl with RepositoryLogger implements OrderRepository {
  OrderRepositoryImpl({required this.apiClient});

  final ApiClient apiClient;

  @override
  Future<Order> createOrder(String businessId, {required double total}) async {
    final payload = {'businessId': businessId, 'total': total};
    return apiClient.post('/orders', body: payload);
  }

  @override
  Future<List<Order>> getUserOrders(String userId) async {
    final orders = await apiClient.get('/users/$userId/orders');
    return orders.map(Order.fromJson).toList();
  }
}

/// Cubit state hierarchy — every state extends the sealed base.
sealed class OrderState extends Equatable {
  const OrderState();

  /// Classifies a state code — pins Dart 3 switch-EXPRESSION complexity
  /// (each arm is a branch, counted per the managed-OO family convention).
  int describe(int code) {
    return switch (code) {
      0 => 1,
      1 => 2,
      _ => 0,
    };
  }

  @override
  List<Object?> get props => [];
}

class OrderInitial extends OrderState {}
class OrderLoading extends OrderState {}
class OrderLoaded extends OrderState {
  const OrderLoaded(this.orders);
  final List<Order> orders;
  @override
  List<Object?> get props => [orders];
}
class OrderError extends OrderState {
  const OrderError(this.message);
  final String message;
}

/// The cubit itself — extends the framework Cubit, emits states.
class OrderCubit extends Cubit<OrderState> {
  OrderCubit(this._repository) : super(OrderInitial());

  final OrderRepository _repository;

  Future<void> loadOrders(String userId) async {
    emit(OrderLoading());
    try {
      final orders = await _repository.getUserOrders(userId);
      emit(OrderLoaded(orders));
    } catch (e) {
      emit(OrderError('failed: $e'));
    }
  }

  void retry() => loadOrders('current');
}

/// Mixin providing consistent logging across repositories.
mixin RepositoryLogger {
  void logCall(String method) {
    print('repo.$method');
  }
}

/// Extension adding convenience getters to the state hierarchy.
extension OrderStateX on OrderState {
  bool get isLoaded => this is OrderLoaded;
  int get orderCount => this is OrderLoaded ? (this as OrderLoaded).orders.length : 0;
}


// F6 coverage (2026-09-02): everything below is probe-verified against the
// pinned tree-sitter-dart grammar. Directives appear only at file top (this
// append keeps them first in this trailing block, which the grammar accepts).
enum F6State { idle, busy, done }

enum F6Rich {
  a.named(1),
  b.named(2);

  const F6Rich.named(this.n);

  final int n;
}

mixin F6Loggable {
  void log(String msg) {}
}

abstract class F6BaseWidget {
  const F6BaseWidget();
}

abstract class F6Contract {}

typedef F6Mapper = String Function(int);

class F6App = F6BaseWidget with F6Loggable implements F6Contract;

// F6 DAD regression class: import-aliased supertypes (mocktail mock shape).
// tree-sitter-dart parses `_iDart.FakeBase` FLAT as two adjacent
// type_identifiers joined by an anonymous `.` — the FIRST is the import
// alias container, never a class name. The resolved leaf must be the edge
// target; the alias must never appear (DAD1/DAD2).
class F6MockClient extends _iDart.FakeBase implements _iIo.Client, _iAsync.Future {
  @override
  void close() {}
}

abstract class F6Bound<T extends Comparable<T>> {
  T? pick(T? a, T? b);
}

class F6ViewModel extends F6BaseWidget with F6Loggable {
  static const F6BaseWidget fallback = F6BaseWidget();
  static final RegExp pattern = RegExp(r'f6-\w+');

  late final String cached;

  F6ViewModel();

  const F6ViewModel.named({super.key});

  factory F6ViewModel.fromSeed(int seed) => F6ViewModel();

  factory F6ViewModel.redirect(int seed) = F6ViewModel.fromSeed;

  F6ViewModel operator -() => this;

  set tag(String v) {}

  void run() {
    var total = 0;
    do {
      total += 1;
    } while (total < 2);
    while (total < 5) {
      total += 1;
    }
    for (final flag in [true, false]) {
      total += flag ? 1 : 0;
    }
    if (total > 3) {
      total += 1;
    }
    switch (total) {
      case 1:
      case 2:
        total += 1;
        break;
      default:
        total += 2;
    }
    final sym = #f6symbol;
    const widget = const F6BaseWidget();
    final list = [1, 2, ...[3, 4]];
    bool both = true && false;
    bool either = true || false;
    final f = () => total;
    final built = new List<int>.filled(2, total); // F6: new_expression
    total += list.length + sym.hashCode + f() + built.length;
    widget.hashCode;
    pattern.hashCode;
    log("$total");
  }

  void demo(F6ViewModel other) {
    final w = F6ViewModel()
      ..tag = 'a'
      ..run();
    tag = other?.tag ?? '';
    w.hashCode;
  }
}
