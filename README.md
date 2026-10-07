# Dashcam Viewer

[Open the web app](https://ericlaw-lyl.github.io/dashcam-viewer/) · [GitHub repository](https://github.com/EricLaw-LYL/dashcam-viewer)

A local-first web app for reviewing **70mai dashcam footage**, exploring GPS history, and exporting clips. View Front, Rear, and Cabin recordings together, follow journeys on a map, and assemble exports directly in your browser.

The project is designed around 70mai file naming and GPS logs. Support for other dashcams can be added by adapting the file discovery and parsing code described below; compatibility with every 70mai model or other brand is not guaranteed.

## Features

- **Footage Viewer:** synchronized multi-camera playback, recording calendar, zoomable timeline, playback speeds up to 8×, and hover thumbnails sampled at the nearest five seconds.
- **Responsive interface:** desktop columns adapt to stacked tablet/phone layouts, with touch playback and trim controls.
- **Flexible camera layout:** collapse or reorder channels, with preferences shared between the Viewer and Export Studio.
- **GPS Analytics:** route maps, date filtering, driving statistics, charts, sortable daily details, and a driving calendar.
- **Export Studio:** automatically sort recording ranges chronologically and trim the joined sequence with draggable timeline edges and thumbnail previews, select cameras through the shared layout, and optionally include Front-camera audio. Video uses full-frame letterboxing at 1920 × 1080 per channel, stacked vertically in the selected order. The playback speed applies to exports at a fixed 30 fps; included audio follows the speed change, including pitch.
- **Local GPS library:** import logs or observation CSV files, deduplicate observations, and back up or restore history using NDJSON.

## Run locally

Requires **Node.js 22 or 24+** and npm.

Download or clone this repository, open a terminal in its root directory, and run:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No backend service, account, or API key is required.

1. Choose your dashcam's SD card folder or a local copy of its contents. Use **Choose folder (compatible)** if the native folder picker is unavailable.
2. Select a date and recording in Footage Viewer. Matching camera files are grouped automatically.
3. Set the recording time zone and timing offsets as needed to align footage with GPS.
4. Open GPS Analytics to explore imported history, or add recording ranges to Export Studio to trim and export them.

Playback depends on the browser and operating system's codec support, particularly for HEVC footage. Browser-side encoding requires WebCodecs support. Native folder access also depends on the browser; the compatible folder picker provides an alternative.

## Supported files and folder layout

The following is an illustrative 70mai layout:

```text
70MAI_SD_CARD/
├── Normal/
│   ├── Front/
│   │   └── NO20260101-120000-000001F.MP4
│   ├── Rear/
│   │   └── NO20260101-120000-000001R.MP4
│   └── Cabin/
│       └── NO20260101-120000-000001C.MP4
└── GPSData000001.txt
```

Folder names and nesting are not fixed: scanning is recursive. The scanner discovers `.mp4` files and `GPSData*.txt` logs case-insensitively and skips dot-prefixed entries. **Video filenames determine whether files are recognized and grouped.**

The current filename format is:

```text
{TYPE}{YYYYMMDD}-{HHMMSS}-{SEQUENCE}{CHANNEL}.MP4
```

| Part | Accepted values |
| --- | --- |
| Type | `NO` = Normal, `EV` / `EM` = Event, `PA` = Parking, `LA` = Lapse |
| Date and time | Recording's local date and time, interpreted in the selected time zone |
| Sequence | One or more digits identifying the recording sequence |
| Channel | `F` = Front, `R` = Rear, `C` = Cabin; `B` is treated as Rear |

Files with the same type, date, time, and sequence form one recording. Unrecognized video filenames are ignored. Timeline blocks use each recording’s actual media duration; lapse recordings currently apply a 15× scale to capture time. Export uses the compressed media duration.

GPS import supports raw 70mai logs and observation CSV files with this header:

```csv
timestamp,status,lat,lng,bearing_centideg,speed_cm_s,accel_x,accel_y,accel_z,filename,flag1,flag2,flag3
```

Timestamps are Unix seconds. CSV headers may use `speed_kmh` and `bearing_deg` instead of `speed_cm_s` and `bearing_centideg`. Daily-summary CSV exports are not a raw-history restore format; use the NDJSON backup for backup and restore.

## Adapting the app for another dashcam

Support for another camera currently requires source changes; there is no camera-profile configuration screen. Changing folder names alone is unnecessary if the files already follow the supported naming format.

| Adaptation | Where to change it |
| --- | --- |
| Discover different extensions or GPS log names | `scanFolder()` in [`src/lib/media.ts`](src/lib/media.ts), plus file filters and picker inputs in [`src/App.svelte`](src/App.svelte) |
| Parse a different filename convention | `parseName()` in [`src/lib/model.ts`](src/lib/model.ts) |
| Change recording grouping, timestamps, channel mapping, or lapse scale | `catalog()`, `CHANNELS`, and related types in [`src/lib/model.ts`](src/lib/model.ts) |
| Read a different GPS format or measurement units | [`src/lib/gps.ts`](src/lib/gps.ts) and import handling in [`src/lib/gps.worker.ts`](src/lib/gps.worker.ts) |

Normalize another camera's data into the existing `Recording`, `Clip`, and `GPSPoint` models so the shared playback, map, analytics, and export components can continue to use it. Adding channels beyond Front, Rear, and Cabin also requires reviewing the layout, player, and export assumptions. Discovering a new media extension does not automatically add browser codec support.

Add synthetic filename, folder, and GPS fixtures when introducing support for a new format. Useful starting points are [`tests/folder.test.ts`](tests/folder.test.ts) and [`tests/core.test.ts`](tests/core.test.ts).

## Tech stack

| Layer | Technology |
| --- | --- |
| Interface | Svelte 5, TypeScript, CSS |
| Development and build | Vite |
| Media decoding and export | Mediabunny, browser media APIs, WebCodecs, Web Workers |
| Maps | MapLibre GL JS with OpenStreetMap raster tiles |
| Charts | Apache ECharts |
| Date and time handling | Luxon |
| Local persistence | IndexedDB through `idb`, plus localStorage for preferences |
| Validation | Svelte Check, Vitest, Playwright, `fake-indexeddb` |

## Project structure

```text
src/
├── App.svelte                   # Navigation, source selection, imports, Viewer
├── main.ts                      # Application entry point
├── style.css                    # Shared styles and layouts
├── components/
│   ├── ReviewPane.svelte        # Shared Viewer / Export review interface
│   ├── Player.svelte            # Synchronized camera playback and layout
│   ├── DayTimeline.svelte       # Timeline, seeking, previews, export trimming
│   ├── Thumbnail.svelte         # Lazy frame decoding and thumbnail cache
│   ├── PlaybackControls.svelte  # Shared transport, speed, and audio controls
│   ├── ExportStudio.svelte      # Export sequence and output settings
│   ├── RouteMap.svelte          # Shared Viewer / Analytics map
│   ├── Analytics.svelte         # GPS analysis interface
│   ├── Chart.svelte             # Chart rendering
│   ├── RecordingCalendar.svelte # Shared date picker
│   └── HeaderNotice.svelte      # Compact notifications and progress
└── lib/
    ├── model.ts                # Data types, filename parsing, recording catalog
    ├── media.ts                # Folder scanning and media metadata
    ├── channel-layout.svelte.ts # Shared camera order and visibility
    ├── gps.ts                  # GPS parsing and validation
    ├── gps-client.ts           # GPS worker client
    ├── gps.worker.ts           # Background GPS processing and library operations
    ├── db.ts                   # IndexedDB persistence
    ├── analytics.ts            # GPS statistics and aggregation
    ├── route-geometry.ts       # Shared route geometry
    ├── fast-export.ts          # Export orchestration
    └── export.worker.ts        # Background media export
tests/                          # Unit tests, browser scripts, synthetic fixtures
```

## Local data and network use

Video and GPS processing run in the browser. The app does not upload footage or GPS logs to an application backend. Footage is read from files you select; imported GPS history is saved in the browser's `dashcam-local` IndexedDB database, and preferences are saved in localStorage.

Maps request tiles from OpenStreetMap, so map display requires network access and sends requests for the viewed map area to that provider. The app is not entirely offline.

Saved history belongs to the browser profile and site origin. A different browser, hostname, or port has separate storage; clearing site data removes saved history. Export a GPS backup before clearing or moving that data. Re-select footage when starting a new session.

Video exports download as `dashcam-export.mp4` using your browser's default download location. If your browser is configured to ask where to save downloads, it will still show that prompt. Exported MP4 chunks are held locally until the download starts; very large exports depend on available browser resources.

## Development

```sh
npm run check     # Svelte and TypeScript checks
npm test          # Unit tests
npm run build     # Production build in dist/
npm run preview   # Serve the production build locally
```

The production output is a static site. Serve it over HTTPS, or use localhost during development, for browser features that require a secure context.

The focused export regression can be run with `node tests/export-trim-speed.mjs` against Vite on port 5174 (or set `DASHCAM_TEST_URL`). It generates synthetic footage in a temporary directory and requires Chrome and FFmpeg/FFprobe.

Browser scripts live under `tests/`; `npm run test:browser` runs `tests/integration.mjs`. That script currently expects a running app at `http://127.0.0.1:4173`, installed Google Chrome, synthetic fixtures under `/private/tmp/dashcam-fixtures`, and FFmpeg/FFprobe. Generate those fixtures with `python3 tests/generate-fixtures.py` (requires Python 3 and FFmpeg). Some browser scripts reference earlier controls and need updating before they can serve as reliable regression checks.

Optional manual browser scripts have no personal recording defaults. Provide test files explicitly before running them:

| Script | Required environment variables |
| --- | --- |
| `tests/browser-export.mjs`, `tests/browser-audio.mjs` | `FRONT_FILE`, `REAR_FILE`, `CABIN_FILE` |
| `tests/browser-media.mjs` | `FRONT_FILE`, `REAR_FILE`, `CABIN_FILE`, `GPS_FILE` |
| `tests/large-gps.mjs` | `GPS_FILE` |
| `tests/viewer-folder.mjs` | `DASHCAM_FOLDER` |

Paths can be absolute or relative to the working directory. Use synthetic fixtures; missing inputs stop the script before Chrome starts. These older scripts still contain assertions for earlier UI controls.

Preserve shared review components for Viewer and Export Studio, and the shared map for Viewer and Analytics. Test imports, restoration, and removal in isolated browser contexts using synthetic data.

Contributions for additional dashcam formats are welcome. Include the naming convention, expected channel mapping, and synthetic examples that demonstrate the change; keep personal footage and GPS history out of the repository.

## GitHub Pages

The app builds to static files in `dist/`. `.github/workflows/pages.yml` checks, tests, builds, and deploys pushes to `main`. In repository **Settings → Pages**, select **GitHub Actions** as the publishing source.

Vite uses relative asset URLs (`base: './'`), and navigation uses hash routes, so the site works under a repository subdirectory without server routing. Footage and GPS files remain on the visitor's device; GitHub hosts the app code only.

## License

Licensed under the [MIT License](LICENSE).
