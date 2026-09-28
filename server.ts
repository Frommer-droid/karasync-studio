import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import transcribeRouter from './server/transcribeRouter';

// В Electron путь к .env задаётся через DOTENV_PATH (рядом с exe или в userData).
// По умолчанию dotenv ищет .env в текущей рабочей папке.
if (process.env.DOTENV_PATH) {
  dotenv.config({ path: process.env.DOTENV_PATH });
} else {
  dotenv.config();
}

const app = express();
// Порт из env (нужен Electron для свободного порта), по умолчанию 3000.
const PORT = Number(process.env.PORT) || 3000;

// Middleware for parsing large JSON payloads (audio files in base64)
app.use(express.json({ limit: '300mb' }));
app.use(express.urlencoded({ extended: true, limit: '300mb' }));

// API Routes
app.use('/api', transcribeRouter);

// Error handler for payload too large or body parsing errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'Размер переданных данных превысил лимит сервера (413). Рекомендуется использовать сжатый аудиоформат (MP3/M4A/OGG) или файл меньшего размера.',
    });
  }
  if (err) {
    return res.status(500).json({
      error: err.message || 'Внутренняя ошибка сервера при обработке запроса.',
    });
  }
  next();
});

/**
 * Где лежит собранный фронтенд (index.html):
 * 1. <cwd>/dist — обычный запуск (npm start, dev);
 * 2. Папка рядом с серверным бандлом — Electron (app.asar/dist).
 */
function resolveDistPath(): string {
  const candidates: string[] = [path.join(process.cwd(), 'dist')];
  try {
    if (typeof __dirname !== 'undefined' && __dirname) {
      candidates.push(__dirname);
    }
  } catch {
    // ignore (ESM без __dirname)
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, 'index.html'))) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return candidates[0];
}

async function startServer() {
  // Vite middleware for development vs static for production.
  // vite импортируется лениво: в прод-сборке (Electron) его нет в пакете.
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = resolveDistPath();
    console.log(`[Server] Serving static from: ${distPath}`);
    const distStatic = express.static(distPath);
    app.use(distStatic);
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎵 Karaoke Sync Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
