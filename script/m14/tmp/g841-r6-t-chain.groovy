class TypedClosureParam {

    def m(d) {
        boolean b = d.find() { File f -> f.endsWith('.groovy') }
        return b
    }
}
