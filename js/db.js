// IndexedDB 持久化：保存会话与轨迹点，刷新/后台回收后不丢数据。

const DB_NAME = 'track-recorder';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('points')) {
        const store = db.createObjectStore('points', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_session', 'sessionId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && result._value !== undefined ? result._value : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export class TrackStore {
  constructor() {
    this.dbPromise = openDb();
  }

  async createSession() {
    const db = await this.dbPromise;
    const session = { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, startedAt: Date.now() };
    await tx(db, 'sessions', 'readwrite', (s) => s.put(session));
    return session;
  }

  async getLatestSession() {
    const db = await this.dbPromise;
    const all = await new Promise((resolve, reject) => {
      const t = db.transaction('sessions', 'readonly');
      const req = t.objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!all || all.length === 0) return null;
    return all.sort((a, b) => b.startedAt - a.startedAt)[0];
  }

  async addPoint(point) {
    const db = await this.dbPromise;
    await tx(db, 'points', 'readwrite', (s) => s.add(point));
  }

  async getPoints(sessionId) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const t = db.transaction('points', 'readonly');
      const index = t.objectStore('points').index('by_session');
      const req = index.getAll(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const pts = (req.result || []).sort((a, b) => a.ts - b.ts);
        resolve(pts);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clearSession(sessionId) {
    const db = await this.dbPromise;
    await new Promise((resolve, reject) => {
      const t = db.transaction('points', 'readwrite');
      const index = t.objectStore('points').index('by_session');
      const req = index.openCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
}
