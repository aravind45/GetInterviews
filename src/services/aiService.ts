
import { Groq } from 'groq-sdk';
import { getProvider, getDefaultProvider } from './llmProvider';
import { getGroqClient } from './groq';

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// Helper to get safe client
const getClient = (): Groq => {
  const client = getGroqClient();
  if (!client) {
    throw new Error('Groq client not initialized. Please configure GROQ_API_KEY.');
  }
  return client;
};

// ============================================================
// CORE RESUME ANALYSIS
// ============================================================
export async function analyzeMatch(
  resumeText: string,
  jobDescription: string,
  provider: string = 'groq'
): Promise<any> {
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

  // Get LLM provider (using llmProvider service would be better, but implementing logic here for now)
  const { getProvider } = require('./llmProvider');
  const llmService = getProvider(provider);

  // NOTE: In a real refactor we should normalize all providers to accept a generic 'chat' request
  // or use a unified interface. For now, since index.ts had specific logic per provider 
  // (Groq vs Claude vs OpenAI), we will stick to Groq here or replicate index.ts logic.
  // The previous index.ts logic manually instantiated Anthropic/OpenAI SDKs.

  // To simplify: We will use the 'Groq' instance we have for defaults, 
  // or if the user selected Claude/OpenAI, we'd need those SDKs.
  // Ideally llmProvider should handle this 'analyze' call generically.
  // But llmProvider.analyzeResume is for the DIAGNOSTIC structure (different JSON).

  // I will implement the Groq call here as a baseline since it's the default.
  // Support for others should be added by refactoring llmProvider eventually.

  const client = getClient();
  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 3000
  });

  const responseText = completion.choices[0]?.message?.content || '';
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('Failed to analyze');
  }

  return JSON.parse(jsonMatch[0]);
}


// ============================================================
// COMPANY RESEARCH HELPER
// ============================================================
export async function researchCompany(companyName: string): Promise<string> {
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
    const prompt = `Provide factual, publicly known information about ${companyName}. Include:
1. What industry/sector they operate in
2. Main products or services (if well-known)
3. Company size/type (startup, enterprise, etc.) if publicly known

Keep it brief (3-4 sentences). ONLY include verified, publicly known facts. If you don't have reliable information, say "Limited public information available about this company."`;

    const client = getClient();
    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
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
// COVER LETTER GENERATOR
// ============================================================
export async function generateCoverLetter(
  resumeText: string,
  jobTitle: string,
  companyName: string,
  jobDescription: string
): Promise<string> {
  const prompt = `Write a compelling cover letter.

CANDIDATE:
${resumeText.substring(0, 3000)}

JOB: ${jobTitle} at ${companyName}
${jobDescription.substring(0, 2000)}

Write a cover letter that:
1. Opens with a hook (NOT "I am writing to apply...")
2. Connects specific experience to job requirements
3. Includes 2-3 achievements with numbers
4. Shows genuine interest in company
5. Ends with confident call to action
6. Is 250-350 words

Return ONLY the cover letter text.`;

  const client = getClient();
  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 800
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

export async function generateSpecificCoverLetter(
  profile: any,
  resumeText: string,
  jobDescription: string,
  companyName: string,
  companyResearch: string,
  achievements: string[],
  analysisData?: any
): Promise<string> {
  const prompt = `You are a cover letter expert. Write a professional, factual cover letter using ONLY information provided below.

CANDIDATE PROFILE:
Name: ${profile.name || 'Candidate'}
Current Role: ${profile.currentTitle || 'Professional'}
Experience: ${profile.yearsExperience || 'Several'}+ years
Key Skills: ${(profile.hardSkills || []).join(', ') || 'various technical skills'}
Key Achievements from Resume:
${achievements.length > 0 ? achievements.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'Professional experience as detailed in resume'}

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

2. WHY THIS COMPANY (2-3 sentences)
- Use ONLY information from the COMPANY INFORMATION section provided above
- If company research shows specific products, services, or initiatives, you may reference them
- Show genuine interest based on researched facts

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

  const client = getClient();
  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1500
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

// ============================================================
// INTERVIEW PREP GENERATOR
// ============================================================
export async function generateInterviewPrep(
  profile: any,
  resumeText: string,
  jobDescription: string,
  companyName: string,
  companyResearch: string,
  achievements: string[],
  analysisData?: any
): Promise<any> {
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

  const prompt = `You are an interview preparation coach. Generate personalized answers for interview questions using ONLY the information provided below.

CANDIDATE PROFILE:
Name: ${profile.name || 'Candidate'}
Current Role: ${profile.currentTitle || 'Professional'}
Experience: ${profile.yearsExperience || 'Several'}+ years
Key Skills: ${(profile.hardSkills || []).join(', ') || 'various technical skills'}
Key Achievements:
${achievements.length > 0 ? achievements.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'Professional experience as detailed in resume'}

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

  const client = getClient();
  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 4000
  });

  const responseText = completion.choices[0]?.message?.content || '';
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    throw new Error('Failed to generate interview preparation');
  }

  return JSON.parse(jsonMatch[0]);
}

// ============================================================
// RESUME OPTIMIZER
// ============================================================
export async function optimizeResume(
  resumeText: string,
  jobDescription: string
): Promise<any> {
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

  const client = getClient();
  const completion = await client.chat.completions.create({
    messages: [{
      role: 'system',
      content: 'You are a professional resume writer. Return ONLY valid JSON, no markdown.'
    }, {
      role: 'user',
      content: prompt
    }],
    model: GROQ_MODEL,
    temperature: 0.3,
    max_tokens: 4000
  });

  const content = completion.choices[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Invalid AI response format');
  }

  return JSON.parse(jsonMatch[0]);
}

// ============================================================
// COMPANY FIT ANALYSIS
// ============================================================
export async function analyzeCompanyFit(
  profile: any,
  companyName: string,
  industry?: string,
  roleKeywords?: string[]
): Promise<any> {
  const prompt = `You are a career strategist. Analyze the fit between a candidate and a target company.
    
    CANDIDATE:
    Title: ${profile.currentTitle || 'Professional'}
    Skills: ${(profile.hardSkills || []).slice(0, 15).join(', ')}
    Target Roles: ${(profile.targetTitles || []).join(', ')}

    TARGET COMPANY:
    Name: ${companyName}
    Industry: ${industry || 'Unknown'}
    Targeting Roles containing: ${(roleKeywords || []).join(', ') || 'General Match'}

    Task:
    Determine if this candidate is a realistic fit for this company based purely on high-level domain/skill alignment. 
    (e.g., If company is "Google" and candidate is "Java Developer", fit is HIGH. If company is "Law Firm" and candidate is "Chef", fit is LOW).

    Return ONLY JSON:
    {
        "score": <0-100 realistic probability>,
        "status": "Strong Match|Potential Match|Stretch|Pivot Required",
        "analysis": "<One sentence explaining WHY giving the brutal truth>"
    }
    `;

  try {
    const { getProvider } = require('./llmProvider');
    // Use default provider (likely Groq)
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 500
    });

    const content = completion.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      // Fallback if JSON parsing fails
      return {
        score: 50,
        status: "Analysis Failed",
        analysis: "Could not retrieve AI analysis at this time."
      };
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Company fit analysis error:', error);
    return {
      score: 0,
      status: "Error",
      analysis: "Service unavailable."
    };
  }
}
