/**
 * ICA (Ideal Contact Advocates) Routes
 *
 * Handles LinkedIn contact import, categorization, and management
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import {
  parseLinkedInCSV,
  validateLinkedInCSV,
  suggestICACategory,
  ParsedContact,
} from '../services/linkedinParser';
import { getPool } from '../database/connection';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// Configure multer for CSV file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

/**
 * POST /api/ica/upload/:sessionId
 * Upload and parse LinkedIn Connections CSV
 */
router.post('/upload/:sessionId', upload.single('file'), async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  try {
    // Validate session exists
    const pool = getPool();
    const sessionResult = await pool.query(
      'SELECT id FROM user_sessions WHERE id = $1 AND is_active = true AND expires_at > NOW()',
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      throw new AppError('Invalid or expired session', 401);
    }

    // Validate CSV format
    validateLinkedInCSV(req.file.buffer);

    // Parse CSV
    const parseResult = parseLinkedInCSV(req.file.buffer);

    if (parseResult.contacts.length === 0) {
      throw new AppError('No valid contacts found in CSV file', 400);
    }

    // Create import batch record
    const batchId = uuidv4();
    await pool.query(
      `INSERT INTO contact_import_batches
       (id, session_id, filename, total_contacts, successful_imports, failed_imports)
       VALUES ($1, $2, $3, $4, 0, 0)`,
      [batchId, sessionId, req.file.originalname, parseResult.totalRows]
    );

    // Get user's target job title if available (for better categorization)
    const analysisResult = await pool.query(
      `SELECT target_job_title FROM resume_analyses
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId]
    );
    const targetJobTitle = analysisResult.rows[0]?.target_job_title;

    // Insert contacts into database
    let successfulImports = 0;
    let duplicateContacts = 0;
    const importErrors: any[] = [];

    for (const contact of parseResult.contacts) {
      try {
        // Suggest ICA category
        const suggestedCategory = suggestICACategory(contact, targetJobTitle);

        await pool.query(
          `INSERT INTO linkedin_contacts
           (session_id, first_name, last_name, email_address, company, position,
            connected_on, ica_category, import_batch_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (session_id, first_name, last_name, company)
           DO NOTHING`,
          [
            sessionId,
            contact.firstName,
            contact.lastName,
            contact.emailAddress,
            contact.company,
            contact.position,
            contact.connectedOn,
            suggestedCategory,
            batchId,
          ]
        );

        successfulImports++;
      } catch (error) {
        if (error instanceof Error && error.message.includes('duplicate')) {
          duplicateContacts++;
        } else {
          importErrors.push({
            contact: `${contact.firstName} ${contact.lastName}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // Update batch record with results
    await pool.query(
      `UPDATE contact_import_batches
       SET successful_imports = $1,
           failed_imports = $2,
           duplicate_contacts = $3,
           import_errors = $4
       WHERE id = $5`,
      [
        successfulImports,
        importErrors.length,
        duplicateContacts,
        JSON.stringify(importErrors),
        batchId,
      ]
    );

    res.json({
      success: true,
      batchId,
      stats: {
        totalRows: parseResult.totalRows,
        successfulImports,
        duplicateContacts,
        failedImports: importErrors.length,
        parseErrors: parseResult.errors.length,
      },
      errors: importErrors.length > 0 ? importErrors : undefined,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      `Failed to process LinkedIn CSV: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});

/**
 * GET /api/ica/contacts/:sessionId
 * Get all contacts for a session
 */
router.get('/contacts/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { category, search } = req.query;

  try {
    const pool = getPool();
    let query = `
      SELECT
        id, first_name, last_name, email_address, company, position,
        connected_on, ica_category, category_reason, notes, last_contacted,
        contact_frequency, relationship_strength, created_at, updated_at
      FROM linkedin_contacts
      WHERE session_id = $1
    `;

    const params: any[] = [sessionId];
    let paramIndex = 2;

    // Filter by category
    if (category && category !== 'all') {
      query += ` AND ica_category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    // Search filter
    if (search && typeof search === 'string') {
      query += ` AND (
        LOWER(first_name) LIKE $${paramIndex} OR
        LOWER(last_name) LIKE $${paramIndex} OR
        LOWER(company) LIKE $${paramIndex} OR
        LOWER(position) LIKE $${paramIndex}
      )`;
      params.push(`%${search.toLowerCase()}%`);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      contacts: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    throw new AppError(
      `Failed to fetch contacts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});

/**
 * PATCH /api/ica/contacts/:sessionId/:contactId
 * Update contact categorization and notes
 */
router.patch('/contacts/:sessionId/:contactId', async (req: Request, res: Response) => {
  const { sessionId, contactId } = req.params;
  const { icaCategory, categoryReason, notes, lastContacted, contactFrequency, relationshipStrength } = req.body;

  try {
    const pool = getPool();
    // Verify contact belongs to session
    const contactResult = await pool.query(
      'SELECT id FROM linkedin_contacts WHERE id = $1 AND session_id = $2',
      [contactId, sessionId]
    );

    if (contactResult.rows.length === 0) {
      throw new AppError('Contact not found', 404);
    }

    // Build update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (icaCategory !== undefined) {
      updates.push(`ica_category = $${paramIndex}`);
      params.push(icaCategory);
      paramIndex++;
    }

    if (categoryReason !== undefined) {
      updates.push(`category_reason = $${paramIndex}`);
      params.push(categoryReason);
      paramIndex++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      params.push(notes);
      paramIndex++;
    }

    if (lastContacted !== undefined) {
      updates.push(`last_contacted = $${paramIndex}`);
      params.push(lastContacted);
      paramIndex++;
    }

    if (contactFrequency !== undefined) {
      updates.push(`contact_frequency = $${paramIndex}`);
      params.push(contactFrequency);
      paramIndex++;
    }

    if (relationshipStrength !== undefined) {
      updates.push(`relationship_strength = $${paramIndex}`);
      params.push(relationshipStrength);
      paramIndex++;
    }

    if (updates.length === 0) {
      throw new AppError('No fields to update', 400);
    }

    params.push(contactId);
    const query = `
      UPDATE linkedin_contacts
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      contact: result.rows[0],
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      `Failed to update contact: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});

/**
 * DELETE /api/ica/contacts/:sessionId/:contactId
 * Delete a contact
 */
router.delete('/contacts/:sessionId/:contactId', async (req: Request, res: Response) => {
  const { sessionId, contactId } = req.params;

  try {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM linkedin_contacts WHERE id = $1 AND session_id = $2 RETURNING id',
      [contactId, sessionId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Contact not found', 404);
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      `Failed to delete contact: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});

/**
 * GET /api/ica/stats/:sessionId
 * Get ICA statistics for a session
 */
router.get('/stats/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM ica_stats WHERE session_id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      res.json({
        success: true,
        stats: {
          totalContacts: 0,
          highPotential: 0,
          mediumPotential: 0,
          lowPotential: 0,
          uncategorized: 0,
          uniqueCompanies: 0,
          contacted: 0,
          contactedLast30Days: 0,
          avgRelationshipStrength: 0,
        },
      });
      return;
    }

    res.json({
      success: true,
      stats: {
        totalContacts: result.rows[0].total_contacts,
        highPotential: result.rows[0].high_potential,
        mediumPotential: result.rows[0].medium_potential,
        lowPotential: result.rows[0].low_potential,
        uncategorized: result.rows[0].uncategorized,
        uniqueCompanies: result.rows[0].unique_companies,
        contacted: result.rows[0].contacted,
        contactedLast30Days: result.rows[0].contacted_last_30_days,
        avgRelationshipStrength: result.rows[0].avg_relationship_strength,
      },
    });
  } catch (error) {
    throw new AppError(
      `Failed to fetch ICA stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});

/**
 * POST /api/ica/interactions/:sessionId/:contactId
 * Log an interaction with a contact
 */
router.post('/interactions/:sessionId/:contactId', async (req: Request, res: Response) => {
  const { sessionId, contactId } = req.params;
  const { interactionType, interactionDate, notes, outcome } = req.body;

  try {
    const pool = getPool();
    // Verify contact belongs to session
    const contactResult = await pool.query(
      'SELECT id FROM linkedin_contacts WHERE id = $1 AND session_id = $2',
      [contactId, sessionId]
    );

    if (contactResult.rows.length === 0) {
      throw new AppError('Contact not found', 404);
    }

    // Create interaction record
    const result = await pool.query(
      `INSERT INTO contact_interactions
       (contact_id, interaction_type, interaction_date, notes, outcome)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [contactId, interactionType, interactionDate || new Date(), notes, outcome]
    );

    // Update last_contacted date on the contact
    await pool.query(
      'UPDATE linkedin_contacts SET last_contacted = $1 WHERE id = $2',
      [interactionDate || new Date(), contactId]
    );

    res.json({
      success: true,
      interaction: result.rows[0],
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      `Failed to log interaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});

/**
 * GET /api/ica/interactions/:sessionId/:contactId
 * Get interaction history for a contact
 */
router.get('/interactions/:sessionId/:contactId', async (req: Request, res: Response) => {
  const { sessionId, contactId } = req.params;

  try {
    const pool = getPool();
    // Verify contact belongs to session
    const contactResult = await pool.query(
      'SELECT id FROM linkedin_contacts WHERE id = $1 AND session_id = $2',
      [contactId, sessionId]
    );

    if (contactResult.rows.length === 0) {
      throw new AppError('Contact not found', 404);
    }

    const result = await pool.query(
      `SELECT * FROM contact_interactions
       WHERE contact_id = $1
       ORDER BY interaction_date DESC, created_at DESC`,
      [contactId]
    );

    res.json({
      success: true,
      interactions: result.rows,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      `Failed to fetch interactions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});

export default router;
