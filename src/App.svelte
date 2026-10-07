<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { DateTime } from 'luxon';
  import Thumbnail from './components/Thumbnail.svelte';
  import RecordingCalendar from './components/RecordingCalendar.svelte';
  import ReviewPane from './components/ReviewPane.svelte';
  import RouteMap from './components/RouteMap.svelte';
  import Analytics from './components/Analytics.svelte';
  import PageHeader from './components/PageHeader.svelte';
  import ExportStudio from './components/ExportStudio.svelte';
  import { createExportSession } from './lib/export-session';
  let exportSession = $state(createExportSession());
  let analyticsVisited = $state(false);
  $effect(() => {
    if (page === 'Analytics') analyticsVisited = true;
  });
  import { catalog, CHANNELS, channelName, typeName, formatTime } from './lib/model';
  import type { Recording, Channel, ExportRange, GPSPoint } from './lib/model';
  import { pickFolder, groupDuration } from './lib/media';
  import { gpsJob, download } from './lib/gps-client';
  import type { Analysis } from './lib/analytics';
  let page = $state('Viewer'),
    exporting = $state(false),
    recordings = $state<Recording[]>([]),
    selected = $state<Recording | null>(null),
    date = $state(''),
    filter = $state<string[]>(['NO', 'EV', 'PA', 'LA']),
    search = $state(''),
    time = $state(0),
    playing = $state(false),
    speed = $state(1),
    volume = $state(1),
    previousVolume = $state(1),
    length = $state(0),
    seekToken = $state(0),
    markIn = $state(0),
    markOut = $state(0),
    rangeEndId = $state(''),
    ranges = $state<ExportRange[]>([]),
    message = $state(''),
    busy = $state(false),
    importStatus = $state(''),
    scanning = $state(false),
    sourceName = $state(''),
    library = $state('T800E'),
    libraries = $state<string[]>([]),
    sources = $state<any[]>([]),
    revision = $state(0),
    points = $state<GPSPoint[]>([]),
    clockOffset = $state(0),
    gpsLead = $state(7),
    zone = $state('America/Toronto'),
    settings = $state(false),
    alignment = $state<{ offset: number; matched: number; total: number } | null>(null),
    storage = $state(''),
    capabilities = $state('Checking browser…');
  let folderInput: HTMLInputElement,
    filesInput: HTMLInputElement,
    gpsInput: HTMLInputElement,
    restoreInput: HTMLInputElement,
    importJob: ReturnType<typeof gpsJob<any>> | undefined;
  const exportRecordingIds = $derived(new Set(ranges.map((r) => r.recording.id)));
  const dates = $derived([...new Set(recordings.map((r) => r.date))].sort());
  const filtered = $derived(
    recordings.filter(
      (r) =>
        (!date || r.date === date) &&
        filter.includes(r.type) &&
        (!search || `${r.time} ${r.type}`.toLowerCase().includes(search.toLowerCase())),
    ),
  );
  const currentEpoch = $derived(
    (selected?.start || 0) + time * (selected?.scale || 1) + clockOffset + gpsLead,
  );
  const currentGPS = $derived(
    points.reduce<GPSPoint | undefined>(
      (best, p) =>
        !best || Math.abs(p.timestamp - currentEpoch) < Math.abs(best.timestamp - currentEpoch)
          ? p
          : best,
      undefined,
    ),
  );
  onMount(() => {
    const route = location.hash.slice(1).toLowerCase();
    if (route === 'analytics') page = 'Analytics';
    if (route === 'export') page = 'Export';
    refreshLibraries();
    const saved = localStorage.getItem('dashcam-preferences');
    if (saved)
      try {
        const p = JSON.parse(saved);
        library = p.library || library;
        zone = p.zone || zone;
        clockOffset = p.clockOffset || 0;
        gpsLead = Number.isFinite(p.gpsLead) ? Math.max(0, Math.min(30, p.gpsLead)) : 7;
      } catch {}
    capabilities = `${document.createElement('video').canPlayType('video/mp4; codecs="hvc1"') ? 'HEVC playback detected' : 'HEVC requires a compatible browser'} · ${'VideoEncoder' in window ? 'Local encoder available' : 'No WebCodecs encoder'}`;
    navigator.storage
      ?.estimate()
      .then(
        (s) =>
          (storage = `${((s.usage || 0) / 1e6).toFixed(1)} MB used / ${((s.quota || 0) / 1e9).toFixed(1)} GB available quota`),
      );
  });
  $effect(() => {
    history.replaceState(null, '', `#${page.toLowerCase()}`);
  });
  $effect(() => {
    localStorage.setItem(
      'dashcam-preferences',
      JSON.stringify({ library, zone, clockOffset, gpsLead }),
    );
  });
  let recordingList: HTMLDivElement | undefined = $state();
  function jumpToPlaying() {
    const row = recordingList?.querySelector<HTMLElement>('.clip-row.selected');
    if (!row || !recordingList) return;
    const listBox = recordingList.getBoundingClientRect(),
      rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top || rowBox.bottom > listBox.bottom)
      recordingList.scrollTop += rowBox.top - listBox.top - (listBox.height - rowBox.height) / 2;
  }
  $effect(() => {
    selected?.id;
    filtered;
    recordingList;
    void tick().then(jumpToPlaying);
  });
  $effect(() => {
    const day = date,
      lib = library;
    revision;
    if (!day) {
      points = [];
      return;
    }
    const job = gpsJob<GPSPoint[]>('viewer', {
      library: lib,
      date: day,
      zone,
      offset: clockOffset,
    });
    job.promise.then((r) => (points = r)).catch(() => {});
    return () => job.cancel();
  });
  $effect(() => {
    revision;
    const files = recordings.flatMap((r) =>
      Object.values(r.clips)
        .filter((c) => c.channel === 'F')
        .map((c) => ({ name: c.name, start: r.start })),
    );
    if (!files.length) return;
    const job = gpsJob<any>('alignment', { library, recordings: files });
    job.promise
      .then((r) => {
        alignment = r;
        if (r && r.matched >= 3 && r.matched / r.total >= 0.8 && clockOffset === 0) {
          clockOffset = r.offset;
        }
      })
      .catch(() => {});
    return () => job.cancel();
  });

  $effect(() => {
    const options = filtered;
    if (selected && options.some((r) => r.id === selected!.id)) return;
    playing = false;
    if (options[0]) void select(options[0]);
    else {
      selected = null;
      length = 0;
      time = 0;
    }
  });

  async function refreshLibraries() {
    libraries = await gpsJob<string[]>('libraries', {}).promise;
  }
  $effect(() => {
    library;
    revision;
    if (settings)
      gpsJob<any[]>('sources', { library })
        .promise.then((r) => (sources = r))
        .catch(() => {});
  });
  async function removeSource(source: string) {
    if (
      !confirm(
        'Remove this imported source from local history? Observations retained by other imports stay available.',
      )
    )
      return;
    await gpsJob('deleteSource', { library, source }).promise;
    revision++;
  }
  async function importGPS(files: File[]) {
    if (!files.length) return;
    busy = true;
    message = '';
    importStatus = 'Reading GPS data…';
    importJob = gpsJob<any>(
      'import',
      { files, library },
      (p) =>
        (importStatus = `${p.file}: ${p.total.toLocaleString()} rows · ${p.added.toLocaleString()} new`),
    );
    try {
      const r = await importJob.promise;
      message = `GPS saved locally: ${r.added.toLocaleString()} new, ${r.duplicates.toLocaleString()} duplicates, ${r.conflicts} conflicts, ${r.rejected} rejected. Existing values kept for conflicts. Saved in this browser’s local library “${library}”. Open GPS Analytics to explore it or Library & settings to manage and back it up.`;
      await refreshLibraries();
      revision++;
      navigator.storage?.persist().catch(() => {});
    } catch (e) {
      message = (e as Error).message;
    } finally {
      busy = false;
      importStatus = '';
    }
  }
  async function loadFiles(files: File[]) {
    const media = files.filter((f) => /\.mp4$/i.test(f.name));
    if (media.length) {
      recordings = catalog(media, zone);
      date = recordings.at(-1)?.date || '';
      filter = ['NO', 'EV', 'PA', 'LA'];
      search = '';
      const first =
        recordings.find((r) => r.date === date && r.type === 'NO') ||
        recordings.find((r) => r.date === date);
      selected = null;
      playing = false;
      ranges = [];
      exportSession = createExportSession();
      if (first) await select(first);
      message = `${recordings.length} recording groups connected. Source footage stays on your device.`;
    }
    const gps = files.filter((f) => /^GPSData.*\.txt$|\.csv$/i.test(f.name));
    if (gps.length) await importGPS(gps);
    else if (!media.length) message = 'No recognized recording or GPS files were found.';
  }
  async function chooseFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) return;
    sourceName = files[0].webkitRelativePath?.split('/')[0] || 'Selected files';
    busy = true;
    try {
      await loadFiles(files);
    } catch (error) {
      message = (error as Error).message;
    } finally {
      busy = false;
      input.value = '';
    }
  }
  async function openFolder() {
    if (!(window as any).showDirectoryPicker) {
      folderInput.click();
      return;
    }
    busy = true;
    message = '';
    try {
      scanning = true;
      importStatus = 'Scanning recording folders…';
      const scan = await pickFolder((count) => {
        importStatus = `Scanning folders · ${count.toLocaleString()} files found`;
      });
      sourceName = scan.name;
      scanning = false;
      importStatus = '';
      await loadFiles(scan.files);
      if (scan.skipped.length)
        message += ` ${scan.skipped.length} unreadable entries skipped. Reconnect the card to retry.`;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') message = (e as Error).message;
    } finally {
      busy = false;
      scanning = false;
      importStatus = '';
    }
  }
  async function select(r: Recording) {
    selected = r;
    time = 0;
    seekToken++;
    markIn = 0;
    rangeEndId = r.id;
    length = 0;
    try {
      const d = await groupDuration(r);
      if (selected?.id === r.id) {
        length = d;
        markOut = d;
      }
    } catch (e) {
      message = `Could not read recording: ${(e as Error).message}`;
    }
  }
  function seek(t: number) {
    time = Math.min(length, Math.max(0, t));
    seekToken++;
  }
  let skipping = false;
  async function skip(seconds: number) {
    if (!selected || skipping) return;
    skipping = true;
    const original = selected.id;
    const options = [...filtered];
    let index = options.findIndex((r) => r.id === original);
    let target = time + seconds;
    try {
      if (index < 0) return;
      let duration = await groupDuration(options[index]);
      while (target < 0 && index > 0) {
        index--;
        duration = await groupDuration(options[index]);
        target += duration;
      }
      while (target >= duration && index < options.length - 1) {
        target -= duration;
        index++;
        duration = await groupDuration(options[index]);
      }
      if (selected?.id !== original) return;
      const destination = options[index];
      if (destination.id !== original) await select(destination);
      if (selected?.id === destination.id) seek(target);
    } catch (e) {
      message = `Could not seek recording: ${(e as Error).message}`;
    } finally {
      skipping = false;
    }
  }
  async function next() {
    const i = filtered.findIndex((r) => r.id === selected?.id);
    if (filtered[i + 1]) await select(filtered[i + 1]);
    else playing = false;
  }
  async function seekGPS(p: GPSPoint) {
    const r = recordings.find((r) =>
      Object.values(r.clips).some((c) => c.name.toUpperCase() === p.filename.toUpperCase()),
    );
    if (!r) {
      message =
        'This GPS history is saved, but its footage is not connected. Reopen the matching recording folder.';
      return;
    }
    page = 'Viewer';
    date = r.date;
    await select(r);
    seek((p.timestamp - r.start - clockOffset - gpsLead) / r.scale);
  }
  async function addRange() {
    if (!selected || markOut <= markIn || markOut > length) {
      message = 'Choose a valid in/out range within this recording.';
      return;
    }
    const startIndex = filtered.findIndex((r) => r.id === selected!.id),
      endIndex = filtered.findIndex((r) => r.id === rangeEndId);
    if (endIndex < startIndex) {
      message = 'The final recording must follow the selected start recording.';
      return;
    }
    try {
      const entries: ExportRange[] = [];
      for (let i = startIndex; i <= endIndex; i++) {
        const r = filtered[i],
          d = i === startIndex ? length : await groupDuration(r);
        entries.push({
          id: crypto.randomUUID(),
          recording: r,
          start: i === startIndex ? markIn : 0,
          end: i === startIndex ? markOut : d,
        });
      }
      ranges = [...ranges, ...entries];
      message = `${entries.length} range(s) added to Export Studio. Gaps between recordings are skipped; drag the timeline edges there to trim the joined sequence.`;
    } catch (e) {
      message = (e as Error).message;
    }
  }

  async function backup() {
    try {
      const handle = (window as any).showSaveFilePicker
        ? await (window as any).showSaveFilePicker({
            suggestedName: `dashcam-${library}-backup.ndjson`,
          })
        : null;
      busy = true;
      const blob = await gpsJob<Blob | null>('backup', { library, handle }).promise;
      if (blob) download(blob, `dashcam-${library}-backup.ndjson`);
      message = 'GPS history backup saved.';
    } catch (e) {
      message = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function restore(file: File) {
    busy = true;
    try {
      library = await gpsJob<string>('restore', { file }).promise;
      await refreshLibraries();
      revision++;
      message = 'GPS backup restored.';
    } catch (e) {
      message = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  const appNotice = $derived({
    message: busy ? importStatus || 'Working locally…' : message,
    busy,
    cancel: busy && importStatus && !scanning ? () => importJob?.cancel() : undefined,
    dismiss: () => {
      message = '';
    },
  });
</script>

<svelte:window
  onbeforeunload={(e) => {
    if (exporting) {
      e.preventDefault();
      e.returnValue = '';
    }
  }}
  onkeydown={(e) => {
    if ((e.target as HTMLElement)?.matches('input,select,textarea') || page !== 'Viewer') return;
    if (e.code === 'Space') {
      e.preventDefault();
      playing = !playing;
    }
    if (e.key === 'ArrowRight') skip(10);
    if (e.key === 'ArrowLeft') skip(-10);
  }}
/>
<input
  class="file-input"
  type="file"
  bind:this={folderInput}
  webkitdirectory
  multiple
  onchange={chooseFiles}
/><input
  class="file-input"
  type="file"
  bind:this={filesInput}
  accept="video/mp4,.txt,.csv"
  multiple
  onchange={chooseFiles}
/><input
  class="file-input"
  type="file"
  bind:this={gpsInput}
  accept=".txt,.csv"
  multiple
  onchange={(e) => importGPS(Array.from(e.currentTarget.files || []))}
/><input
  class="file-input"
  type="file"
  bind:this={restoreInput}
  accept=".ndjson,.json"
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (f) restore(f);
  }}
/>
<div class="app-shell">
  <aside class="sidebar">
    <a
      class="brand"
      href="#viewer"
      onclick={(e) => {
        e.preventDefault();
        page = 'Viewer';
      }}
      ><span class="brand-symbol" aria-hidden="true"
        ><svg
          viewBox="0 0 32 32"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path
            d="m6 13 3-7h14l3 7M5 13h22v11H5zM5 20h22M8 24v3m16-3v3M9 17h3m8 0h3M3 12h3m20 0h3"
          /><path d="M13 9h6" /></svg
        ></span
      >
      <div>Dashcam Viewer</div></a
    >
    <div class="mobile-library-actions">
      <button disabled={busy || exporting} onclick={openFolder}>＋ Open folder</button>
      <button onclick={() => (settings = !settings)}>⚙ Library & settings</button>
    </div>
    <div class="workspace-label">WORKSPACE</div>
    <nav>
      {#each [['Viewer', '▤', 'Footage Viewer'], ['Analytics', '⌁', 'GPS Analytics'], ['Export', '↗', 'Export Studio']] as [key, icon, label]}<button
          disabled={exporting}
          class:active={page === key}
          onclick={() => {
            page = key;
            playing = false;
          }}
          ><span>{icon}</span>{label}{#if key === 'Export' && ranges.length}<b>{ranges.length}</b
            >{/if}</button
        >{/each}
    </nav>
    <div class="source-card">
      <div class="eyebrow">CONNECTED SOURCE</div>
      <strong>{recordings.length ? sourceName || '70mai recordings' : 'No source connected'}</strong
      >
      <p>
        {recordings.length
          ? `${recordings.length} recording groups`
          : 'Open a recording folder to begin.'}
      </p>
      <button onclick={openFolder} disabled={busy || exporting}>＋ Open folder</button>
    </div>
    <div class="sidebar-bottom">
      <button onclick={() => (settings = !settings)}>⚙ Library & settings</button>
      <div class="privacy-badge">
        <span class="status-light"></span>Private by design<small
          >Video and GPS stay on this device. Maps use OpenStreetMap.</small
        >
      </div>
    </div>
  </aside>
  <main class:viewer-page={page === 'Viewer'} class:export-page={page === 'Export'}>
    {#if settings}<section class="settings panel">
        <div class="card-heading">
          <h2>Local library settings</h2>
          <button onclick={() => (settings = false)}>Done</button>
        </div>
        <div class="filter-bar">
          <label
            >Device / library<input bind:value={library} list="libraries" /><datalist id="libraries"
              >{#each libraries as l}<option value={l}></option>{/each}</datalist
            ></label
          ><label
            >Recording timezone<select
              bind:value={zone}
              onchange={() => {
                recordings = catalog(
                  recordings.flatMap((r) => Object.values(r.clips).map((c) => c.file)),
                  zone,
                );
                selected = null;
                playing = false;
              }}
              ><option>America/Toronto</option><option>UTC</option><option>America/Vancouver</option
              ><option>Europe/London</option><option>Asia/Hong_Kong</option></select
            ></label
          ><label>GPS clock offset (seconds)<input type="number" bind:value={clockOffset} /></label>
        </div>
        <p class="muted">
          Positive offset means GPS epoch is later than filename time. Validate against the recorded
          overlay. This setting does not alter saved observations.
        </p>
        <div class="button-row">
          <button onclick={() => gpsInput.click()}>Import GPS / CSV</button><button
            onclick={backup}
            disabled={busy || exporting}>Back up GPS history</button
          ><button onclick={() => restoreInput.click()} disabled={busy || exporting}
            >Restore backup</button
          >
        </div>
        {#if sources.length}<div class="table-scroll">
            <table>
              <thead
                ><tr
                  ><th>Imported source</th><th>Status</th><th>Rejected / conflicts</th><th></th></tr
                ></thead
              ><tbody
                >{#each sources as source}<tr
                    ><td>{source.name}</td><td>{source.status}</td><td
                      >{source.rejected || 0} / {source.conflicts || 0}</td
                    ><td
                      ><button class="tiny" disabled={busy} onclick={() => removeSource(source.id)}
                        >Remove source</button
                      ></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>{/if}
        <p class="muted">{storage}</p>
        <p class="muted">{capabilities}</p>
        <p class="muted">
          Hidden GPS file not visible? On macOS press Command + Shift + . in the file picker. GPS
          data is retained in this browser profile; clearing site data removes it.
        </p>
      </section>{/if}
    <div class="page-body" class:viewer-body={page === 'Viewer'}>
      {#if page === 'Viewer'}
        <PageHeader title="Footage Viewer" notice={appNotice}>
          <button class="primary" disabled={!selected} onclick={addRange}
            >＋ Add range to export</button
          >
        </PageHeader>
        <div class="viewer-grid">
          <div class="recordings-column">
            <div class="viewer-toolbar">
              <div class="button-row">
                <RecordingCalendar
                  {dates}
                  value={date}
                  onchange={async (day) => {
                    date = day;
                    playing = false;
                    const first = recordings.find((r) => r.date === day && filter.includes(r.type));
                    if (first) await select(first);
                  }}
                />
                <div class="segmented footage-types">
                  <button
                    class:active={filter.length === 4}
                    aria-pressed={filter.length === 4}
                    onclick={() => (filter = ['NO', 'EV', 'PA', 'LA'])}>All footage</button
                  >
                  {#each ['NO', 'EV', 'PA', 'LA'] as t}<button
                      class:active={filter.includes(t)}
                      aria-pressed={filter.includes(t)}
                      onclick={() =>
                        (filter = filter.includes(t)
                          ? filter.filter((v) => v !== t)
                          : [...filter, t])}>{typeName[t]}</button
                    >{/each}
                </div>
              </div>
              <span class="muted"
                >{filtered.length} recordings · {sourceName || 'Local footage'}</span
              >
            </div>
            <section class="recording-panel">
              <div class="card-heading">
                <h3>Recordings</h3>
                <button
                  class="tiny"
                  title="Jump to playing recording"
                  aria-label="Jump to playing recording"
                  disabled={!selected}
                  onclick={jumpToPlaying}>Locate</button
                >
              </div>
              <input
                class="search"
                placeholder="Search time or type…"
                bind:value={search}
                aria-label="Search recordings"
              />
              <div class="clip-list" bind:this={recordingList}>
                {#if !filtered.length}<div class="list-empty">
                    Your recordings will appear here.<br /><button
                      class="text-button"
                      onclick={openFolder}>Open a folder →</button
                    >
                  </div>{/if}{#each filtered as r (r.id)}<button
                    class="clip-row"
                    class:selected={selected?.id === r.id}
                    onclick={() => select(r)}
                    ><span class="clip-art" class:lapse={r.type === 'LA'}
                      ><Thumbnail clip={r.clips.F || r.clips.R || r.clips.C} /><small
                        >{r.type}</small
                      ></span
                    >
                    <div class="clip-details">
                      <span class="clip-time"
                        ><strong>{r.time}</strong>
                        {#if exportRecordingIds.has(r.id)}
                          <svg
                            class="export-star"
                            viewBox="0 0 24 24"
                            role="img"
                            aria-label="Included in export"
                          >
                            <title>Included in export</title>
                            <path
                              d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1Z"
                            />
                          </svg>
                        {/if}
                      </span><small
                        ><span class={`type-dot ${r.type}`}></span>{typeName[r.type]}{r.scale === 30
                          ? ' · 30×'
                          : ''}</small
                      ><span class="channel-badges"
                        >{#each CHANNELS as c}<b class:absent={!r.clips[c]}>{channelName[c]}</b
                          >{/each}</span
                      >
                    </div></button
                  >{/each}
              </div>
            </section>
          </div>
          <ReviewPane
            recording={selected}
            recordings={filtered}
            {time}
            {length}
            bind:playing
            bind:speed
            bind:volume
            {seekToken}
            {zone}
            ontime={(t) => (time = t)}
            onend={next}
            onskip={skip}
            onseek={async (r, seconds) => {
              if (selected?.id !== r.id) await select(r);
              seek(seconds);
            }}
          />
          <div class="journey-column">
            <aside class="journey-panel">
              <div class="card-heading">
                <h3>Journey</h3>
                <span class="pill">GPS</span>
              </div>
              <RouteMap {points} current={currentEpoch} onseek={seekGPS} />

              <div class="journey-stats">
                <div>
                  <small>CURRENT SPEED</small><strong
                    >{currentGPS && Math.abs(currentGPS.timestamp - currentEpoch) < 10
                      ? Math.round(currentGPS.speed)
                      : '—'}<span>km/h</span></strong
                  >
                </div>
                <label class="gps-lead"
                  >GPS ahead <output>+{gpsLead}s</output><input
                    aria-label="GPS ahead seconds"
                    type="range"
                    min="0"
                    max="30"
                    step="1"
                    bind:value={gpsLead}
                  /></label
                >
              </div>
              {#if alignment && alignment.offset !== clockOffset}<button
                  class="alignment-button"
                  onclick={() => {
                    clockOffset = alignment!.offset;
                    message = `Applied GPS offset ${clockOffset / 3600} hours, inferred from ${alignment!.matched} filename matches. Verify against the recording overlay in settings.`;
                  }}>Align GPS: {alignment.offset / 3600}h detected</button
                >{/if}
            </aside>
          </div>
        </div>
      {:else if page === 'Export'}<ExportStudio
          session={exportSession}
          notice={appNotice}
          {ranges}
          onchange={(r) => (ranges = r)}
          onbrowse={() => (page = 'Viewer')}
          onbusy={(b) => (exporting = b)}
        />{/if}
      {#if analyticsVisited}
        <div class="analytics-cache" hidden={page !== 'Analytics'}>
          <Analytics
            notice={appNotice}
            {library}
            {revision}
            {clockOffset}
            onseek={seekGPS}
            onimport={() => gpsInput.click()}
          />
        </div>
      {/if}
    </div>
    <footer><strong>placeholder</strong></footer>
  </main>
</div>
