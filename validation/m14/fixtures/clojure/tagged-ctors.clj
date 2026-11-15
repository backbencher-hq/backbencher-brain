(ns clj.fixture.tags)

#Foo[1 2]
#clj.fixture.tags.Rec{:x 1}
#my/tag (call-x)
#my/tag [1 2]

(defn built [] #Bar[3])
