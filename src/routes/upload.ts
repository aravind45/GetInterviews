import { Router, Request, Response, NextFunction } from 'express';
import { uploadMiddleware, validateUploadedFile, cleanupTempFile } from '../middleware/fileUpload';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { cacheSet } from '../cache/redis';
import crypto from 'crypto';

const router = Router();

// Session management for file uploads
interface UploadSession {
  sessionId: string;
  fileHash: string;
  originalName: string;
  tempPath: string;
  uploadTime: Date;
  validated: boolean;
}

// In-memory session store (in production, use Redis or database)
const uploadSessions = new Map<string, UploadSession>();

// Generate session ID
const generateSessionId = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

// Calculate file hash for deduplication
const calculateFileHash = (filePath: string): string => {
  const fs = require('fs');
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
};

/**
 * POST /api/upload
 * Upload resume file for analysis
 */
router.post('/upload', (req: Request, res: Response, next: NextFunction) => {
  // Apply multer middleware
  uploadMiddleware.single('resume')(req, res, async (err) => {
    try {
      // Handle multer errors
      if (err) {
        logger.error('File upload error:', err);
        
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(createError('File size exceeds maximum allowed limit (10MB)', 400));
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(createError('Unexpected file field. Please use "resume" field name.', 400));
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return next(createError('Only one file allowed per upload', 400));
        }
        
        return next(createError(err.message || 'File upload failed', 400));
      }

      // Validate file was uploaded
      if (!req.file) {
        return next(createError('No file uploaded. Please select a resume file.', 400));
      }

      // Validate uploaded file
      const validation = validateUploadedFile(req.file);
      
      if (!validation.isValid) {
        // Cleanup invalid file
        await cleanupTempFile(req.file.path);
        
        return res.status(400).json({
          success: false,
          error: 'File validation failed',
          details: validation.errors,
          warnings: validation.warnings
        });
      }

      // Calculate file hash for deduplication
      const fileHash = calculateFileHash(req.file.path);
      
      // Generate session ID
      const sessionId = generateSessionId();
      
      // Create upload session
      const session: UploadSession = {
        sessionId,
        fileHash,
        originalName: req.file.originalname,
        tempPath: req.file.path,
        uploadTime: new Date(),
        validated: true
      };
      
      // Store session (with TTL)
      uploadSessions.set(sessionId, session);
      
      // Cache session data in Redis with 1-hour TTL
      await cacheSet(`upload_session:${sessionId}`, session, 3600);
      
      // Log successful upload
      logger.info('File uploaded successfully', {
        sessionId,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        fileHash,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Return success response
      res.json({
        success: true,
        data: {
          sessionId,
          fileInfo: {
            originalName: validation.fileInfo!.originalName,
            size: validation.fileInfo!.size,
            type: validation.fileInfo!.mimetype,
            extension: validation.fileInfo!.extension
          },
          warnings: validation.warnings,
          uploadTime: session.uploadTime
        },
        message: 'File uploaded successfully. You can now proceed with analysis.'
      });

    } catch (error) {
      logger.error('Upload route error:', error);
      
      // Cleanup file if it exists
      if (req.file?.path) {
        await cleanupTempFile(req.file.path);
      }
      
      next(createError('File upload processing failed', 500));
    }
  });
});

/**
 * GET /api/upload/session/:sessionId
 * Get upload session information
 */
router.get('/session/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId || typeof sessionId !== 'string') {
      return next(createError('Invalid session ID', 400));
    }
    
    // Check in-memory store first
    let session = uploadSessions.get(sessionId);
    
    // If not found, check Redis cache
    if (!session) {
      session = await require('../cache/redis').cacheGet(`upload_session:${sessionId}`);
    }
    
    if (!session) {
      return next(createError('Upload session not found or expired', 404));
    }
    
    // Check if session is still valid (1 hour TTL)
    const sessionAge = Date.now() - new Date(session.uploadTime).getTime();
    if (sessionAge > 60 * 60 * 1000) { // 1 hour
      // Cleanup expired session
      uploadSessions.delete(sessionId);
      await cleanupTempFile(session.tempPath);
      
      return next(createError('Upload session expired. Please upload your file again.', 410));
    }
    
    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        originalName: session.originalName,
        uploadTime: session.uploadTime,
        validated: session.validated,
        status: 'ready_for_analysis'
      }
    });
    
  } catch (error) {
    logger.error('Session retrieval error:', error);
    next(createError('Failed to retrieve session information', 500));
  }
});

/**
 * DELETE /api/upload/session/:sessionId
 * Cleanup upload session and temporary files
 */
router.delete('/session/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId || typeof sessionId !== 'string') {
      return next(createError('Invalid session ID', 400));
    }
    
    // Get session info
    let session = uploadSessions.get(sessionId);
    if (!session) {
      session = await require('../cache/redis').cacheGet(`upload_session:${sessionId}`);
    }
    
    if (session) {
      // Cleanup temporary file
      await cleanupTempFile(session.tempPath);
      
      // Remove from stores
      uploadSessions.delete(sessionId);
      await require('../cache/redis').cacheDelete(`upload_session:${sessionId}`);
      
      logger.info('Upload session cleaned up', { sessionId });
    }
    
    res.json({
      success: true,
      message: 'Session cleaned up successfully'
    });
    
  } catch (error) {
    logger.error('Session cleanup error:', error);
    next(createError('Failed to cleanup session', 500));
  }
});

// Cleanup expired sessions periodically
setInterval(async () => {
  try {
    const now = Date.now();
    const expiredSessions: string[] = [];
    
    for (const [sessionId, session] of uploadSessions.entries()) {
      const sessionAge = now - new Date(session.uploadTime).getTime();
      if (sessionAge > 60 * 60 * 1000) { // 1 hour
        expiredSessions.push(sessionId);
      }
    }
    
    // Cleanup expired sessions
    for (const sessionId of expiredSessions) {
      const session = uploadSessions.get(sessionId);
      if (session) {
        await cleanupTempFile(session.tempPath);
        uploadSessions.delete(sessionId);
        await require('../cache/redis').cacheDelete(`upload_session:${sessionId}`);
      }
    }
    
    if (expiredSessions.length > 0) {
      logger.info(`Cleaned up ${expiredSessions.length} expired upload sessions`);
    }
    
  } catch (error) {
    logger.error('Session cleanup job error:', error);
  }
}, 15 * 60 * 1000); // Run every 15 minutes

export default router;