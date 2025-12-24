import { z } from 'zod';

// ============================================
// Core Domain Types
// ============================================

/**
 * Severity Score: How much a problem reduces interview likelihood (1-10)
 */
export type SeverityScore = number; // 1-10

/**
 * Impact Score: How many job opportunities a problem affects (1-10)
 */
export type ImpactScore = number; // 1-10

/**
 * Confidence Score: System's certainty in diagnosis (0-100)
 */
export type ConfidenceScore = number; // 0-100

// ============================================
// Job Title Types
// ============================================

export interface CanonicalJobTitle {
  id: string;
  title: string;
  category: string;
  seniorityLevel: 'Entry' | 'Junior' | 'Mid' | 'Senior' | 'Lead' | 'Principal' | 'Executive';
  industry: string;
  variations: JobTitleVariation[];
  createdAt: Date;
  updatedAt: Date;
}

export interface JobTitleVariation {
  id: string;
  canonicalId: string;
  variation: string;
  confidenceScore: number;
}

export interface JobTitleNormalizationResult {
  originalTitle: string;
  canonicalTitle: string | null;
  confidence: ConfidenceScore;
  suggestions: string[];
  requiresSpecialization: boolean;
}

// ============================================
// Resume Types
// ============================================

export interface ResumeData {
  rawText: string;
  sections: ResumeSection[];
  metadata: ResumeMetadata;
  extractedAt: Date;
}

export interface ResumeSection {
  type: 'contact' | 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'other';
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

export interface ResumeMetadata {
  pageCount: number;
  wordCount: number;
  fileName: string;
  fileType: 'pdf' | 'doc' | 'docx';
  fileSize: number;
  processingTime: number;
}

// ============================================
// Diagnosis Types
// ============================================

export interface RootCause {
  id: string;
  title: string;
  description: string;
  category: RootCauseCategory;
  severityScore: SeverityScore;
  impactScore: ImpactScore;
  evidence: Evidence[];
  priority: number; // 1-5, where 1 is highest priority
}

export type RootCauseCategory = 
  | 'keyword_mismatch'
  | 'experience_gap'
  | 'skill_deficiency'
  | 'formatting_issue'
  | 'ats_compatibility'
  | 'quantification_missing'
  | 'relevance_issue'
  | 'career_progression'
  | 'education_mismatch'
  | 'other';

export interface Evidence {
  type: 'resume_section' | 'missing_keyword' | 'formatting' | 'market_data' | 'comparison';
  description: string;
  citation: string; // Exact text or reference from resume
  location?: string; // Section or line reference
  confidence: ConfidenceScore;
}

export interface ActionableRecommendation {
  id: string;
  title: string;
  description: string;
  implementationSteps: string[];
  expectedImpact: ImpactScore;
  difficulty: 'easy' | 'medium' | 'hard';
  timeEstimate: string;
  relatedRootCause: string; // Root cause ID
  priority: number; // 1-3, where 1 is highest priority
}

export interface DiagnosisResult {
  id: string;
  sessionId: string;
  targetJob: TargetJobInfo;
  rootCauses: RootCause[]; // Max 5, sorted by priority
  recommendations: ActionableRecommendation[]; // Max 3, sorted by priority
  overallConfidence: ConfidenceScore;
  confidenceExplanation: string;
  isCompetitive: boolean;
  processingMetadata: ProcessingMetadata;
  createdAt: Date;
  expiresAt: Date;
}

export interface TargetJobInfo {
  originalTitle: string;
  canonicalTitle: string;
  category: string;
  seniorityLevel: string;
  industry: string;
  jobDescription?: string;
  applicationCount?: number;
}

export interface ProcessingMetadata {
  resumeProcessingTime: number;
  analysisTime: number;
  totalTime: number;
  modelUsed: string;
  dataCompleteness: number; // 0-100
}

// ============================================
// Session Types
// ============================================

export interface UserSession {
  id: string;
  sessionToken: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export interface ResumeAnalysis {
  id: string;
  sessionId: string;
  fileHash: string;
  encryptedContent: Buffer;
  targetJobTitle: string;
  canonicalJobId?: string;
  status: AnalysisStatus;
  confidenceScore?: ConfidenceScore;
  createdAt: Date;
  expiresAt: Date;
  deletedAt?: Date;
}

export type AnalysisStatus = 
  | 'pending'
  | 'processing'
  | 'analyzing'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'deleted';

// ============================================
// API Request/Response Types
// ============================================

export interface UploadRequest {
  resume: Express.Multer.File;
  targetJobTitle: string;
  jobDescription?: string;
  applicationCount?: number;
}

export interface UploadResponse {
  success: boolean;
  data?: {
    sessionId: string;
    fileInfo: {
      originalName: string;
      size: number;
      type: string;
      pageCount: number;
    };
    targetJob: JobTitleNormalizationResult;
    uploadTime: Date;
  };
  error?: string;
  warnings?: string[];
}

export interface AnalyzeRequest {
  sessionId: string;
  targetJobTitle: string;
  jobDescription?: string;
  applicationCount?: number;
}

export interface AnalyzeResponse {
  success: boolean;
  data?: DiagnosisResult;
  error?: string;
  partialResults?: boolean;
}

export interface SessionResponse {
  success: boolean;
  data?: {
    sessionId: string;
    status: AnalysisStatus;
    createdAt: Date;
    expiresAt: Date;
  };
  error?: string;
}

// ============================================
// Validation Schemas
// ============================================

export const UploadRequestSchema = z.object({
  targetJobTitle: z.string()
    .min(2, 'Job title must be at least 2 characters')
    .max(100, 'Job title must be less than 100 characters'),
  jobDescription: z.string()
    .max(5000, 'Job description must be less than 5000 characters')
    .optional(),
  applicationCount: z.number()
    .int()
    .min(0)
    .max(10000)
    .optional(),
});

export const AnalyzeRequestSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format'),
  targetJobTitle: z.string()
    .min(2, 'Job title must be at least 2 characters')
    .max(100, 'Job title must be less than 100 characters'),
  jobDescription: z.string()
    .max(5000, 'Job description must be less than 5000 characters')
    .optional(),
  applicationCount: z.number()
    .int()
    .min(0)
    .max(10000)
    .optional(),
});

// ============================================
// Error Types
// ============================================

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class ProcessingError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 422, 'PROCESSING_ERROR', details);
    this.name = 'ProcessingError';
  }
}

export class TimeoutError extends AppError {
  constructor(message: string = 'Processing timeout exceeded') {
    super(message, 408, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}

// ============================================
// Configuration Types
// ============================================

export interface AppConfig {
  port: number;
  nodeEnv: string;
  database: {
    url: string;
    ssl: boolean;
  };
  redis: {
    url: string;
  };
  security: {
    jwtSecret: string;
    encryptionKey: string;
    adminKey: string;
  };
  groq: {
    apiKey: string;
    model: string;
  };
  limits: {
    maxFileSize: number;
    maxResumePages: number;
    uploadTimeout: number;
    analysisTimeout: number;
    maxProcessingTimeout: number;
  };
  dataRetention: {
    ttlHours: number;
    cleanupIntervalMinutes: number;
  };
}
