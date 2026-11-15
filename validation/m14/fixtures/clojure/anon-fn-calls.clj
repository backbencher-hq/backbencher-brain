(ns clj.fixture.anonfn)

(defn head-call [] (#(helper %) 1))

(defn qualified [] (#(clj.fixture.util/conv % :x) 2))

(defn nested [] (#(outer (inner %)) 3))
