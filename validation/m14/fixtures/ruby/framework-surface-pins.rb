# M60.R8 (#749) — the Rails trigger surface.
#
# Every construct below fires a trigger, and they fire DIFFERENT ones:
#   * three Rails models/controllers, each detecting by superclass name
#   * `before_action`/`after_action`, whose trigger used to be UNREACHABLE —
#     `before_action` is a member of RAILS_MACRO_METHODS, that branch returns, and
#     the pattern push sat after the return, so this file published
#     `frameworkPatterns: []` and no fixture could see it
#   * `render` and `redirect_to`, per-call triggers
#
# Pre-fix this file produced `["Ruby on Rails", "Ruby on Rails", ...]` (one entry per
# class and per call), no `framework` key at all, and a pattern named "Rails" while the
# detection said "Ruby on Rails" — one framework, two names. The expectation below is
# what all four fixes have to keep true at once.
class User < ApplicationRecord
  has_many :posts
end

class Admin < ApplicationRecord
  belongs_to :account
end

class ReportsController < ApplicationController
  before_action :authenticate
  after_action :log

  def index
    render :json => {}
  end

  def show
    redirect_to :root
  end
end
