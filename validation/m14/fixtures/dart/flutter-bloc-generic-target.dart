// FLUTTER / BLOC — the constructs the engineers named, in one fixture.
//
// Authored BEFORE the analyzer run. The claim under test is narrow and specific:
//
//   in `context.read<CounterCubit>()` the semantically meaningful target is the
//   TYPE ARGUMENT (CounterCubit), not the method `read`, and in
//   `BlocBase.of<CounterBloc>(context)` it is CounterBloc.
//
// That is the bloc/cubit resolution problem: the declaration a reader cares about is
// written inside angle brackets. If the analyzer emits `uses -> read` only, the edge
// exists but names the wrong thing, and a Flutter codebase reads as unresolvable even
// though every file parsed.
//
// The framework types (Widget, StatelessWidget, BuildContext, the mixin) are DECLARED
// IN THIS FIXTURE on purpose, so this fixture measures the ANALYZER and not the corpus:
// a real Flutter corpus does not contain packages/flutter, and that separate gap is
// recorded in docs/analyzers/LAPTOP-B-STATUS.md.
//
// Also under test: `with X` (a mixin application) and `@override` of a framework member.

abstract class Cubit<T> {
  T get state;
  void emit(T next) {}
}

class CounterState {
  final int value;
  const CounterState(this.value);
}

class CounterCubit extends Cubit<CounterState> {
  CounterCubit() : super(const CounterState(0));

  void increment() => emit(CounterState(state.value + 1));
}

abstract class BlocBase<S> {
  S get state;

  static T of<T extends BlocBase<Object?>>(Object context) =>
      throw UnimplementedError();
}

class CounterBloc extends BlocBase<CounterState> {
  @override
  CounterState get state => const CounterState(0);
}

abstract class Widget {
  const Widget();
}

abstract class StatelessWidget extends Widget {
  const StatelessWidget();

  Widget build(BuildContext context);
}

mixin SingleTickerProviderStateMixin {}

class BuildContext {}

extension ContextReadX on BuildContext {
  T read<T>() => throw UnimplementedError();
}

class CounterPage extends StatelessWidget with SingleTickerProviderStateMixin {
  const CounterPage();

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<CounterCubit>();
    final bloc = BlocBase.of<CounterBloc>(context);
    cubit.increment();
    return CounterText(state: bloc.state.value);
  }
}

class CounterText extends Widget {
  const CounterText({required this.state});

  final int state;
}
