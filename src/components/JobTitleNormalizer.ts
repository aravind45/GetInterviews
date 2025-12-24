import { query } from '../database/connection';
import { cacheGet, cacheSet } from '../cache/redis';
import { logger } from '../utils/logger';
import { 
  JobTitleNormalizationResult, 
  CanonicalJobTitle, 
  ConfidenceScore 
} from '../types';

// Generic job titles that require specialization (Requirement 2.2)
const GENERIC_TITLES = [
  'manager',
  'developer',
  'engineer',
  'analyst',
  'consultant',
  'specialist',
  'coordinator',
  'associate',
  'lead',
  'director'
];

// Cache TTL for job title lookups
const CACHE_TTL = 3600; // 1 hour

/**
 * Normalize a job title to its canonical form
 * Implements Requirement 2: Job Target Configuration
 */
export const normalizeJobTitle = async (
  inputTitle: string
): Promise<JobTitleNormalizationResult> => {
  const normalizedInput = inputTitle.trim().toLowerCase();
  
  // Check cache first
  const cacheKey = `job_title:${normalizedInput}`;
  const cached = await cacheGet<JobTitleNormalizationResult>(cacheKey);
  if (cached) {
    logger.debug('Job title cache hit', { title: inputTitle });
    return cached;
  }
  
  // Check if it's a generic title that needs specialization
  const isGeneric = GENERIC_TITLES.some(generic => 
    normalizedInput === generic || 
    normalizedInput.split(' ').length === 1 && normalizedInput.includes(generic)
  );
  
  // Try exact match first
  const exactMatch = await findExactMatch(normalizedInput);
  if (exactMatch) {
    const result: JobTitleNormalizationResult = {
      originalTitle: inputTitle,
      canonicalTitle: exactMatch.title,
      confidence: 100,
      suggestions: [],
      requiresSpecialization: exactMatch.isGeneric || false
    };
    
    await cacheSet(cacheKey, result, CACHE_TTL);
    return result;
  }
  
  // Try variation match
  const variationMatch = await findVariationMatch(normalizedInput);
  if (variationMatch) {
    const result: JobTitleNormalizationResult = {
      originalTitle: inputTitle,
      canonicalTitle: variationMatch.canonicalTitle,
      confidence: variationMatch.confidence,
      suggestions: [],
      requiresSpecialization: variationMatch.isGeneric || false
    };
    
    await cacheSet(cacheKey, result, CACHE_TTL);
    return result;
  }
  
  // Try fuzzy match
  const fuzzyMatches = await findFuzzyMatches(normalizedInput);
  
  if (fuzzyMatches.length > 0 && fuzzyMatches[0].confidence >= 60) {
    const result: JobTitleNormalizationResult = {
      originalTitle: inputTitle,
      canonicalTitle: fuzzyMatches[0].title,
      confidence: fuzzyMatches[0].confidence,
      suggestions: fuzzyMatches.slice(1, 4).map(m => m.title),
      requiresSpecialization: fuzzyMatches[0].isGeneric || isGeneric
    };
    
    await cacheSet(cacheKey, result, CACHE_TTL);
    return result;
  }
  
  // No match found - return suggestions
  const suggestions = await getSuggestions(normalizedInput);
  
  const result: JobTitleNormalizationResult = {
    originalTitle: inputTitle,
    canonicalTitle: null,
    confidence: 0,
    suggestions: suggestions.slice(0, 5),
    requiresSpecialization: isGeneric
  };
  
  await cacheSet(cacheKey, result, CACHE_TTL);
  return result;
};

/**
 * Find exact match in canonical titles
 */
const findExactMatch = async (
  normalizedTitle: string
): Promise<{ title: string; isGeneric: boolean } | null> => {
  try {
    const result = await query<{ title: string; is_generic: boolean }>(
      `SELECT title, is_generic FROM canonical_job_titles 
       WHERE LOWER(title) = $1`,
      [normalizedTitle]
    );
    
    if (result.rows.length > 0) {
      return {
        title: result.rows[0].title,
        isGeneric: result.rows[0].is_generic
      };
    }
    return null;
  } catch (error) {
    logger.error('Error finding exact match:', error);
    return null;
  }
};

/**
 * Find match in job title variations
 */
const findVariationMatch = async (
  normalizedTitle: string
): Promise<{ canonicalTitle: string; confidence: number; isGeneric: boolean } | null> => {
  try {
    const result = await query<{ 
      title: string; 
      confidence_score: number; 
      is_generic: boolean 
    }>(
      `SELECT c.title, v.confidence_score, c.is_generic
       FROM job_title_variations v
       JOIN canonical_job_titles c ON v.canonical_id = c.id
       WHERE LOWER(v.variation) = $1
       ORDER BY v.confidence_score DESC
       LIMIT 1`,
      [normalizedTitle]
    );
    
    if (result.rows.length > 0) {
      return {
        canonicalTitle: result.rows[0].title,
        confidence: result.rows[0].confidence_score,
        isGeneric: result.rows[0].is_generic
      };
    }
    return null;
  } catch (error) {
    logger.error('Error finding variation match:', error);
    return null;
  }
};

/**
 * Find fuzzy matches using trigram similarity
 */
const findFuzzyMatches = async (
  normalizedTitle: string
): Promise<Array<{ title: string; confidence: number; isGeneric: boolean }>> => {
  try {
    // First try canonical titles
    const canonicalResult = await query<{ 
      title: string; 
      similarity: number;
      is_generic: boolean;
    }>(
      `SELECT title, is_generic,
              SIMILARITY(LOWER(title), $1) * 100 as similarity
       FROM canonical_job_titles
       WHERE SIMILARITY(LOWER(title), $1) > 0.3
       ORDER BY similarity DESC
       LIMIT 5`,
      [normalizedTitle]
    );
    
    // Also check variations
    const variationResult = await query<{ 
      title: string; 
      similarity: number;
      is_generic: boolean;
    }>(
      `SELECT c.title, c.is_generic,
              GREATEST(
                SIMILARITY(LOWER(v.variation), $1),
                v.confidence_score::float / 100 * SIMILARITY(LOWER(v.variation), $1)
              ) * 100 as similarity
       FROM job_title_variations v
       JOIN canonical_job_titles c ON v.canonical_id = c.id
       WHERE SIMILARITY(LOWER(v.variation), $1) > 0.3
       ORDER BY similarity DESC
       LIMIT 5`,
      [normalizedTitle]
    );
    
    // Combine and dedupe results
    const combined = new Map<string, { title: string; confidence: number; isGeneric: boolean }>();
    
    for (const row of [...canonicalResult.rows, ...variationResult.rows]) {
      const existing = combined.get(row.title);
      if (!existing || row.similarity > existing.confidence) {
        combined.set(row.title, {
          title: row.title,
          confidence: Math.round(row.similarity),
          isGeneric: row.is_generic
        });
      }
    }
    
    return Array.from(combined.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
      
  } catch (error) {
    // pg_trgm extension might not be available
    logger.warn('Fuzzy matching failed (pg_trgm may not be installed):', error);
    return [];
  }
};

/**
 * Get job title suggestions based on category
 */
const getSuggestions = async (normalizedTitle: string): Promise<string[]> => {
  try {
    // Try to determine category from keywords
    let category = 'Engineering'; // Default
    
    if (/data|analy|science|ml|ai/i.test(normalizedTitle)) {
      category = 'Data';
    } else if (/product|pm|owner/i.test(normalizedTitle)) {
      category = 'Product';
    } else if (/design|ux|ui/i.test(normalizedTitle)) {
      category = 'Design';
    } else if (/market|sales|growth/i.test(normalizedTitle)) {
      category = 'Marketing';
    }
    
    const result = await query<{ title: string }>(
      `SELECT title FROM canonical_job_titles 
       WHERE category = $1 AND is_generic = false
       ORDER BY title
       LIMIT 10`,
      [category]
    );
    
    return result.rows.map(r => r.title);
  } catch (error) {
    logger.error('Error getting suggestions:', error);
    return [];
  }
};

/**
 * Get role template for a canonical job title
 */
export const getRoleTemplate = async (canonicalTitle: string): Promise<{
  requiredSkills: string[];
  preferredSkills: string[];
  requiredKeywords: string[];
  atsKeywords: string[];
  experienceRange: { min: number; max: number | null };
  educationRequirements: string[];
} | null> => {
  try {
    const result = await query<{
      required_skills: string[];
      preferred_skills: string[];
      required_keywords: string[];
      ats_keywords: string[];
      experience_level_min: number;
      experience_level_max: number | null;
      education_requirements: string[];
    }>(
      `SELECT r.required_skills, r.preferred_skills, r.required_keywords,
              r.ats_keywords, r.experience_level_min, r.experience_level_max,
              r.education_requirements
       FROM role_templates r
       JOIN canonical_job_titles c ON r.canonical_job_id = c.id
       WHERE c.title = $1`,
      [canonicalTitle]
    );
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      requiredSkills: row.required_skills || [],
      preferredSkills: row.preferred_skills || [],
      requiredKeywords: row.required_keywords || [],
      atsKeywords: row.ats_keywords || [],
      experienceRange: {
        min: row.experience_level_min,
        max: row.experience_level_max
      },
      educationRequirements: row.education_requirements || []
    };
  } catch (error) {
    logger.error('Error getting role template:', error);
    return null;
  }
};

/**
 * Get canonical job info
 */
export const getCanonicalJobInfo = async (canonicalTitle: string): Promise<{
  id: string;
  title: string;
  category: string;
  seniorityLevel: string;
  industry: string;
} | null> => {
  try {
    const result = await query<{
      id: string;
      title: string;
      category: string;
      seniority_level: string;
      industry: string;
    }>(
      `SELECT id, title, category, seniority_level, industry
       FROM canonical_job_titles
       WHERE title = $1`,
      [canonicalTitle]
    );
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      seniorityLevel: row.seniority_level,
      industry: row.industry
    };
  } catch (error) {
    logger.error('Error getting canonical job info:', error);
    return null;
  }
};

export default {
  normalizeJobTitle,
  getRoleTemplate,
  getCanonicalJobInfo
};
