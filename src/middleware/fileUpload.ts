import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Request } from 'express';
import { logger } from '../utils/logger';
import { ValidationError } from '../types';

// Configuration
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760'); // 10MB
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/uploads';
const ALLOWED_MIMETYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];

// Ensure upload directory exists
const ensureUploadDir = (): void => {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    logger.info(`Created upload directory: ${UPLOAD_DIR}`);
  }
};

ensureUploadDir();

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and random string
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `resume-${uniqueSuffix}${ext}`);
  }
});

// File filter
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimetype = file.mimetype.toLowerCase();

  // Check extension
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    cb(new ValidationError(
      `Invalid file type. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`,
      { allowedExtensions: ALLOWED_EXTENSIONS, receivedExtension: ext }
    ));
    return;
  }

  // Check MIME type
  if (!ALLOWED_MIMETYPES.includes(mimetype)) {
    cb(new ValidationError(
      `Invalid file format. Please upload a PDF or Word document.`,
      { allowedMimetypes: ALLOWED_MIMETYPES, receivedMimetype: mimetype }
    ));
    return;
  }

  cb(null, true);
};

// Multer instance
export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only one file per request
    fields: 10, // Max form fields
    parts: 15 // Max multipart parts
  }
});

// File validation result
export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fileInfo?: {
    originalName: string;
    size: number;
    mimetype: string;
    extension: string;
    path: string;
  };
}

// Validate uploaded file
export const validateUploadedFile = (file: Express.Multer.File): FileValidationResult => {
  const result: FileValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  if (!file) {
    result.isValid = false;
    result.errors.push('No file uploaded');
    return result;
  }

  const ext = path.extname(file.originalname).toLowerCase();

  // Extension validation
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    result.isValid = false;
    result.errors.push(`Invalid file extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  // MIME type validation
  if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
    result.isValid = false;
    result.errors.push(`Invalid MIME type: ${file.mimetype}`);
  }

  // Size validation
  if (file.size > MAX_FILE_SIZE) {
    result.isValid = false;
    result.errors.push(`File size (${formatBytes(file.size)}) exceeds maximum (${formatBytes(MAX_FILE_SIZE)})`);
  }

  // Size warnings
  if (file.size < 1000) {
    result.warnings.push('File seems very small. Please ensure it contains your complete resume.');
  }

  if (file.size > 5 * 1024 * 1024) {
    result.warnings.push('Large file detected. Processing may take longer.');
  }

  // Filename validation
  if (file.originalname.length > 255) {
    result.warnings.push('Filename is very long. Consider using a shorter name.');
  }

  // Check for suspicious patterns
  if (/[<>:"/\\|?*]/.test(file.originalname)) {
    result.warnings.push('Filename contains special characters that may cause issues.');
  }

  if (result.isValid) {
    result.fileInfo = {
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      extension: ext,
      path: file.path
    };
  }

  return result;
};

// Clean up temporary file
export const cleanupTempFile = async (filePath: string): Promise<void> => {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.debug(`Cleaned up temp file: ${filePath}`);
    }
  } catch (error) {
    logger.error('Failed to cleanup temp file:', { filePath, error });
  }
};

// Calculate file hash for deduplication
export const calculateFileHash = (filePath: string): string => {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
};

// Format bytes helper
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Cleanup old files periodically
export const cleanupOldFiles = async (maxAgeMs: number = 3600000): Promise<number> => {
  let cleaned = 0;
  
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return 0;
    
    const files = await fs.promises.readdir(UPLOAD_DIR);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      try {
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath);
          cleaned++;
        }
      } catch (error) {
        logger.error('Error checking file age:', { filePath, error });
      }
    }
    
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old upload files`);
    }
  } catch (error) {
    logger.error('Error during file cleanup:', error);
  }
  
  return cleaned;
};

export default {
  uploadMiddleware,
  validateUploadedFile,
  cleanupTempFile,
  calculateFileHash,
  cleanupOldFiles
};
