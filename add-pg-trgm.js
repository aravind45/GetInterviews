const { Client } = require('pg');

async function addPgTrgmExtension() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/database'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Add pg_trgm extension
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    console.log('✅ pg_trgm extension added successfully');

    // Test the extension
    const result = await client.query("SELECT similarity('hello', 'helo');");
    console.log('✅ Extension test successful:', result.rows[0]);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

addPgTrgmExtension();