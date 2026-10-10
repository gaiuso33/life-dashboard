/**
 * Optional "stay unlocked on this device". The derived key is kept in the browser's IndexedDB as a non-extractable
 * CryptoKey: this page can use it, but nothing can read the key bytes or recover the passphrase from it.
 */
const DB = 'life-dashboard-keys';
const STORE = 'keys';

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return undefined;
  }
};

const id = (userId: string, salt: string) => `${userId}:${salt}`;
export const rememberKey = (userId: string, salt: string, key: CryptoKey) => run('readwrite', (s) => s.put(key, id(userId, salt)));
export const recallKey = async (userId: string, salt: string): Promise<CryptoKey | null> => ((await run<CryptoKey>('readonly', (s) => s.get(id(userId, salt)))) as CryptoKey | undefined) ?? null;
export const forgetKeys = () => run('readwrite', (s) => s.clear());
