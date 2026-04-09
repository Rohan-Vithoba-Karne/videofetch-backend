import express, { Request, Response } from 'express';
import cors from 'cors';
import { analyzeRoute } from './api/analyze';
import { downloadRoute } from './api/download';
import { getRuntimeToolsStatus, initializeRuntimeTools } from './lib/runtimeTools';

const app = express();
const PORT = process.env.PORT || 3001;
initializeRuntimeTools();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS Configuration
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const currentTools = getRuntimeToolsStatus();
  const ready = currentTools.ytDlp.ready;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    message: ready ? 'Backend is running' : 'Backend is running with missing dependencies',
    tools: currentTools,
  });
});

// API Routes
app.post('/api/analyze', analyzeRoute);
app.get('/api/download', downloadRoute);
app.post('/api/download', downloadRoute);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ VideoFetch Backend running on http://localhost:${PORT}`);
  console.log(`📝 Analyze endpoint: POST http://localhost:${PORT}/api/analyze`);
  console.log(`⬇️ Download endpoint: POST http://localhost:${PORT}/api/download`);
});
