// Same-origin file staging is transport only. All domain writes go through Draft Gateway.
export const FILE_DB = "ai-draft-file-transport-v1";
export async function transportDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(FILE_DB, 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("files", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function stageFile(blob) {
  const id = crypto.randomUUID();
  const db = await transportDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    const cursor = tx.objectStore("files").openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      if (c.value.createdAt < Date.now() - 24 * 60 * 60 * 1000) c.delete();
      c.continue();
    };
    tx.objectStore("files").put({ id, blob, createdAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  return id;
}
export async function takeFile(id, remove = true) {
  const db = await transportDB();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction("files", remove ? "readwrite" : "readonly");
    const r = tx.objectStore("files").get(id);
    let value;
    r.onsuccess = () => {
      value = r.result;
      if (remove) tx.objectStore("files").delete(id);
    };
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  if (!value) throw new Error("文件通道已过期，请重新选择文件");
  return value.blob;
}
