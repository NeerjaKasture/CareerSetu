// Load environment variables FIRST, before any other imports
import dotenv from 'dotenv';
import path from 'path';

// Load .env from the backend directory
const envPath = path.resolve(process.cwd(), '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('⚠️  Warning: Could not load .env file:', result.error.message);
} else {
  console.log('✅ Loaded .env file from:', envPath);
}

import express, { Request, Response } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import homeRoutes from './routes/home';
import assessmentRoutes from './routes/assessment';
import chatRoutes from './routes/chat';
import profileRoutes from './routes/profile';

const app = express();
const PORT = process.env.PORT || 3000;

// Eagerly initialize RAG service on server startup (in background)
// This preloads the Python process, embeddings model, and ChromaDB
// so it's ready when users need it (no wait time on first request)
// Import happens inside async function to avoid circular dependency
async function initializeRAGService() {
  try {
    console.log('🚀 Starting RAG service initialization in background...');
    const { getRAGService } = await import('./routes/chat');
    const ragService = getRAGService();
    await ragService.initialize();
    console.log('✅ RAG service preloaded successfully - ready for instant responses!');
  } catch (err: any) {
    console.error('⚠️  RAG service preload failed (will lazy load on first use):', err.message);
  }
}

// Start initialization in background (don't await - let it run parallel to server startup)
initializeRAGService();

// Middleware
// CRITICAL: Parse JSON with UTF-8 encoding to support Hindi/Telugu/etc.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
      ];
      
      if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'career-guidance-backend',
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/assessment', assessmentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/profile', profileRoutes);

// Serve frontend static files in production
const frontendBuildPath = path.resolve(__dirname, '../../frontend/build');
app.use(express.static(frontendBuildPath));

// Support React Router SPA fallback (redirect non-API paths to frontend index.html)
app.get('*', (req: Request, res: Response, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API endpoints:`);
  console.log(`   POST /api/auth/setup`);
  console.log(`   POST /api/auth/login`);
  console.log(`   POST /api/auth/logout`);
  console.log(`   POST /api/auth/token/refresh`);
  console.log(`   GET  /api/home`);
  console.log(`   POST /api/assessment/start`);
  console.log(`   POST /api/assessment/complete`);
  console.log(`   POST /api/chat/start`);
  console.log(`   POST /api/chat/message`);
  console.log(`   GET  /api/chat/history`);
  console.log(`   GET  /api/profile`);
  console.log(`   PATCH /api/profile/update`);
  console.log(`   DELETE /api/profile/delete`);

  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  WARNING: GEMINI_API_KEY not set. AI features will fail.');
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-secret-key') {
    console.warn('⚠️  WARNING: JWT_SECRET not set or using default. Change in production!');
  }
});

// Handle port already in use error gracefully
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use.`);
    console.error(`💡 To free up port ${PORT}, run: lsof -ti:${PORT} | xargs kill -9`);
    console.error(`   Or use: npm run free-port (from root directory)\n`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', err);
    process.exit(1);
  }
});

export default app;

