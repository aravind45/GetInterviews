import { Router, Request, Response } from 'express';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { query } from '../database/connection';
import { logger } from '../utils/logger';
import { 
  generateBooleanSearch, 
  saveJobSearch, 
  getJobSearches,
  deleteJobSearch,
  addJobApplication,
  updateApplicationStatus,
  getApplications,
  getApplicationStats,
  deleteApplication,
  getQuickSearchUrls,
  ATS_PLATFORMS,
  JobSearchConfig,
  JobApplication
} from '../services/jobSearch';
import { z } from 'zod';

const router = Router();

// Minimum confidence score required to access job features
const MIN_CONFIDENCE_SCORE = 75;

/**
 * Middleware to check if user has qualifying diagnosis score
 */
const requireQualifyingScore = asyncHandler(async (req: Request, res: Response, next) => {
  const sessionId = req.params.sessionId || req.body.sessionId;
  
  if (!sessionId) {
    throw createError('Session ID required', 400);
  }
  
  // Check if user has a diagnosis with score >= 75
  const result = await query(
    `SELECT dr.overall_confidence, dr.is_competitive
     FROM diagnosis_results dr
     JOIN resume_analyses ra ON dr.analysis_id = ra.id
     WHERE ra.session_id = $1 AND ra.status = 'completed'
     ORDER BY dr.created_at DESC
     LIMIT 1`,
    [sessionId]
  );
  
  if (result.rows.length === 0) {
    return res.status(403).json({
      success: false,
      error: 'No diagnosis found. Please complete a resume analysis first.',
      code: 'NO_DIAGNOSIS'
    });
  }
  
  const { overall_confidence, is_competitive } = result.rows[0];
  
  if (overall_confidence < MIN_CONFIDENCE_SCORE) {
    return res.status(403).json({
      success: false,
      error: `Job search features require a diagnosis confidence score of ${MIN_CONFIDENCE_SCORE}+. Your current score is ${overall_confidence}.`,
      code: 'SCORE_TOO_LOW',
      currentScore: overall_confidence,
      requiredScore: MIN_CONFIDENCE_SCORE,
      suggestions: [
        'Review and implement the recommendations from your diagnosis',
        'Update your resume and run a new analysis',
        'Ensure your resume clearly matches your target job title'
      ]
    });
  }
  
  // Attach diagnosis info to request
  (req as any).diagnosisInfo = { 
    confidence: overall_confidence, 
    isCompetitive: is_competitive 
  };
  
  next();
});

// ============================================
// Boolean Search Generator
// ============================================

/**
 * POST /api/jobs/generate-search
 * Generate a Boolean search string for job hunting
 */
router.post('/generate-search', asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({
    jobTitle: z.string().min(2).max(100),
    location: z.string().max(100).default('remote'),
    locationType: z.enum(['remote', 'hybrid', 'onsite', 'any']).default('remote'),
    experienceLevel: z.enum(['entry', 'mid', 'senior', 'lead', 'executive']).optional(),
    platforms: z.array(z.string()).optional(),
    excludeKeywords: z.array(z.string()).optional(),
    includeKeywords: z.array(z.string()).optional()
  });
  
  const config = schema.parse(req.body) as JobSearchConfig;
  const search = generateBooleanSearch(config);
  
  res.json({
    success: true,
    data: {
      booleanString: search.booleanString,
      urls: {
        last24Hours: search.searchUrlLast24h,
        lastWeek: search.searchUrlLastWeek,
        allTime: search.searchUrl
      },
      platforms: search.platforms,
      tips: [
        'Click the 24-hour link daily for fresh postings',
        'Apply within 24-48 hours of posting for best results',
        'Customize your resume for each application'
      ]
    }
  });
}));

/**
 * GET /api/jobs/platforms
 * Get list of supported ATS platforms
 */
router.get('/platforms', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      platforms: Object.entries(ATS_PLATFORMS).map(([key, domain]) => ({
        id: key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        domain
      }))
    }
  });
});

/**
 * GET /api/jobs/quick-search/:jobTitle
 * Get quick search URLs for a job title
 */
router.get('/quick-search/:jobTitle', (req: Request, res: Response) => {
  const { jobTitle } = req.params;
  const urls = getQuickSearchUrls(decodeURIComponent(jobTitle));
  
  res.json({
    success: true,
    data: {
      jobTitle,
      urls,
      instruction: 'Add &tbs=qdr:d to any Google search URL to filter to last 24 hours'
    }
  });
});

// ============================================
// Saved Searches (requires qualifying score)
// ============================================

/**
 * POST /api/jobs/searches/:sessionId
 * Save a job search configuration
 */
router.post('/searches/:sessionId', requireQualifyingScore, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  const schema = z.object({
    jobTitle: z.string().min(2).max(100),
    location: z.string().max(100).default('remote'),
    locationType: z.enum(['remote', 'hybrid', 'onsite', 'any']).default('remote'),
    experienceLevel: z.enum(['entry', 'mid', 'senior', 'lead', 'executive']).optional(),
    platforms: z.array(z.string()).optional(),
    runDaily: z.boolean().optional()
  });
  
  const config = schema.parse(req.body);
  
  // Get diagnosis ID
  const diagResult = await query(
    `SELECT dr.id FROM diagnosis_results dr
     JOIN resume_analyses ra ON dr.analysis_id = ra.id
     WHERE ra.session_id = $1
     ORDER BY dr.created_at DESC LIMIT 1`,
    [sessionId]
  );
  
  const diagnosisId = diagResult.rows[0]?.id || null;
  
  const result = await saveJobSearch(sessionId, diagnosisId, config as JobSearchConfig);
  
  res.json({
    success: true,
    data: {
      searchId: result.id,
      ...result.search
    }
  });
}));

/**
 * GET /api/jobs/searches/:sessionId
 * Get all saved searches for a session
 */
router.get('/searches/:sessionId', requireQualifyingScore, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const searches = await getJobSearches(sessionId);
  
  res.json({
    success: true,
    data: { searches }
  });
}));

/**
 * DELETE /api/jobs/searches/:sessionId/:searchId
 * Delete a saved search
 */
router.delete('/searches/:sessionId/:searchId', requireQualifyingScore, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, searchId } = req.params;
  const deleted = await deleteJobSearch(searchId, sessionId);
  
  res.json({
    success: deleted,
    message: deleted ? 'Search deleted' : 'Search not found'
  });
}));

// ============================================
// Application Tracker (requires qualifying score)
// ============================================

/**
 * POST /api/jobs/applications/:sessionId
 * Add a new job application
 */
router.post('/applications/:sessionId', requireQualifyingScore, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  const schema = z.object({
    jobTitle: z.string().min(1).max(500),
    company: z.string().min(1).max(255),
    location: z.string().max(255).optional(),
    jobUrl: z.string().url().optional(),
    atsPlatform: z.string().max(100).optional(),
    status: z.enum(['saved', 'applied', 'screening', 'interviewing', 'offer', 'rejected', 'withdrawn', 'ghosted']).default('applied'),
    appliedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().split('T')[0]),
    notes: z.string().max(2000).optional(),
    resumeVersion: z.string().max(100).optional(),
    coverLetterUsed: z.boolean().optional(),
    referralSource: z.string().max(255).optional()
  });
  
  const data = schema.parse(req.body);
  
  const applicationId = await addJobApplication({
    sessionId,
    ...data
  } as JobApplication);
  
  res.json({
    success: true,
    data: {
      applicationId,
      message: 'Application tracked successfully'
    }
  });
}));

/**
 * GET /api/jobs/applications/:sessionId
 * Get all applications for a session
 */
router.get('/applications/:sessionId', requireQualifyingScore, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { status, from, to } = req.query;
  
  const applications = await getApplications(sessionId, {
    status: status as string,
    fromDate: from as string,
    toDate: to as string
  });
  
  res.json({
    success: true,
    data: { applications }
  });
}));

/**
 * GET /api/jobs/applications/:sessionId/stats
 * Get application statistics
 */
router.get('/applications/:sessionId/stats', requireQualifyingScore, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const stats = await getApplicationStats(sessionId);
  
  res.json({
    success: true,
    data: { stats }
  });
}));

/**
 * PATCH /api/jobs/applications/:sessionId/:applicationId
 * Update application status
 */
router.patch('/applications/:sessionId/:applicationId', requireQualifyingScore, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, applicationId } = req.params;
  
  const schema = z.object({
    status: z.enum(['saved', 'applied', 'screening', 'interviewing', 'offer', 'rejected', 'withdrawn', 'ghosted']),
    notes: z.string().max(2000).optional()
  });
  
  const { status, notes } = schema.parse(req.body);
  
  const updated = await updateApplicationStatus(applicationId, sessionId, status, notes);
  
  res.json({
    success: updated,
    message: updated ? 'Application updated' : 'Application not found'
  });
}));

/**
 * DELETE /api/jobs/applications/:sessionId/:applicationId
 * Delete an application
 */
router.delete('/applications/:sessionId/:applicationId', requireQualifyingScore, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, applicationId } = req.params;
  const deleted = await deleteApplication(applicationId, sessionId);
  
  res.json({
    success: deleted,
    message: deleted ? 'Application deleted' : 'Application not found'
  });
}));

/**
 * GET /api/jobs/check-eligibility/:sessionId
 * Check if user is eligible for job features
 */
router.get('/check-eligibility/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  const result = await query(
    `SELECT dr.overall_confidence, dr.is_competitive, ra.target_job_title
     FROM diagnosis_results dr
     JOIN resume_analyses ra ON dr.analysis_id = ra.id
     WHERE ra.session_id = $1 AND ra.status = 'completed'
     ORDER BY dr.created_at DESC
     LIMIT 1`,
    [sessionId]
  );
  
  if (result.rows.length === 0) {
    return res.json({
      success: true,
      data: {
        eligible: false,
        reason: 'No diagnosis found',
        currentScore: null,
        requiredScore: MIN_CONFIDENCE_SCORE
      }
    });
  }
  
  const { overall_confidence, is_competitive, target_job_title } = result.rows[0];
  const eligible = overall_confidence >= MIN_CONFIDENCE_SCORE;
  
  res.json({
    success: true,
    data: {
      eligible,
      currentScore: overall_confidence,
      requiredScore: MIN_CONFIDENCE_SCORE,
      isCompetitive: is_competitive,
      targetJobTitle: target_job_title,
      reason: eligible 
        ? 'You qualify for job search features!' 
        : `Score ${overall_confidence} is below required ${MIN_CONFIDENCE_SCORE}`,
      quickSearchUrls: eligible ? getQuickSearchUrls(target_job_title) : null
    }
  });
}));

export default router;
