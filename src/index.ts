import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { connectDatabase } from './database/connection';
import { connectRedis } from './cache/redis';
import { initializeGroq } from './services/groq';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Load environment variables
dotenv.config();

const app = express();

// Trust proxy for correct IP detection behind load balancers
app.set('trust proxy', 1);

// Security middleware with CSP for frontend
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Request logging (minimal for serverless)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health' && req.path !== '/favicon.ico') {
      logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ============================================
// Lazy Initialization for Serverless
// ============================================
let initialized = false;

const ensureInitialized = async () => {
  if (initialized) return;
  
  try {
    // Initialize database
    await connectDatabase();
    
    // Initialize Redis (with graceful failure)
    try {
      await connectRedis();
    } catch (redisError) {
      logger.warn('Redis connection failed, continuing without cache:', redisError);
    }
    
    // Initialize Groq
    initializeGroq();
    
    initialized = true;
    logger.info('Services initialized');
  } catch (error) {
    logger.error('Initialization error:', error);
    throw error;
  }
};

// Middleware to ensure initialization
app.use(async (req, res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    res.status(503).json({
      success: false,
      error: 'Service temporarily unavailable',
      code: 'INITIALIZATION_ERROR'
    });
  }
});

// Health check endpoint (doesn't require full initialization)
app.get('/health', async (req, res) => {
  try {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'resume-diagnosis-engine',
      version: '1.0.0',
      initialized
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: 'Health check failed' });
  }
});

// Import routes
import apiRoutes from './routes/api';
import adminRoutes from './routes/admin';
import jobRoutes from './routes/jobs';

// API routes
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/jobs', jobRoutes);

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Resume Diagnosis Engine API',
    version: '1.0.0',
    description: 'AI-powered resume analysis for identifying interview barriers',
    endpoints: {
      upload: { method: 'POST', path: '/api/upload' },
      analyze: { method: 'POST', path: '/api/analyze' },
      session: { method: 'GET', path: '/api/session/:id' },
      results: { method: 'GET', path: '/api/results/:id' },
      deleteSession: { method: 'DELETE', path: '/api/session/:id' },
      jobs: {
        generateSearch: { method: 'POST', path: '/api/jobs/generate-search' },
        platforms: { method: 'GET', path: '/api/jobs/platforms' },
        applications: { method: 'GET/POST', path: '/api/jobs/applications/:sessionId' }
      }
    }
  });
});

// Serve frontend for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler for API routes
app.use('/api/*', notFoundHandler);

// Serve frontend for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use(errorHandler);

// For local development
const PORT = process.env.PORT || 3000;
const isVercel = process.env.VERCEL === '1';

if (!isVercel) {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

// Export for Vercel serverless
export default app;
module.exports = app;
