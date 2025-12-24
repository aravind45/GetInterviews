import fs from 'fs';
import path from 'path';
import { getClient, connectDatabase, closeDatabase } from './connection';
import { logger } from '../utils/logger';

/**
 * Parse SQL file handling dollar-quoted strings (PL/pgSQL functions)
 */
const parseSqlStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let currentStatement = '';
  let inDollarQuote = false;
  let dollarTag = '';
  
  const lines = sql.split('\n');
  
  for (const line of lines) {
    // Skip pure comment lines when not in a statement
    if (line.trim().startsWith('--') && currentStatement.trim() === '') {
      continue;
    }
    
    currentStatement += line + '\n';
    
    // Track dollar-quoted strings ($$, $tag$, etc.)
    const dollarMatches = line.match(/\$([a-zA-Z_]*)\$/g);
    if (dollarMatches) {
      for (const match of dollarMatches) {
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = match;
        } else if (match === dollarTag) {
          inDollarQuote = false;
          dollarTag = '';
        }
      }
    }
    
    // End of statement (only when not inside dollar quotes)
    if (!inDollarQuote && line.trim().endsWith(';')) {
      const trimmed = currentStatement.trim();
      if (trimmed && !trimmed.startsWith('--')) {
        statements.push(trimmed);
      }
      currentStatement = '';
    }
  }
  
  // Add any remaining statement
  if (currentStatement.trim() && !currentStatement.trim().startsWith('--')) {
    statements.push(currentStatement.trim());
  }
  
  return statements;
};

export const runMigrations = async (): Promise<{ executed: number; skipped: number; failed: number }> => {
  const client = await getClient();
  const results = { executed: 0, skipped: 0, failed: 0 };
  
  try {
    logger.info('Starting database migrations...');
    
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const statements = parseSqlStatements(schemaSql);
    
    logger.info(`Found ${statements.length} SQL statements to execute`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 60).replace(/\n/g, ' ').trim();
      
      try {
        await client.query(statement);
        results.executed++;
        logger.debug(`[${i + 1}/${statements.length}] ✓ ${preview}...`);
      } catch (error: any) {
        // Expected errors (already exists, duplicate, etc.)
        const isExpectedError = 
          error.message?.includes('already exists') ||
          error.message?.includes('duplicate key') ||
          error.code === '42P07' || // relation already exists
          error.code === '42710' || // object already exists
          error.code === '42723';   // function already exists
        
        if (isExpectedError) {
          results.skipped++;
          logger.debug(`[${i + 1}/${statements.length}] ⊘ Skipped (exists): ${preview}...`);
        } else {
          results.failed++;
          logger.warn(`[${i + 1}/${statements.length}] ✗ Failed: ${preview}...`, { error: error.message });
        }
      }
    }
    
    logger.info('Database migrations completed', results);
    return results;
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// CLI execution
if (require.main === module) {
  (async () => {
    try {
      require('dotenv').config();
      await connectDatabase();
      const results = await runMigrations();
      console.log('\n✅ Migration completed:', results);
      await closeDatabase();
      process.exit(0);
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  })();
}

export default runMigrations;
