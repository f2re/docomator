import { SqliteStore } from "./database.js";
import type { DocumentScheduleRegistry } from "./document-schedules.js";
import { ScheduleNetworkDeliveryRegistry } from "./schedule-network-delivery.js";

export function scheduleNetworkRegistryFromScheduleRegistry(
  registry: DocumentScheduleRegistry
): ScheduleNetworkDeliveryRegistry {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Document schedule registry does not expose its backing SQLite store"
    );
  }
  return new ScheduleNetworkDeliveryRegistry(store);
}
