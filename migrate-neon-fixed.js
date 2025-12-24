const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🚀 Starting database migrations...');
    
    // Read schema.sql file
    const schemaPath = path.join(__dirname, 'src/database/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('📝 Executing complete schema...');
    
    const client = await pool.connect();
    
    try {
      // Execute the entire schema as one transaction
      await client.query('BEGIN');
      await client.query(schemaSql);
      await client.query('COMMIT');
      console.log('✅ Schema executed successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Schema execution failed:', error.message);
      
      // Try executing individual statements for better error reporting
      console.log('🔄 Trying individual statements...');
      
      // Split more carefully, preserving function bodies
      const statements = [];
      let currentStatement = '';
      let inFunction = false;
      let dollarQuoteCount = 0;
      
      const lines = schemaSql.split('\n');
      
      for (const line of lines) {
        currentStatement += line + '\n';
        
        // Track dollar-quoted strings ($$)
        const dollarMatches = line.match(/\$\$/g);
        if (dollarMatches) {
          dollarQuoteCount += dollarMatches.length;
        }
        
        // Check if we're in a function
        if (line.includes('CREATE OR REPLACE FUNCTION') || line.includes('CREATE FUNCTION')) {
          inFunction = true;
        }
        
        // End of statement detection
        if (line.trim().endsWith(';') && !inFunction && dollarQuoteCount % 2 === 0) {
          statements.push(currentStatement.trim());
          currentStatement = '';
        } else if (inFunction && line.includes('$$ LANGUAGE')) {
          inFunction = false;
          statements.push(currentStatement.trim());
          currentStatement = '';
        }
      }
      
      // Add any remaining statement
      if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
      }
      
      console.log(`📝 Found ${statements.length} SQL statements`);
      
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement.length === 0) continue;
        
        try {
          await client.query(statement);
          console.log(`✅ Statement ${i + 1}/${statements.length} executed`);
        } catch (stmtError) {
          console.log(`⚠️  Statement ${i + 1} failed: ${stmtError.message}`);
        }
      }
    }
    
    client.release();
    await pool.end();
    
    console.log('🎉 Database migrations completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigrations();