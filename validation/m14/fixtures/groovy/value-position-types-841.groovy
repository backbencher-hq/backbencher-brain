// #841 round 5 — a parameterized or array type in VALUE position.
//
// Before this round the grammar had no value-position production for a
// parameterized/array type, so every line below was an ERROR and recovery
// swallowed the ENTIRE enclosing class. All eight forms are accepted by the
// real Groovy 3.0.24 compiler (reviews/m59-841-assert-comma-separator.md §7b).
//
// The point of the fixture is that the class SURVIVES: if any of these forms
// regresses, the members that follow it disappear too.
@Scaffold(RestfulServiceController<User>)
class ValuePositionTypes841 {

    Class annotationArg = List<String>

    Class assignmentRhs = RestfulServiceController<User>

    Class arrayValue = String[]

    def register(Class type) {
        return type
    }

    def callArgument() {
        register(RestfulServiceController<User>)
    }

    def mapValue() {
        return [k: RestfulServiceController<User>]
    }

    def comparison() {
        return RestfulServiceController<User> == null
    }
}
