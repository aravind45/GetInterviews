
import fs from 'fs';
import path from 'path';
// @ts-ignore
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { getProvider, getDefaultProvider } from './llmProvider';

/**
 * Parse resume file to text
 */
export async function parseResume(filePath: string, mimeType: string): Promise<string> {
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
 * Extract structured profile from resume text using LLM
 */
export async function extractProfileFromResume(resumeText: string, providerName?: string): Promise<any> {
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

    // Get provider
    const selectedProvider = (providerName as any) || getDefaultProvider();
    const providerService = getProvider(selectedProvider);

    // We need to use the provider's generic chat/analyze method. 
    // However, llmProvider currently has 'analyzeResume' which is specific for the diagnostic.
    // We might need to expose a raw 'chat' or 'complete' method in llmProvider or just instantiate Groq here for now 
    // to match index.ts behavior, OR refactor llmProvider to be more generic.

    // For now, to minimize risk, we will replicate the Groq call here as it was in index.ts
    // but we should eventually improve llmProvider.
    // index.ts used Groq directly for this.

    const { Groq } = require('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
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
