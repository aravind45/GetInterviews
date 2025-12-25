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
import { cleanupOldFiles } from './middleware/fileUpload';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Request logging
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'resume-diagnosis-engine',
    version: '1.0.0'
  });
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
      upload: {
        method: 'POST',
        path: '/api/upload',
        description: 'Upload resume and create analysis session',
        contentType: 'multipart/form-data',
        fields: {
          resume: 'File (PDF, DOC, DOCX)',
          targetJobTitle: 'String (required)',
          jobDescription: 'String (optional)',
          applicationCount: 'Number (optional)'
        }
      },
      analyze: {
        method: 'POST',
        path: '/api/analyze',
        description: 'Run AI diagnosis on uploaded resume',
        body: {
          sessionId: 'UUID',
          targetJobTitle: 'String',
          jobDescription: 'String (optional)'
        }
      },
      session: {
        method: 'GET',
        path: '/api/session/:sessionId',
        description: 'Get session and analysis status'
      },
      results: {
        method: 'GET',
        path: '/api/results/:sessionId',
        description: 'Get diagnosis results'
      },
      deleteSession: {
        method: 'DELETE',
        path: '/api/session/:sessionId',
        description: 'Delete session and all associated data'
      },
      admin: {
        health: 'GET /api/admin/health',
        migrate: 'POST /api/admin/migrate',
        seed: 'POST /api/admin/seed',
        cleanup: 'POST /api/admin/cleanup',
        stats: 'GET /api/admin/stats'
      }
    },
    requirements: {
      maxFileSize: '10MB',
      maxPages: 10,
      supportedFormats: ['PDF', 'DOC', 'DOCX'],
      dataRetention: '24 hours'
    }
  });
});

// Serve frontend for root and unknown routes
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

// Cleanup job for old upload files
const startCleanupJob = () => {
  const interval = parseInt(process.env.CLEANUP_INTERVAL_MINUTES || '60') * 60 * 1000;
  setInterval(async () => {
    try {
      const cleaned = await cleanupOldFiles(60 * 60 * 1000); // 1 hour
      if (cleaned > 0) {
        logger.info(`Cleanup job removed ${cleaned} old files`);
      }
    } catch (error) {
      logger.error('Cleanup job failed:', error);
    }
  }, interval);
};

// Start server
async function startServer() {
  try {
    logger.info('Starting Resume Diagnosis Engine...');
    
    // Initialize database connection
    await connectDatabase();
    logger.info('✓ Database connected');

    // Initialize Redis connection
    await connectRedis();
    logger.info('✓ Redis connected');

    // Initialize Groq client
    initializeGroq();
    logger.info('✓ Groq client initialized');

    // Start cleanup job
    startCleanupJob();
    logger.info('✓ Cleanup job started');

    // Start HTTP server
    app.listen(PORT, () => {
      logger.info(`✓ Server running on port ${PORT}`);
      logger.info(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`✓ API: http://localhost:${PORT}/api`);
      logger.info(`✓ Frontend: http://localhost:${PORT}`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully...`);
  
  try {
    const { closeDatabase } = require('./database/connection');
    const { closeRedis } = require('./cache/redis');
    
    await closeDatabase();
    await closeRedis();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer();

export default app;
