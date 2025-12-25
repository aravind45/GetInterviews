import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Groq from 'groq-sdk';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// In-memory storage (use DB in production)
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
 * POST /api/extract-profile
 * Extract candidate profile from resume
 */
app.post('/api/extract-profile', upload.single('resume'), async (req, res) => {
  let filePath = '';
  
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Resume file required' });
    }
    
    filePath = req.file.path;
    const resumeText = await parseResume(filePath, req.file.mimetype);
    
    if (!resumeText || resumeText.length < 100) {
      return res.status(400).json({ success: false, error: 'Could not extract text from resume' });
    }

    const prompt = `Extract a structured profile from this resume. Return ONLY JSON:

RESUME:
${resumeText.substring(0, 6000)}

Return this exact JSON structure:
{
  "name": "<full name>",
  "email": "<email if found>",
  "phone": "<phone if found>",
  "location": "<city, state/country>",
  "currentTitle": "<most recent job title>",
  "yearsExperience": <number>,
  "experienceLevel": "ENTRY|MID|SENIOR|LEAD|EXECUTIVE",
  
  "targetTitles": ["<job titles they could apply for>"],
  "targetIndustries": ["<industries they fit>"],
  
  "hardSkills": ["<technical skills, tools, languages>"],
  "softSkills": ["<communication, leadership, etc>"],
  "certifications": ["<any certifications>"],
  
  "education": {
    "degree": "<highest degree>",
    "field": "<field of study>",
    "school": "<school name>"
  },
  
  "summary": "<2-3 sentence professional summary>",
  "strengths": ["<top 3 strengths>"],
  "searchKeywords": ["<keywords to use when searching for jobs>"]
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('Failed to parse profile');
    }

    const profile = JSON.parse(jsonMatch[0]);
    
    // Generate session ID
    const sessionId = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessions[sessionId] = { profile, resumeText, jobs: [], createdAt: Date.now() };

    res.json({ success: true, data: { sessionId, profile, resumeText } });

  } catch (error: any) {
    console.error('Profile extraction error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

/**
 * POST /api/search-jobs
 * Search for jobs based on profile
 */
app.post('/api/search-jobs', async (req, res) => {
  try {
    const { sessionId, searchQuery, location, jobType } = req.body;
    
    const session = sessions[sessionId];
    if (!session) {
      return res.status(400).json({ success: false, error: 'Session not found. Please upload resume first.' });
    }

    // Build search query from profile if not provided
    const query = searchQuery || session.profile.targetTitles?.[0] || session.profile.currentTitle;
    const loc = location || session.profile.location || 'Remote';

    // In a real implementation, this would call job board APIs
    // For now, we'll generate realistic job listings based on the profile
    const prompt = `Generate 8 realistic job listings that would match someone with this profile:

CANDIDATE PROFILE:
- Current Title: ${session.profile.currentTitle}
- Experience: ${session.profile.yearsExperience} years
- Skills: ${session.profile.hardSkills?.slice(0, 10).join(', ')}
- Target Roles: ${session.profile.targetTitles?.join(', ')}

SEARCH: "${query}" in "${loc}"

Return ONLY a JSON array of jobs. Make them realistic with real company types and requirements:
[
  {
    "id": "<unique id>",
    "title": "<job title>",
    "company": "<realistic company name>",
    "location": "<city or Remote>",
    "salary": "<salary range if typical>",
    "jobType": "FULL_TIME|CONTRACT|PART_TIME",
    "postedDate": "<X days ago>",
    "url": "<placeholder url>",
    "description": "<3-4 sentence job description>",
    "requirements": ["<requirement 1>", "<requirement 2>", ...],
    "niceToHave": ["<nice to have 1>", ...],
    "benefits": ["<benefit 1>", ...]
  }
]

Include a mix:
- 2 jobs that are PERFECT matches (90%+)
- 3 jobs that are GOOD matches (70-89%)
- 2 jobs that are STRETCH matches (50-69%)
- 1 job that is a REACH (30-49%)

Vary the company sizes (startup, mid-size, enterprise) and make requirements realistic.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 3000
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    
    if (!jsonMatch) {
      throw new Error('Failed to generate jobs');
    }

    const jobs = JSON.parse(jsonMatch[0]);
    
    // Now score each job
    const scoredJobs = await Promise.all(jobs.map(async (job: any) => {
      const score = await quickScoreJob(session.profile, session.resumeText, job);
      return { ...job, ...score };
    }));

    // Sort by score
    scoredJobs.sort((a, b) => b.matchScore - a.matchScore);
    
    // Save to session
    session.jobs = scoredJobs;

    res.json({ success: true, data: { jobs: scoredJobs } });

  } catch (error: any) {
    console.error('Job search error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Quick score a job against profile
 */
async function quickScoreJob(profile: any, resumeText: string, job: any): Promise<any> {
  const prompt = `Score this job match. Return ONLY JSON:

CANDIDATE:
- Title: ${profile.currentTitle}
- Experience: ${profile.yearsExperience} years (${profile.experienceLevel})
- Skills: ${profile.hardSkills?.join(', ')}

JOB:
- Title: ${job.title}
- Requirements: ${job.requirements?.join(', ')}
- Nice to have: ${job.niceToHave?.join(', ')}

Return:
{
  "matchScore": <0-100>,
  "matchLevel": "EXCELLENT|GOOD|MODERATE|LOW",
  "recommendation": "APPLY_NOW|WORTH_APPLYING|CUSTOMIZE_FIRST|SKIP",
  "matchingSkills": ["<skills you have that match>"],
  "missingSkills": ["<required skills you lack>"],
  "quickTake": "<one sentence - why apply or not>"
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Scoring error:', e);
  }

  return { matchScore: 50, matchLevel: 'MODERATE', recommendation: 'WORTH_APPLYING', matchingSkills: [], missingSkills: [], quickTake: 'Unable to analyze' };
}

/**
 * POST /api/analyze-job
 * Deep analysis of a specific job
 */
app.post('/api/analyze-job', async (req, res) => {
  try {
    const { sessionId, jobId, jobDescription } = req.body;
    
    const session = sessions[sessionId];
    if (!session) {
      return res.status(400).json({ success: false, error: 'Session not found' });
    }

    // Find job or use provided description
    let job = session.jobs?.find((j: any) => j.id === jobId);
    const jd = jobDescription || job?.description + '\n\nRequirements:\n' + job?.requirements?.join('\n');

    const prompt = `Deep analysis of job fit. Return ONLY JSON:

RESUME:
${session.resumeText.substring(0, 4000)}

JOB:
${jd.substring(0, 3000)}

{
  "overallScore": <0-100>,
  "verdict": "STRONG MATCH|MODERATE MATCH|WEAK MATCH|NOT A FIT",
  "summary": "<2-3 sentences on fit>",
  
  "interviewChance": {
    "percentage": <0-100>,
    "reasoning": "<why>"
  },
  
  "skillAnalysis": {
    "matched": [{"skill": "<skill>", "evidence": "<from resume>"}],
    "missing": [{"skill": "<skill>", "severity": "CRITICAL|IMPORTANT|NICE_TO_HAVE", "suggestion": "<how to address>"}]
  },
  
  "experienceGap": {
    "required": "<what they want>",
    "youHave": "<what you have>",
    "assessment": "OVERQUALIFIED|GOOD_MATCH|SLIGHTLY_UNDER|SIGNIFICANTLY_UNDER"
  },
  
  "strategy": {
    "shouldApply": true/false,
    "approach": "APPLY_NOW|CUSTOMIZE_RESUME|GET_REFERRAL|SKIP",
    "timeToSpend": "<how much time worth investing>",
    "keyPointsToEmphasize": ["<what to highlight>"]
  },
  
  "dealbreakers": ["<if any critical missing requirements>"],
  
  "bottomLine": "<honest 1-2 sentence advice>"
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('Analysis failed');
    }

    const analysis = JSON.parse(jsonMatch[0]);
    res.json({ success: true, data: { analysis, job } });

  } catch (error: any) {
    console.error('Job analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/generate-cover-letter
 * Generate tailored cover letter
 */
app.post('/api/generate-cover-letter', async (req, res) => {
  try {
    const { sessionId, jobId, jobDescription, companyName, jobTitle, tone } = req.body;
    
    const session = sessions[sessionId];
    if (!session) {
      return res.status(400).json({ success: false, error: 'Session not found' });
    }

    const job = session.jobs?.find((j: any) => j.id === jobId);
    const company = companyName || job?.company || 'the company';
    const title = jobTitle || job?.title || 'the position';
    const jd = jobDescription || job?.description + '\n' + job?.requirements?.join('\n');

    const prompt = `Write a compelling cover letter. 

CANDIDATE:
${session.resumeText.substring(0, 3000)}

JOB: ${title} at ${company}
${jd.substring(0, 2000)}

TONE: ${tone || 'professional but personable'}

Write a cover letter that:
1. Opens with a hook (not "I am writing to apply...")
2. Connects their specific experience to job requirements
3. Shows knowledge of the company/role
4. Includes 2-3 concrete achievements with numbers
5. Ends with confident call to action
6. Is 250-350 words

Return ONLY the cover letter text, no JSON or labels.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 800
    });

    const coverLetter = completion.choices[0]?.message?.content || '';

    res.json({ 
      success: true, 
      data: { 
        coverLetter: coverLetter.trim(),
        company,
        jobTitle: title
      } 
    });

  } catch (error: any) {
    console.error('Cover letter error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/save-job
 * Save a job to tracking list
 */
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

/**
 * GET /api/saved-jobs
 */
app.get('/api/saved-jobs', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const session = sessions[sessionId];
  
  if (!session) {
    return res.json({ success: true, data: { savedJobs: [] } });
  }

  res.json({ success: true, data: { savedJobs: session.savedJobs || [] } });
});

/**
 * POST /api/update-job-status
 */
app.post('/api/update-job-status', async (req, res) => {
  try {
    const { sessionId, jobId, status, notes } = req.body;
    
    const session = sessions[sessionId];
    if (!session?.savedJobs) {
      return res.status(400).json({ success: false, error: 'No saved jobs' });
    }

    const job = session.savedJobs.find((j: any) => j.id === jobId);
    if (job) {
      job.status = status;
      if (notes) job.notes = notes;
      job.updatedAt = Date.now();
      if (status === 'APPLIED') job.appliedAt = Date.now();
    }

    res.json({ success: true, data: { job } });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

export default app;
module.exports = app;
