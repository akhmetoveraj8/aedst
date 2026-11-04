import { type DBSchema, type IDBPDatabase, openDB } from "idb";

import type {
  NewOutboxRecord,
  OutboxRecord,
  OutboxStore,
} from "@/shared/lib/outbox/types";

/**
 * IndexedDB because it is the only durable, structured, async store in a
 * browser that survives reloads and works in a service worker; `idb` is a
 * ~1 KB promise wrapper over it (docs/content/library-first/web.md).
 */
type StoredRecord = OutboxRecord & { order: number };

interface OutboxDb extends DBSchema {
  items: {
    key: string;
    value: StoredRecord;
    indexes: { "by-order": number };
  };
}

const OUTBOX_DB_NAME = "aedst-outbox";

export function createIdbOutboxStore(name: string = OUTBOX_DB_NAME) {
  let opened: Promise<IDBPDatabase<OutboxDb>> | undefined;
  const db = () => {
    opened ??= openDB<OutboxDb>(name, 1, {
      upgrade(database) {
        const items = database.createObjectStore("items", { keyPath: "id" });
        items.createIndex("by-order", "order", { unique: true });
      },
    });
    return opened;
  };

  const store: OutboxStore = {
    async add(record: NewOutboxRecord) {
      const tx = (await db()).transaction("items", "readwrite");
      if (await tx.store.get(record.id)) {
        await tx.done;
        return false;
      }
      // Creation order = a counter one above the newest item, computed in
      // the same transaction so concurrent tabs cannot interleave.
      const newest = await tx.store.index("by-order").openCursor(null, "prev");
      await tx.store.add({
        ...record,
        status: "pending",
        attempts: 0,
        createdAt: Date.now(),
        order: (newest?.value.order ?? 0) + 1,
      });
      await tx.done;
      return true;
    },

    async list(owner) {
      const all = await (await db()).getAllFromIndex("items", "by-order");
      return all.filter((item) => item.owner === owner);
    },

    async update(id, patch) {
      const tx = (await db()).transaction("items", "readwrite");
      const current = await tx.store.get(id);
      if (current) {
        await tx.store.put({ ...current, ...patch });
      }
      await tx.done;
    },

    async remove(id) {
      await (await db()).delete("items", id);
    },

    async clear(keepOwner) {
      const tx = (await db()).transaction("items", "readwrite");
      for (
        let cursor = await tx.store.openCursor();
        cursor;
        cursor = await cursor.continue()
      ) {
        if (cursor.value.owner !== keepOwner) {
          await cursor.delete();
        }
      }
      await tx.done;
    },
  };
  return store;
}
