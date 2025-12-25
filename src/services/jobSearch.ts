import { query, transaction } from '../database/connection';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// ATS Platforms and their domains
const ATS_PLATFORMS = {
  workday: 'myworkdayjobs.com',
  greenhouse: 'greenhouse.io',
  lever: 'lever.co',
  icims: 'icims.com',
  smartrecruiters: 'smartrecruiters.com',
  taleo: 'taleo.net',
  jobvite: 'jobvite.com',
  adp: 'workforcenow.adp.com',
  bamboohr: 'bamboohr.com',
  brassring: 'brassring.com',
  breezy: 'breezy.hr',
  bullhorn: 'bullhorn.com',
  jazzhr: 'jazzhr.com',
  jobdiva: 'jobdiva.com',
  successfactors: 'successfactors.com',
  ashby: 'ashbyhq.com',
  rippling: 'rippling.com',
  deel: 'jobs.ashbyhq.com'
};

// Location keywords for different work types
const LOCATION_KEYWORDS = {
  remote: ['remote', 'worldwide', 'work from anywhere', 'work from home', 'distributed', 'anywhere'],
  hybrid: ['hybrid', 'flexible', 'partial remote'],
  onsite: [] // Will use actual city/location
};

export interface JobSearchConfig {
  jobTitle: string;
  location: string;
  locationType: 'remote' | 'hybrid' | 'onsite' | 'any';
  experienceLevel?: 'entry' | 'mid' | 'senior' | 'lead' | 'executive';
  platforms?: string[]; // Subset of ATS platforms to search
  excludeKeywords?: string[];
  includeKeywords?: string[];
}

export interface GeneratedSearch {
  booleanString: string;
  searchUrl: string;
  searchUrlLast24h: string;
  searchUrlLastWeek: string;
  platforms: string[];
}

/**
 * Generate Boolean search string for job search
 */
export const generateBooleanSearch = (config: JobSearchConfig): GeneratedSearch => {
  const { jobTitle, location, locationType, experienceLevel, platforms, excludeKeywords, includeKeywords } = config;
  
  // Build site: operators for ATS platforms
  const selectedPlatforms = platforms && platforms.length > 0 
    ? platforms 
    : Object.keys(ATS_PLATFORMS);
  
  const siteOperators = selectedPlatforms
    .map(p => `site:${ATS_PLATFORMS[p as keyof typeof ATS_PLATFORMS] || p}`)
    .join(' OR ');
  
  // Build job title part
  const titlePart = `("${jobTitle}")`;
  
  // Build location part
  let locationPart = '';
  if (locationType === 'remote') {
    const remoteKeywords = LOCATION_KEYWORDS.remote.map(k => `"${k}"`).join(' OR ');
    locationPart = `(${remoteKeywords})`;
  } else if (locationType === 'hybrid') {
    const hybridKeywords = [...LOCATION_KEYWORDS.hybrid, ...LOCATION_KEYWORDS.remote].map(k => `"${k}"`).join(' OR ');
    locationPart = `(${hybridKeywords})`;
  } else if (locationType === 'onsite' && location) {
    locationPart = `("${location}")`;
  } else if (locationType === 'any') {
    if (location && location.toLowerCase() !== 'anywhere') {
      const allKeywords = [...LOCATION_KEYWORDS.remote, location].map(k => `"${k}"`).join(' OR ');
      locationPart = `(${allKeywords})`;
    }
  }
  
  // Build experience level part
  let experiencePart = '';
  if (experienceLevel) {
    const expKeywords: Record<string, string[]> = {
      entry: ['entry level', 'junior', 'associate', '0-2 years', '1-2 years', 'new grad'],
      mid: ['mid level', 'mid-level', '2-5 years', '3-5 years'],
      senior: ['senior', 'sr.', 'sr', '5+ years', '5-8 years'],
      lead: ['lead', 'principal', 'staff', '8+ years'],
      executive: ['director', 'vp', 'vice president', 'head of', 'c-level', 'chief']
    };
    
    if (expKeywords[experienceLevel]) {
      experiencePart = `(${expKeywords[experienceLevel].map(k => `"${k}"`).join(' OR ')})`;
    }
  }
  
  // Build exclusions
  let excludePart = '';
  if (excludeKeywords && excludeKeywords.length > 0) {
    excludePart = excludeKeywords.map(k => `-"${k}"`).join(' ');
  }
  
  // Build inclusions
  let includePart = '';
  if (includeKeywords && includeKeywords.length > 0) {
    includePart = includeKeywords.map(k => `"${k}"`).join(' OR ');
    includePart = `(${includePart})`;
  }
  
  // Combine all parts
  const parts = [
    `(${siteOperators})`,
    titlePart,
    locationPart,
    experiencePart,
    includePart,
    excludePart
  ].filter(p => p.length > 0);
  
  const booleanString = parts.join(' ');
  
  // Generate Google search URLs
  const baseUrl = 'https://www.google.com/search?q=';
  const encodedQuery = encodeURIComponent(booleanString);
  
  return {
    booleanString,
    searchUrl: `${baseUrl}${encodedQuery}`,
    searchUrlLast24h: `${baseUrl}${encodedQuery}&tbs=qdr:d`,
    searchUrlLastWeek: `${baseUrl}${encodedQuery}&tbs=qdr:w`,
    platforms: selectedPlatforms
  };
};

/**
 * Save a job search configuration
 */
export const saveJobSearch = async (
  sessionId: string,
  diagnosisId: string | null,
  config: JobSearchConfig
): Promise<{ id: string; search: GeneratedSearch }> => {
  const search = generateBooleanSearch(config);
  
  const result = await query(
    `INSERT INTO job_searches (
      session_id, diagnosis_id, job_title, location, location_type,
      experience_level, boolean_string, search_url
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id`,
    [
      sessionId,
      diagnosisId,
      config.jobTitle,
      config.location,
      config.locationType,
      config.experienceLevel || null,
      search.booleanString,
      search.searchUrlLast24h
    ]
  );
  
  logger.info('Job search saved', { 
    searchId: result.rows[0].id, 
    jobTitle: config.jobTitle 
  });
  
  return {
    id: result.rows[0].id,
    search
  };
};

/**
 * Get job searches for a session
 */
export const getJobSearches = async (sessionId: string): Promise<any[]> => {
  const result = await query(
    `SELECT js.*, 
            (SELECT COUNT(*) FROM job_listings WHERE search_id = js.id) as listings_count,
            (SELECT COUNT(*) FROM job_listings WHERE search_id = js.id AND is_new = true) as new_listings_count
     FROM job_searches js
     WHERE js.session_id = $1 AND js.is_active = true
     ORDER BY js.created_at DESC`,
    [sessionId]
  );
  
  return result.rows.map(row => ({
    id: row.id,
    jobTitle: row.job_title,
    location: row.location,
    locationType: row.location_type,
    experienceLevel: row.experience_level,
    booleanString: row.boolean_string,
    searchUrl: row.search_url,
    searchUrlLast24h: `${row.search_url}${row.search_url.includes('?') ? '&' : '?'}tbs=qdr:d`,
    runDaily: row.run_daily,
    lastRunAt: row.last_run_at,
    listingsCount: parseInt(row.listings_count),
    newListingsCount: parseInt(row.new_listings_count),
    createdAt: row.created_at
  }));
};

/**
 * Delete a job search
 */
export const deleteJobSearch = async (searchId: string, sessionId: string): Promise<boolean> => {
  const result = await query(
    `UPDATE job_searches SET is_active = false WHERE id = $1 AND session_id = $2`,
    [searchId, sessionId]
  );
  return result.rowCount > 0;
};

// ============================================
// Job Application Tracking
// ============================================

export interface JobApplication {
  id?: string;
  sessionId: string;
  listingId?: string;
  jobTitle: string;
  company: string;
  location?: string;
  jobUrl?: string;
  atsPlatform?: string;
  status: 'saved' | 'applied' | 'screening' | 'interviewing' | 'offer' | 'rejected' | 'withdrawn' | 'ghosted';
  appliedDate: string;
  responseDate?: string;
  notes?: string;
  resumeVersion?: string;
  coverLetterUsed?: boolean;
  referralSource?: string;
  salaryOffered?: string;
}

/**
 * Add a job application
 */
export const addJobApplication = async (app: JobApplication): Promise<string> => {
  const result = await query(
    `INSERT INTO job_applications (
      session_id, listing_id, job_title, company, location, job_url,
      ats_platform, status, applied_date, notes, resume_version,
      cover_letter_used, referral_source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id`,
    [
      app.sessionId,
      app.listingId || null,
      app.jobTitle,
      app.company,
      app.location || null,
      app.jobUrl || null,
      app.atsPlatform || null,
      app.status,
      app.appliedDate,
      app.notes || null,
      app.resumeVersion || null,
      app.coverLetterUsed || false,
      app.referralSource || null
    ]
  );
  
  logger.info('Job application added', { 
    applicationId: result.rows[0].id, 
    company: app.company,
    status: app.status
  });
  
  return result.rows[0].id;
};

/**
 * Update job application status
 */
export const updateApplicationStatus = async (
  applicationId: string,
  sessionId: string,
  status: JobApplication['status'],
  notes?: string
): Promise<boolean> => {
  const updates: string[] = ['status = $3', 'updated_at = NOW()'];
  const values: any[] = [applicationId, sessionId, status];
  
  if (status === 'interviewing' || status === 'offer' || status === 'rejected') {
    updates.push(`response_date = COALESCE(response_date, CURRENT_DATE)`);
  }
  
  if (notes !== undefined) {
    values.push(notes);
    updates.push(`notes = $${values.length}`);
  }
  
  const result = await query(
    `UPDATE job_applications 
     SET ${updates.join(', ')}
     WHERE id = $1 AND session_id = $2`,
    values
  );
  
  return result.rowCount > 0;
};

/**
 * Get all applications for a session
 */
export const getApplications = async (
  sessionId: string,
  filters?: { status?: string; fromDate?: string; toDate?: string }
): Promise<any[]> => {
  let whereClause = 'session_id = $1';
  const values: any[] = [sessionId];
  
  if (filters?.status) {
    values.push(filters.status);
    whereClause += ` AND status = $${values.length}`;
  }
  
  if (filters?.fromDate) {
    values.push(filters.fromDate);
    whereClause += ` AND applied_date >= $${values.length}`;
  }
  
  if (filters?.toDate) {
    values.push(filters.toDate);
    whereClause += ` AND applied_date <= $${values.length}`;
  }
  
  const result = await query(
    `SELECT * FROM job_applications 
     WHERE ${whereClause}
     ORDER BY applied_date DESC, created_at DESC`,
    values
  );
  
  return result.rows.map(row => ({
    id: row.id,
    jobTitle: row.job_title,
    company: row.company,
    location: row.location,
    jobUrl: row.job_url,
    atsPlatform: row.ats_platform,
    status: row.status,
    appliedDate: row.applied_date,
    responseDate: row.response_date,
    notes: row.notes,
    resumeVersion: row.resume_version,
    coverLetterUsed: row.cover_letter_used,
    referralSource: row.referral_source,
    salaryOffered: row.salary_offered,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
};

/**
 * Get application statistics
 */
export const getApplicationStats = async (sessionId: string): Promise<any> => {
  const result = await query(
    `SELECT * FROM application_stats WHERE session_id = $1`,
    [sessionId]
  );
  
  if (result.rows.length === 0) {
    return {
      totalApplications: 0,
      applied: 0,
      screening: 0,
      interviewing: 0,
      offers: 0,
      rejected: 0,
      ghosted: 0,
      appliedLast7Days: 0,
      appliedLast30Days: 0,
      interviewRate: 0
    };
  }
  
  const row = result.rows[0];
  return {
    totalApplications: parseInt(row.total_applications),
    applied: parseInt(row.applied),
    screening: parseInt(row.screening),
    interviewing: parseInt(row.interviewing),
    offers: parseInt(row.offers),
    rejected: parseInt(row.rejected),
    ghosted: parseInt(row.ghosted),
    appliedLast7Days: parseInt(row.applied_last_7_days),
    appliedLast30Days: parseInt(row.applied_last_30_days),
    interviewRate: parseFloat(row.interview_rate) || 0,
    firstApplication: row.first_application,
    lastApplication: row.last_application
  };
};

/**
 * Delete a job application
 */
export const deleteApplication = async (applicationId: string, sessionId: string): Promise<boolean> => {
  const result = await query(
    `DELETE FROM job_applications WHERE id = $1 AND session_id = $2`,
    [applicationId, sessionId]
  );
  return result.rowCount > 0;
};

/**
 * Get quick search URLs for common job types
 */
export const getQuickSearchUrls = (jobTitle: string): Record<string, string> => {
  const remoteSearch = generateBooleanSearch({
    jobTitle,
    location: 'remote',
    locationType: 'remote'
  });
  
  return {
    last24Hours: remoteSearch.searchUrlLast24h,
    lastWeek: remoteSearch.searchUrlLastWeek,
    allTime: remoteSearch.searchUrl
  };
};

export default {
  generateBooleanSearch,
  saveJobSearch,
  getJobSearches,
  deleteJobSearch,
  addJobApplication,
  updateApplicationStatus,
  getApplications,
  getApplicationStats,
  deleteApplication,
  getQuickSearchUrls,
  ATS_PLATFORMS
};
