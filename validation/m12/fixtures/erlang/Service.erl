-module(service).
-behaviour(gen_server).
-behaviour(my_behaviour).

-export([start_link/0, submit/2, stop/0, init/1, handle_call/3, handle_cast/2]).
-import(lists, [map/2, filter/2]).
-include("service.hrl").
-include_lib("kernel/include/logger.hrl").

-define(MAX_JOBS, 1000).
-define(DEFAULT_TIMEOUT, 5000).

-type job_id() :: integer().
-type job() :: #{id := job_id(), kind := atom()}.
-record(job, {id :: job_id(), kind :: atom(), payload :: term()}).
-record(state, {queue :: [job()], running :: map()}).

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

-spec submit(job_id(), atom()) -> ok.
submit(Id, Kind) when is_integer(Id), is_atom(Kind) ->
    gen_server:cast(?MODULE, {submit, #job{id = Id, kind = Kind, payload = make_payload(Id)}}).

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

make_payload(Id) ->
    {payload, Id}.
