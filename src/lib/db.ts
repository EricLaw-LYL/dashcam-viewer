import { openDB } from 'idb';
export const database = () =>
  openDB('dashcam-local', 1, {
    upgrade(db) {
      const p = db.createObjectStore('points', { keyPath: 'key' });
      p.createIndex('libraryTime', ['library', 'timestamp']);
      p.createIndex('library', 'library');
      db.createObjectStore('imports', { keyPath: 'id' });
      db.createObjectStore('settings');
    },
  });
