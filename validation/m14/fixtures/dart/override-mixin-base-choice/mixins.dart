// THE TWO MIXINS — the cross-file evidence the base-choice rule needs.
//
// Both are declared HERE, in a sibling file, so the project index is the only thing that can tell
// the analyzer which of them declares `onCheckForClose`. A single-file fixture could not exercise
// the rule at all: with the base and the member in one file, the per-file `exposed()` closure
// already answers, and the first-parent fallback never runs.
//
// The names are the MEASURED dart-http ones (`pkgs/http2/lib/src/error_handler.dart`), because a
// fixture that invents its own names measures a different thing.
library override_mixin_base_choice;

/// Used by classes which may be terminated from the outside.
mixin TerminatableMixin {
  bool _terminated = false;

  void terminate([Object? error]) {
    if (!wasTerminated) {
      _terminated = true;
      onTerminated(error);
    }
  }

  bool get wasTerminated => _terminated;

  void onTerminated(Object? error) {
    // Subclasses can override this method if they want.
  }
}

/// Used by classes which may be closed.
mixin ClosableMixin {
  bool _closing = false;

  bool get isClosing => _closing;

  void startClosing() {
    if (!_closing) {
      _closing = true;
      onClosing();
    }
    onCheckForClose();
  }

  void onCheckForClose() {
    // Subclasses can override this method if they want.
  }

  void onClosing() {
    // Subclasses can override this method if they want.
  }
}
