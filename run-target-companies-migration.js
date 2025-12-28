#!/usr/bin/env node
/**
 * Target Companies Migration Runner
 * Runs the SQL migrations for the Target Companies feature
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.log('Please set it in your .env file or Vercel environment variables');
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Read and run schema migration
    console.log('📋 Running Target Companies schema migration...');
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'src/database/target-companies-schema.sql'),
      'utf8'
    );
    await client.query(schemaSQL);
    console.log('✅ Schema created successfully\n');

    // Read and run seed data
    console.log('📋 Seeding 15 default companies...');
    const seedSQL = fs.readFileSync(
      path.join(__dirname, 'src/database/seed-target-companies.sql'),
      'utf8'
    );
    await client.query(seedSQL);
    console.log('✅ Companies seeded successfully\n');

    // Verify tables were created
    console.log('🔍 Verifying tables...');
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('target_companies', 'global_company_suggestions', 'company_job_searches', 'company_job_listings')
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 4) {
      console.log('✅ All 4 tables created:');
      tablesResult.rows.forEach(row => console.log(`   - ${row.table_name}`));
    } else {
      console.warn(`⚠️  Only ${tablesResult.rows.length}/4 tables found`);
    }

    // Count seeded companies
    const countResult = await client.query('SELECT COUNT(*) FROM global_company_suggestions');
    const companyCount = parseInt(countResult.rows[0].count);
    console.log(`\n✅ ${companyCount} companies available in suggestions\n`);

    console.log('🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Build the app: npm run build');
    console.log('2. Start the server: npm start');
    console.log('3. Open the app and click "🏢 Target Companies" tab');
    console.log('4. Click "💡 Browse Suggestions" to see the 15 companies\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
    if (error.hint) console.error('Hint:', error.hint);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

// Run migrations
runMigrations().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
