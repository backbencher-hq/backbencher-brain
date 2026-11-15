defmodule App.Router do
  use Phoenix.Router
  import Phoenix.LiveView.Router

  scope "/", App do
    get "/", PageController, :index
  end
end
