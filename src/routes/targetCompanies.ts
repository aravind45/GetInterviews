import { Router, Request, Response } from 'express';
import { query, transaction } from '../database/connection';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/target-companies
 * Get all target companies for a session with statistics
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.query;

  if (!sessionId) {
    throw createError(400, 'sessionId is required');
  }

  // Get companies with statistics
  const result = await query(`
    SELECT * FROM target_companies_summary
    WHERE session_id = $1
    ORDER BY priority ASC, company_name ASC
  `, [sessionId]);

  res.json({
    success: true,
    data: {
      companies: result.rows,
      stats: result.rows.length > 0 ? {
        total: result.rows.length,
        activeCount: result.rows.filter((c: any) => c.is_active).length,
        totalJobsFound: result.rows.reduce((sum: number, c: any) => sum + (c.total_jobs_found || 0), 0),
        newJobsCount: result.rows.reduce((sum: number, c: any) => sum + (c.new_jobs_count || 0), 0)
      } : null
    }
  });
}));

/**
 * GET /api/target-companies/suggestions
 * Get global company suggestions
 */
router.get('/suggestions', asyncHandler(async (req: Request, res: Response) => {
  const result = await query(`
    SELECT
      company_name,
      company_domain,
      industry,
      company_size,
      description,
      careers_page_url,
      linkedin_url
    FROM global_company_suggestions
    WHERE is_popular = TRUE
    ORDER BY company_name ASC
  `);

  res.json({
    success: true,
    data: {
      suggestions: result.rows
    }
  });
}));

/**
 * POST /api/target-companies
 * Add a new target company
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const {
    sessionId,
    companyName,
    companyDomain,
    industry,
    companySize,
    priority = 3,
    notes,
    targetRoles,
    locationPreference,
    referralContact
  } = req.body;

  if (!sessionId || !companyName) {
    throw createError(400, 'sessionId and companyName are required');
  }

  // Verify session exists
  const sessionCheck = await query(
    'SELECT id FROM user_sessions WHERE id = $1 AND expires_at > NOW()',
    [sessionId]
  );

  if (sessionCheck.rows.length === 0) {
    throw createError(404, 'Session not found or expired');
  }

  // Insert new company
  const result = await query(`
    INSERT INTO target_companies (
      session_id, company_name, company_domain, industry, company_size,
      priority, notes, target_roles, location_preference, referral_contact
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    sessionId,
    companyName,
    companyDomain,
    industry,
    companySize,
    priority,
    notes,
    targetRoles || [],
    locationPreference,
    referralContact
  ]);

  logger.info('Target company added', {
    sessionId,
    companyName,
    companyId: result.rows[0].id
  });

  res.json({
    success: true,
    data: {
      company: result.rows[0]
    },
    message: `${companyName} added to your target companies`
  });
}));

/**
 * POST /api/target-companies/bulk
 * Add multiple companies from suggestions at once
 */
router.post('/bulk', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, companyNames } = req.body;

  if (!sessionId || !Array.isArray(companyNames) || companyNames.length === 0) {
    throw createError(400, 'sessionId and companyNames array are required');
  }

  // Verify session exists
  const sessionCheck = await query(
    'SELECT id FROM user_sessions WHERE id = $1 AND expires_at > NOW()',
    [sessionId]
  );

  if (sessionCheck.rows.length === 0) {
    throw createError(404, 'Session not found or expired');
  }

  // Get company details from suggestions
  const suggestions = await query(`
    SELECT * FROM global_company_suggestions
    WHERE company_name = ANY($1)
  `, [companyNames]);

  const added = [];
  const skipped = [];

  for (const suggestion of suggestions.rows) {
    try {
      const result = await query(`
        INSERT INTO target_companies (
          session_id, company_name, company_domain, industry, company_size, priority
        )
        VALUES ($1, $2, $3, $4, $5, 3)
        RETURNING id, company_name
      `, [
        sessionId,
        suggestion.company_name,
        suggestion.company_domain,
        suggestion.industry,
        suggestion.company_size
      ]);
      added.push(result.rows[0]);
    } catch (error: any) {
      if (error.code === '23505') { // Unique constraint violation
        skipped.push(suggestion.company_name);
      } else {
        throw error;
      }
    }
  }

  logger.info('Bulk companies added', {
    sessionId,
    addedCount: added.length,
    skippedCount: skipped.length
  });

  res.json({
    success: true,
    data: {
      added,
      skipped,
      stats: {
        totalRequested: companyNames.length,
        successfullyAdded: added.length,
        alreadyExisted: skipped.length
      }
    },
    message: `${added.length} companies added successfully`
  });
}));

/**
 * PUT /api/target-companies/:id
 * Update a target company
 */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    sessionId,
    companyName,
    companyDomain,
    industry,
    companySize,
    priority,
    notes,
    targetRoles,
    locationPreference,
    referralContact,
    isActive
  } = req.body;

  if (!sessionId) {
    throw createError(400, 'sessionId is required');
  }

  // Build update query dynamically
  const updates: string[] = [];
  const values: any[] = [id, sessionId];
  let paramCounter = 3;

  if (companyName !== undefined) {
    updates.push(`company_name = $${paramCounter++}`);
    values.push(companyName);
  }
  if (companyDomain !== undefined) {
    updates.push(`company_domain = $${paramCounter++}`);
    values.push(companyDomain);
  }
  if (industry !== undefined) {
    updates.push(`industry = $${paramCounter++}`);
    values.push(industry);
  }
  if (companySize !== undefined) {
    updates.push(`company_size = $${paramCounter++}`);
    values.push(companySize);
  }
  if (priority !== undefined) {
    updates.push(`priority = $${paramCounter++}`);
    values.push(priority);
  }
  if (notes !== undefined) {
    updates.push(`notes = $${paramCounter++}`);
    values.push(notes);
  }
  if (targetRoles !== undefined) {
    updates.push(`target_roles = $${paramCounter++}`);
    values.push(targetRoles);
  }
  if (locationPreference !== undefined) {
    updates.push(`location_preference = $${paramCounter++}`);
    values.push(locationPreference);
  }
  if (referralContact !== undefined) {
    updates.push(`referral_contact = $${paramCounter++}`);
    values.push(referralContact);
  }
  if (isActive !== undefined) {
    updates.push(`is_active = $${paramCounter++}`);
    values.push(isActive);
  }

  if (updates.length === 0) {
    throw createError(400, 'No fields to update');
  }

  const result = await query(`
    UPDATE target_companies
    SET ${updates.join(', ')}
    WHERE id = $1 AND session_id = $2
    RETURNING *
  `, values);

  if (result.rows.length === 0) {
    throw createError(404, 'Company not found or access denied');
  }

  logger.info('Target company updated', {
    sessionId,
    companyId: id,
    fieldsUpdated: updates.length
  });

  res.json({
    success: true,
    data: {
      company: result.rows[0]
    },
    message: 'Company updated successfully'
  });
}));

/**
 * DELETE /api/target-companies/:id
 * Remove a target company
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { sessionId } = req.query;

  if (!sessionId) {
    throw createError(400, 'sessionId is required');
  }

  const result = await query(`
    DELETE FROM target_companies
    WHERE id = $1 AND session_id = $2
    RETURNING company_name
  `, [id, sessionId]);

  if (result.rows.length === 0) {
    throw createError(404, 'Company not found or access denied');
  }

  logger.info('Target company deleted', {
    sessionId,
    companyId: id,
    companyName: result.rows[0].company_name
  });

  res.json({
    success: true,
    message: `${result.rows[0].company_name} removed from target companies`
  });
}));

/**
 * GET /api/target-companies/:id/jobs
 * Get all jobs found for a specific target company
 */
router.get('/:id/jobs', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { sessionId, includeApplied = 'true' } = req.query;

  if (!sessionId) {
    throw createError(400, 'sessionId is required');
  }

  let jobsQuery = `
    SELECT * FROM company_job_listings
    WHERE company_id = $1 AND session_id = $2
  `;

  if (includeApplied === 'false') {
    jobsQuery += ' AND applied = FALSE';
  }

  jobsQuery += ' ORDER BY discovered_at DESC';

  const result = await query(jobsQuery, [id, sessionId]);

  res.json({
    success: true,
    data: {
      jobs: result.rows,
      stats: {
        total: result.rows.length,
        newJobs: result.rows.filter((j: any) => j.is_new).length,
        bookmarked: result.rows.filter((j: any) => j.bookmarked).length,
        applied: result.rows.filter((j: any) => j.applied).length
      }
    }
  });
}));

/**
 * POST /api/target-companies/:id/search
 * Perform a job search for a specific target company
 */
router.post('/:id/search', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { sessionId, searchQuery, roles } = req.body;

  if (!sessionId) {
    throw createError(400, 'sessionId is required');
  }

  // Get company details
  const companyResult = await query(`
    SELECT * FROM target_companies
    WHERE id = $1 AND session_id = $2
  `, [id, sessionId]);

  if (companyResult.rows.length === 0) {
    throw createError(404, 'Company not found');
  }

  const company = companyResult.rows[0];

  // Generate search URLs for different platforms
  const searchPlatforms = generateSearchUrls(
    company.company_name,
    searchQuery || roles?.join(' OR ') || '',
    company.location_preference
  );

  // Record the search
  const searchResults = [];

  for (const platform of searchPlatforms) {
    const searchRecord = await query(`
      INSERT INTO company_job_searches (
        company_id, session_id, search_query, search_platform, search_url
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      id,
      sessionId,
      searchQuery || roles?.join(', ') || 'all roles',
      platform.name,
      platform.url
    ]);

    searchResults.push({
      platform: platform.name,
      url: platform.url,
      searchId: searchRecord.rows[0].id
    });
  }

  logger.info('Company job search performed', {
    sessionId,
    companyId: id,
    companyName: company.company_name,
    platforms: searchPlatforms.length
  });

  res.json({
    success: true,
    data: {
      company: company.company_name,
      searchQuery: searchQuery || roles?.join(', ') || 'all roles',
      searchUrls: searchResults
    },
    message: `Search initiated for ${company.company_name}`
  });
}));

/**
 * Helper: Generate search URLs for various platforms
 */
function generateSearchUrls(
  companyName: string,
  query: string,
  location: string = ''
): Array<{ name: string; url: string }> {
  const encodeName = encodeURIComponent(companyName);
  const encodeQuery = encodeURIComponent(`${query} ${companyName}`.trim());
  const encodeLocation = encodeURIComponent(location);

  return [
    {
      name: 'linkedin',
      url: `https://www.linkedin.com/jobs/search/?keywords=${encodeQuery}&location=${encodeLocation}&f_C=${encodeName}`
    },
    {
      name: 'indeed',
      url: `https://www.indeed.com/jobs?q=${encodeQuery}&l=${encodeLocation}`
    },
    {
      name: 'glassdoor',
      url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeQuery}&locT=C&locKeyword=${encodeLocation}`
    },
    {
      name: 'google',
      url: `https://www.google.com/search?q=${encodeQuery}+jobs+${encodeLocation}&ibp=htl;jobs`
    }
  ];
}

/**
 * GET /api/target-companies/stats
 * Get overall statistics for target companies
 */
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.query;

  if (!sessionId) {
    throw createError(400, 'sessionId is required');
  }

  const stats = await query(`
    SELECT * FROM target_companies_stats
    WHERE session_id = $1
  `, [sessionId]);

  res.json({
    success: true,
    data: stats.rows[0] || {
      total_companies: 0,
      active_companies: 0,
      high_priority: 0,
      medium_high_priority: 0,
      medium_priority: 0
    }
  });
}));

export default router;
