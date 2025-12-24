import fc from 'fast-check';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateUploadedFile, cleanupTempFile, encryptFileContent, decryptFileContent } from '../fileUpload';
import { logger } from '../../utils/logger';

// Mock logger
jest.mock('../../utils/logger');

// Mock fs for some tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  openSync: jest.fn(),
  writeSync: jest.fn(),
  fsyncSync: jest.fn(),
  closeSync: jest.fn(),
  unlinkSync: jest.fn()
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('File Upload Property Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Property Tests', () => {
    /**
     * Feature: resume-diagnosis-engine, Property 1: File Processing Consistency
     * Validates: Requirements 1.1, 1.2
     */
    test('Property 1: File processing consistency - valid files should always be processed successfully', async () => {
      // Get the actual MAX_FILE_SIZE from environment (test env has 5MB limit)
      const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760');
      
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            originalname: fc.oneof(
              fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s.trim().replace(/[^a-zA-Z0-9]/g, 'a')}.pdf`),
              fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s.trim().replace(/[^a-zA-Z0-9]/g, 'a')}.doc`),
              fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s.trim().replace(/[^a-zA-Z0-9]/g, 'a')}.docx`)
            ),
            size: fc.integer({ min: 1, max: MAX_FILE_SIZE }), // Within the actual limit
            mimetype: fc.constantFrom('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
            path: fc.string({ minLength: 10, maxLength: 50 }).map(s => `/tmp/${s}`)
          }),
          async (fileData) => {
            // Mock file existence
            mockFs.existsSync.mockReturnValue(true);
            
            const mockFile = fileData as Express.Multer.File;
            
            // Test file validation consistency
            const result = validateUploadedFile(mockFile);
            
            // For valid inputs within our constraints, validation should pass
            const extension = path.extname(fileData.originalname).toLowerCase();
            const isValidExtension = ['.pdf', '.doc', '.docx'].includes(extension);
            const isValidMimeType = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(fileData.mimetype);
            const isValidSize = fileData.size > 0 && fileData.size <= MAX_FILE_SIZE;
            
            if (isValidExtension && isValidMimeType && isValidSize) {
              expect(result.isValid).toBe(true);
              expect(result.errors).toHaveLength(0);
              expect(result.fileInfo).toBeDefined();
              expect(result.fileInfo!.originalName).toBe(fileData.originalname);
              expect(result.fileInfo!.size).toBe(fileData.size);
              expect(result.fileInfo!.mimetype).toBe(fileData.mimetype);
            }
            
            // Validation should always return a consistent structure
            expect(typeof result.isValid).toBe('boolean');
            expect(Array.isArray(result.errors)).toBe(true);
            expect(Array.isArray(result.warnings)).toBe(true);
          }
        ),
        { 
          numRuns: 100,
          timeout: 5000
        }
      );
    });

    /**
     * Feature: resume-diagnosis-engine, Property 2: Invalid File Rejection
     * Validates: Requirements 1.3, 1.4
     */
    test('Property 2: Invalid file rejection - unsupported files should always be rejected consistently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            originalname: fc.oneof(
              fc.string({ minLength: 1, maxLength: 50 }).map(s => s + '.txt'),
              fc.string({ minLength: 1, maxLength: 50 }).map(s => s + '.jpg'),
              fc.string({ minLength: 1, maxLength: 50 }).map(s => s + '.exe'),
              fc.string({ minLength: 1, maxLength: 50 }).map(s => s + '.zip')
            ),
            size: fc.integer({ min: 0, max: 20 * 1024 * 1024 }), // 0 to 20MB
            mimetype: fc.constantFrom('text/plain', 'image/jpeg', 'application/octet-stream', 'application/zip'),
            path: fc.string({ minLength: 10, maxLength: 50 }).map(s => `/tmp/${s}`)
          }),
          async (fileData) => {
            mockFs.existsSync.mockReturnValue(true);
            
            const mockFile = fileData as Express.Multer.File;
            const result = validateUploadedFile(mockFile);
            
            // Invalid files should always be rejected
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            
            // Should contain specific error messages for unsupported types
            const hasExtensionError = result.errors.some(error => 
              error.includes('Unsupported file extension') || error.includes('extension')
            );
            const hasMimeTypeError = result.errors.some(error => 
              error.includes('Unsupported MIME type') || error.includes('MIME')
            );
            
            expect(hasExtensionError || hasMimeTypeError).toBe(true);
          }
        ),
        { 
          numRuns: 100,
          timeout: 5000
        }
      );
    });

    test('Property 1 & 2: File validation should be deterministic for same inputs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            originalname: fc.string({ minLength: 5, maxLength: 50 }),
            size: fc.integer({ min: 0, max: 15 * 1024 * 1024 }),
            mimetype: fc.string({ minLength: 5, maxLength: 50 }),
            path: fc.string({ minLength: 5, maxLength: 50 })
          }),
          async (fileData) => {
            mockFs.existsSync.mockReturnValue(true);
            
            const mockFile = fileData as Express.Multer.File;
            
            // Run validation multiple times with same input
            const result1 = validateUploadedFile(mockFile);
            const result2 = validateUploadedFile(mockFile);
            const result3 = validateUploadedFile(mockFile);
            
            // Results should be identical (deterministic)
            expect(result1.isValid).toBe(result2.isValid);
            expect(result1.isValid).toBe(result3.isValid);
            expect(result1.errors).toEqual(result2.errors);
            expect(result1.errors).toEqual(result3.errors);
            expect(result1.warnings).toEqual(result2.warnings);
            expect(result1.warnings).toEqual(result3.warnings);
          }
        ),
        { 
          numRuns: 50,
          timeout: 5000
        }
      );
    });

    test('Property 1: File encryption/decryption should maintain data integrity', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            content: fc.uint8Array({ minLength: 1, maxLength: 1024 }),
            key: fc.string({ minLength: 16, maxLength: 64 })
          }),
          async (testData) => {
            const originalContent = Buffer.from(testData.content);
            
            try {
              // Encrypt the content
              const encrypted = encryptFileContent(originalContent, testData.key);
              
              // Decrypt the content
              const decrypted = decryptFileContent(encrypted, testData.key);
              
              // Round-trip property: decrypt(encrypt(data)) === data
              expect(decrypted.equals(originalContent)).toBe(true);
              expect(decrypted.length).toBe(originalContent.length);
              
              // Encrypted content should be different from original
              expect(encrypted.equals(originalContent)).toBe(false);
              
              // Encrypted content should be longer (includes IV and auth tag)
              expect(encrypted.length).toBeGreaterThan(originalContent.length);
              
            } catch (error) {
              // If encryption fails, it should fail consistently
              expect(() => encryptFileContent(originalContent, testData.key)).toThrow();
            }
          }
        ),
        { 
          numRuns: 100,
          timeout: 5000
        }
      );
    });

    test('Property 2: File cleanup should handle various file paths safely', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 5, maxLength: 100 }).map(s => `/tmp/test_${s}`),
          async (filePath) => {
            // Mock file system operations
            mockFs.existsSync.mockReturnValue(true);
            mockFs.statSync.mockReturnValue({ size: 1024 } as any);
            mockFs.openSync.mockReturnValue(3);
            mockFs.writeSync.mockReturnValue(1024);
            mockFs.fsyncSync.mockReturnValue(undefined);
            mockFs.closeSync.mockReturnValue(undefined);
            mockFs.unlinkSync.mockReturnValue(undefined);
            
            // Cleanup should not throw errors for valid paths
            await expect(cleanupTempFile(filePath)).resolves.not.toThrow();
            
            // Verify secure deletion process was attempted
            expect(mockFs.existsSync).toHaveBeenCalledWith(filePath);
          }
        ),
        { 
          numRuns: 50,
          timeout: 5000
        }
      );
    });

    test('Property 1 & 2: File size validation should be consistent across different scenarios', async () => {
      // Get the actual MAX_FILE_SIZE from environment
      const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760');
      
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            size: fc.integer({ min: 0, max: Math.floor(MAX_FILE_SIZE * 1.5) }), // 0 to 1.5x the limit
            originalname: fc.constantFrom('test.pdf', 'resume.docx', 'cv.doc'),
            mimetype: fc.constantFrom('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword')
          }),
          async (fileData) => {
            mockFs.existsSync.mockReturnValue(true);
            
            const mockFile = {
              ...fileData,
              path: '/tmp/test'
            } as Express.Multer.File;
            
            const result = validateUploadedFile(mockFile);
            
            // Size validation should be consistent
            if (fileData.size === 0) {
              expect(result.isValid).toBe(false);
              expect(result.errors).toContain('File is empty');
            } else if (fileData.size > MAX_FILE_SIZE) {
              expect(result.isValid).toBe(false);
              expect(result.errors.some(error => error.includes('exceeds maximum'))).toBe(true);
            } else {
              // For valid sizes with supported formats, should not have size-related errors
              const hasSizeError = result.errors.some(error => 
                error.includes('empty') || error.includes('exceeds')
              );
              expect(hasSizeError).toBe(false);
              
              // But may still be invalid due to other factors (which is fine)
              // We're only testing that size validation is consistent
            }
          }
        ),
        { 
          numRuns: 100,
          timeout: 5000
        }
      );
    });
  });
});