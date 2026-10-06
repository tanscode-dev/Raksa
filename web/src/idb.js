// IndexedDB kecil untuk cache data Raksa di perangkat (supaya pembukaan berikutnya cepat).
const NAMA = "raksa";
const STORE = "kv";

function buka() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(NAMA, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function jalan(mode, fn) {
  const db = await buka();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { res(req && req.result); db.close(); };
    tx.onerror = () => { rej(tx.error); db.close(); };
  });
}
export const idbGet = (k) => jalan("readonly", (s) => s.get(k));
export const idbSet = (k, v) => jalan("readwrite", (s) => s.put(v, k));
export const idbDel = (k) => jalan("readwrite", (s) => s.delete(k));
