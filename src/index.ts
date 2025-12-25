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

    // Store for later use
    const sessionId = req.body.sessionId || 'sess_' + Math.random().toString(36).substring(2);
    sessions[sessionId] = sessions[sessionId] || {};
    sessions[sessionId].resumeText = resumeText;

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

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 3000
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('Failed to analyze');
    }

    const analysis = JSON.parse(jsonMatch[0]);
    res.json({ success: true, data: analysis, sessionId });

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
    const sessionId = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessions[sessionId] = { profile, resumeText, jobs: [], savedJobs: [] };

    res.json({ success: true, data: { sessionId, profile, resumeText } });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// ============================================================
// FEATURE 3: JOB SEARCH
// ============================================================

app.post('/api/search-jobs', async (req, res) => {
  try {
    const { sessionId, searchQuery, location } = req.body;
    const session = sessions[sessionId];
    
    if (!session) {
      return res.status(400).json({ success: false, error: 'Session not found. Upload resume first.' });
    }

    const query = searchQuery || session.profile.targetTitles?.[0] || session.profile.currentTitle;
    const loc = location || session.profile.location || 'Remote';
    const skills = (session.profile.hardSkills || []).slice(0, 5).join(', ');

    // Simplified prompt for faster response
    const prompt = `Generate 6 job listings for: "${query}" in "${loc}"
Candidate skills: ${skills}

Return ONLY a JSON array, no other text:
[{"id":"j1","title":"<title>","company":"<company>","location":"<loc>","salary":"<range>","postedDate":"<X days ago>","description":"<2 sentences>","requirements":["<r1>","<r2>","<r3>"],"matchScore":<0-100>,"recommendation":"APPLY_NOW|WORTH_APPLYING|CUSTOMIZE_FIRST|SKIP","matchingSkills":["<s1>","<s2>"],"missingSkills":["<s1>"],"quickTake":"<1 sentence>"}]

Mix: 2 high match (85-95%), 2 medium (65-80%), 2 lower (40-60%). Use realistic companies.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    });

    const responseText = completion.choices[0]?.message?.content || '';
    
    // Try to extract JSON array
    let jobs = [];
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    
    if (jsonMatch) {
      try {
        jobs = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr);
        // Return empty with helpful message
        return res.json({ success: true, data: { jobs: [] }, message: 'Could not parse results' });
      }
    }
    
    // Sort by score
    jobs.sort((a: any, b: any) => (b.matchScore || 0) - (a.matchScore || 0));
    session.jobs = jobs;

    res.json({ success: true, data: { jobs } });

  } catch (error: any) {
    console.error('Job search error:', error);
    res.status(500).json({ success: false, error: error.message || 'Search failed' });
  }
});

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

// Health & Static
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

export default app;
module.exports = app;
