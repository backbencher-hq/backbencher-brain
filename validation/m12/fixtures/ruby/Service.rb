require_relative "base"
require "json"

module Billing
  module Audited
    def audit(event)
      serialize(event)
    end
  end
end

class UserService < BaseService
  include Billing::Audited
  attr_reader :store
  API_PREFIX = "/v1"

  def initialize(store)
    super(store)
  end

  def save(record)
    validate(record)
    User.new(record)
  end

  protected

  def validate(record)
    record.valid?
  end

  class << self
    def build(store:)
      new(store)
    end
  end
end
