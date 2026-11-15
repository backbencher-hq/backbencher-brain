(ns clj.fixture.params)

(defn rest-args [& args] args)

(defn leaky [x] [y z])

(defn destructured [{:keys [a b] :as m}
                    {x :x}
                    [c d]]
  [a b])

(defn multi
  ([] :none)
  ([x] x)
  ([x y] [x y]))
