/**
 * LinkedIn Contacts CSV Parser
 *
 * Parses LinkedIn exported CSV files (Connections.csv format)
 * Standard LinkedIn export columns:
 * - First Name, Last Name, Email Address, Company, Position, Connected On
 */

import { parse } from 'csv-parse/sync';
import { z } from 'zod';

/**
 * LinkedIn contact data schema
 */
export const LinkedInContactSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  emailAddress: z.string().email().optional().or(z.literal('')),
  company: z.string().optional(),
  position: z.string().optional(),
  connectedOn: z.string().optional(), // Format: "DD MMM YYYY" e.g., "15 Jan 2023"
});

export type LinkedInContact = z.infer<typeof LinkedInContactSchema>;

/**
 * Parsed contact with additional metadata
 */
export interface ParsedContact {
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  company?: string;
  position?: string;
  connectedOn?: Date | null;
  rawConnectedOn?: string;
}

/**
 * Parse result with statistics
 */
export interface ParseResult {
  contacts: ParsedContact[];
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  errors: Array<{ row: number; error: string; data?: any }>;
}

/**
 * Parse LinkedIn connections CSV file
 *
 * @param csvContent - CSV file content as string or buffer
 * @returns ParseResult with contacts and statistics
 */
export function parseLinkedInCSV(csvContent: string | Buffer): ParseResult {
  const content = csvContent.toString('utf-8');

  const result: ParseResult = {
    contacts: [],
    totalRows: 0,
    successfulRows: 0,
    failedRows: 0,
    errors: [],
  };

  try {
    // Parse CSV with headers
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true, // Handle UTF-8 BOM
      relax_column_count: true, // Allow inconsistent column counts
    });

    result.totalRows = records.length;

    records.forEach((record: any, index: number) => {
      try {
        // Map LinkedIn export column names to our schema
        const mappedRecord = {
          firstName: record['First Name'] || record['first_name'] || '',
          lastName: record['Last Name'] || record['last_name'] || '',
          emailAddress: record['Email Address'] || record['email_address'] || record['Email'] || '',
          company: record['Company'] || record['company'] || '',
          position: record['Position'] || record['position'] || record['Title'] || '',
          connectedOn: record['Connected On'] || record['connected_on'] || record['Connection Date'] || '',
        };

        // Skip completely empty rows
        if (!mappedRecord.firstName && !mappedRecord.lastName && !mappedRecord.emailAddress) {
          return;
        }

        // Parse the "Connected On" date
        const connectedOnDate = parseLinkedInDate(mappedRecord.connectedOn);

        const contact: ParsedContact = {
          firstName: mappedRecord.firstName || undefined,
          lastName: mappedRecord.lastName || undefined,
          emailAddress: mappedRecord.emailAddress || undefined,
          company: mappedRecord.company || undefined,
          position: mappedRecord.position || undefined,
          connectedOn: connectedOnDate,
          rawConnectedOn: mappedRecord.connectedOn || undefined,
        };

        result.contacts.push(contact);
        result.successfulRows++;
      } catch (error) {
        result.failedRows++;
        result.errors.push({
          row: index + 2, // +2 because: 0-indexed + header row
          error: error instanceof Error ? error.message : 'Unknown parsing error',
          data: record,
        });
      }
    });

    return result;
  } catch (error) {
    throw new Error(
      `Failed to parse LinkedIn CSV: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Parse LinkedIn date format: "DD MMM YYYY" (e.g., "15 Jan 2023")
 *
 * @param dateStr - Date string from LinkedIn export
 * @returns Date object or null if invalid
 */
function parseLinkedInDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.trim() === '') {
    return null;
  }

  try {
    // LinkedIn format: "15 Jan 2023" or "01 Feb 2022"
    const date = new Date(dateStr);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return null;
    }

    return date;
  } catch {
    return null;
  }
}

/**
 * Validate CSV file before parsing
 *
 * @param csvContent - CSV file content
 * @returns true if valid, throws error if invalid
 */
export function validateLinkedInCSV(csvContent: string | Buffer): boolean {
  const content = csvContent.toString('utf-8');

  // Check for minimum content
  if (content.length < 10) {
    throw new Error('CSV file is too small to contain valid data');
  }

  // Check for CSV header presence
  const firstLine = content.split('\n')[0].toLowerCase();
  const hasLinkedInHeaders =
    (firstLine.includes('first name') || firstLine.includes('first_name')) ||
    (firstLine.includes('last name') || firstLine.includes('last_name')) ||
    (firstLine.includes('email') || firstLine.includes('company'));

  if (!hasLinkedInHeaders) {
    throw new Error(
      'CSV does not appear to be a LinkedIn Connections export. Expected columns: First Name, Last Name, Email Address, Company, Position, Connected On'
    );
  }

  return true;
}

/**
 * Get suggested ICA category based on contact data
 * This is a basic heuristic - can be enhanced with AI later
 *
 * @param contact - Parsed contact
 * @param targetJobTitle - User's target job title
 * @returns Suggested category
 */
export function suggestICACategory(
  contact: ParsedContact,
  targetJobTitle?: string
): 'high_potential' | 'medium_potential' | 'low_potential' | 'uncategorized' {
  // If no position or company, hard to categorize
  if (!contact.position && !contact.company) {
    return 'uncategorized';
  }

  // High potential indicators
  const highPotentialKeywords = [
    'recruiter',
    'talent',
    'hiring',
    'hr manager',
    'head of',
    'director',
    'vp',
    'cto',
    'ceo',
    'founder',
    'engineering manager',
    'technical lead',
  ];

  // Medium potential indicators
  const mediumPotentialKeywords = [
    'engineer',
    'developer',
    'manager',
    'lead',
    'senior',
    'principal',
    'architect',
  ];

  const positionLower = (contact.position || '').toLowerCase();

  // Check for high potential
  if (highPotentialKeywords.some((keyword) => positionLower.includes(keyword))) {
    return 'high_potential';
  }

  // Check for medium potential
  if (mediumPotentialKeywords.some((keyword) => positionLower.includes(keyword))) {
    return 'medium_potential';
  }

  // Default to low potential if we have data but no matches
  return contact.position || contact.company ? 'low_potential' : 'uncategorized';
}
