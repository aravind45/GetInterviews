import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Groq from 'groq-sdk';
// @ts-ignore
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { connectDatabase, getPool } from './database/connection';
import icaRoutes from './routes/ica';
import { initializeProviders } from './services/llmProvider';

const app = express();

// Initialize database connection
connectDatabase().catch(err => {
  console.error('Failed to connect to database:', err);
});

// Initialize LLM providers (Groq and Claude)
initializeProviders();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// In-memory storage
const sessions: Record<string, any> = {};

/**
 * Parse resume file
 */
async function parseResume(filePath: string, mimeType: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  
  if (mimeType === 'application/pdf' || filePath.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return data.text;
  }
  
  if (mimeType.includes('word') || filePath.endsWith('.docx') || filePath.endsWith('.doc')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  
  throw new Error('Unsupported file format');
}

/**
 * Extract structured profile from resume text
 */
async function extractProfileFromResume(resumeText: string): Promise<any> {
  try {
    const prompt = `Extract a structured profile from this resume. Return ONLY JSON:

RESUME:
${resumeText.substring(0, 6000)}

{
  "name": "<full name>",
  "email": "<email>",
  "location": "<city, state>",
  "currentTitle": "<most recent job title>",
  "yearsExperience": <number>,
  "experienceLevel": "ENTRY|MID|SENIOR|LEAD",
  "targetTitles": ["<job titles they could apply for>"],
  "hardSkills": ["<technical skills>"],
  "softSkills": ["<soft skills>"],
  "education": {"degree": "<degree>", "field": "<field>", "school": "<school>"},
  "summary": "<2-3 sentence professional summary>",
  "searchKeywords": ["<keywords for job search>"]
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Profile extraction error:', error);
    return null;
  }
}

// ============================================================
// FEATURE 1: RESUME ANALYSIS (Deep Diagnosis)
// ============================================================

app.post('/api/analyze-match', upload.single('resume'), async (req, res) => {
  let filePath = '';

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Resume file is required' });
    }

    const jobDescription = req.body.jobDescription;
    if (!jobDescription || jobDescription.length < 50) {
      return res.status(400).json({ success: false, error: 'Job description is required (minimum 50 characters)' });
    }

    filePath = req.file.path;
    const resumeText = await parseResume(filePath, req.file.mimetype);

    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({ success: false, error: 'Could not extract text from resume' });
    }

    const sessionToken = req.body.sessionId || 'sess_' + Math.random().toString(36).substring(2);
    const pool = getPool();

    // Get or create session UUID
    let sessionResult = await pool.query(
      'SELECT id FROM user_sessions WHERE session_token = $1',
      [sessionToken]
    );

    let sessionUuid;
    if (sessionResult.rows.length === 0) {
      const newSession = await pool.query(
        `INSERT INTO user_sessions (session_token, ip_address, user_agent, expires_at, is_active)
         VALUES ($1, $2, $3, NOW() + INTERVAL '30 days', true)
         RETURNING id`,
        [sessionToken, req.ip || '127.0.0.1', req.get('user-agent') || 'Unknown']
      );
      sessionUuid = newSession.rows[0].id;
    } else {
      sessionUuid = sessionResult.rows[0].id;
    }

    // Calculate file hash for deduplication and caching
    const fileBuffer = fs.readFileSync(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const jobHash = crypto.createHash('sha256').update(jobDescription).digest('hex');

    // Check if we already analyzed this exact resume + job combo
    const cacheCheck = await pool.query(
      `SELECT dr.* FROM diagnosis_results dr
       JOIN resume_analyses ra ON dr.analysis_id = ra.id
       WHERE ra.session_id = $1 AND ra.file_hash = $2
       AND ra.job_description = $3
       AND ra.created_at > NOW() - INTERVAL '7 days'
       ORDER BY ra.created_at DESC LIMIT 1`,
      [sessionUuid, fileHash, jobDescription]
    );

    if (cacheCheck.rows.length > 0) {
      console.log('✅ Returning cached analysis');
      const cached = cacheCheck.rows[0];
      return res.json({
        success: true,
        data: JSON.parse(cached.confidence_explanation),
        sessionId: sessionToken,
        cached: true
      });
    }

    // Store for in-memory session (backward compatibility)
    sessions[sessionToken] = sessions[sessionToken] || {};
    sessions[sessionToken].resumeText = resumeText;

    const prompt = `You are a brutally honest career coach who has reviewed 10,000+ resumes and knows exactly why people don't get interviews.

RESUME:
${resumeText.substring(0, 5000)}

JOB DESCRIPTION:
${jobDescription.substring(0, 4000)}

Analyze like you're the hiring manager with 200 applications to review. Be specific, honest, helpful.

Return ONLY this JSON:
{
  "overallScore": <0-100>,
  "verdict": "STRONG MATCH|MODERATE MATCH|WEAK MATCH|LONG SHOT|NOT A FIT",
  "summary": "<2-3 sentences - brutal truth about their chances>",
  
  "sixSecondScan": {
    "firstImpression": "<what recruiter notices in first 6 seconds>",
    "standoutElements": ["<what's good>"],
    "immediateRedFlags": ["<what makes them move to next resume>"],
    "wouldReadMore": true/false,
    "whyOrWhyNot": "<explanation>"
  },
  
  "atsAnalysis": {
    "score": <0-100>,
    "likelyToPass": true/false,
    "keywordsFound": ["<matches from JD>"],
    "criticalKeywordsMissing": ["<will auto-reject>"],
    "suggestionToPassATS": "<specific fix>"
  },
  
  "qualificationGap": {
    "experienceRequired": "<what JD asks>",
    "experienceYouHave": "<what resume shows>",
    "gapAssessment": "OVER_QUALIFIED|GOOD_MATCH|SLIGHTLY_UNDER|SIGNIFICANTLY_UNDER",
    "yearsGap": "<e.g., 'JD wants 5+, you show ~3'>",
    "howToCloseGap": "<if possible>"
  },
  
  "dealbreakers": [
    {"requirement": "<from JD>", "status": "MISSING|WEAK", "urgentFix": "<what to do>"}
  ],
  
  "strengths": [
    {"skill": "<what you have>", "howItHelps": "<why matters>", "howToHighlight": "<make visible>"}
  ],
  
  "hiddenRedFlags": [
    {"issue": "<concern>", "whatRecruiterThinks": "<assumption>", "howToAddress": "<fix>"}
  ],
  
  "competitorAnalysis": {
    "typicalWinningCandidate": "<who gets this job>",
    "howYouCompare": "<honest comparison>",
    "yourCompetitiveAdvantage": "<what you have>",
    "yourBiggestDisadvantage": "<where you fall short>"
  },
  
  "applicationStrategy": {
    "shouldYouApply": true/false,
    "confidenceLevel": "HIGH|MEDIUM|LOW",
    "bestApproach": "APPLY_NOW|CUSTOMIZE_HEAVILY|GET_REFERRAL|SKIP",
    "timeWorthInvesting": "<how much time>"
  },
  
  "resumeRewrites": [
    {"section": "<part>", "currentText": "<weak>", "rewrittenText": "<better>", "whyBetter": "<reason>"}
  ],
  
  "prioritizedActionPlan": {
    "before_applying": ["<must do>"],
    "quick_wins": ["<easy fixes>"],
    "worth_the_effort": ["<harder but valuable>"],
    "long_term": ["<for future>"]
  },
  
  "interviewProbability": {
    "percentage": <0-100>,
    "reasoning": "<why>",
    "whatWouldIncreaseOdds": "<specific change>"
  },
  
  "bottomLine": {
    "honestAssessment": "<real talk>",
    "oneThingToFix": "<most important>",
    "encouragement": "<something positive>"
  }
}`;

    // Get LLM provider from request or use default
    const { getProvider, getDefaultProvider } = require('./services/llmProvider');
    const selectedProvider = req.body.llmProvider || getDefaultProvider();
    const llmService = getProvider(selectedProvider);

    let responseText = '';
    let modelUsed = '';

    if (selectedProvider === 'claude') {
      // Use Claude
      const Anthropic = require('@anthropic-ai/sdk').default;
      const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const claudeModel = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

      const response = await claude.messages.create({
        model: claudeModel,
        max_tokens: 4000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      });

      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      modelUsed = claudeModel;
    } else {
      // Use Groq (default)
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 3000
      });

      responseText = completion.choices[0]?.message?.content || '';
      modelUsed = 'llama-3.1-8b-instant';
    }
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('Failed to analyze');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    // Extract profile for skill-based scoring
    const profileExtract = await extractProfileFromResume(resumeText);
    const profileSkills = profileExtract?.hardSkills || [];

    // Store AI's original score before we override it
    const aiOriginalScore = analysis.overallScore || 0;

    // Calculate REALISTIC match score based on skills (not AI's inflated score)
    const jobText = jobDescription.toLowerCase();
    let matchedSkills = 0;
    const matchingSkills: string[] = [];

    profileSkills.forEach((skill: string) => {
      const skillLower = skill.toLowerCase();
      // Match if skill appears in job description OR if skill is partial match
      if (jobText.includes(skillLower) ||
          jobText.includes(skillLower.replace(/\.js$/, '')) || // Match "React.js" to "React"
          jobText.split(/\W+/).some((word: string) => word === skillLower)) { // Match whole words
        matchedSkills++;
        matchingSkills.push(skill);
      }
    });

    // Calculate score with more reasonable baseline
    // If NO skills match, use AI's assessment but cap at 40%
    // If skills match, use skill-based scoring
    const realisticScore = profileSkills.length > 0 && matchedSkills > 0
      ? Math.min(95, Math.round((matchedSkills / profileSkills.length) * 100))
      : profileSkills.length > 0 && matchedSkills === 0
        ? Math.min(40, aiOriginalScore || 20) // Use AI's score but cap at 40%
        : 30;

    // Override AI's inflated overallScore with realistic skill-based score
    analysis.overallScore = realisticScore;
    analysis.matchingSkills = matchingSkills;
    analysis.skillMatchPercentage = realisticScore;
    analysis.aiOriginalScore = aiOriginalScore; // Keep AI's original for comparison

    // Also override interview probability to match realistic score
    if (analysis.interviewProbability) {
      analysis.interviewProbability.percentage = realisticScore;
    }

    // Save resume to database
    const encryptedContent = Buffer.from(resumeText); // In production, encrypt this
    const resumeAnalysis = await pool.query(
      `INSERT INTO resume_analyses
       (session_id, file_hash, encrypted_content, original_filename, file_type, file_size,
        target_job_title, job_description, llm_provider, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', NOW() + INTERVAL '30 days')
       RETURNING id`,
      [
        sessionUuid,
        fileHash,
        encryptedContent,
        req.file.originalname,
        path.extname(req.file.originalname).substring(1),
        req.file.size,
        'General Position', // Could extract from JD
        jobDescription,
        selectedProvider
      ]
    );

    const analysisId = resumeAnalysis.rows[0].id;

    // Cache the analysis result
    await pool.query(
      `INSERT INTO diagnosis_results
       (analysis_id, overall_confidence, confidence_explanation, is_competitive, data_completeness,
        model_used, llm_provider, resume_processing_time, analysis_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        analysisId,
        realisticScore,
        JSON.stringify(analysis),
        realisticScore >= 70,
        100,
        modelUsed,
        selectedProvider,
        0,
        0
      ]
    );

    console.log(`✅ Saved analysis to database with realistic score: ${realisticScore}%`);

    // Add provider info to response
    analysis.llmProvider = selectedProvider;
    analysis.modelUsed = modelUsed;

    res.json({ success: true, data: analysis, sessionId: sessionToken });

  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// ============================================================
// FEATURE 2: PROFILE EXTRACTION (for Job Search)
// ============================================================

app.post('/api/extract-profile', upload.single('resume'), async (req, res) => {
  let filePath = '';
  
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Resume file required' });
    }
    
    filePath = req.file.path;
    const resumeText = await parseResume(filePath, req.file.mimetype);

    const prompt = `Extract a structured profile from this resume. Return ONLY JSON:

RESUME:
${resumeText.substring(0, 6000)}

{
  "name": "<full name>",
  "email": "<email>",
  "location": "<city, state>",
  "currentTitle": "<most recent job title>",
  "yearsExperience": <number>,
  "experienceLevel": "ENTRY|MID|SENIOR|LEAD",
  "targetTitles": ["<job titles they could apply for>"],
  "hardSkills": ["<technical skills>"],
  "softSkills": ["<soft skills>"],
  "education": {"degree": "<degree>", "field": "<field>", "school": "<school>"},
  "summary": "<2-3 sentence professional summary>",
  "searchKeywords": ["<keywords for job search>"]
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) throw new Error('Failed to parse profile');

    const profile = JSON.parse(jsonMatch[0]);

    // Use stable session ID based on profile email if available
    let sessionId;
    if (profile.email) {
      const cleanEmail = Buffer.from(profile.email).toString('base64').replace(/[=\/\+]/g, '').toLowerCase();
      sessionId = 'sess_' + cleanEmail.substring(0, 15);
    } else {
      sessionId = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    sessions[sessionId] = { profile, resumeText, jobs: [], savedJobs: [] };

    res.json({ success: true, data: { sessionId, profile, resumeText } });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// Initialize session with existing profile (for auto-loaded profiles)
app.post('/api/init-session', async (req, res) => {
  try {
    const { email, profile, resumeText } = req.body;

    if (!email || !profile) {
      return res.status(400).json({ success: false, error: 'Email and profile required' });
    }

    // Create stable session ID from email
    const cleanEmail = Buffer.from(email).toString('base64').replace(/[=\/\+]/g, '').toLowerCase();
    const sessionId = 'sess_' + cleanEmail.substring(0, 15);

    // Initialize or update session
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        profile,
        resumeText: resumeText || '',
        jobs: [],
        savedJobs: []
      };
      console.log(`✅ Session initialized for ${email}: ${sessionId}`);
    } else {
      console.log(`✓ Session already exists for ${email}: ${sessionId}`);
    }

    res.json({ success: true, data: { sessionId } });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE 3: JOB SEARCH - Smart Links + Optional Real API
// ============================================================

// Generate smart job board search URLs
function generateJobSearchLinks(profile: any, customQuery?: string, customLocation?: string) {
  const title = customQuery || profile.targetTitles?.[0] || profile.currentTitle || 'software engineer';
  const location = customLocation || profile.location || '';
  const skills = (profile.hardSkills || []).slice(0, 3).join(' ');
  
  const encode = encodeURIComponent;
  
  return {
    primary: [
      {
        name: 'LinkedIn',
        icon: '💼',
        url: `https://www.linkedin.com/jobs/search/?keywords=${encode(title)}&location=${encode(location)}`,
        description: 'Most professional jobs'
      },
      {
        name: 'Indeed',
        icon: '🔍',
        url: `https://www.indeed.com/jobs?q=${encode(title)}&l=${encode(location)}`,
        description: 'Largest job board'
      },
      {
        name: 'Glassdoor',
        icon: '🚪',
        url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encode(title)}&locT=C&locKeyword=${encode(location)}`,
        description: 'Jobs + salary info'
      }
    ],
    secondary: [
      {
        name: 'Google Jobs',
        icon: '🔎',
        url: `https://www.google.com/search?q=${encode(title + ' jobs ' + location)}&ibp=htl;jobs`
      },
      {
        name: 'ZipRecruiter',
        icon: '⚡',
        url: `https://www.ziprecruiter.com/jobs-search?search=${encode(title)}&location=${encode(location)}`
      },
      {
        name: 'Dice (Tech)',
        icon: '🎲',
        url: `https://www.dice.com/jobs?q=${encode(title)}&location=${encode(location)}`
      },
      {
        name: 'Wellfound (Startups)',
        icon: '🚀',
        url: `https://wellfound.com/jobs?query=${encode(title)}`
      }
    ],
    bySkill: (profile.hardSkills || []).slice(0, 4).map((skill: string) => ({
      skill,
      url: `https://www.linkedin.com/jobs/search/?keywords=${encode(skill + ' ' + profile.experienceLevel)}&location=${encode(location)}`
    })),
    byTitle: (profile.targetTitles || []).slice(0, 4).map((t: string) => ({
      title: t,
      linkedin: `https://www.linkedin.com/jobs/search/?keywords=${encode(t)}&location=${encode(location)}`,
      indeed: `https://www.indeed.com/jobs?q=${encode(t)}&l=${encode(location)}`
    }))
  };
}

app.post('/api/search-jobs', async (req, res) => {
  try {
    const { sessionId, searchQuery, location, useRealApi } = req.body;
    const session = sessions[sessionId];
    
    if (!session) {
      return res.status(400).json({ success: false, error: 'Session not found. Upload resume first.' });
    }

    // Generate smart search links (always available)
    const searchLinks = generateJobSearchLinks(session.profile, searchQuery, location);
    
    // If JSearch API key is provided and useRealApi is true, fetch real jobs
    const JSEARCH_API_KEY = process.env.JSEARCH_API_KEY;
    let realJobs: any[] = [];
    
    if (JSEARCH_API_KEY && useRealApi !== false) {
      try {
        const query = searchQuery || session.profile.targetTitles?.[0] || session.profile.currentTitle;
        const loc = location || session.profile.location || '';
        
        const response = await fetch(
          `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query + ' in ' + loc)}&num_pages=1`,
          {
            headers: {
              'X-RapidAPI-Key': JSEARCH_API_KEY,
              'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
            }
          }
        );
        
        const data: any = await response.json();
        
        if (data.data && Array.isArray(data.data)) {
          // Score each real job against profile
          realJobs = await Promise.all(data.data.slice(0, 8).map(async (job: any) => {
            const score = quickMatchScore(session.profile, job);
            return {
              id: job.job_id,
              title: job.job_title,
              company: job.employer_name,
              location: job.job_city ? `${job.job_city}, ${job.job_state}` : job.job_country,
              salary: job.job_min_salary && job.job_max_salary 
                ? `$${job.job_min_salary.toLocaleString()} - $${job.job_max_salary.toLocaleString()}`
                : null,
              postedDate: job.job_posted_at_datetime_utc ? getRelativeTime(job.job_posted_at_datetime_utc) : 'Recently',
              description: job.job_description?.substring(0, 200) + '...',
              applyUrl: job.job_apply_link,
              companyLogo: job.employer_logo,
              employmentType: job.job_employment_type,
              isRemote: job.job_is_remote,
              ...score
            };
          }));
          
          realJobs.sort((a, b) => b.matchScore - a.matchScore);
        }
      } catch (apiErr) {
        console.error('JSearch API error:', apiErr);
        // Continue without real jobs - links will still work
      }
    }
    
    // If no API or API failed, generate AI suggestions
    if (realJobs.length === 0 && process.env.GROQ_API_KEY) {
      try {
        const query = searchQuery || session.profile.targetTitles?.[0] || session.profile.currentTitle;
        const skills = (session.profile.hardSkills || []).slice(0, 5).join(', ');
        
        const prompt = `Suggest 5 specific job titles and companies that would be good matches for someone with these skills: ${skills}, looking for: ${query}

Return ONLY JSON array:
[{"title":"<specific job title>","company":"<real company name>","matchScore":<70-95>,"reason":"<why good match>"}]`;

        const completion = await groq.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 800
        });

        const responseText = completion.choices[0]?.message?.content || '';
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        
        if (jsonMatch) {
          const suggestions = JSON.parse(jsonMatch[0]);
          realJobs = suggestions.map((s: any, i: number) => ({
            id: 'sug_' + i,
            title: s.title,
            company: s.company,
            matchScore: s.matchScore,
            quickTake: s.reason,
            isSuggestion: true,
            searchUrl: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(s.title + ' ' + s.company)}`
          }));
        }
      } catch (aiErr) {
        console.error('AI suggestion error:', aiErr);
      }
    }
    
    session.jobs = realJobs;
    session.searchLinks = searchLinks;

    res.json({ 
      success: true, 
      data: { 
        jobs: realJobs,
        searchLinks,
        hasRealApi: !!process.env.JSEARCH_API_KEY
      } 
    });

  } catch (error: any) {
    console.error('Job search error:', error);
    res.status(500).json({ success: false, error: error.message || 'Search failed' });
  }
});

// Quick match score without AI (fast)
function quickMatchScore(profile: any, job: any) {
  const jobText = (job.job_title + ' ' + job.job_description + ' ' + (job.job_required_skills || []).join(' ')).toLowerCase();
  const profileSkills = (profile.hardSkills || []).map((s: string) => s.toLowerCase());
  
  let matched = 0;
  let matchingSkills: string[] = [];
  
  profileSkills.forEach((skill: string) => {
    if (jobText.includes(skill.toLowerCase())) {
      matched++;
      matchingSkills.push(skill);
    }
  });

  // Realistic scoring: actual percentage without artificial bonus
  const rawScore = Math.round((matched / Math.max(profileSkills.length, 1)) * 100);
  const score = Math.min(95, rawScore);

  return {
    matchScore: score,
    matchingSkills,
    recommendation: score >= 70 ? 'APPLY_NOW' : score >= 50 ? 'WORTH_APPLYING' : 'CUSTOMIZE_FIRST',
    quickTake: score >= 70 ? 'Strong match for your skills!' : score >= 50 ? 'Good potential - worth applying' : 'Consider customizing your resume'
  };
}

function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

// ============================================================
// FEATURE 4: COVER LETTER GENERATION
// ============================================================

app.post('/api/generate-cover-letter', async (req, res) => {
  try {
    const { sessionId, jobId, jobDescription, companyName, jobTitle } = req.body;
    const session = sessions[sessionId];
    
    if (!session) {
      return res.status(400).json({ success: false, error: 'Session not found' });
    }

    const job = session.jobs?.find((j: any) => j.id === jobId);
    const company = companyName || job?.company || 'the company';
    const title = jobTitle || job?.title || 'the position';
    const jd = jobDescription || (job?.description + '\n' + job?.requirements?.join('\n'));

    const prompt = `Write a compelling cover letter.

CANDIDATE:
${session.resumeText.substring(0, 3000)}

JOB: ${title} at ${company}
${jd?.substring(0, 2000) || 'Position at company'}

Write a cover letter that:
1. Opens with a hook (NOT "I am writing to apply...")
2. Connects specific experience to job requirements
3. Includes 2-3 achievements with numbers
4. Shows genuine interest in company
5. Ends with confident call to action
6. Is 250-350 words

Return ONLY the cover letter text.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 800
    });

    const coverLetter = completion.choices[0]?.message?.content || '';
    res.json({ success: true, data: { coverLetter: coverLetter.trim(), company, jobTitle: title } });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE 5: JOB TRACKER
// ============================================================

app.post('/api/save-job', async (req, res) => {
  try {
    const { sessionId, job, status } = req.body;
    const session = sessions[sessionId];
    
    if (!session) {
      return res.status(400).json({ success: false, error: 'Session not found' });
    }

    if (!session.savedJobs) session.savedJobs = [];
    
    const existingIndex = session.savedJobs.findIndex((j: any) => j.id === job.id);
    if (existingIndex >= 0) {
      session.savedJobs[existingIndex] = { ...session.savedJobs[existingIndex], ...job, status, updatedAt: Date.now() };
    } else {
      session.savedJobs.push({ ...job, status: status || 'SAVED', savedAt: Date.now() });
    }

    res.json({ success: true, data: { savedJobs: session.savedJobs } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/saved-jobs', (req, res) => {
  const sessionId = req.query.sessionId as string;
  const session = sessions[sessionId];
  res.json({ success: true, data: { savedJobs: session?.savedJobs || [] } });
});

app.post('/api/update-job-status', async (req, res) => {
  try {
    const { sessionId, jobId, status } = req.body;
    const session = sessions[sessionId];
    
    if (!session?.savedJobs) {
      return res.status(400).json({ success: false, error: 'No saved jobs' });
    }

    const job = session.savedJobs.find((j: any) => j.id === jobId);
    if (job) {
      job.status = status;
      job.updatedAt = Date.now();
      if (status === 'APPLIED') job.appliedAt = Date.now();
    }

    res.json({ success: true, data: { job } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// COMPANY RESEARCH HELPER
// ============================================================
async function researchCompany(companyName: string): Promise<string> {
  if (!companyName || companyName.length < 2) {
    return 'No company information available.';
  }

  try {
    // Use Tavily API for company research if available
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

    if (TAVILY_API_KEY) {
      const searchQuery = `${companyName} company products services recent news 2024 2025`;
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query: searchQuery,
          search_depth: 'basic',
          max_results: 5,
          include_answer: true
        })
      });

      if (response.ok) {
        const data: any = await response.json();
        let companyInfo = '';

        if (data.answer) {
          companyInfo += `Overview: ${data.answer}\n\n`;
        }

        if (data.results && data.results.length > 0) {
          companyInfo += 'Key Information:\n';
          data.results.slice(0, 3).forEach((result: any, i: number) => {
            companyInfo += `${i + 1}. ${result.title}\n${result.content}\n\n`;
          });
        }

        return companyInfo || 'Limited company information found.';
      }
    }

    // Fallback: Use Groq to generate a research summary based on company name
    // This provides context about what the company likely does
    const prompt = `Provide factual, publicly known information about ${companyName}. Include:
1. What industry/sector they operate in
2. Main products or services (if well-known)
3. Company size/type (startup, enterprise, etc.) if publicly known

Keep it brief (3-4 sentences). ONLY include verified, publicly known facts. If you don't have reliable information, say "Limited public information available about this company."`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 300
    });

    return completion.choices[0]?.message?.content?.trim() || 'No additional company information available.';

  } catch (error) {
    console.error('Company research error:', error);
    return 'Unable to retrieve company information.';
  }
}

// ============================================================
// SPECIFIC COVER LETTER GENERATOR (for Analyze Resume page)
// ============================================================
app.post('/api/generate-specific-cover-letter', async (req, res) => {
  try {
    const { sessionId, jobDescription, analysisData, companyName: providedCompanyName } = req.body;
    const session = sessions[sessionId] || {};

    if (!jobDescription) {
      return res.status(400).json({ success: false, error: 'Job description required' });
    }

    // Extract company name and role from job description
    const companyMatch = jobDescription.match(/(?:at|@|company[:\s]+|about[:\s]+)([A-Z][a-zA-Z0-9\s&]+?)(?:\.|,|\n|is|we|has)/i);
    const titleMatch = jobDescription.match(/(?:title|position|role)[:\s]+([^\n]+)/i) ||
                       jobDescription.match(/(?:seeking|hiring|looking for)[:\s]+(?:an?\s+)?([^\n.]+)/i);

    const companyName = providedCompanyName || companyMatch?.[1]?.trim() || 'the company';

    // Research company information
    const companyResearch = await researchCompany(companyName);

    const resumeText = session.resumeText || '';
    // Use profile from session, or extract from analysisData, or use empty object
    const profile = session.profile || analysisData?.profile || {};
    
    // Extract specific achievements from resume
    const achievementPatterns = [
      /(?:led|managed|built|developed|created|launched|designed|implemented|reduced|increased|improved|saved|generated|grew|scaled)[^.]+\d+[^.]+\./gi,
      /\d+%[^.]+\./gi,
      /\$[\d,]+[^.]+\./gi
    ];
    
    let achievements: string[] = [];
    achievementPatterns.forEach(pattern => {
      const matches = resumeText.match(pattern);
      if (matches) achievements.push(...matches);
    });
    achievements = [...new Set(achievements)].slice(0, 5);

    const prompt = `You are a cover letter expert. Write a professional, factual cover letter using ONLY information provided below.

CANDIDATE PROFILE:
Name: ${profile.name || 'Candidate'}
Current Role: ${profile.currentTitle || 'Professional'}
Experience: ${profile.yearsExperience || 'Several'}+ years
Key Skills: ${(profile.hardSkills || []).join(', ') || 'various technical skills'}
Key Achievements from Resume:
${achievements.length > 0 ? achievements.map((a, i) => `${i+1}. ${a}`).join('\n') : 'Professional experience as detailed in resume'}

COMPANY INFORMATION (${companyName}):
${companyResearch}

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

ANALYSIS INSIGHTS:
- Match Score: ${analysisData?.overallScore || 'N/A'}%
- Strengths: ${(analysisData?.strengths || []).map((s: any) => s.skill).join(', ') || 'Multiple relevant skills'}
- Areas to Address: ${(analysisData?.dealbreakers || []).map((d: any) => d.requirement).join(', ') || 'None identified'}

WRITE A PROFESSIONAL COVER LETTER WITH THESE SECTIONS (flowing naturally, no headers):

1. OPENING (1-2 sentences)
- Express interest in the specific role and company
- If company information is available, you may reference specific facts from the COMPANY INFORMATION section
- Connect your background to the position
- Example: "I am writing to express my interest in the [Job Title] position at [Company]. With [X] years of experience in [relevant field], I am confident I can contribute to your team's success."

2. WHY THIS COMPANY (2-3 sentences)
- Use ONLY information from the COMPANY INFORMATION section provided above
- If company research shows specific products, services, or initiatives, you may reference them
- Show genuine interest based on researched facts
- If limited company information is available, focus on the role and industry instead

3. RELEVANT EXPERIENCE (2-3 sentences)
- Connect your skills and experience to the job requirements listed in the job description
- Reference only technologies and requirements mentioned in the provided job description
- Demonstrate understanding of role requirements

4. YOUR ACHIEVEMENTS (3-4 sentences)
- Use ONLY the achievements listed above from the resume
- DO NOT embellish or add details not present in the achievements
- If no specific achievements are provided, describe general professional competencies
- Include only metrics that appear in the provided achievements

5. VALUE PROPOSITION (2-3 sentences)
- Explain how your background aligns with the role's requirements
- Reference only challenges or needs explicitly mentioned in the job description or company research
- Connect your skills to company needs identified in the research

6. CLOSING (1-2 sentences)
- Express enthusiasm for the opportunity
- Include a professional call to action
- Example: "I would welcome the opportunity to discuss how my experience aligns with your needs. Thank you for your consideration."

CRITICAL RULES - ABSOLUTE REQUIREMENTS:
- ONLY use company facts from the COMPANY INFORMATION section provided above
- DO NOT add achievements or metrics not listed in the provided achievements
- DO NOT invent or assume information beyond what's provided
- ONLY use facts from: company research provided, resume achievements provided, job description text, and candidate profile
- If company information says "Limited public information available", focus on the role instead of the company
- Keep it under 400 words
- Write in first person, professional tone
- Be honest and factual above all else - only reference what's been researched

Return ONLY the cover letter text, no additional commentary.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1500
    });

    const coverLetter = completion.choices[0]?.message?.content || '';

    res.json({
      success: true,
      data: {
        coverLetter: coverLetter.trim(),
        companyResearch: companyResearch,
        companyName: companyName
      }
    });

  } catch (error: any) {
    console.error('Cover letter error:', error);
    res.status(500).json({ success: false, error: error.message || 'Generation failed' });
  }
});

// ============================================================
// INTERVIEW PREPARATION GENERATOR
// ============================================================
app.post('/api/generate-interview-prep', async (req, res) => {
  try {
    const { sessionId, jobDescription, analysisData, companyName: providedCompanyName } = req.body;
    const session = sessions[sessionId] || {};

    if (!jobDescription) {
      return res.status(400).json({ success: false, error: 'Job description required' });
    }

    // Extract company name from job description
    const companyMatch = jobDescription.match(/(?:at|@|company[:\s]+|about[:\s]+)([A-Z][a-zA-Z0-9\s&]+?)(?:\.|,|\n|is|we|has)/i);
    const companyName = providedCompanyName || companyMatch?.[1]?.trim() || 'the company';

    // Research company information
    const companyResearch = await researchCompany(companyName);

    const resumeText = session.resumeText || '';
    const profile = session.profile || analysisData?.profile || {};

    // Extract achievements from resume
    const achievementPatterns = [
      /(?:led|managed|built|developed|created|launched|designed|implemented|reduced|increased|improved|saved|generated|grew|scaled)[^.]+\d+[^.]+\./gi,
      /\d+%[^.]+\./gi,
      /\$[\d,]+[^.]+\./gi
    ];

    let achievements: string[] = [];
    achievementPatterns.forEach(pattern => {
      const matches = resumeText.match(pattern);
      if (matches) achievements.push(...matches);
    });
    achievements = [...new Set(achievements)].slice(0, 8);

    // The 20 standard interview questions
    const interviewQuestions = [
      "Tell me about yourself",
      "What are your strengths / weaknesses?",
      "What do you like to do outside of work?",
      "How do you handle difficult situations?",
      "Do you like working alone or in a team?",
      "Why did you leave your previous job?",
      "Why should we hire you?",
      "What do you know about this company?",
      "Have you applied anywhere else?",
      "Where do you see yourself in 5 years?",
      "What are your salary expectations?",
      "Describe your ability to work under pressure",
      "What is the most challenging thing about working with you?",
      "Talk about your achievements",
      "How do you handle conflict?",
      "What was your biggest challenge with your previous boss?",
      "Why do you want to work with us?",
      "Why do you think you deserve this job?",
      "What motivates you?",
      "Do you have any questions for us?"
    ];

    // Questions candidate should ask the interviewer
    const questionsToAskInterviewer = [
      "Can you describe the company culture?",
      "What does success look like in this role?",
      "How does the team collaborate, and what's the typical workflow?",
      "What are the biggest challenges the team or company is currently facing?",
      "What opportunities are there for professional development and growth within the company?",
      "Can you tell me about the next steps in the interview process?"
    ];

    const prompt = `You are an interview preparation coach. Generate personalized answers for interview questions using ONLY the information provided below.

CANDIDATE PROFILE:
Name: ${profile.name || 'Candidate'}
Current Role: ${profile.currentTitle || 'Professional'}
Experience: ${profile.yearsExperience || 'Several'}+ years
Key Skills: ${(profile.hardSkills || []).join(', ') || 'various technical skills'}
Key Achievements:
${achievements.length > 0 ? achievements.map((a, i) => `${i+1}. ${a}`).join('\n') : 'Professional experience as detailed in resume'}

COMPANY INFORMATION (${companyName}):
${companyResearch}

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

ANALYSIS INSIGHTS:
- Match Score: ${analysisData?.overallScore || 'N/A'}%
- Strengths: ${(analysisData?.strengths || []).map((s: any) => s.skill).join(', ') || 'Multiple relevant skills'}
- Gaps/Weaknesses: ${(analysisData?.dealbreakers || []).map((d: any) => d.requirement).join(', ') || 'None identified'}

INTERVIEW QUESTIONS TO ANSWER:
${interviewQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

For EACH question above, provide:
1. The question number and text
2. A personalized suggested answer based on the candidate's actual resume, achievements, and the specific job/company
3. Use ONLY facts from the resume, job description, and company research
4. For weakness/gap questions, acknowledge honestly but show how they're addressing it
5. Keep each answer concise (2-4 sentences)

Return ONLY a JSON array with this structure:
[
  {
    "question": "Tell me about yourself",
    "suggestedAnswer": "Based on resume and JD, explain who you are professionally...",
    "tips": "Brief tip on how to deliver this answer"
  }
]

CRITICAL RULES:
- DO NOT fabricate achievements, skills, or experience
- Use ONLY information from the resume provided
- Reference company facts ONLY from the company research section
- For gaps/weaknesses identified in analysis, provide honest but constructive answers
- If resume lacks information for a question, suggest general professional response
- Keep answers factual and authentic - this is someone's career opportunity

Return ONLY the JSON array, no additional text.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 4000
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      throw new Error('Failed to generate interview preparation');
    }

    const interviewPrep = JSON.parse(jsonMatch[0]);

    res.json({
      success: true,
      data: {
        questions: interviewPrep,
        questionsToAsk: questionsToAskInterviewer,
        companyResearch: companyResearch,
        companyName: companyName
      }
    });

  } catch (error: any) {
    console.error('Interview prep error:', error);
    res.status(500).json({ success: false, error: error.message || 'Generation failed' });
  }
});

// ICA Routes
app.use('/api/ica', require('./routes/ica').default);

// LLM Providers endpoint
app.get('/api/llm-providers', (req, res) => {
  try {
    const { getAvailableProviders, getDefaultProvider } = require('./services/llmProvider');
    const providers = getAvailableProviders();

    res.json({
      success: true,
      data: {
        providers: providers.map((p: any) => ({
          name: p.name,
          displayName: p.displayName,
          available: p.isAvailable()
        })),
        default: getDefaultProvider()
      }
    });
  } catch (error: any) {
    console.error('Error in /api/llm-providers:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load providers'
    });
  }
});

// Health & Static
app.get('/health', (req, res) => res.json({ status: 'ok' }));
// ========== RESUME OPTIMIZER ENDPOINT ==========
app.post('/api/optimize-resume', upload.single('resume'), async (req, res) => {
  try {
    const { jobDescription } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Resume file required' });
    }

    if (!jobDescription || jobDescription.trim().length < 50) {
      return res.status(400).json({ success: false, error: 'Job description required (min 50 chars)' });
    }

    // Extract resume text
    const resumeText = await parseResume(req.file.path, req.file.mimetype);

    // Build comprehensive audit and optimization prompt
    const prompt = `You are a professional resume writer and ATS optimization expert.

CRITICAL INSTRUCTIONS:
- Read the ACTUAL resume text below carefully
- Extract the REAL content from the resume (actual summary, actual job titles, actual skills)
- Do NOT make up or fabricate content
- Do NOT use example data
- Base ALL analysis on the actual resume provided

RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

TASK: Audit this resume using the 10-point checklist below, then provide an optimized version using ONLY the actual content from the resume above.

AUDIT CHECKLIST:
1. Target Role Alignment (3 checks)
2. Summary Section (4 checks if present)
3. Experience Section (4 checks)
4. Bullet Quality (6 checks per bullet)
5. Skills Section (4 checks)
6. Formatting & Readability (4 checks)
7. ATS Optimization (4 checks)
8. Results & Impact Test (3 checks)
9. Customization Check (4 checks)
10. Final Sanity (4 checks)

OUTPUT FORMAT (JSON):
{
  "auditScore": {
    "total": "6/10",
    "sections": [
      {"name": "Target Role Alignment", "passed": 2, "total": 3, "issues": ["actual issue 1", "actual issue 2"]},
      {"name": "Summary Section", "passed": 3, "total": 4, "issues": ["actual issue"]},
      {"name": "Experience Section", "passed": 3, "total": 4, "issues": ["actual issue"]},
      {"name": "Bullet Quality", "passed": 4, "total": 6, "issues": ["actual issue 1", "actual issue 2"]},
      {"name": "Skills Section", "passed": 3, "total": 4, "issues": ["actual issue"]},
      {"name": "Formatting & Readability", "passed": 3, "total": 4, "issues": ["actual issue"]},
      {"name": "ATS Optimization", "passed": 3, "total": 4, "issues": ["actual issue"]},
      {"name": "Results & Impact Test", "passed": 2, "total": 3, "issues": ["actual issue"]},
      {"name": "Customization Check", "passed": 3, "total": 4, "issues": ["actual issue"]},
      {"name": "Final Sanity", "passed": 3, "total": 4, "issues": ["actual issue"]}
    ]
  },
  "sections": [
    {
      "title": "Summary",
      "before": "ACTUAL summary text from resume",
      "after": "Optimized version of ACTUAL summary",
      "changes": ["What you changed and why"]
    },
    {
      "title": "Experience - ACTUAL JOB TITLE FROM RESUME",
      "bullets": [
        {
          "before": "ACTUAL bullet text from resume",
          "after": "Optimized version of ACTUAL bullet",
          "changes": ["What you changed"]
        }
      ]
    },
    {
      "title": "Skills",
      "before": ["ACTUAL", "skills", "from", "resume"],
      "after": ["Optimized", "skill", "list", "based", "on", "job"],
      "changes": ["What you changed"]
    }
  ],
  "changesSummary": "Summary of what was changed"
}`;

    // Call Groq API
    const completion = await groq.chat.completions.create({
      messages: [{
        role: 'system',
        content: 'You are a professional resume writer. Return ONLY valid JSON, no markdown.'
      }, {
        role: 'user',
        content: prompt
      }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.3,
      max_tokens: 4000
    });

    const content = completion.choices[0]?.message?.content || '';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid AI response format');
    }

    const optimization = JSON.parse(jsonMatch[0]);

    res.json({
      success: true,
      data: optimization
    });

  } catch (error: any) {
    console.error('Resume optimization error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Optimization failed'
    });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

export default app;
module.exports = app;
