const { Client } = require('pg');

async function addJobTitle() {
  const client = new Client({
    connectionString: 'postgresql://neondb_owner:npg_EJaq0VAklM4o@ep-green-bar-ahj4m4hv-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Check if job title already exists
    const existing = await client.query(`
      SELECT id FROM canonical_job_titles WHERE title = $1
    `, ['Director - Agentic AI Transformation']);

    if (existing.rows.length > 0) {
      console.log('✅ Job title already exists!');
      return;
    }

    // Add your specific job title
    const result = await client.query(`
      INSERT INTO canonical_job_titles (title, category, seniority_level, industry)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [
      'Director - Agentic AI Transformation',
      'Leadership',
      'Executive', 
      'Technology'
    ]);

    console.log('✅ Job title added successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

addJobTitle();