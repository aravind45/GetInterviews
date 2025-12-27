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
  suggestICACategory,
  ParsedContact,
} from '../services/linkedinParser';
import { getPool } from '../database/connection';

const router = Router();

/**
 * Helper function to get session UUID from session token
 * Auto-creates session if it doesn't exist (for development)
 */
async function getSessionUuid(sessionToken: string): Promise<string | null> {
  const pool = getPool();

  // First try to find existing session
  let result = await pool.query(
    'SELECT id FROM user_sessions WHERE session_token = $1 AND is_active = true AND expires_at > NOW()',
    [sessionToken]
  );

  // If session doesn't exist, create it
  if (result.rows.length === 0) {
    console.log(`Creating new session for token: ${sessionToken}`);
    result = await pool.query(
      `INSERT INTO user_sessions (session_token, ip_address, user_agent, expires_at, is_active)
       VALUES ($1, '127.0.0.1', 'Auto-created', NOW() + INTERVAL '7 days', true)
       RETURNING id`,
      [sessionToken]
    );
  }

  return result.rows.length > 0 ? result.rows[0].id : null;
}

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
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  try {
    // Validate session and get UUID
    const sessionUuid = await getSessionUuid(sessionId);
    if (!sessionUuid) {
      return res.status(401).json({ success: false, error: 'Invalid or expired session' });
    }

    const pool = getPool();

    // Parse CSV (validation happens inside parser)
    const parseResult = parseLinkedInCSV(req.file.buffer);

    console.log('Parse result:', {
      totalRows: parseResult.totalRows,
      successfulRows: parseResult.successfulRows,
      failedRows: parseResult.failedRows,
      contactsLength: parseResult.contacts.length,
      errors: parseResult.errors
    });

    if (parseResult.contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid contacts found in CSV file',
        parseResult: {
          totalRows: parseResult.totalRows,
          successfulRows: parseResult.successfulRows,
          failedRows: parseResult.failedRows,
          errors: parseResult.errors
        }
      });
    }

    // Create import batch record
    const batchId = uuidv4();
    await pool.query(
      `INSERT INTO contact_import_batches
       (id, session_id, filename, total_contacts, successful_imports, failed_imports)
       VALUES ($1, $2, $3, $4, 0, 0)`,
      [batchId, sessionUuid, req.file.originalname, parseResult.totalRows]
    );

    // Get user's target job title if available (for better categorization)
    const analysisResult = await pool.query(
      `SELECT target_job_title FROM resume_analyses
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionUuid]
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
            connected_on, linkedin_profile_url, ica_category, import_batch_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (session_id, first_name, last_name, company)
           DO NOTHING`,
          [
            sessionUuid,
            contact.firstName,
            contact.lastName,
            contact.emailAddress,
            contact.company,
            contact.position,
            contact.connectedOn,
            contact.linkedinUrl,
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
    console.error('ICA upload error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return res.status(500).json({
      success: false,
      error: `Failed to process LinkedIn CSV: ${error instanceof Error ? error.message : 'Unknown error'}`,
      details: error instanceof Error ? error.stack : undefined
    });
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
    const sessionUuid = await getSessionUuid(sessionId);
    if (!sessionUuid) {
      return res.status(401).json({ success: false, error: 'Invalid or expired session' });
    }

    const pool = getPool();
    let query = `
      SELECT
        id, first_name, last_name, email_address, company, position,
        connected_on, ica_category, category_reason, notes, last_contacted,
        contact_frequency, relationship_strength, created_at, updated_at
      FROM linkedin_contacts
      WHERE session_id = $1
    `;

    const params: any[] = [sessionUuid];
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
    return res.status(500).json({
      success: false,
      error: `Failed to fetch contacts: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
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
      return res.status(404).json({ success: false, error: 'Contact not found' });
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
      return res.status(400).json({ success: false, error: 'No fields to update' });
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
    return res.status(500).json({
      success: false,
      error: `Failed to update contact: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
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
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Failed to delete contact: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
});

/**
 * GET /api/ica/stats/:sessionId
 * Get ICA statistics for a session
 */
router.get('/stats/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const sessionUuid = await getSessionUuid(sessionId);
    if (!sessionUuid) {
      return res.status(401).json({ success: false, error: 'Invalid or expired session' });
    }

    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM ica_stats WHERE session_id = $1',
      [sessionUuid]
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
        highPotential: result.rows[0].high_potential_count,
        mediumPotential: result.rows[0].medium_potential_count,
        lowPotential: result.rows[0].low_potential_count,
        uncategorized: result.rows[0].uncategorized_count,
        uniqueCompanies: result.rows[0].total_companies,
        contacted: 0, // Not yet implemented
        contactedLast30Days: 0, // Not yet implemented
        avgRelationshipStrength: 0, // Not yet implemented
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Failed to fetch ICA stats: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
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
      return res.status(404).json({ success: false, error: 'Contact not found' });
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
    return res.status(500).json({
      success: false,
      error: `Failed to log interaction: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
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
      return res.status(404).json({ success: false, error: 'Contact not found' });
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
    return res.status(500).json({
      success: false,
      error: `Failed to fetch interactions: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
});

export default router;
