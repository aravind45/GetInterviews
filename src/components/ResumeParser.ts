import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../utils/logger';
import { ResumeData, ResumeSection, ResumeMetadata, ProcessingError, TimeoutError } from '../types';

// Configuration
const MAX_PAGES = parseInt(process.env.MAX_RESUME_PAGES || '10');
const PROCESSING_TIMEOUT = parseInt(process.env.UPLOAD_TIMEOUT || '30') * 1000;

// Section patterns for resume parsing
const SECTION_PATTERNS: Record<string, RegExp[]> = {
  contact: [
    /^(contact|personal)\s*(info|information|details)?$/i,
    /^(email|phone|address|location)$/i
  ],
  summary: [
    /^(summary|profile|objective|about|overview)$/i,
    /^(professional|career)\s*(summary|profile|objective)$/i,
    /^(executive|personal)\s*summary$/i
  ],
  experience: [
    /^(work|professional|employment)\s*(experience|history)?$/i,
    /^experience$/i,
    /^(career|job)\s*history$/i
  ],
  education: [
    /^education$/i,
    /^(academic|educational)\s*(background|qualifications|history)?$/i,
    /^degrees?$/i
  ],
  skills: [
    /^(technical\s*)?skills$/i,
    /^(core\s*)?(competencies|qualifications)$/i,
    /^expertise$/i,
    /^proficiencies$/i
  ],
  projects: [
    /^projects?$/i,
    /^(personal|professional|key)\s*projects$/i,
    /^portfolio$/i
  ],
  certifications: [
    /^certifications?$/i,
    /^(professional\s*)?(certifications?|licenses?|credentials?)$/i,
    /^training$/i
  ]
};

// Parse PDF file
const parsePDF = async (filePath: string): Promise<{ text: string; pageCount: number }> => {
  const dataBuffer = fs.readFileSync(filePath);
  
  const options = {
    max: MAX_PAGES, // Limit pages per Requirement 10
    pagerender: undefined // Use default text extraction
  };
  
  const data = await pdfParse(dataBuffer, options);
  
  if (data.numpages > MAX_PAGES) {
    throw new ProcessingError(
      `Resume exceeds maximum page limit (${MAX_PAGES} pages). Please upload a shorter version.`,
      { pageCount: data.numpages, maxPages: MAX_PAGES }
    );
  }
  
  return {
    text: data.text,
    pageCount: data.numpages
  };
};

// Parse Word document
const parseWord = async (filePath: string): Promise<{ text: string; pageCount: number }> => {
  const result = await mammoth.extractRawText({ path: filePath });
  
  // Estimate page count (roughly 3000 chars per page)
  const estimatedPages = Math.ceil(result.value.length / 3000);
  
  if (estimatedPages > MAX_PAGES) {
    throw new ProcessingError(
      `Resume appears to exceed maximum page limit (${MAX_PAGES} pages). Please upload a shorter version.`,
      { estimatedPages, maxPages: MAX_PAGES }
    );
  }
  
  return {
    text: result.value,
    pageCount: estimatedPages
  };
};

// Identify section type from heading
const identifySectionType = (heading: string): ResumeSection['type'] => {
  const normalizedHeading = heading.trim();
  
  for (const [sectionType, patterns] of Object.entries(SECTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedHeading)) {
        return sectionType as ResumeSection['type'];
      }
    }
  }
  
  return 'other';
};

// Extract sections from text
const extractSections = (text: string): ResumeSection[] => {
  const sections: ResumeSection[] = [];
  
  // Common section header patterns
  const headerPattern = /^([A-Z][A-Za-z\s&]+)[\s]*[:|\n]/gm;
  const allCapsPattern = /^([A-Z][A-Z\s&]{2,})$/gm;
  
  let currentSection: Partial<ResumeSection> | null = null;
  let lastIndex = 0;
  
  // Find potential section headers
  const matches: Array<{ heading: string; index: number }> = [];
  
  let match;
  while ((match = headerPattern.exec(text)) !== null) {
    matches.push({ heading: match[1].trim(), index: match.index });
  }
  
  // Also check for all-caps headers
  while ((match = allCapsPattern.exec(text)) !== null) {
    const heading = match[1].trim();
    if (heading.length > 3 && heading.length < 50) {
      matches.push({ heading, index: match.index });
    }
  }
  
  // Sort by index
  matches.sort((a, b) => a.index - b.index);
  
  // Remove duplicates
  const uniqueMatches = matches.filter((m, i) => 
    i === 0 || m.index !== matches[i - 1].index
  );
  
  // Create sections
  for (let i = 0; i < uniqueMatches.length; i++) {
    const current = uniqueMatches[i];
    const nextIndex = i < uniqueMatches.length - 1 
      ? uniqueMatches[i + 1].index 
      : text.length;
    
    const sectionContent = text.substring(current.index, nextIndex).trim();
    
    if (sectionContent.length > 10) { // Minimum content threshold
      sections.push({
        type: identifySectionType(current.heading),
        title: current.heading,
        content: sectionContent,
        startIndex: current.index,
        endIndex: nextIndex
      });
    }
  }
  
  // If no sections found, create a single "other" section
  if (sections.length === 0) {
    sections.push({
      type: 'other',
      title: 'Resume Content',
      content: text,
      startIndex: 0,
      endIndex: text.length
    });
  }
  
  return sections;
};

// Count words in text
const countWords = (text: string): number => {
  return text.split(/\s+/).filter(word => word.length > 0).length;
};

// Main parsing function with timeout
export const parseResume = async (
  filePath: string,
  originalName: string,
  fileSize: number
): Promise<ResumeData> => {
  const startTime = Date.now();
  
  return new Promise(async (resolve, reject) => {
    // Set timeout per Requirement 1 (30 seconds for processing)
    const timeout = setTimeout(() => {
      reject(new TimeoutError('Resume processing timeout exceeded. Please try with a smaller file.'));
    }, PROCESSING_TIMEOUT);
    
    try {
      const ext = path.extname(originalName).toLowerCase();
      let parseResult: { text: string; pageCount: number };
      
      // Parse based on file type
      if (ext === '.pdf') {
        parseResult = await parsePDF(filePath);
      } else if (ext === '.doc' || ext === '.docx') {
        parseResult = await parseWord(filePath);
      } else {
        throw new ProcessingError(`Unsupported file format: ${ext}`);
      }
      
      const { text, pageCount } = parseResult;
      
      // Validate text extraction
      if (!text || text.trim().length < 50) {
        throw new ProcessingError(
          'Could not extract text from resume. Please try a different format or ensure the file is not corrupted.'
        );
      }
      
      // Extract sections
      const sections = extractSections(text);
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Build metadata
      const metadata: ResumeMetadata = {
        pageCount,
        wordCount: countWords(text),
        fileName: originalName,
        fileType: ext.replace('.', '') as 'pdf' | 'doc' | 'docx',
        fileSize,
        processingTime
      };
      
      logger.info('Resume parsed successfully', {
        fileName: originalName,
        pageCount,
        wordCount: metadata.wordCount,
        sectionCount: sections.length,
        processingTime
      });
      
      clearTimeout(timeout);
      
      resolve({
        rawText: text,
        sections,
        metadata,
        extractedAt: new Date()
      });
      
    } catch (error) {
      clearTimeout(timeout);
      
      if (error instanceof ProcessingError || error instanceof TimeoutError) {
        reject(error);
      } else {
        logger.error('Resume parsing failed:', error);
        reject(new ProcessingError(
          'Failed to process resume. Please ensure the file is not corrupted and try again.'
        ));
      }
    }
  });
};

// Extract key information from parsed resume
export const extractKeyInfo = (resumeData: ResumeData): {
  hasContactInfo: boolean;
  hasExperience: boolean;
  hasEducation: boolean;
  hasSkills: boolean;
  experienceYears: number | null;
  skillsList: string[];
} => {
  const sections = resumeData.sections;
  
  const hasContactInfo = sections.some(s => s.type === 'contact') || 
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(resumeData.rawText);
  
  const hasExperience = sections.some(s => s.type === 'experience');
  const hasEducation = sections.some(s => s.type === 'education');
  const hasSkills = sections.some(s => s.type === 'skills');
  
  // Try to extract years of experience
  let experienceYears: number | null = null;
  const yearsMatch = resumeData.rawText.match(/(\d+)\+?\s*years?\s*(of)?\s*(experience|exp)/i);
  if (yearsMatch) {
    experienceYears = parseInt(yearsMatch[1]);
  }
  
  // Extract skills list
  const skillsSection = sections.find(s => s.type === 'skills');
  let skillsList: string[] = [];
  if (skillsSection) {
    // Split by common delimiters
    skillsList = skillsSection.content
      .split(/[,•·|\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 1 && s.length < 50 && !s.includes(':'));
  }
  
  return {
    hasContactInfo,
    hasExperience,
    hasEducation,
    hasSkills,
    experienceYears,
    skillsList
  };
};

export default {
  parseResume,
  extractKeyInfo
};
