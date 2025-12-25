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
      console.log('No GROQ_API_KEY, returning mock response');
      return res.json({
        success: true,
        data: {
          overallScore: 58,
          verdict: "MODERATE MATCH",
          summary: "You have relevant experience, but you're missing 2-3 critical keywords that are likely getting your resume auto-rejected by the ATS. With some targeted changes, you could significantly improve your chances.",
          
          sixSecondScan: {
            firstImpression: "Clean format, but job title doesn't immediately match. Skills section is buried at the bottom where recruiters might not see it.",
            standoutElements: ["Clear work history", "Recognized company names", "Good education"],
            immediateRedFlags: ["Job title mismatch", "No quantified achievements visible", "Generic summary"],
            wouldReadMore: false,
            whyOrWhyNot: "The job title mismatch and lack of immediate keyword matches would likely cause most recruiters to move on within 6 seconds."
          },
          
          atsAnalysis: {
            score: 52,
            likelyToPass: false,
            keywordsFound: ["JavaScript", "React", "Node.js", "Git", "Agile"],
            criticalKeywordsMissing: ["TypeScript", "AWS", "Docker", "CI/CD", "PostgreSQL"],
            suggestionToPassATS: "Add the missing keywords to your skills section. If you have ANY experience with TypeScript or AWS, add them immediately - even if basic."
          },
          
          qualificationGap: {
            experienceRequired: "5+ years of full-stack development with cloud experience",
            experienceYouHave: "4 years of frontend-heavy development, limited cloud exposure",
            gapAssessment: "SLIGHTLY_UNDER",
            yearsGap: "You're about 1 year short on total experience, and significantly short on cloud/DevOps",
            canYouCloseGap: true,
            howToCloseGap: "Emphasize any backend or cloud work you've done. Consider adding a personal project using AWS to demonstrate capability."
          },
          
          dealbreakers: [
            {
              requirement: "TypeScript experience required",
              status: "MISSING",
              impact: "This alone could disqualify you - TypeScript is in the job title",
              urgentFix: "Add TypeScript to your resume. If you've used it at all, even in side projects, list it. Consider spending 2-3 hours on a TypeScript tutorial so you can honestly claim familiarity."
            },
            {
              requirement: "AWS/Cloud platform experience",
              status: "WEAK",
              impact: "Major gap - most candidates at this level will have cloud experience",
              urgentFix: "Deploy one of your existing projects to AWS (even a simple S3/CloudFront setup). Then you can legitimately list AWS experience."
            }
          ],
          
          strengths: [
            {
              skill: "Strong React experience",
              howItHelps: "React is the primary frontend framework they're using",
              howToHighlight: "Move React higher in your skills list and quantify it: 'React (4 years, 10+ production apps)'"
            },
            {
              skill: "Experience at recognized companies",
              howItHelps: "Brand-name companies add credibility and suggest you've passed rigorous hiring before",
              howToHighlight: "Keep company names prominent. Add brief context if company isn't well-known in tech."
            }
          ],
          
          hiddenRedFlags: [
            {
              issue: "Short tenure at last company (10 months)",
              whatRecruiterThinks: "Job hopper? Fired? Couldn't handle the role?",
              howToAddress: "Add context if there's a good reason (startup ran out of funding, relocated, etc.) or emphasize what you accomplished in that time."
            },
            {
              issue: "No GitHub or portfolio link",
              whatRecruiterThinks: "Can't verify skills. What are they hiding?",
              howToAddress: "Add your GitHub link. If your repos are sparse, spend a weekend cleaning them up or adding one solid project."
            }
          ],
          
          competitorAnalysis: {
            typicalWinningCandidate: "5-7 years full-stack experience, TypeScript/React/Node stack, AWS certified or 2+ years cloud experience, has shipped production systems at scale",
            howYouCompare: "You're competitive on frontend skills but behind on cloud/DevOps. You're in the 40th percentile of applicants for this role.",
            yourCompetitiveAdvantage: "Strong React depth and experience at established companies gives you credibility",
            yourBiggestDisadvantage: "Missing cloud experience in a role that explicitly requires it - this is likely why you're not hearing back"
          },
          
          applicationStrategy: {
            shouldYouApply: true,
            confidenceLevel: "LOW",
            bestApproach: "CUSTOMIZE_HEAVILY",
            timeWorthInvesting: "Worth 1-2 hours to customize, but only if you can honestly add TypeScript and some AWS experience",
            alternativeStrategy: "Consider reaching out to someone at the company on LinkedIn first. A referral would significantly boost your chances given the experience gap."
          },
          
          resumeRewrites: [
            {
              section: "Professional Summary",
              currentText: "Experienced software developer with a passion for building web applications",
              problem: "Generic, no keywords, doesn't match job title",
              rewrittenText: "Full-Stack Engineer with 4+ years building scalable React/TypeScript applications. Experienced in Node.js backends, REST API design, and cloud deployments. Passionate about clean code and developer experience.",
              whyBetter: "Matches job title, includes key technologies, quantifies experience"
            },
            {
              section: "Work Experience - Bullet Point",
              currentText: "Worked on the frontend team building new features",
              problem: "No impact, no technologies, no scale",
              rewrittenText: "Led development of customer dashboard using React and TypeScript, reducing page load time by 40% and increasing user engagement by 25%",
              whyBetter: "Shows leadership, specific tech stack, quantified impact"
            }
          ],
          
          prioritizedActionPlan: {
            before_applying: [
              "Add TypeScript to your skills (do a quick tutorial if needed)",
              "Add at least one AWS service you can speak to",
              "Rewrite your summary to match the job title",
              "Add quantified achievements to every bullet point"
            ],
            quick_wins: [
              "Add GitHub link to header",
              "Move skills section higher on resume",
              "Mirror exact phrases from job description"
            ],
            worth_the_effort: [
              "Deploy a project to AWS this weekend",
              "Get AWS Cloud Practitioner cert (can be done in a week)",
              "Build one TypeScript project you can discuss in interviews"
            ],
            long_term: [
              "Contribute to open source to build public proof of skills",
              "Write technical blog posts to demonstrate expertise",
              "Build network at target companies before applying"
            ]
          },
          
          interviewProbability: {
            percentage: 15,
            reasoning: "The missing TypeScript requirement and limited cloud experience are likely causing automatic rejection. Your frontend skills are strong but not differentiated enough to overcome the gaps.",
            whatWouldIncreaseOdds: "Adding TypeScript and any AWS experience would likely bump this to 40-50%. A referral could push it to 60%+."
          },
          
          bottomLine: {
            honestAssessment: "You're a borderline candidate right now. Not unqualified, but not competitive either. The good news: the gaps are fixable with a few hours of work. Don't apply to this job yet - spend this weekend on the quick fixes first.",
            oneThingToFix: "Add TypeScript to your resume. This single change could double your callback rate for senior frontend roles.",
            encouragement: "Your React experience is genuinely strong, and that's the core of this role. You're closer than you think - you just need to fill in the supporting skills that hiring managers expect to see."
          }
        }
      });
    }
    
    // Call Groq AI for analysis
    console.log('Calling Groq API for analysis...');
    
    const prompt = `You are a brutally honest career coach who has reviewed 10,000+ resumes and knows exactly why people don't get interviews. A frustrated jobseeker needs the TRUTH about why they're being ghosted.

RESUME:
${resumeText.substring(0, 5000)}

JOB DESCRIPTION:
${jobDescription.substring(0, 4000)}

Analyze this like you're the hiring manager who has 200 applications to review. Be specific, be honest, be helpful.

Return ONLY this JSON (no other text):
{
  "overallScore": <0-100>,
  "verdict": "STRONG MATCH|MODERATE MATCH|WEAK MATCH|LONG SHOT|NOT A FIT",
  "summary": "<2-3 sentences - the brutal truth about their chances>",
  
  "sixSecondScan": {
    "firstImpression": "<what a recruiter notices in first 6 seconds>",
    "standoutElements": ["<what's good>"],
    "immediateRedFlags": ["<what makes them move to next resume>"],
    "wouldReadMore": true/false,
    "whyOrWhyNot": "<honest explanation>"
  },
  
  "atsAnalysis": {
    "score": <0-100>,
    "likelyToPass": true/false,
    "keywordsFound": ["<exact matches from JD>"],
    "criticalKeywordsMissing": ["<keywords that will auto-reject>"],
    "suggestionToPassATS": "<specific fix>"
  },
  
  "qualificationGap": {
    "experienceRequired": "<what JD asks for>",
    "experienceYouHave": "<what resume shows>",
    "gapAssessment": "OVER_QUALIFIED|SLIGHTLY_OVER|GOOD_MATCH|SLIGHTLY_UNDER|SIGNIFICANTLY_UNDER",
    "yearsGap": "<e.g., 'JD wants 5+ years, you show ~3 years'>",
    "canYouCloseGap": true/false,
    "howToCloseGap": "<if possible, how>"
  },
  
  "dealbreakers": [
    {
      "requirement": "<exact requirement from JD>",
      "status": "MISSING|WEAK|UNCLEAR",
      "impact": "This alone could disqualify you",
      "urgentFix": "<exactly what to do>"
    }
  ],
  
  "strengths": [
    {
      "skill": "<what you have>",
      "howItHelps": "<why this matters for the job>",
      "howToHighlight": "<make it more visible>"
    }
  ],
  
  "hiddenRedFlags": [
    {
      "issue": "<something that raises questions>",
      "whatRecruiterThinks": "<their assumption>",
      "howToAddress": "<fix or explain>"
    }
  ],
  
  "competitorAnalysis": {
    "typicalWinningCandidate": "<profile of who usually gets this job>",
    "howYouCompare": "<honest comparison>",
    "yourCompetitiveAdvantage": "<what you have that others might not>",
    "yourBiggestDisadvantage": "<where you fall short>"
  },
  
  "applicationStrategy": {
    "shouldYouApply": true/false,
    "confidenceLevel": "HIGH|MEDIUM|LOW|VERY_LOW",
    "bestApproach": "APPLY_NOW|CUSTOMIZE_HEAVILY|FIND_REFERRAL|SKIP_THIS_ONE|APPLY_BUT_KEEP_LOOKING",
    "timeWorthInvesting": "<e.g., 'Worth 30 min to customize' or 'Don't spend more than 10 min'>",
    "alternativeStrategy": "<if direct apply won't work, what else?>"
  },
  
  "resumeRewrites": [
    {
      "section": "<which part of resume>",
      "currentText": "<weak text from their resume>",
      "problem": "<why it's weak>",
      "rewrittenText": "<stronger version using JD keywords>",
      "whyBetter": "<explains the improvement>"
    }
  ],
  
  "prioritizedActionPlan": {
    "before_applying": ["<must do before submitting>"],
    "quick_wins": ["<easy fixes with big impact>"],
    "worth_the_effort": ["<harder but valuable>"],
    "long_term": ["<for future applications>"]
  },
  
  "interviewProbability": {
    "percentage": <0-100>,
    "reasoning": "<why this number>",
    "whatWouldIncreaseOdds": "<specific change that would boost chances>"
  },
  
  "bottomLine": {
    "honestAssessment": "<real talk - should they pursue this?>",
    "oneThingToFix": "<if you fix ONE thing, fix this>",
    "encouragement": "<something genuinely encouraging if possible>"
  }
}

Be specific. Use actual words from both the resume and JD. No generic advice.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 3000
    });
    
    const responseText = completion.choices[0]?.message?.content || '';
    console.log('Groq response:', responseText.substring(0, 200));
    
    // Parse JSON from response
    let analysis;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to analyze resume. Please try again.' 
      });
    }
    
    // Build comprehensive result
    const result = {
      overallScore: Math.min(100, Math.max(0, parseInt(analysis.overallScore) || 50)),
      verdict: analysis.verdict || 'Analysis Complete',
      summary: analysis.summary || '',
      
      sixSecondScan: {
        firstImpression: analysis.sixSecondScan?.firstImpression || '',
        standoutElements: analysis.sixSecondScan?.standoutElements || [],
        immediateRedFlags: analysis.sixSecondScan?.immediateRedFlags || [],
        wouldReadMore: analysis.sixSecondScan?.wouldReadMore ?? null,
        whyOrWhyNot: analysis.sixSecondScan?.whyOrWhyNot || ''
      },
      
      atsAnalysis: {
        score: Math.min(100, Math.max(0, parseInt(analysis.atsAnalysis?.score) || 50)),
        likelyToPass: analysis.atsAnalysis?.likelyToPass ?? null,
        keywordsFound: analysis.atsAnalysis?.keywordsFound || [],
        criticalKeywordsMissing: analysis.atsAnalysis?.criticalKeywordsMissing || [],
        suggestionToPassATS: analysis.atsAnalysis?.suggestionToPassATS || ''
      },
      
      qualificationGap: {
        experienceRequired: analysis.qualificationGap?.experienceRequired || '',
        experienceYouHave: analysis.qualificationGap?.experienceYouHave || '',
        gapAssessment: analysis.qualificationGap?.gapAssessment || 'Unknown',
        yearsGap: analysis.qualificationGap?.yearsGap || '',
        canYouCloseGap: analysis.qualificationGap?.canYouCloseGap ?? null,
        howToCloseGap: analysis.qualificationGap?.howToCloseGap || ''
      },
      
      dealbreakers: analysis.dealbreakers || [],
      strengths: analysis.strengths || [],
      hiddenRedFlags: analysis.hiddenRedFlags || [],
      
      competitorAnalysis: {
        typicalWinningCandidate: analysis.competitorAnalysis?.typicalWinningCandidate || '',
        howYouCompare: analysis.competitorAnalysis?.howYouCompare || '',
        yourCompetitiveAdvantage: analysis.competitorAnalysis?.yourCompetitiveAdvantage || '',
        yourBiggestDisadvantage: analysis.competitorAnalysis?.yourBiggestDisadvantage || ''
      },
      
      applicationStrategy: {
        shouldYouApply: analysis.applicationStrategy?.shouldYouApply ?? true,
        confidenceLevel: analysis.applicationStrategy?.confidenceLevel || 'MEDIUM',
        bestApproach: analysis.applicationStrategy?.bestApproach || 'APPLY_NOW',
        timeWorthInvesting: analysis.applicationStrategy?.timeWorthInvesting || '',
        alternativeStrategy: analysis.applicationStrategy?.alternativeStrategy || ''
      },
      
      resumeRewrites: (analysis.resumeRewrites || []).slice(0, 3),
      
      prioritizedActionPlan: {
        before_applying: analysis.prioritizedActionPlan?.before_applying || [],
        quick_wins: analysis.prioritizedActionPlan?.quick_wins || [],
        worth_the_effort: analysis.prioritizedActionPlan?.worth_the_effort || [],
        long_term: analysis.prioritizedActionPlan?.long_term || []
      },
      
      interviewProbability: {
        percentage: Math.min(100, Math.max(0, parseInt(analysis.interviewProbability?.percentage) || 30)),
        reasoning: analysis.interviewProbability?.reasoning || '',
        whatWouldIncreaseOdds: analysis.interviewProbability?.whatWouldIncreaseOdds || ''
      },
      
      bottomLine: {
        honestAssessment: analysis.bottomLine?.honestAssessment || '',
        oneThingToFix: analysis.bottomLine?.oneThingToFix || '',
        encouragement: analysis.bottomLine?.encouragement || ''
      }
    };
    
    console.log('Analysis complete, score:', result.overallScore);
    
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
