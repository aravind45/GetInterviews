import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AppError, ValidationError, ProcessingError, TimeoutError } from '../types';
import { ZodError } from 'zod';

export const createError = (
  message: string, 
  statusCode: number = 500, 
  code?: string,
  details?: Record<string, any>
): AppError => {
  return new AppError(message, statusCode, code, details);
};

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log the error
  logger.error('Error handled:', {
    name: err.name,
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }))
    });
    return;
  }

  // Handle custom app errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      details: err.details
    });
    return;
  }

  // Handle multer errors
  if (err.name === 'MulterError') {
    const multerError = err as any;
    let message = 'File upload error';
    let statusCode = 400;

    switch (multerError.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File size exceeds maximum allowed limit (10MB)';
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Only one file allowed per upload';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field. Please use "resume" field name.';
        break;
      case 'LIMIT_PART_COUNT':
        message = 'Too many parts in multipart request';
        break;
      default:
        message = multerError.message || 'File upload failed';
    }

    res.status(statusCode).json({
      success: false,
      error: message,
      code: 'FILE_UPLOAD_ERROR'
    });
    return;
  }

  // Handle database errors
  if (err.name === 'DatabaseError' || (err as any).code?.startsWith?.('P')) {
    res.status(503).json({
      success: false,
      error: 'Database operation failed. Please try again.',
      code: 'DATABASE_ERROR'
    });
    return;
  }

  // Handle timeout errors
  if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
    res.status(408).json({
      success: false,
      error: 'Request timeout. Please try again with a smaller file.',
      code: 'TIMEOUT_ERROR'
    });
    return;
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.message,
    code: 'INTERNAL_ERROR'
  });
};

// Async handler wrapper to catch async errors
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Not found handler
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND'
  });
};

export default errorHandler;
