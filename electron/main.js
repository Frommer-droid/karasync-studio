import path from "node:path";
import net from "node:net";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";

const APP_HOST = "127.0.0.1";
// Фиксированный порт важен: localStorage/IndexedDB привязаны к origin
// (адрес+порт), и только со стабильным портом проект переживает перезапуски.
const FIXED_PORT = Number(process.env.ELECTRON_PORT) || 17842;
const WINDOW_BACKGROUND = "#231825";
const APP_USER_MODEL_ID = "ru.frommer.karasyncstudio";

if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow = null;
let releaseNotesWindow = null;

function createApplicationMenu() {
  const template = [
    {
      label: "Файл",
      submenu: [{ role: "quit", label: "Выйти" }],
    },
    {
      label: "Правка",
      submenu: [
        { role: "undo", label: "Отменить" },
        { role: "redo", label: "Повторить" },
        { type: "separator" },
        { role: "cut", label: "Вырезать" },
        { role: "copy", label: "Копировать" },
        { role: "paste", label: "Вставить" },
        { type: "separator" },
        { role: "selectAll", label: "Выделить все" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "reload", label: "Обновить страницу" },
        { type: "separator" },
        { role: "resetZoom", label: "Масштаб 100%" },
        { role: "zoomIn", label: "Увеличить масштаб" },
        { role: "zoomOut", label: "Уменьшить масштаб" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Полноэкранный режим" },
      ],
    },
    {
      label: "Справка",
      submenu: [
        {
          label: "О программе",
          click: () => showAboutDialog().catch((error) => {
            console.error("[Karaoke Sync Studio] About dialog failed:", error);
          }),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showAboutDialog() {
  const { response } = await dialog.showMessageBox(mainWindow || undefined, {
    type: "info",
    title: "О Karaoke Sync Studio",
    message: "Karaoke Sync Studio",
    detail:
      `Версия: ${app.getVersion()}\n\n` +
      "Студия автоматического создания караоке и таймкодов из аудио с помощью Gemini AI. " +
      "Двухстрочное превью, быстрый офлайн-экспорт MP4 1080p.",
    buttons: ["Закрыть", "Заметки о выпуске"],
    defaultId: 0,
    cancelId: 0,
    icon: getAppIconPath(),
  });
  if (response === 1) {
    await showReleaseNotes();
  }
}

async function showReleaseNotes() {
  if (releaseNotesWindow && !releaseNotesWindow.isDestroyed()) {
    releaseNotesWindow.focus();
    return;
  }
  try {
    const notes = await readFile(resolveAppFile("RELEASE_NOTES.md"), "utf8");
    const escapedNotes = notes.replace(/[&<>]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
    })[character]);
    const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>Заметки о выпуске — Karaoke Sync Studio</title>
  <style>
    body { margin: 0; padding: 32px; color: #f4f2f5; background: #231825; font: 15px/1.6 system-ui, sans-serif; }
    pre { margin: 0 auto; max-width: 820px; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
  </style>
</head>
<body><pre>${escapedNotes}</pre></body>
</html>`;
    const notesWindow = new BrowserWindow({
      title: `Заметки о выпуске — ${app.getVersion()}`,
      width: 900,
      height: 700,
      minWidth: 480,
      minHeight: 360,
      icon: getAppIconPath(),
      backgroundColor: WINDOW_BACKGROUND,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    releaseNotesWindow = notesWindow;
    notesWindow.on("closed", () => {
      if (releaseNotesWindow === notesWindow) releaseNotesWindow = null;
    });
    await notesWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  } catch (error) {
    releaseNotesWindow?.destroy();
    dialog.showErrorBox(
      "Заметки о выпуске",
      error?.message || "Не удалось открыть заметки о выпуске.",
    );
  }
}

/**
 * Корень приложения: app.getAppPath() зависит от способа запуска.
 * - `electron .` / сборка (asar): корень проекта (там лежат electron/ и dist/).
 * - `electron electron/main.js`: appPath указывает на electron/ — поднимаемся на уровень выше.
 */
function getAppRoot() {
  const candidates = [];
  try {
    candidates.push(app.getAppPath());
  } catch {
    // ignore
  }
  try {
    candidates.push(process.cwd());
  } catch {
    // ignore
  }
  for (const base of candidates) {
    try {
      if (existsSync(path.join(base, "electron", "preload.cjs"))) return base;
    } catch {
      // ignore
    }
    try {
      if (existsSync(path.join(base, "dist", "server.cjs"))) return base;
    } catch {
      // ignore
    }
  }
  for (const base of candidates) {
    try {
      const parent = path.dirname(base);
      if (parent && parent !== base) {
        if (
          existsSync(path.join(parent, "electron", "preload.cjs")) ||
          existsSync(path.join(parent, "dist", "server.cjs"))
        ) {
          return parent;
        }
      }
    } catch {
      // ignore
    }
  }
  try {
    return app.getAppPath();
  } catch {
    return process.cwd();
  }
}

function resolveAppFile(...segments) {
  return path.join(getAppRoot(), ...segments);
}

function getAppIconPath() {
  const iconPath = resolveAppFile("electron", "icon.ico");
  return existsSync(iconPath) ? iconPath : undefined;
}

function pickEnvFile() {
  // 1. .env рядом с exe (portable-вариант), 2. .env в userData.
  const candidates = [
    path.join(path.dirname(app.getPath("exe")), ".env"),
    path.join(app.getPath("userData"), ".env"),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return path.join(app.getPath("userData"), ".env");
}

function listenPort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, APP_HOST, () => {
      const address = probe.address();
      const actualPort = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(actualPort));
    });
  });
}

async function pickServerPort() {
  // 1. Пробуем фиксированный порт — он даёт стабильный origin и живое хранилище.
  try {
    const port = await listenPort(FIXED_PORT);
    if (port === FIXED_PORT) {
      return { port, stable: true };
    }
  } catch (error) {
    if (error?.code !== "EADDRINUSE") {
      throw error;
    }
  }
  // 2. Порт занят (вторая копия / dev-сервер): случайный, без персистентности.
  console.warn(
    `[Karaoke Sync Studio] Port ${FIXED_PORT} is busy, using a random port (project storage will not persist).`,
  );
  return { port: await listenPort(0), stable: false };
}

async function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // сервер ещё поднимается
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Встроенный сервер не отвечает: ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function ensureServer() {
  // Dev-режим: грузим уже запущенный `npm run dev`.
  if (process.env.ELECTRON_START_URL) {
    await waitForServer(`${process.env.ELECTRON_START_URL}/api/health`);
    return process.env.ELECTRON_START_URL;
  }

  const { port, stable } = await pickServerPort();
  console.log(`[Karaoke Sync Studio] Using port ${port}${stable ? " (stable)" : " (fallback, unstable origin)"}`);
  process.env.PORT = String(port);
  process.env.NODE_ENV = "production";
  process.env.DOTENV_PATH = pickEnvFile();

  const serverBundle = resolveAppFile("dist", "server.cjs");
  if (!existsSync(serverBundle)) {
    throw new Error(
      "Не найден dist/server.cjs. Сначала соберите приложение: npm run build.",
    );
  }

  await import(pathToFileURL(serverBundle).href);
  const url = `http://${APP_HOST}:${port}`;
  await waitForServer(`${url}/api/health`);
  return url;
}

function isSameOrigin(value, appUrl) {
  try {
    const source = new URL(value);
    const target = new URL(appUrl);
    return source.protocol === target.protocol && source.host === target.host;
  } catch {
    return false;
  }
}

function openExternalIfNeeded(targetUrl, appUrl) {
  if (!isSameOrigin(targetUrl, appUrl)) {
    shell.openExternal(targetUrl).catch(() => {});
  }
}

async function createWindow() {
  const url = await ensureServer();

  mainWindow = new BrowserWindow({
    title: "Karaoke Sync Studio",
    width: 1500,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    icon: getAppIconPath(),
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: resolveAppFile("electron", "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    openExternalIfNeeded(targetUrl, url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isSameOrigin(targetUrl, url)) {
      event.preventDefault();
      openExternalIfNeeded(targetUrl, url);
    }
  });

  // Обычные веб-скачивания (<a download>: субтитры, JSON, PNG-кадры, видео)
  // используют один штатный диалог Electron с корректным именем файла.
  mainWindow.webContents.session.on("will-download", (_event, item) => {
    const fileName = item.getFilename() || "karaoke-export";
    item.setSaveDialogOptions({
      title: "Сохранить файл",
      defaultPath: fileName,
    });
    item.once("done", (_doneEvent, state) => {
      if (state !== "completed" && state !== "cancelled") {
        console.warn(`[Karaoke Sync Studio] Download ${fileName}: ${state}`);
      }
    });
  });

  await mainWindow.loadURL(url);
}

function registerIpcHandlers() {
  // Сохранение текстовых файлов (пресеты оформления): нативный диалог + запись.
  // Нужен, потому что скачивание через <a download> в Electron без will-download
  // никуда не ведёт, а File System Access API там ненадёжен.
  ipcMain.handle("karaoke:save-text-file", async (event, payload) => {
    try {
      const fileName =
        payload && typeof payload.fileName === "string" && payload.fileName.trim()
          ? payload.fileName.trim()
          : "preset.karasync-preset.json";
      const text = payload && typeof payload.text === "string" ? payload.text : "";
      const senderWindow = payload && payload.windowId
        ? BrowserWindow.fromId(payload.windowId)
        : BrowserWindow.fromWebContents(event.sender);
      const parentWindow = senderWindow && !senderWindow.isDestroyed() ? senderWindow : undefined;
      const { canceled, filePath } = await dialog.showSaveDialog(parentWindow || undefined, {
        title: "Сохранить пресет оформления",
        defaultPath: fileName,
        filters: [
          { name: "Пресет оформления", extensions: ["json"] },
          { name: "Все файлы", extensions: ["*"] },
        ],
      });
      if (canceled || !filePath) {
        return { saved: false };
      }
      await writeFile(filePath, text, "utf-8");
      return { saved: true, filePath };
    } catch (error) {
      console.error("[Karaoke Sync Studio] Save file failed:", error);
      throw new Error(error?.message || "Не удалось сохранить файл.");
    }
  });
}

app.whenReady()
  .then(() => {
    registerIpcHandlers();
    createApplicationMenu();
    return createWindow();
  })
  .catch((error) => {
    console.error("[Karaoke Sync Studio] Startup failed:", error);
    dialog.showErrorBox(
      "Karaoke Sync Studio",
      error?.message || "Не удалось запустить приложение.",
    );
    app.quit();
  });

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      dialog.showErrorBox(
        "Karaoke Sync Studio",
        error?.message || "Не удалось открыть окно приложения.",
      );
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
