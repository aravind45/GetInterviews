import Groq from 'groq-sdk';
import { logger } from '../utils/logger';
import { 
  ResumeData, 
  RootCause, 
  ActionableRecommendation, 
  Evidence,
  ConfidenceScore,
  ProcessingError,
  TimeoutError
} from '../types';

let groqClient: Groq | null = null;

/**
 * Initialize Groq client
 */
export const initializeGroq = (): void => {
  const apiKey = process.env.GROQ_API_KEY;
  
  if (!apiKey || apiKey === 'your-groq-api-key-here') {
    logger.warn('GROQ_API_KEY not configured - AI analysis will be unavailable');
    return;
  }
  
  groqClient = new Groq({ apiKey });
  logger.info('Groq client initialized');
};

/**
 * Get Groq client
 */
export const getGroqClient = (): Groq | null => {
  return groqClient;
};

/**
 * Check if Groq is available
 */
export const isGroqAvailable = (): boolean => {
  return groqClient !== null;
};

/**
 * Analyze resume and generate diagnosis
 */
export const analyzeResume = async (
  resumeData: ResumeData,
  targetJob: {
    title: string;
    category: string;
    seniorityLevel: string;
    requiredSkills: string[];
    requiredKeywords: string[];
  },
  jobDescription?: string
): Promise<{
  rootCauses: RootCause[];
  recommendations: ActionableRecommendation[];
  overallConfidence: ConfidenceScore;
  confidenceExplanation: string;
  isCompetitive: boolean;
  dataCompleteness: number;
}> => {
  if (!groqClient) {
    throw new ProcessingError('AI analysis service is not configured');
  }
  
  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const timeout = parseInt(process.env.ANALYSIS_TIMEOUT || '60') * 1000;
  
  // Anonymize PII before sending to AI (Requirement 9.4)
  const anonymizedResume = anonymizeResume(resumeData.rawText);
  
  // Build the analysis prompt
  const prompt = buildAnalysisPrompt(
    anonymizedResume,
    resumeData.sections.map(s => ({ type: s.type, title: s.title })),
    targetJob,
    jobDescription
  );
  
  try {
    const response = await Promise.race([
      groqClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new TimeoutError('AI analysis timeout')), timeout)
      )
    ]);
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new ProcessingError('Empty response from AI service');
    }
    
    // Parse and validate the response
    const analysis = parseAnalysisResponse(content);
    
    logger.info('AI analysis completed', {
      rootCausesCount: analysis.rootCauses.length,
      recommendationsCount: analysis.recommendations.length,
      confidence: analysis.overallConfidence
    });
    
    return analysis;
    
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw error;
    }
    
    logger.error('AI analysis failed:', error);
    throw new ProcessingError('AI analysis failed. Please try again.');
  }
};

/**
 * Anonymize PII from resume text
 */
const anonymizeResume = (text: string): string => {
  let anonymized = text;
  
  // Email addresses
  anonymized = anonymized.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    '[EMAIL]'
  );
  
  // Phone numbers
  anonymized = anonymized.replace(
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    '[PHONE]'
  );
  
  // Social Security Numbers
  anonymized = anonymized.replace(
    /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
    '[SSN]'
  );
  
  // Street addresses (basic)
  anonymized = anonymized.replace(
    /\d+\s+[A-Za-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct)[.,]?\s*\n?/gi,
    '[ADDRESS] '
  );
  
  // LinkedIn URLs
  anonymized = anonymized.replace(
    /https?:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9-]+\/?/gi,
    '[LINKEDIN]'
  );
  
  // GitHub URLs  
  anonymized = anonymized.replace(
    /https?:\/\/(www\.)?github\.com\/[A-Za-z0-9-]+\/?/gi,
    '[GITHUB]'
  );
  
  return anonymized;
};

/**
 * Build analysis prompt
 */
const buildAnalysisPrompt = (
  resumeText: string,
  sections: Array<{ type: string; title: string }>,
  targetJob: {
    title: string;
    category: string;
    seniorityLevel: string;
    requiredSkills: string[];
    requiredKeywords: string[];
  },
  jobDescription?: string
): string => {
  let prompt = `Analyze this resume for the target position: ${targetJob.title} (${targetJob.seniorityLevel} level, ${targetJob.category})

RESUME CONTENT:
${resumeText.substring(0, 6000)} ${resumeText.length > 6000 ? '...[truncated]' : ''}

RESUME SECTIONS DETECTED:
${sections.map(s => `- ${s.title} (${s.type})`).join('\n')}

TARGET ROLE REQUIREMENTS:
- Required Skills: ${targetJob.requiredSkills.join(', ')}
- Key Keywords: ${targetJob.requiredKeywords.join(', ')}
`;

  if (jobDescription) {
    prompt += `
JOB DESCRIPTION:
${jobDescription.substring(0, 2000)}
`;
  }

  prompt += `
ANALYSIS TASK:
1. Identify the TOP 5 root causes preventing this candidate from getting interviews
2. For each root cause, provide SPECIFIC evidence from the resume
3. Generate TOP 3 actionable recommendations to fix the most critical issues
4. Assess overall competitiveness for the target role

Focus on specific, citable issues - not generic advice. Be direct and actionable.
`;

  return prompt;
};

const SYSTEM_PROMPT = `You are an expert resume analyst and career coach specializing in identifying why job seekers don't receive interview invitations.

Your analysis must:
1. Be SPECIFIC - cite exact sections, missing keywords, or formatting issues from the resume
2. Be ACTIONABLE - provide implementable fixes, not vague suggestions  
3. Be PRIORITIZED - rank issues by severity (1-10) and impact (1-10)
4. Be EVIDENCE-BASED - every claim must have supporting evidence
5. Be HONEST - if the resume is competitive, say so

You must respond in valid JSON format with this structure:
{
  "rootCauses": [
    {
      "title": "Clear, specific issue title",
      "description": "Detailed explanation of the problem",
      "category": "keyword_mismatch|experience_gap|skill_deficiency|formatting_issue|ats_compatibility|quantification_missing|relevance_issue|career_progression|education_mismatch|other",
      "severityScore": 1-10,
      "impactScore": 1-10,
      "evidence": [
        {
          "type": "resume_section|missing_keyword|formatting|market_data|comparison",
          "description": "What the evidence shows",
          "citation": "Exact text or specific reference from resume",
          "confidence": 0-100
        }
      ]
    }
  ],
  "recommendations": [
    {
      "title": "Clear action title",
      "description": "What to do and why",
      "implementationSteps": ["Step 1", "Step 2", "Step 3"],
      "expectedImpact": 1-10,
      "difficulty": "easy|medium|hard",
      "timeEstimate": "e.g., 30 minutes, 2 hours",
      "relatedRootCause": "title of related root cause"
    }
  ],
  "overallConfidence": 0-100,
  "confidenceExplanation": "Why this confidence level based on data quality",
  "isCompetitive": true/false,
  "dataCompleteness": 0-100
}

Limit root causes to 5 maximum, recommendations to 3 maximum.
Lower confidence if resume has missing sections or unclear information.`;

/**
 * Parse and validate AI response
 */
const parseAnalysisResponse = (content: string): {
  rootCauses: RootCause[];
  recommendations: ActionableRecommendation[];
  overallConfidence: ConfidenceScore;
  confidenceExplanation: string;
  isCompetitive: boolean;
  dataCompleteness: number;
} => {
  try {
    const parsed = JSON.parse(content);
    
    // Validate and transform root causes
    const rootCauses: RootCause[] = (parsed.rootCauses || [])
      .slice(0, 5) // Max 5 per Requirement 4
      .map((rc: any, index: number) => ({
        id: `rc-${index + 1}`,
        title: String(rc.title || 'Unknown Issue'),
        description: String(rc.description || ''),
        category: validateCategory(rc.category),
        severityScore: clamp(Number(rc.severityScore) || 5, 1, 10),
        impactScore: clamp(Number(rc.impactScore) || 5, 1, 10),
        evidence: (rc.evidence || []).map((e: any, eIndex: number) => ({
          type: validateEvidenceType(e.type),
          description: String(e.description || ''),
          citation: String(e.citation || 'No citation provided'),
          location: e.location,
          confidence: clamp(Number(e.confidence) || 50, 0, 100)
        })),
        priority: index + 1
      }));
    
    // Validate and transform recommendations
    const recommendations: ActionableRecommendation[] = (parsed.recommendations || [])
      .slice(0, 3) // Max 3 per Requirement 5
      .map((rec: any, index: number) => ({
        id: `rec-${index + 1}`,
        title: String(rec.title || 'Unknown Recommendation'),
        description: String(rec.description || ''),
        implementationSteps: Array.isArray(rec.implementationSteps) 
          ? rec.implementationSteps.map(String)
          : ['Review and implement this recommendation'],
        expectedImpact: clamp(Number(rec.expectedImpact) || 5, 1, 10),
        difficulty: validateDifficulty(rec.difficulty),
        timeEstimate: String(rec.timeEstimate || '1-2 hours'),
        relatedRootCause: String(rec.relatedRootCause || ''),
        priority: index + 1
      }));
    
    return {
      rootCauses,
      recommendations,
      overallConfidence: clamp(Number(parsed.overallConfidence) || 50, 0, 100),
      confidenceExplanation: String(parsed.confidenceExplanation || 'Based on available resume data'),
      isCompetitive: Boolean(parsed.isCompetitive),
      dataCompleteness: clamp(Number(parsed.dataCompleteness) || 50, 0, 100)
    };
    
  } catch (error) {
    logger.error('Failed to parse AI response:', error);
    throw new ProcessingError('Failed to process AI analysis results');
  }
};

// Helper functions
const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const validateCategory = (category: string): RootCause['category'] => {
  const valid = [
    'keyword_mismatch', 'experience_gap', 'skill_deficiency',
    'formatting_issue', 'ats_compatibility', 'quantification_missing',
    'relevance_issue', 'career_progression', 'education_mismatch', 'other'
  ];
  return valid.includes(category) ? category as RootCause['category'] : 'other';
};

const validateEvidenceType = (type: string): Evidence['type'] => {
  const valid = ['resume_section', 'missing_keyword', 'formatting', 'market_data', 'comparison'];
  return valid.includes(type) ? type as Evidence['type'] : 'resume_section';
};

const validateDifficulty = (difficulty: string): 'easy' | 'medium' | 'hard' => {
  const valid = ['easy', 'medium', 'hard'];
  return valid.includes(difficulty) ? difficulty as 'easy' | 'medium' | 'hard' : 'medium';
};

export default {
  initializeGroq,
  getGroqClient,
  isGroqAvailable,
  analyzeResume
};
