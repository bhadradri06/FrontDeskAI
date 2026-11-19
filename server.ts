import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createDatabase } from './src/server/db.ts';
import { createApiRouter } from './src/server/routes.ts';
import { realtimeHub } from './src/server/ws.ts';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const db = createDatabase();

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Mount API routes
  app.use('/api', createApiRouter(db));

  // Attach WebSocket real-time hub
  realtimeHub.attach(server);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`FrontDesk AI listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
