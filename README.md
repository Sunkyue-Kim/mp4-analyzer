# MP4/fMP4 Media Analyzer

Single-file browser analyzer for MP4, fragmented MP4, MOV-style ISO BMFF files, and common media tracks.

## Use

Open `index.html` or the GitHub Pages URL, then drop a media file anywhere in the window.

The app runs locally in the browser. It does not upload media files.

The sample selector loads files from `validation/generated/`. On GitHub Pages these files are served as normal static assets. When opening `index.html` directly from `file://`, some browsers block `fetch()` for local relative files; in that case, open or drop the sample file manually.

## Build

```powershell
npm install
npm run build
```

Build outputs:

- `mp4-analyzer.html`: readable single-file HTML
- `mp4-analyzer.min.html`: minified single-file HTML
- `index.html`: GitHub Pages entry point

## Source Layout

- `src/app.js`: build entry
- `src/js/main.js`: browser bootstrap
- `src/js/core/analyzer-core.js`: MP4/fMP4 parser, sample model, AVC/HEVC/AAC parsing, self-tests
- `src/js/i18n/catalogs.js`: English/Korean UI strings and box descriptions
- `src/js/samples/sample-manifest.js`: static sample file manifest for Pages
- `src/js/ui/analyzer-ui.js`: DOM state, rendering, filters, exports, media preview, sample loading

## Scope

- MP4 and fragmented MP4 box/sample parsing
- AVC/H.264, HEVC/H.265, AAC, and ProRes track metadata
- Frame table, frame size graph, bitrate/FPS metrics, fragments, warnings
- English/Korean UI via an extensible i18n dictionary
