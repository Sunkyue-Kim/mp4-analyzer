# MP4/fMP4 Media Analyzer

Single-file browser analyzer for MP4, fragmented MP4, MOV-style ISO BMFF files, and common media tracks.

## Use

Open `index.html` or the GitHub Pages URL, then drop a media file anywhere in the window.

The app runs locally in the browser. It does not upload media files.

## Build

```powershell
npm install
npm run build
Copy-Item -LiteralPath .\mp4-analyzer.min.html -Destination .\index.html -Force
```

Build outputs:

- `mp4-analyzer.html`: readable single-file HTML
- `mp4-analyzer.min.html`: minified single-file HTML
- `index.html`: GitHub Pages entry point

## Scope

- MP4 and fragmented MP4 box/sample parsing
- AVC/H.264, HEVC/H.265, AAC, and ProRes track metadata
- Frame table, frame size graph, bitrate/FPS metrics, fragments, warnings
- English/Korean UI via an extensible i18n dictionary
