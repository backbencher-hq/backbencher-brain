;; CLJ-D24/D9 — two namespaces in one file, and an auto-resolved spec name.
;;
;;   D7  a file with two `(ns …)` forms (45 sites: clj-kondo's corpus/ dialect
;;       files, test files that switch namespace mid-file) has TWO namespaces,
;;       so the refer table must be POSITIONAL. Keeping one table resolves a
;;       first-namespace call against the second namespace's clause; resetting
;;       it at the second `ns` empties it for the post-walk pass and every
;;       call in the file loses its lib. The two lines below are the
;;       discriminator: the SAME referred name, called once inside the first
;;       namespace and once after the second `ns` form, and only the first may
;;       carry the first lib.
;;   D9  `(s/def ::kw …)` published the spec under the literal `::kw`. The
;;       reader qualifies `::` against the enclosing namespace, so the real
;;       spec name is `:current-ns/kw` — without it the spec had an identity
;;       no other file could reference.
(ns clj.fixture.twons.first
  (:require [clj.fixture.legacy :only (format-node)]))

(defn uses-first-refer [s] (format-node s))

(ns clj.fixture.twons.second
  (:require [clj.fixture.other :as other]))

(defn uses-second [s] (other/render s))

;; After the second `ns`: `format-node` is NOT referred here, so the target
;; stays BARE. A surviving single table would resolve it to the first lib.
(defn after-second-ns [s] (format-node s))

(s/def ::width 3)
(s/fdef ::height (s/int?))
