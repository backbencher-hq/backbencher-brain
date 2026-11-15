// #841 round 9 — KEYWORD-Named arguments.
//
// `g.formatBoolean(boolean: model.value)` is real Grails taglib idiom. The
// map_item KEY choice accepted `identifier` and `_reserved_identifier` (which
// covers contextual keywords like `class`, `module`, `record`, `sealed`,
// `default`) but NOT the type keywords or the remaining Java keywords, so the
// argument was an ERROR and recovery took the enclosing class with it.
//
// The set is measured: of 64 keywords probed as `g.f(KW: v)`, exactly 13 are
// refused by us and real Groovy 3.0.24 accepts all 13 — boolean, int, long,
// short, byte, char, float, double, void, new, switch, this, super.
class KeywordNamedArgs841 {

    def format(g, model) {
        g.formatBoolean(boolean: model.value)
    }

    def formatNumber(g, model) {
        g.formatNumber(int: model.count, double: model.ratio)
    }
}
