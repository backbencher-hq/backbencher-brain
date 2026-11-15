// DT2: bound locals/params read as values; file-scope values read;
// for-in/pattern/catch/lambda bindings; labels/writes/decl-sites never.
int gTotal = 0;
String gLabel = 'x';

int helper(int x) {
  return x + 1;
}

class Store {
  int count = 0;
  int total = 0;

  int compute(int k, int limit) {
    int depth = k * 2;
    int total = compute(depth, limit);
    return total + count;
  }

  int shadowed() {
    int count = 5;
    return count;
  }

  int sums(List<int> xs) {
    int total = 0;
    for (int i = 0; i < xs.length; i++) {
      total += xs[i];
    }
    for (var x in xs) {
      total += x;
    }
    return total;
  }

  void takes(Handler h) {
    run(cb: h, count: 3);
  }

  Future<int> guarded() async {
    try {
      return await fetch();
    } catch (e) {
      log(e);
      return -1;
    }
  }

  void blocks(List<int> xs) {
    var doubled = xs.map((x) => x + count);
    var f = (int p, int q) {
      return p + q;
    };
    var g = f(1, 2);
  }

  void inits(int p) {
    var b = StringBuffer();
    b..write('a');
    var s = 'hi $p and ${count + 1}';
  }
}

class Holder {
  int x = 0;
  Holder() : x = 1;
  Holder.named(int p) : x = p;
}

void reset() {
  gTotal = 0;
}

int get() {
  return gTotal;
}

String label() {
  return gLabel;
}
