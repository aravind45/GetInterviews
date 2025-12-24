import { Router, Request, Response, NextFunction } from 'express';
import { uploadMiddleware, validateUploadedFile, cleanupTempFile, calculateFileHash } from '../middleware/fileUpload';
import { createError, asyncHandler } from '../middleware/errorHandler';
import { parseResume, extractKeyInfo } from '../components/ResumeParser';
import { normalizeJobTitle, getRoleTemplate, getCanonicalJobInfo } from '../components/JobTitleNormalizer';
import { analyzeResume, isGroqAvailable } from '../services/groq';
import { encrypt, generateSessionToken, hash } from '../services/encryption';
import { query, transaction } from '../database/connection';
import { cacheSet, cacheGet, cacheDelete } from '../cache/redis';
import { logger } from '../utils/logger';
import { 
  UploadRequestSchema, 
  AnalyzeRequestSchema, 
  DiagnosisResult,
  ValidationError,
  ProcessingError
} from '../types';

const router = Router();

// Data retention TTL (24 hours per Requirement 9.2)
const DATA_TTL_HOURS = parseInt(process.env.DATA_TTL_HOURS || '24');
const DATA_TTL_MS = DATA_TTL_HOURS * 60 * 60 * 1000;

/**
 * POST /api/upload
 * Upload resume and create analysis session
 * Implements Requirements 1, 2, 9, 10
 */
router.post('/upload', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  // Handle file upload with multer
  uploadMiddleware.single('resume')(req, res, async (err) => {
    const startTime = Date.now();
    let tempFilePath: string | undefined;
    
    try {
      // Handle multer errors
      if (err) {
        logger.error('Upload error:', err);
        return next(err);
      }
      
      // Validate file presence
      if (!req.file) {
        return next(new ValidationError('No file uploaded. Please select a resume file.'));
      }
      
      tempFilePath = req.file.path;
      
      // Validate file
      const validation = validateUploadedFile(req.file);
      if (!validation.isValid) {
        await cleanupTempFile(tempFilePath);
        return res.status(400).json({
          success: false,
          error: 'File validation failed',
          details: validation.errors,
          warnings: validation.warnings
        });
      }
      
      // Validate request body
      const bodyValidation = UploadRequestSchema.safeParse({
        targetJobTitle: req.body.targetJobTitle || req.body.targetJob,
        jobDescription: req.body.jobDescription,
        applicationCount: req.body.applicationCount ? parseInt(req.body.applicationCount) : undefined
      });
      
      if (!bodyValidation.success) {
        await cleanupTempFile(tempFilePath);
        return next(new ValidationError('Invalid request data', {
          errors: bodyValidation.error.errors
        }));
      }
      
      const { targetJobTitle, jobDescription, applicationCount } = bodyValidation.data;
      
      // Normalize job title (Requirement 2)
      const normalizedJob = await normalizeJobTitle(targetJobTitle);
      
      // Check if generic title needs specialization (Requirement 2.2)
      if (normalizedJob.requiresSpecialization && !normalizedJob.canonicalTitle) {
        await cleanupTempFile(tempFilePath);
        return res.status(400).json({
          success: false,
          error: 'Job title is too generic. Please be more specific.',
          suggestions: normalizedJob.suggestions,
          code: 'GENERIC_JOB_TITLE'
        });
      }
      
      // Parse resume (Requirement 1)
      const resumeData = await parseResume(
        tempFilePath,
        req.file.originalname,
        req.file.size
      );
      
      // Calculate file hash for deduplication
      const fileHash = calculateFileHash(tempFilePath);
      
      // Encrypt resume content (Requirement 9.1)
      const encryptedContent = encrypt(resumeData.rawText);
      
      // Create session and analysis record in transaction
      const sessionToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + DATA_TTL_MS);
      
      const result = await transaction(async (client) => {
        // Create user session
        const sessionResult = await client.query(
          `INSERT INTO user_sessions (session_token, ip_address, user_agent, expires_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [sessionToken, req.ip, req.get('User-Agent'), expiresAt]
        );
        const sessionId = sessionResult.rows[0].id;
        
        // Get canonical job ID if available
        let canonicalJobId = null;
        if (normalizedJob.canonicalTitle) {
          const jobInfo = await getCanonicalJobInfo(normalizedJob.canonicalTitle);
          canonicalJobId = jobInfo?.id || null;
        }
        
        // Create analysis record
        const analysisResult = await client.query(
          `INSERT INTO resume_analyses (
            session_id, file_hash, encrypted_content, original_filename,
            file_type, file_size, page_count, target_job_title, canonical_job_id,
            job_description, application_count, status, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
          RETURNING id`,
          [
            sessionId,
            fileHash,
            encryptedContent,
            req.file!.originalname,
            resumeData.metadata.fileType,
            resumeData.metadata.fileSize,
            resumeData.metadata.pageCount,
            targetJobTitle,
            canonicalJobId,
            jobDescription || null,
            applicationCount || null,
            expiresAt
          ]
        );
        
        return {
          sessionId,
          analysisId: analysisResult.rows[0].id
        };
      });
      
      // Cache session data
      await cacheSet(`session:${sessionToken}`, {
        sessionId: result.sessionId,
        analysisId: result.analysisId,
        createdAt: new Date().toISOString()
      }, DATA_TTL_HOURS * 3600);
      
      // Cleanup temp file
      await cleanupTempFile(tempFilePath);
      tempFilePath = undefined;
      
      const processingTime = Date.now() - startTime;
      
      logger.info('Upload successful', {
        sessionId: result.sessionId,
        analysisId: result.analysisId,
        fileName: req.file.originalname,
        processingTime
      });
      
      // Response
      res.json({
        success: true,
        data: {
          sessionId: result.sessionId,
          sessionToken,
          fileInfo: {
            originalName: resumeData.metadata.fileName,
            size: resumeData.metadata.fileSize,
            type: resumeData.metadata.fileType,
            pageCount: resumeData.metadata.pageCount,
            wordCount: resumeData.metadata.wordCount
          },
          targetJob: {
            original: targetJobTitle,
            canonical: normalizedJob.canonicalTitle,
            confidence: normalizedJob.confidence,
            requiresSpecialization: normalizedJob.requiresSpecialization,
            suggestions: normalizedJob.suggestions
          },
          uploadTime: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
          processingTime
        },
        warnings: validation.warnings,
        message: 'Resume uploaded successfully. Ready for analysis.'
      });
      
    } catch (error) {
      // Cleanup on error
      if (tempFilePath) {
        await cleanupTempFile(tempFilePath);
      }
      next(error);
    }
  });
}));

/**
 * POST /api/analyze
 * Run AI diagnosis on uploaded resume
 * Implements Requirements 3, 4, 5, 6
 */
router.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  // Validate request
  const validation = AnalyzeRequestSchema.safeParse(req.body);
  if (!validation.success) {
    throw new ValidationError('Invalid request', { errors: validation.error.errors });
  }
  
  const { sessionId, targetJobTitle, jobDescription, applicationCount } = validation.data;
  
  // Check Groq availability
  if (!isGroqAvailable()) {
    throw new ProcessingError('AI analysis service is not available');
  }
  
  // Get analysis record
  const analysisResult = await query(
    `SELECT ra.*, us.session_token
     FROM resume_analyses ra
     JOIN user_sessions us ON ra.session_id = us.id
     WHERE ra.session_id = $1 AND ra.status != 'deleted' AND ra.expires_at > NOW()
     ORDER BY ra.created_at DESC
     LIMIT 1`,
    [sessionId]
  );
  
  if (analysisResult.rows.length === 0) {
    throw new ValidationError('Session not found or expired');
  }
  
  const analysis = analysisResult.rows[0];
  
  // Check if already analyzed
  if (analysis.status === 'completed') {
    const existingResult = await query(
      `SELECT * FROM diagnosis_results WHERE analysis_id = $1`,
      [analysis.id]
    );
    
    if (existingResult.rows.length > 0) {
      // Return cached result
      const diagnosis = await buildDiagnosisResult(analysis.id, sessionId);
      return res.json({
        success: true,
        data: diagnosis,
        cached: true
      });
    }
  }
  
  // Update status to processing
  await query(
    `UPDATE resume_analyses SET status = 'processing', processing_started_at = NOW() WHERE id = $1`,
    [analysis.id]
  );
  
  try {
    // Decrypt resume content
    const { decryptToString } = require('../services/encryption');
    const resumeText = decryptToString(analysis.encrypted_content);
    
    // Parse resume data for analysis
    const resumeData = {
      rawText: resumeText,
      sections: [], // We'd need to re-parse or store sections
      metadata: {
        pageCount: analysis.page_count,
        wordCount: resumeText.split(/\s+/).length,
        fileName: analysis.original_filename,
        fileType: analysis.file_type,
        fileSize: analysis.file_size,
        processingTime: 0
      },
      extractedAt: new Date()
    };
    
    // Normalize job title
    const normalizedJob = await normalizeJobTitle(targetJobTitle);
    const canonicalTitle = normalizedJob.canonicalTitle || targetJobTitle;
    
    // Get role template
    const roleTemplate = await getRoleTemplate(canonicalTitle);
    const jobInfo = await getCanonicalJobInfo(canonicalTitle);
    
    // Update status to analyzing
    await query(
      `UPDATE resume_analyses SET status = 'analyzing' WHERE id = $1`,
      [analysis.id]
    );
    
    // Run AI analysis (Requirement 3)
    const aiResult = await analyzeResume(
      resumeData,
      {
        title: canonicalTitle,
        category: jobInfo?.category || 'General',
        seniorityLevel: jobInfo?.seniorityLevel || 'Mid',
        requiredSkills: roleTemplate?.requiredSkills || [],
        requiredKeywords: roleTemplate?.requiredKeywords || []
      },
      jobDescription || analysis.job_description
    );
    
    // Store results in database
    await transaction(async (client) => {
      // Create diagnosis result
      const diagnosisResult = await client.query(
        `INSERT INTO diagnosis_results (
          analysis_id, overall_confidence, confidence_explanation,
          is_competitive, data_completeness, model_used,
          resume_processing_time, analysis_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          analysis.id,
          aiResult.overallConfidence,
          aiResult.confidenceExplanation,
          aiResult.isCompetitive,
          aiResult.dataCompleteness,
          process.env.GROQ_MODEL || 'llama3-8b-8192',
          analysis.processing_time || 0,
          Date.now() - startTime
        ]
      );
      const diagnosisId = diagnosisResult.rows[0].id;
      
      // Store root causes (max 5, Requirement 4)
      for (const rootCause of aiResult.rootCauses) {
        const rcResult = await client.query(
          `INSERT INTO root_causes (
            diagnosis_id, title, description, category,
            severity_score, impact_score, priority
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id`,
          [
            diagnosisId,
            rootCause.title,
            rootCause.description,
            rootCause.category,
            rootCause.severityScore,
            rootCause.impactScore,
            rootCause.priority
          ]
        );
        
        // Store evidence
        for (const evidence of rootCause.evidence) {
          await client.query(
            `INSERT INTO evidence (
              root_cause_id, type, description, citation, location, confidence
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              rcResult.rows[0].id,
              evidence.type,
              evidence.description,
              evidence.citation,
              evidence.location || null,
              evidence.confidence
            ]
          );
        }
      }
      
      // Store recommendations (max 3, Requirement 5)
      for (const rec of aiResult.recommendations) {
        // Find related root cause ID
        let relatedRcId = null;
        if (rec.relatedRootCause) {
          const rcMatch = await client.query(
            `SELECT id FROM root_causes WHERE diagnosis_id = $1 AND title ILIKE $2 LIMIT 1`,
            [diagnosisId, `%${rec.relatedRootCause}%`]
          );
          if (rcMatch.rows.length > 0) {
            relatedRcId = rcMatch.rows[0].id;
          }
        }
        
        await client.query(
          `INSERT INTO recommendations (
            diagnosis_id, root_cause_id, title, description,
            implementation_steps, expected_impact, difficulty, time_estimate, priority
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            diagnosisId,
            relatedRcId,
            rec.title,
            rec.description,
            rec.implementationSteps,
            rec.expectedImpact,
            rec.difficulty,
            rec.timeEstimate,
            rec.priority
          ]
        );
      }
      
      // Update analysis status
      await client.query(
        `UPDATE resume_analyses 
         SET status = 'completed', 
             confidence_score = $1,
             processing_completed_at = NOW()
         WHERE id = $2`,
        [aiResult.overallConfidence, analysis.id]
      );
    });
    
    // Build and return diagnosis result
    const diagnosis = await buildDiagnosisResult(analysis.id, sessionId);
    
    const totalTime = Date.now() - startTime;
    logger.info('Analysis completed', {
      sessionId,
      analysisId: analysis.id,
      confidence: aiResult.overallConfidence,
      rootCauses: aiResult.rootCauses.length,
      recommendations: aiResult.recommendations.length,
      totalTime
    });
    
    res.json({
      success: true,
      data: diagnosis
    });
    
  } catch (error) {
    // Update status to failed
    await query(
      `UPDATE resume_analyses SET status = 'failed', error_message = $1 WHERE id = $2`,
      [error instanceof Error ? error.message : 'Unknown error', analysis.id]
    );
    throw error;
  }
}));

/**
 * GET /api/session/:sessionId
 * Get session and analysis status
 */
router.get('/session/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  const result = await query(
    `SELECT ra.id, ra.status, ra.confidence_score, ra.created_at, ra.expires_at,
            ra.original_filename, ra.target_job_title, ra.page_count,
            us.is_active
     FROM resume_analyses ra
     JOIN user_sessions us ON ra.session_id = us.id
     WHERE ra.session_id = $1 AND ra.expires_at > NOW()
     ORDER BY ra.created_at DESC
     LIMIT 1`,
    [sessionId]
  );
  
  if (result.rows.length === 0) {
    throw new ValidationError('Session not found or expired');
  }
  
  const analysis = result.rows[0];
  
  res.json({
    success: true,
    data: {
      sessionId,
      analysisId: analysis.id,
      status: analysis.status,
      fileName: analysis.original_filename,
      targetJob: analysis.target_job_title,
      pageCount: analysis.page_count,
      confidence: analysis.confidence_score,
      createdAt: analysis.created_at,
      expiresAt: analysis.expires_at,
      isActive: analysis.is_active
    }
  });
}));

/**
 * GET /api/results/:sessionId
 * Get diagnosis results
 */
router.get('/results/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  // Get analysis ID
  const analysisResult = await query(
    `SELECT id, status FROM resume_analyses 
     WHERE session_id = $1 AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );
  
  if (analysisResult.rows.length === 0) {
    throw new ValidationError('Session not found or expired');
  }
  
  const { id: analysisId, status } = analysisResult.rows[0];
  
  if (status !== 'completed') {
    return res.json({
      success: false,
      error: 'Analysis not completed',
      status
    });
  }
  
  const diagnosis = await buildDiagnosisResult(analysisId, sessionId);
  
  res.json({
    success: true,
    data: diagnosis
  });
}));

/**
 * DELETE /api/session/:sessionId
 * Delete session and all associated data (Requirement 9.5)
 */
router.delete('/session/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  // Get session
  const sessionResult = await query(
    `SELECT id FROM user_sessions WHERE id = $1`,
    [sessionId]
  );
  
  if (sessionResult.rows.length === 0) {
    throw new ValidationError('Session not found');
  }
  
  // Delete session (cascades to analysis and results)
  await query(`DELETE FROM user_sessions WHERE id = $1`, [sessionId]);
  
  // Clear cache
  await cacheDelete(`session:${sessionId}`);
  
  // Generate deletion confirmation
  const { generateDeletionToken } = require('../services/encryption');
  const confirmationToken = generateDeletionToken();
  
  // Store deletion confirmation
  await query(
    `INSERT INTO deletion_confirmations (session_id, analysis_id, confirmation_token)
     VALUES ($1, $1, $2)`,
    [sessionId, confirmationToken]
  );
  
  logger.info('Session deleted', { sessionId });
  
  res.json({
    success: true,
    message: 'Session and all associated data have been deleted',
    confirmationToken
  });
}));

/**
 * Helper: Build diagnosis result from database
 */
async function buildDiagnosisResult(analysisId: string, sessionId: string): Promise<DiagnosisResult> {
  // Get diagnosis
  const diagResult = await query(
    `SELECT * FROM diagnosis_results WHERE analysis_id = $1`,
    [analysisId]
  );
  
  if (diagResult.rows.length === 0) {
    throw new ProcessingError('Diagnosis results not found');
  }
  
  const diag = diagResult.rows[0];
  
  // Get root causes with evidence
  const rcResult = await query(
    `SELECT rc.*, json_agg(e.*) as evidence
     FROM root_causes rc
     LEFT JOIN evidence e ON e.root_cause_id = rc.id
     WHERE rc.diagnosis_id = $1
     GROUP BY rc.id
     ORDER BY rc.priority`,
    [diag.id]
  );
  
  // Get recommendations
  const recResult = await query(
    `SELECT * FROM recommendations WHERE diagnosis_id = $1 ORDER BY priority`,
    [diag.id]
  );
  
  // Get analysis info
  const analysisResult = await query(
    `SELECT ra.*, c.title as canonical_title, c.category, c.seniority_level, c.industry
     FROM resume_analyses ra
     LEFT JOIN canonical_job_titles c ON ra.canonical_job_id = c.id
     WHERE ra.id = $1`,
    [analysisId]
  );
  
  const analysis = analysisResult.rows[0];
  
  return {
    id: diag.id,
    sessionId,
    targetJob: {
      originalTitle: analysis.target_job_title,
      canonicalTitle: analysis.canonical_title || analysis.target_job_title,
      category: analysis.category || 'General',
      seniorityLevel: analysis.seniority_level || 'Mid',
      industry: analysis.industry || 'Technology',
      jobDescription: analysis.job_description,
      applicationCount: analysis.application_count
    },
    rootCauses: rcResult.rows.map(rc => ({
      id: rc.id,
      title: rc.title,
      description: rc.description,
      category: rc.category,
      severityScore: rc.severity_score,
      impactScore: rc.impact_score,
      evidence: (rc.evidence || []).filter((e: any) => e !== null).map((e: any) => ({
        type: e.type,
        description: e.description,
        citation: e.citation,
        location: e.location,
        confidence: e.confidence
      })),
      priority: rc.priority
    })),
    recommendations: recResult.rows.map(rec => ({
      id: rec.id,
      title: rec.title,
      description: rec.description,
      implementationSteps: rec.implementation_steps,
      expectedImpact: rec.expected_impact,
      difficulty: rec.difficulty,
      timeEstimate: rec.time_estimate,
      relatedRootCause: rec.root_cause_id,
      priority: rec.priority
    })),
    overallConfidence: diag.overall_confidence,
    confidenceExplanation: diag.confidence_explanation,
    isCompetitive: diag.is_competitive,
    processingMetadata: {
      resumeProcessingTime: diag.resume_processing_time,
      analysisTime: diag.analysis_time,
      totalTime: diag.resume_processing_time + diag.analysis_time,
      modelUsed: diag.model_used,
      dataCompleteness: diag.data_completeness
    },
    createdAt: diag.created_at,
    expiresAt: analysis.expires_at
  };
}

export default router;
