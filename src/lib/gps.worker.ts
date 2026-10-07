/// <reference lib="webworker" />
import { database } from './db';
import { DateTime } from 'luxon';
import { valid } from './gps';
import { RAW, csvRow, parseGPS } from './gps';
import { createAnalysis } from './analytics';
import type { GPSPoint } from './model';
const send = (id: number, type: string, data: unknown) => postMessage({ id, type, data });
self.onmessage = async (e) => {
  const { id, action, payload } = e.data;
  try {
    const db = await database();
    if (action === 'libraries') {
      const tx = db.transaction('points'),
        names = new Set<string>();
      let c = await tx.store.index('library').openKeyCursor(null, 'nextunique');
      while (c) {
        names.add(String(c.key));
        c = await c.continue();
      }
      send(id, 'result', [...names]);
    }
    if (action === 'import') {
      let added = 0,
        duplicates = 0,
        conflicts = 0,
        rejected = 0,
        total = 0;
      for (const file of payload.files as File[]) {
        const before = { added, rejected, conflicts };
        const manifest = {
          id: `${payload.library}|${file.name}|${file.size}|${file.lastModified}`,
          library: payload.library,
          name: file.name,
          size: file.size,
          status: 'importing',
        };
        const previousManifest = await db.get('imports', manifest.id);
        await db.put(
          'imports',
          previousManifest?.status === 'complete' ? previousManifest : manifest,
        );
        const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
        let carry = '',
          columns = RAW,
          batch: GPSPoint[] = [];
        const flush = async () => {
          const tx = db.transaction('points', 'readwrite');
          for (const p of batch) {
            const old = await tx.store.get(p.key);
            if (old) {
              duplicates++;
              if (old.lat !== p.lat || old.lng !== p.lng || Math.abs(old.speed - p.speed) > 0.0001)
                conflicts++;
              else {
                old.sources = [...new Set([...(old.sources || ['legacy']), manifest.id])];
                await tx.store.put(old);
              }
            } else {
              await tx.store.put({ ...p, sources: [manifest.id] });
              added++;
            }
          }
          await tx.done;
          batch = [];
          send(id, 'progress', { added, duplicates, conflicts, rejected, total, file: file.name });
        };
        const line = async (l: string) => {
          if (!l.trim() || l.startsWith('$')) return;
          if (l.startsWith('timestamp,')) {
            columns = csvRow(l.trim());
            return;
          }
          total++;
          const p = parseGPS(l, payload.library, columns);
          if (p) batch.push(p);
          else rejected++;
          if (batch.length >= 1500) await flush();
        };
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            carry += value;
            const lines = carry.split('\n');
            carry = lines.pop() || '';
            for (const l of lines) await line(l);
          }
          if (carry) await line(carry);
          await flush();
          await db.put('imports', {
            ...manifest,
            status: 'complete',
            added: added - before.added,
            rejected: rejected - before.rejected,
            conflicts: conflicts - before.conflicts,
            completed: Date.now(),
          });
        } finally {
          reader.releaseLock();
        }
      }
      send(id, 'result', { added, duplicates, conflicts, rejected, total });
    }
    if (action === 'calendar') {
      const complete = new Set(
        (await db.getAll('imports'))
          .filter((i) => i.library === payload.library && i.status === 'complete')
          .map((i) => i.id),
      );
      complete.add('legacy');
      const dates = new Set<string>();
      let count = 0,
        lastMinute = -1,
        date = '';
      const range = IDBKeyRange.bound([payload.library, 0], [payload.library, Infinity]);
      let cursor = await db.transaction('points').store.index('libraryTime').openCursor(range);
      while (cursor) {
        const p = cursor.value as GPSPoint;
        if (!p.sources || p.sources.some((s) => complete.has(s))) {
          const minute = Math.floor(p.timestamp / 60);
          if (minute !== lastMinute) {
            date = DateTime.fromSeconds(p.timestamp - (payload.clockOffset || 0), {
              zone: payload.zone,
            }).toISODate()!;
            lastMinute = minute;
          }
          dates.add(date);
          count++;
        }
        cursor = await cursor.continue();
      }
      send(id, 'result', { dates: [...dates].sort(), count });
    }
    if (action === 'analyze') {
      const manifests = (await db.getAll('imports')).filter(
        (i) => i.library === payload.library && i.status === 'complete',
      );
      const revision = manifests
        .map((i) => `${i.id}:${i.completed || 0}`)
        .sort()
        .join(';');
      const cacheKey = `analysis:v4:${payload.library}:${JSON.stringify(payload)}`;
      const cached = await db.get('settings', cacheKey);
      if (cached?.revision === revision) {
        send(id, 'result', cached.result);
        return;
      }
      const complete = new Set(manifests.map((i) => i.id));
      complete.add('legacy');
      const a = createAnalysis(payload);
      const range = IDBKeyRange.bound([payload.library, 0], [payload.library, Infinity]);
      let c = await db.transaction('points').store.index('libraryTime').openCursor(range),
        n = 0,
        pending: GPSPoint | undefined;
      while (c) {
        const p = c.value as GPSPoint;
        if (!p.sources || p.sources.some((s) => complete.has(s))) {
          if (payload.type === 'ALL') {
            if (pending && pending.timestamp !== p.timestamp) {
              a.add(pending);
              pending = p;
            } else if (
              !pending ||
              (valid(p) && !valid(pending)) ||
              (p.type === 'NO' && pending.type !== 'NO')
            )
              pending = p;
          } else a.add(p);
        }
        if (++n % 25000 === 0) send(id, 'progress', { rows: n });
        c = await c.continue();
      }
      if (pending) a.add(pending);
      const result = a.finish();
      await db.put('settings', { revision, result }, cacheKey);
      const keys = (await db.getAllKeys('settings')).filter((k) =>
        String(k).startsWith(`analysis:v4:${payload.library}:`),
      );
      for (const key of keys.slice(0, Math.max(0, keys.length - 12)))
        await db.delete('settings', key);
      send(id, 'result', result);
    }
    if (action === 'viewer') {
      const complete = new Set(
        (await db.getAll('imports')).filter((i) => i.status === 'complete').map((i) => i.id),
      );
      complete.add('legacy');
      const start = payload.date
        ? DateTime.fromISO(payload.date, { zone: payload.zone }).startOf('day').toSeconds() +
          payload.offset
        : 0;
      const end = payload.date
        ? DateTime.fromISO(payload.date, { zone: payload.zone })
            .plus({ days: 1 })
            .startOf('day')
            .toSeconds() + payload.offset
        : Infinity;
      const range = IDBKeyRange.bound(
          [payload.library, start],
          [payload.library, end],
          false,
          true,
        ),
        points: GPSPoint[] = [];
      let c = await db.transaction('points').store.index('libraryTime').openCursor(range);
      while (c) {
        const p = c.value;
        if (valid(p) && (!p.sources || p.sources.some((s: string) => complete.has(s))))
          points.push(p);
        c = await c.continue();
      }
      send(id, 'result', points);
    }
    if (action === 'alignment') {
      const names = new Map<string, number>(
        payload.recordings.map((r: any) => [r.name.toUpperCase(), r.start]),
      );
      const offsets: number[] = [];
      const seen = new Set<string>();
      let c = await db
        .transaction('points')
        .store.index('libraryTime')
        .openCursor(IDBKeyRange.bound([payload.library, 0], [payload.library, Infinity]));
      while (c) {
        const p = c.value;
        if (names.has(p.filename) && !seen.has(p.filename) && valid(p)) {
          const delta = p.timestamp - names.get(p.filename)!;
          offsets.push(Math.round(delta / 3600) * 3600);
          seen.add(p.filename);
        }
        c = await c.continue();
      }
      const counts = new Map<number, number>();
      for (const n of offsets) counts.set(n, (counts.get(n) || 0) + 1);
      const ranked = [...counts].sort((a, b) => b[1] - a[1]);
      send(
        id,
        'result',
        ranked.length
          ? { offset: ranked[0][0], matched: ranked[0][1], total: offsets.length }
          : null,
      );
    }
    if (action === 'delete') {
      const tx = db.transaction(['points', 'imports', 'settings'], 'readwrite');
      let c = await tx.objectStore('points').index('library').openCursor(payload.library);
      while (c) {
        await c.delete();
        c = await c.continue();
      }
      const imports = await tx.objectStore('imports').getAll();
      for (const i of imports)
        if (i.library === payload.library) await tx.objectStore('imports').delete(i.id);
      await tx.objectStore('settings').clear();
      await tx.done;
      send(id, 'result', true);
    }
    if (action === 'sources') {
      send(
        id,
        'result',
        (await db.getAll('imports')).filter((i) => i.library === payload.library),
      );
    }
    if (action === 'deleteSource') {
      const tx = db.transaction(['points', 'imports', 'settings'], 'readwrite');
      let cursor = await tx.objectStore('points').index('library').openCursor(payload.library);
      while (cursor) {
        const p = cursor.value;
        if (p.sources?.includes(payload.source)) {
          p.sources = p.sources.filter((s: string) => s !== payload.source);
          if (p.sources.length) await cursor.update(p);
          else await cursor.delete();
        }
        cursor = await cursor.continue();
      }
      await tx.objectStore('imports').delete(payload.source);
      await tx.objectStore('settings').clear();
      await tx.done;
      send(id, 'result', true);
    }
    if (action === 'backup') {
      const manifests = (await db.getAll('imports')).filter((i) => i.library === payload.library);
      const complete = new Set(manifests.filter((i) => i.status === 'complete').map((i) => i.id));
      complete.add('legacy');
      const encoder = new TextEncoder(),
        chunks: BlobPart[] = [];
      let bytes = 0;
      const writer = payload.handle ? await payload.handle.createWritable() : null;
      const write = async (text: string) => {
        const chunk = encoder.encode(text);
        bytes += chunk.length;
        if (writer) await writer.write(chunk);
        else {
          if (bytes > 64 * 1024 * 1024)
            throw Error(
              'Large backups require a browser with Save File support. Use desktop Chrome/Edge.',
            );
          chunks.push(chunk);
        }
      };
      try {
        await write(JSON.stringify({ version: 2, library: payload.library, manifests }) + '\n');
        let last: string | undefined;
        while (true) {
          const range = last
            ? IDBKeyRange.bound(last, `${payload.library}|\uffff`, true, false)
            : IDBKeyRange.bound(`${payload.library}|`, `${payload.library}|\uffff`);
          const batch = await db.getAll('points', range, 1500);
          if (!batch.length) break;
          last = batch.at(-1).key;
          await write(
            batch
              .filter((p) => !p.sources || p.sources.some((s: string) => complete.has(s)))
              .map((p) => JSON.stringify(p))
              .join('\n') + '\n',
          );
          send(id, 'progress', { bytes });
        }
        await writer?.close();
        send(id, 'result', writer ? null : new Blob(chunks, { type: 'application/x-ndjson' }));
      } catch (e) {
        await writer?.abort();
        throw e;
      }
    }
    if (action === 'restore') {
      const file = payload.file as File,
        reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
      let carry = '',
        header: any,
        rows: GPSPoint[] = [],
        count = 0;
      const importId = `restore:${file.name}:${file.size}:${file.lastModified}`;
      const flush = async () => {
        const tx = db.transaction('points', 'readwrite');
        for (const p of rows) {
          if (!p.library || !p.filename || !Number.isFinite(p.timestamp) || !Array.isArray(p.raw))
            throw Error('Invalid backup record');
          p.key = `${p.library}|${p.timestamp}|${p.filename.toUpperCase()}`;
          const existing = await tx.store.get(p.key);
          if (!existing) await tx.store.put({ ...p, sources: [importId] });
          else
            await tx.store.put({
              ...existing,
              sources: [...new Set([...(existing.sources ?? ['legacy']), importId])],
            });
        }
        await tx.done;
        count += rows.length;
        rows = [];
        send(id, 'progress', { rows: count });
      };
      const line = async (text: string) => {
        if (!text.trim()) return;
        const data = JSON.parse(text);
        if (!header) {
          if (data.version !== 2 || !data.library)
            throw Error('Unsupported backup format; select a version 2 .ndjson backup.');
          header = data;
          await db.put('imports', {
            id: importId,
            library: header.library,
            name: file.name,
            status: 'importing',
          });
        } else {
          if (data.library !== header.library)
            throw Error('Backup contains an unexpected library.');
          rows.push(data);
          if (rows.length >= 1500) await flush();
        }
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          carry += value;
          const lines = carry.split('\n');
          carry = lines.pop() || '';
          for (const l of lines) await line(l);
        }
        if (carry) await line(carry);
        if (!header) throw Error('Empty backup');
        await flush();
        await db.put('imports', {
          id: importId,
          library: header.library,
          name: file.name,
          status: 'complete',
          completed: Date.now(),
          added: count,
          originalSources: header.manifests,
        });
        send(id, 'result', header.library);
      } finally {
        reader.releaseLock();
      }
    }
  } catch (error) {
    send(id, 'error', error instanceof Error ? error.message : String(error));
  }
};
