namespace Example.Service

type IDisposable =
    abstract member Dispose: unit -> unit

type ILogger =
    abstract member Log: string -> unit

type FileLogger() =
    interface ILogger with
        member _.Log(message: string) =
            printfn "%s" message

type CompositeLogger(first: ILogger, second: ILogger) =
    interface ILogger with
        member _.Log(message: string) =
            first.Log(message)
            second.Log(message)

type Service(store: Map<string, string>) =
    member _.Get(key: string) =
        match Map.tryFind key store with
        | Some value -> value
        | None -> ""

    member _.Set(key: string, value: string) =
        store.Add(key, value)
