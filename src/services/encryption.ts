import crypto from 'crypto';
import { logger } from '../utils/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Get encryption key from environment or derive from secret
 */
const getEncryptionKey = (): Buffer => {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
  // If key is exactly 32 bytes, use directly
  if (key.length === 32) {
    return Buffer.from(key, 'utf8');
  }
  
  // Otherwise, derive a 32-byte key using PBKDF2
  const salt = crypto.createHash('sha256').update('resume-diagnosis-salt').digest();
  return crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');
};

/**
 * Encrypt data using AES-256-GCM
 * Requirement 9.1: Encrypt all uploaded resume data
 */
export const encrypt = (data: string | Buffer): Buffer => {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    const inputBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    
    const encrypted = Buffer.concat([
      cipher.update(inputBuffer),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    // Format: IV (16 bytes) + Auth Tag (16 bytes) + Encrypted Data
    return Buffer.concat([iv, authTag, encrypted]);
    
  } catch (error) {
    logger.error('Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
};

/**
 * Decrypt data encrypted with encrypt()
 */
export const decrypt = (encryptedData: Buffer): Buffer => {
  try {
    const key = getEncryptionKey();
    
    // Extract IV, auth tag, and encrypted content
    const iv = encryptedData.subarray(0, IV_LENGTH);
    const authTag = encryptedData.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = encryptedData.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted;
    
  } catch (error) {
    logger.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
};

/**
 * Decrypt to string
 */
export const decryptToString = (encryptedData: Buffer): string => {
  return decrypt(encryptedData).toString('utf8');
};

/**
 * Generate a secure random token
 */
export const generateToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Generate a secure session token
 */
export const generateSessionToken = (): string => {
  return crypto.randomBytes(32).toString('base64url');
};

/**
 * Hash data using SHA-256
 */
export const hash = (data: string | Buffer): string => {
  const inputBuffer = typeof data === 'string' ? Buffer.from(data) : data;
  return crypto.createHash('sha256').update(inputBuffer).digest('hex');
};

/**
 * Hash file content for deduplication
 */
export const hashFile = (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data: Buffer) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};

/**
 * Securely compare two strings (timing-safe)
 */
export const secureCompare = (a: string, b: string): boolean => {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(a, 'utf8'),
      Buffer.from(b, 'utf8')
    );
  } catch {
    return false;
  }
};

/**
 * Generate deletion confirmation token
 */
export const generateDeletionToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

export default {
  encrypt,
  decrypt,
  decryptToString,
  generateToken,
  generateSessionToken,
  hash,
  hashFile,
  secureCompare,
  generateDeletionToken
};
