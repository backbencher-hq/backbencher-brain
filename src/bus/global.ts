type EventHandler = (data: any) => void

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>()

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler)
  }

  emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach(h => {
      try { h(data) } catch {}
    })
  }

  publishSafe(event: string, data: any): void {
    this.emit(event, data)
  }
}

export const Bus = new EventBus()
export const GlobalBus = Bus
