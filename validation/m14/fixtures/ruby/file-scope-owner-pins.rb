# File-scope sentinel pins — R7 (no analyzer may NAME something with a
# placeholder literal) and the dynamic-class-factory attribution.
#
# Authored BEFORE the analyzer change, against the family contract rather than
# the analyzer's output. Two classes of pin:
#
#   1. The four sites that said "unknown" (alias, alias_method, mixin,
#      association) now share the ONE file-scope owner this file already pins
#      elsewhere — `Global` — which is the same sentinel the committed
#      `payload-and-complexity` (top-level require) and `rack-wave-regressions`
#      (RB-D member reads, RB-A/RB-C constructions) fixtures already assert. The
#      pre-fix positions are forbidden below.
#   2. `Widget = Class.new do ... end`: the factory's LHS names a real class, so
#      members inside the block belong to it — the same shape `class Acct` gets.

# --- top level: outside any named scope -------------------------------------
alias fresh_name stale_name
include Comparable
extend Helpers
has_many :widgets

# --- controls: the same constructions inside real scopes --------------------
class Acct
  alias class_alias other_name
  include Comparable
  has_many :ledger_entries
end

module Box
  include Comparable
end

# --- dynamic class factory: the owner is KNOWN, so it must be used ----------
Widget = Class.new do
  has_many :parts
end
