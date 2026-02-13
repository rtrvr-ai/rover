const ROVER_INDEXED_DB_NAME = 'rover-runtime-state-db';
const ROVER_INDEXED_DB_STORE = 'runtime-state';

type JsonStorageAdapter<T> = {
  read: (key: string) => T | null;
  write: (key: string, value: T) => void;
  remove: (key: string) => void;
};

type AsyncJsonStorageAdapter<T> = {
  read: (key: string) => Promise<T | null>;
  write: (key: string, value: T) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

class SessionJsonStorage<T> implements JsonStorageAdapter<T> {
  read(key: string): T | null {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  write(key: string, value: T): void {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // no-op
    }
  }

  remove(key: string): void {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // no-op
    }
  }
}

class IndexedDbJsonStorage<T> implements AsyncJsonStorageAdapter<T> {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB unavailable'));
        return;
      }

      const request = indexedDB.open(ROVER_INDEXED_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ROVER_INDEXED_DB_STORE)) {
          db.createObjectStore(ROVER_INDEXED_DB_STORE);
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error || new Error('indexedDB open failed'));
      };
    }).catch(error => {
      this.dbPromise = null;
      throw error;
    });

    return this.dbPromise;
  }

  private async withStore<R>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, resolve: (value: R) => void, reject: (reason?: unknown) => void) => void,
  ): Promise<R> {
    const db = await this.openDb();
    return new Promise<R>((resolve, reject) => {
      const tx = db.transaction(ROVER_INDEXED_DB_STORE, mode);
      const store = tx.objectStore(ROVER_INDEXED_DB_STORE);
      run(store, resolve, reject);
      tx.onerror = () => {
        reject(tx.error || new Error('indexedDB transaction failed'));
      };
    });
  }

  async read(key: string): Promise<T | null> {
    try {
      return await this.withStore<T | null>('readonly', (store, resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const value = request.result;
          resolve(value == null ? null : (value as T));
        };
        request.onerror = () => {
          reject(request.error || new Error('indexedDB read failed'));
        };
      });
    } catch {
      return null;
    }
  }

  async write(key: string, value: T): Promise<void> {
    await this.withStore<void>('readwrite', (store, resolve, reject) => {
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(request.error || new Error('indexedDB write failed'));
      };
    }).catch(() => {
      // no-op
    });
  }

  async remove(key: string): Promise<void> {
    await this.withStore<void>('readwrite', (store, resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(request.error || new Error('indexedDB delete failed'));
      };
    }).catch(() => {
      // no-op
    });
  }
}

export type RuntimeStateStore<T> = {
  readSync: (key: string) => T | null;
  readAsync: (key: string) => Promise<T | null>;
  write: (key: string, value: T) => void;
  remove: (key: string) => void;
};

export function createRuntimeStateStore<T>(): RuntimeStateStore<T> {
  const session = new SessionJsonStorage<T>();
  const indexed = new IndexedDbJsonStorage<T>();

  return {
    readSync: (key: string) => session.read(key),
    readAsync: async (key: string) => indexed.read(key),
    write: (key: string, value: T) => {
      session.write(key, value);
      void indexed.write(key, value);
    },
    remove: (key: string) => {
      session.remove(key);
      void indexed.remove(key);
    },
  };
}
