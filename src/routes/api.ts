
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { query } from '../database/connection';
import sessionService from '../services/sessionService';
import * as resumeService from '../services/resumeService';
import * as aiService from '../services/aiService';
import * as jobSearchService from '../services/jobSearch'; // Need to insure exports are correct
import { getAvailableProviders } from '../services/llmProvider';

const router = express.Router();

// Valid file types
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword'
];

// Multer setup
const upload = multer({
  dest: process.env.NODE_ENV === 'production' ? '/tmp' : 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and Word documents are allowed.'));
    }
  }
});

/**
 * GET /health - Check API health
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

/**
 * GET /config - Public configuration
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      env: process.env.NODE_ENV || 'development'
    }
  });
});

/**
 * GET /llm-providers - List available LLM providers
 */
router.get('/llm-providers', (req, res) => {
  const { getDefaultProvider } = require('../services/llmProvider');
  const services = getAvailableProviders();

  // Serialize for frontend (convert functions to values)
  const providers = services.map(p => ({
    name: p.name,
    displayName: p.displayName,
    available: p.isAvailable()
  }));

  res.json({
    success: true,
    data: {
      providers,
      default: getDefaultProvider()
    }
  });
});

/**
 * POST /extract-profile - Parse resume and extract profile
 */
router.post('/extract-profile', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No resume file uploaded' });
    }

    // 1. Parse Resume
    const resumeText = await resumeService.parseResume(req.file.path, req.file.mimetype);
    console.log(`[Parse] Resume parsed. Length: ${resumeText.length} chars`);

    if (resumeText.length < 50) {
      console.warn('[Parse] Resume text extremely short/empty');
    }

    // 2. Extract Profile
    const profile = await resumeService.extractProfileFromResume(resumeText);

    // 3. Create Session
    const timestamp = Date.now();
    const sessionId = crypto.createHash('md5').update(resumeText + timestamp).digest('hex');

    // 4. Store in Session Service (In-Memory)
    sessionService.set(sessionId, {
      id: sessionId,
      resumeText,
      profile,
      uploadedAt: new Date(timestamp),
      fileName: req.file.originalname
    });

    // 5. Store in Database (if available)
    try {
      await query(
        `INSERT INTO user_sessions (session_id, resume_text, file_name) VALUES ($1, $2, $3)
         ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()`,
        [sessionId, resumeText, req.file.originalname]
      );
    } catch (dbError) {
      console.warn('DB Session save failed (non-fatal):', dbError);
    }

    // Cleanup uploaded file
    fs.unlink(req.file.path, () => { });

    res.json({
      success: true,
      data: {
        sessionId,
        profile,
        resumeText: resumeText.substring(0, 1000) // Preview
      }
    });

  } catch (error: any) {
    console.error('Extraction error:', error);
    if (req.file) fs.unlink(req.file.path, () => { });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /analyze-match - Analyze resume against job description
 */
router.post('/analyze-match', upload.single('resume'), async (req, res) => {
  try {
    const jobDescription = req.body.jobDescription;
    const existingSessionId = req.body.sessionId;

    if (!jobDescription) {
      return res.status(400).json({ success: false, error: 'Job description is required' });
    }

    let resumeText = '';
    let sessionId = existingSessionId;

    // Handle new file upload OR existing session
    if (req.file) {
      resumeText = await resumeService.parseResume(req.file.path, req.file.mimetype);
      fs.unlink(req.file.path, () => { });

      // Create new session
      const timestamp = Date.now();
      sessionId = crypto.createHash('md5').update(resumeText + timestamp).digest('hex');

      // Extract profile for the new file
      const profile = await resumeService.extractProfileFromResume(resumeText);

      sessionService.set(sessionId, {
        id: sessionId,
        resumeText,
        profile,
        uploadedAt: new Date(timestamp),
        fileName: req.file.originalname
      });

    } else if (existingSessionId) {
      const session = sessionService.get(existingSessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found. Please upload resume again.' });
      }
      resumeText = session.resumeText;
    } else {
      return res.status(400).json({ success: false, error: 'No resume provided' });
    }

    // Perform Analysis
    const provider = req.body.provider || 'groq';
    const analysis = await aiService.analyzeMatch(resumeText, jobDescription, provider);

    // Save Analysis to DB
    const verificationToken = crypto.randomBytes(16).toString('hex');
    try {
      await query(
        `INSERT INTO analyses (session_id, job_description, match_score, analysis_json, verification_token)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, jobDescription, analysis.overallScore, JSON.stringify(analysis), verificationToken]
      );
    } catch (dbError) {
      console.warn('DB Analysis save failed:', dbError);
    }

    res.json({
      success: true,
      data: {
        sessionId,
        analysis,
        verificationToken
      }
    });

  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /search-jobs - Generate Boolean strings and Links
 */
router.post('/search-jobs', async (req, res) => {
  const { sessionId, jobTitle, location } = req.body;

  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Session required' });
  }

  const session = sessionService.get(sessionId);
  if (!session || !session.profile) {
    return res.status(404).json({ success: false, error: 'Session or profile not found' });
  }

  // Generate Search Links
  // @ts-ignore - Assuming generateJobSearchLinks exists in jobSearchService (we added it)
  const links = jobSearchService.generateJobSearchLinks(session.profile, jobTitle, location);

  // Generate Boolean String (Deep Search)
  const booleanSearch = jobSearchService.generateBooleanSearch({
    jobTitle: jobTitle || session.profile.currentTitle || 'Software Engineer',
    location: location || session.profile.location || 'Remote',
    locationType: 'any'
  });

  res.json({
    success: true,
    data: {
      links,
      booleanSearch
    }
  });
});

/**
 * POST /generate-cover-letter
 */
router.post('/generate-cover-letter', async (req, res) => {
  const { sessionId, jobTitle, companyName, jobDescription } = req.body;

  if (!sessionId || !jobDescription) {
    return res.status(400).json({ success: false, error: 'Session and JD required' });
  }

  const session = sessionService.get(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  try {
    // Determine which generator to use
    // Using simple one for generic request
    const coverLetter = await aiService.generateCoverLetter(
      session.resumeText,
      jobTitle || 'Role',
      companyName || 'Company',
      jobDescription
    );

    res.json({ success: true, data: { coverLetter } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /generate-specific-cover-letter - Advanced generation
 */
router.post('/generate-specific-cover-letter', async (req, res) => {
  const { sessionId, jobDescription, companyName, analysisData } = req.body;

  const session = sessionService.get(sessionId || '');
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

  try {
    // Research company first
    const companyResearch = await aiService.researchCompany(companyName);

    // Generate specialized letter
    const achievements = session.profile?.achievements || []; // Need to ensure profile has this or extract it
    const coverLetter = await aiService.generateSpecificCoverLetter(
      session.profile,
      session.resumeText,
      jobDescription,
      companyName,
      companyResearch,
      achievements,
      analysisData
    );

    res.json({ success: true, data: { coverLetter, companyResearch } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /generate-interview-prep
 */
router.post('/generate-interview-prep', async (req, res) => {
  const { sessionId, jobDescription, companyName, analysisData } = req.body;

  const session = sessionService.get(sessionId || '');
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

  try {
    const companyResearch = await aiService.researchCompany(companyName);
    const achievements = session.profile?.achievements || [];

    const questions = await aiService.generateInterviewPrep(
      session.profile,
      session.resumeText,
      jobDescription,
      companyName,
      companyResearch,
      achievements,
      analysisData
    );

    res.json({ success: true, data: { questions, companyResearch } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /optimize-resume
 */
router.post('/optimize-resume', async (req, res) => {
  const { sessionId, jobDescription } = req.body;
  const session = sessionService.get(sessionId || '');
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

  try {
    const optimization = await aiService.optimizeResume(session.resumeText, jobDescription);
    res.json({ success: true, data: { optimization } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// JOB TRACKING ROUTES
// ==========================================

router.post('/save-job', async (req, res) => {
  try {
    const id = await jobSearchService.addJobApplication({
      sessionId: req.body.sessionId,
      jobTitle: req.body.jobTitle,
      company: req.body.company,
      status: 'saved',
      appliedDate: new Date().toISOString(),
      jobUrl: req.body.jobUrl,
      location: req.body.location
    });
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/saved-jobs', async (req, res) => {
  try {
    const jobs = await jobSearchService.getApplications(req.query.sessionId as string);
    res.json({ success: true, data: { jobs } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/update-job-status', async (req, res) => {
  try {
    const success = await jobSearchService.updateApplicationStatus(
      req.body.jobId,
      req.body.sessionId,
      req.body.status,
      req.body.notes
    );
    res.json({ success });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
