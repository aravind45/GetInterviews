import { Router, Request, Response, NextFunction } from 'express';
import { runMigrations } from '../database/migrate';
import { seedDatabase } from '../database/seed';
import { query } from '../database/connection';
import { isRedisConnected, getRedisClient } from '../cache/redis';
import { isGroqAvailable } from '../services/groq';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Admin authentication middleware
 */
const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const adminKey = process.env.ADMIN_KEY;
  
  if (!adminKey) {
    return next(createError('Admin operations not configured', 503));
  }
  
  if (!authHeader || authHeader !== `Bearer ${adminKey}`) {
    return next(createError('Unauthorized', 401));
  }
  
  next();
};

/**
 * GET /api/admin/health
 * Comprehensive health check
 */
router.get('/health', adminAuth, asyncHandler(async (req: Request, res: Response) => {
  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    services: {}
  };
  
  // Database health
  try {
    const dbResult = await query('SELECT NOW() as time, current_database() as db, version() as version');
    health.services.database = {
      connected: true,
      database: dbResult.rows[0].db,
      serverTime: dbResult.rows[0].time,
      version: dbResult.rows[0].version.split(' ')[0] + ' ' + dbResult.rows[0].version.split(' ')[1]
    };
  } catch (error) {
    health.services.database = {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    health.status = 'degraded';
  }
  
  // Redis health
  try {
    if (isRedisConnected()) {
      const redisClient = getRedisClient();
      await redisClient?.ping();
      health.services.redis = { connected: true };
    } else {
      health.services.redis = { connected: false, reason: 'Not configured or not connected' };
    }
  } catch (error) {
    health.services.redis = {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
  
  // Groq health
  health.services.groq = {
    configured: isGroqAvailable(),
    model: process.env.GROQ_MODEL || 'llama3-8b-8192'
  };
  
  // System info
  health.system = {
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'
    },
    nodeVersion: process.version
  };
  
  // Database stats
  try {
    const statsResult = await query(`
      SELECT 
        (SELECT COUNT(*) FROM user_sessions WHERE expires_at > NOW()) as active_sessions,
        (SELECT COUNT(*) FROM resume_analyses WHERE status = 'completed') as completed_analyses,
        (SELECT COUNT(*) FROM resume_analyses WHERE status = 'pending') as pending_analyses,
        (SELECT COUNT(*) FROM canonical_job_titles) as job_titles
    `);
    health.stats = statsResult.rows[0];
  } catch {
    // Stats are optional
  }
  
  res.json(health);
}));

/**
 * POST /api/admin/migrate
 * Run database migrations
 */
router.post('/migrate', adminAuth, asyncHandler(async (req: Request, res: Response) => {
  logger.info('Starting database migration via API');
  
  const results = await runMigrations();
  
  logger.info('Database migration completed via API', results);
  
  res.json({
    success: true,
    message: 'Database migrations completed',
    results,
    timestamp: new Date().toISOString()
  });
}));

/**
 * POST /api/admin/seed
 * Seed database with initial data
 */
router.post('/seed', adminAuth, asyncHandler(async (req: Request, res: Response) => {
  logger.info('Starting database seeding via API');
  
  const results = await seedDatabase();
  
  logger.info('Database seeding completed via API', results);
  
  res.json({
    success: true,
    message: 'Database seeded successfully',
    results,
    timestamp: new Date().toISOString()
  });
}));

/**
 * POST /api/admin/cleanup
 * Manual cleanup of expired data
 */
router.post('/cleanup', adminAuth, asyncHandler(async (req: Request, res: Response) => {
  logger.info('Starting manual cleanup');
  
  const result = await query('SELECT * FROM cleanup_expired_data()');
  const cleanup = result.rows[0];
  
  logger.info('Manual cleanup completed', cleanup);
  
  res.json({
    success: true,
    message: 'Cleanup completed',
    results: {
      sessionsDeleted: cleanup.sessions_deleted,
      analysesDeleted: cleanup.analyses_deleted,
      auditLogsCleaned: cleanup.audit_cleaned
    },
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/admin/stats
 * Get system statistics
 */
router.get('/stats', adminAuth, asyncHandler(async (req: Request, res: Response) => {
  const stats = await query(`
    SELECT 
      -- Sessions
      (SELECT COUNT(*) FROM user_sessions) as total_sessions,
      (SELECT COUNT(*) FROM user_sessions WHERE expires_at > NOW() AND is_active) as active_sessions,
      
      -- Analyses
      (SELECT COUNT(*) FROM resume_analyses) as total_analyses,
      (SELECT COUNT(*) FROM resume_analyses WHERE status = 'completed') as completed_analyses,
      (SELECT COUNT(*) FROM resume_analyses WHERE status = 'failed') as failed_analyses,
      (SELECT COUNT(*) FROM resume_analyses WHERE status = 'pending') as pending_analyses,
      
      -- Diagnoses
      (SELECT COUNT(*) FROM diagnosis_results) as total_diagnoses,
      (SELECT AVG(overall_confidence) FROM diagnosis_results) as avg_confidence,
      (SELECT COUNT(*) FROM diagnosis_results WHERE is_competitive) as competitive_resumes,
      
      -- Root causes
      (SELECT COUNT(*) FROM root_causes) as total_root_causes,
      (SELECT AVG(severity_score) FROM root_causes) as avg_severity,
      
      -- Job titles
      (SELECT COUNT(*) FROM canonical_job_titles) as job_titles,
      (SELECT COUNT(*) FROM job_title_variations) as job_variations,
      
      -- Audit
      (SELECT COUNT(*) FROM audit_log WHERE created_at > NOW() - INTERVAL '24 hours') as audit_entries_24h
  `);
  
  // Top root cause categories
  const categoriesResult = await query(`
    SELECT category, COUNT(*) as count
    FROM root_causes
    GROUP BY category
    ORDER BY count DESC
    LIMIT 5
  `);
  
  res.json({
    success: true,
    stats: stats.rows[0],
    topRootCauseCategories: categoriesResult.rows,
    timestamp: new Date().toISOString()
  });
}));

/**
 * POST /api/admin/reset
 * Reset database (DANGEROUS - development only)
 */
router.post('/reset', adminAuth, asyncHandler(async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError('Database reset not allowed in production', 403);
  }
  
  const { confirm } = req.body;
  if (confirm !== 'RESET_DATABASE') {
    throw createError('Confirmation required. Send { confirm: "RESET_DATABASE" }', 400);
  }
  
  logger.warn('Database reset initiated');
  
  // Drop and recreate tables
  await query(`
    DROP TABLE IF EXISTS deletion_confirmations CASCADE;
    DROP TABLE IF EXISTS audit_log CASCADE;
    DROP TABLE IF EXISTS evidence CASCADE;
    DROP TABLE IF EXISTS recommendations CASCADE;
    DROP TABLE IF EXISTS root_causes CASCADE;
    DROP TABLE IF EXISTS diagnosis_results CASCADE;
    DROP TABLE IF EXISTS resume_analyses CASCADE;
    DROP TABLE IF EXISTS user_sessions CASCADE;
    DROP TABLE IF EXISTS role_templates CASCADE;
    DROP TABLE IF EXISTS job_title_variations CASCADE;
    DROP TABLE IF EXISTS canonical_job_titles CASCADE;
  `);
  
  // Run migrations
  await runMigrations();
  
  // Seed database
  await seedDatabase();
  
  logger.warn('Database reset completed');
  
  res.json({
    success: true,
    message: 'Database reset and reseeded successfully',
    timestamp: new Date().toISOString()
  });
}));

export default router;
