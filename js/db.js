const DB_NAME = 'track-recorder-db';
const DB_VERSION = 1;
const STORE = 'points';

let dbPromise = null;
let memoryFallback = null;

function openDB() {
  if (memoryFallback) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      memoryFallback = [];
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return openDB().then((db) => {
    if (db === null) return fn(null);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  });
}

export async function addPoint(point) {
  if (memoryFallback) {
    memoryFallback.push(point);
    return;
  }
  await run('readwrite', (store) => store.add(point));
}

export async function getAllPoints() {
  if (memoryFallback) return memoryFallback.slice();
  const db = await openDB();
  if (db === null) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const list = (req.result || []).sort((a, b) => a.ts - b.ts);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearPoints() {
  if (memoryFallback) {
    memoryFallback = [];
    return;
  }
  await run('readwrite', (store) => store.clear());
}
