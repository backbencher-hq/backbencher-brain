// Bus facade: the ported code calls Bus.publishSafe; the real event bus lives
// in bus/global with an emit surface.
import { Bus as EventBus, GlobalBus } from "./bus/global"

export const Bus = {
  publishSafe(event: string, data: any): void {
    EventBus.emit(event, data)
  },
  publish(event: string, data: any): void {
    EventBus.emit(event, data)
  },
  emit: (event: string, data: any) => EventBus.emit(event, data),
  on: (event: string, handler: (data: any) => void) => EventBus.on(event, handler),
  off: (event: string, handler: (data: any) => void) => EventBus.off(event, handler),
}

export { GlobalBus }
