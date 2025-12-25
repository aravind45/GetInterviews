const { Client } = require('pg');

async function addJobTitle() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/database'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Add your specific job title
    const result = await client.query(`
      INSERT INTO canonical_job_titles (title, category, seniority_level, industry)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (title) DO UPDATE SET
        category = EXCLUDED.category,
        seniority_level = EXCLUDED.seniority_level,
        industry = EXCLUDED.industry,
        updated_at = NOW()
      RETURNING id
    `, [
      'Director - Agentic AI Transformation',
      'Leadership',
      'Executive', 
      'Technology'
    ]);

    const canonicalId = result.rows[0].id;
    console.log('✅ Job title added with ID:', canonicalId);

    // Add variations
    const variations = [
      { variation: 'Director – Agentic AI Transformation', confidence: 100 },
      { variation: 'AI Transformation Director', confidence: 95 },
      { variation: 'Director of AI Transformation', confidence: 95 },
      { variation: 'Agentic AI Director', confidence: 90 },
      { variation: 'AI Strategy Director', confidence: 85 }
    ];

    for (const variation of variations) {
      await client.query(`
        INSERT INTO job_title_variations (canonical_id, variation, confidence_score)
        VALUES ($1, $2, $3)
      `, [canonicalId, variation.variation, variation.confidence]);
    }

    // Add role template
    await client.query(`
      INSERT INTO role_templates (
        canonical_job_id, required_skills, preferred_skills, required_keywords,
        ats_keywords, experience_level_min, experience_level_max, education_requirements
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      canonicalId,
      ['AI Strategy', 'Digital Transformation', 'Executive Leadership', 'Change Management', 'Technology Vision'],
      ['Machine Learning', 'Agentic AI', 'Business Strategy', 'Team Leadership', 'Stakeholder Management'],
      ['director', 'ai', 'transformation', 'agentic', 'leadership', 'strategy'],
      ['director ai transformation', 'agentic ai', 'ai strategy', 'digital transformation', 'executive leadership'],
      8, // Min 8 years experience
      null, // No max
      ['MBA', 'Computer Science', 'Engineering', 'Business Administration']
    ]);

    console.log('✅ Job title, variations, and role template added successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

addJobTitle();