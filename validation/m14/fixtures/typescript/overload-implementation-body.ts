class Api {
    fetch(id: string): Promise<string>
    fetch(id: string, opts?: { depth: number }): Promise<string> {
        if (!id) throw new Error("no id")
        return this.client.get(id).then(r => r.json())
    }
}
