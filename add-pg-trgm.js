const { Client } = require('pg');

async function addPgTrgmExtension() {
  const client = new Client({
    connectionString: 'postgresql://neondb_owner:npg_EJaq0VAklM4o@ep-green-bar-ahj4m4hv-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
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