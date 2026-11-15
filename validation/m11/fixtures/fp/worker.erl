-module(worker).
-behaviour(gen_server).

-export([start_link/0, submit/2, stop/0]).
-export([init/1, handle_call/3, handle_cast/2]).

-define(MAX_JOBS, 1000).
-define(POLL_MS, 100).

-record(job, {id :: integer(), kind :: atom(), payload :: term()}).
-record(state, {queue :: [term()], running :: map()}).

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

-spec submit(atom(), term()) -> ok.
submit(Kind, Payload) when is_atom(Kind) ->
    gen_server:cast(?MODULE, {submit, #job{id = 1, kind = Kind, payload = Payload}}).

stop() ->
    gen_server:cast(?MODULE, stop).

init([]) ->
    {ok, #state{queue = [], running = #{}}}.

handle_call({peek, N}, _From, #state{queue = Queue} = State) when N > 0 ->
    {reply, lists:sublist(Queue, N), State}.

handle_cast({submit, Job}, #state{queue = Queue} = State) ->
    case length(Queue) of
        ?MAX_JOBS -> {noreply, State};
        _ -> {noreply, State#state{queue = [Job | Queue]}}
    end;
handle_cast(stop, State) ->
    {stop, normal, State}.

count_jobs(#state{queue = Queue}) ->
    length(Queue).

sweep(State) ->
    lists:filter(fun is_stale/1, State#state.queue).

is_stale(Job) ->
    Job#job.kind =:= stale.
