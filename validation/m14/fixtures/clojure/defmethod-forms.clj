(ns clj.fixture.defmethodforms)
(defmulti area :shape)
(defmethod area "Docstring for the circle impl." :circle [s] (:r s))
(defmethod area :square [s] (* (:side s) (:side s)))
