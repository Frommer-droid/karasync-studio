<div align="center">
  <img src="assets/branding/karasync-app-icon-source.png" width="112" alt="Karaoke Sync Studio icon" />
  <h1>Karaoke Sync Studio</h1>
  <p><strong>A desktop studio for karaoke, precise word timing, and Full HD video from audio.</strong></p>
  <p><a href="README.md">Русская версия</a> · <a href="https://github.com/Frommer-droid/karasync-studio/releases/latest">Latest release</a></p>
</div>

Karaoke Sync Studio is a desktop studio for creating karaoke, precise word timing, and Full HD video from an audio recording. It transcribes vocals with Gemini AI, aligns the result with reference lyrics, and lets you refine timing manually.

## Features

- word transcription and timing from the original track or a separate vocal track;
- alignment with reference lyrics while preserving lines, case, and punctuation;
- a detailed clean-vocal waveform aligned to the original track, draggable word-start markers, word deletion from a marker's context menu, and global 50/100 ms marker shifts;
- word navigation and precise start-time editing; selected-word playback stops at the next marker and returns to the word start. A standalone dash is attached to the preceding word and has no separate timestamp;
- automatic scrolling of the word list to the currently playing line;
- Undo and Redo buttons for word and timing edits;
- two-line karaoke preview with adjustable fonts, colours, placement, and branding;
- background videos, intro/outro clips, and fullscreen preview;
- LRC, SRT, VTT, and JSON export, plus Full HD video export with a 20-second test mode;
- local projects, audio, and visual-design presets;
- the app version and release notes in Electron's About menu.

## Requirements

- Windows 10 or 11 for the desktop application;
- Node.js 20 or newer and npm when running from source;
- a Gemini API key for transcription;
- a modern Chromium browser for development mode.

## Install on Windows

Download the installer from the [latest release page](https://github.com/Frommer-droid/karasync-studio/releases/latest), run it, and follow the setup wizard. The default folder is `D:\Apps\Караоке Синк Студио`, or `C:\Apps\Караоке Синк Студио` if there is no D drive. The installed application does not require Node.js.

Version 0.6.1 switches to an Inno Setup installer. If version 0.6.0 was installed with NSIS, remove that older installation from Windows Installed Apps after switching so that two installed copies do not remain. Electron projects and settings are stored outside the program folder.

## Run from source

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Set `GEMINI_API_KEY` in the local `.env`, then open `http://127.0.0.1:3000`.

You can also enter the key in the interface. It remains in local application storage and is sent to the local server only with a transcription request.

## Basic workflow

1. Load the original song.
2. Optionally add a clean vocal track and reference lyrics.
3. Start transcription and review the lines in the timing editor.
4. Adjust the design and preview a short test segment.
5. Export subtitles or the completed video.

## Development and verification

```powershell
npm run lint
$testFiles = @(rg --files -g '*.test.ts')
node --import tsx --test $testFiles
npm run build
```

To run Electron over an already running development server:

```powershell
$env:ELECTRON_START_URL = 'http://127.0.0.1:3000'
npm run electron
```

## Build for Windows

```powershell
npm run dist:electron
```

The command creates an unpacked application in `Karaoke-Sync-Studio-<version>\win-unpacked` and an Inno Setup installer on the current user's Desktop. Inno Setup 6 is required to build it.

See [DEVELOPER.md](DEVELOPER.md) for architecture, storage, and build details.

## Data and security

- `.env`, API keys, local projects, and user media are excluded from Git;
- project settings are stored in `localStorage`; audio and images use IndexedDB;
- the desktop app opens external links in the system browser and uses an isolated preload bridge.

## License

The source code is available under the [MIT License](LICENSE). The Windows installer is published as a separate GitHub Release asset.
