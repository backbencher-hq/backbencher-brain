require_relative 'base'
require 'json'

module Auth
  def self.check(user)
    user.role == :admin
  end
end

class UserService < BaseService
  include Loggable
  extend ActiveSupport::Concern rescue nil

  ADMIN_PATTERN = /^user:/

  def initialize(store)
    super(store)
  end

  def format(value)
    "#{super} (user)"
  end

  def save(record)
    @store[record.id] = record
    record
  end

  private

  def validate!(record)
    raise "invalid user" unless record.id
  end
end
