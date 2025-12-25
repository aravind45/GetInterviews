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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File upload configuration
const upload = multer({ 
  dest: '/tmp/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/**
 * Parse resume file (PDF or Word)
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
  
  throw new Error('Unsupported file format. Please upload PDF or Word document.');
}

/**
 * POST /api/analyze-match
 * Analyze resume against job description
 */
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
    
    // Parse resume
    console.log('Parsing resume:', req.file.originalname);
    const resumeText = await parseResume(filePath, req.file.mimetype);
    
    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({ success: false, error: 'Could not extract text from resume. Please try a different file.' });
    }
    
    console.log('Resume parsed, length:', resumeText.length);
    
    // Check if Groq API key is configured
    if (!process.env.GROQ_API_KEY) {
      // Return mock response for testing without API key
      console.log('No GROQ_API_KEY, returning mock response');
      return res.json({
        success: true,
        data: {
          score: 65,
          feedback: "This is a mock response. To get real AI analysis, please configure the GROQ_API_KEY environment variable. The resume appears to have relevant experience but would need AI analysis to provide detailed feedback.",
          matchingSkills: ["Communication", "Problem Solving", "Team Collaboration"],
          missingSkills: ["Specific technical skills require AI analysis"]
        }
      });
    }
    
    // Call Groq AI for analysis
    console.log('Calling Groq API for analysis...');
    
    const prompt = `You are an expert resume analyzer and hiring consultant. Analyze how well this resume matches the job description.

RESUME:
${resumeText.substring(0, 4000)}

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

Provide your analysis in the following JSON format ONLY (no other text):
{
  "score": <number 0-100>,
  "feedback": "<2-3 sentence summary of how well the candidate matches, highlighting key strengths and gaps>",
  "matchingSkills": ["<skill1>", "<skill2>", ...],
  "missingSkills": ["<skill1>", "<skill2>", ...]
}

Scoring guide:
- 90-100: Exceptional match, exceeds most requirements
- 70-89: Strong match, meets most key requirements
- 50-69: Partial match, has some relevant experience
- Below 50: Weak match, missing critical requirements

Be specific about skills. List actual technologies, tools, and competencies - not generic terms.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000
    });
    
    const responseText = completion.choices[0]?.message?.content || '';
    console.log('Groq response:', responseText.substring(0, 200));
    
    // Parse JSON from response
    let analysis;
    try {
      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Return a fallback response
      analysis = {
        score: 50,
        feedback: "Analysis completed but could not parse detailed results. The resume appears to have some relevant qualifications for this role.",
        matchingSkills: [],
        missingSkills: []
      };
    }
    
    // Validate and sanitize response
    const result = {
      score: Math.min(100, Math.max(0, parseInt(analysis.score) || 50)),
      feedback: String(analysis.feedback || 'Analysis complete.'),
      matchingSkills: Array.isArray(analysis.matchingSkills) ? analysis.matchingSkills.slice(0, 10) : [],
      missingSkills: Array.isArray(analysis.missingSkills) ? analysis.missingSkills.slice(0, 10) : []
    };
    
    console.log('Analysis complete, score:', result.score);
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze resume'
    });
  } finally {
    // Clean up uploaded file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
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
const isVercel = process.env.VERCEL === '1';

if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
module.exports = app;
