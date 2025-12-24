const { Pool } = require('pg');
require('dotenv').config();

const seedData = [
  {
    title: 'Software Engineer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    variations: [
      { variation: 'SWE', confidence: 95 },
      { variation: 'Software Developer', confidence: 90 },
      { variation: 'Programmer', confidence: 80 },
      { variation: 'Developer', confidence: 70 },
      { variation: 'Software Dev', confidence: 85 }
    ],
    requiredSkills: ['Programming', 'Problem Solving', 'Software Development'],
    preferredSkills: ['Agile', 'Git', 'Testing', 'Code Review'],
    requiredKeywords: ['software', 'programming', 'development', 'code'],
    experienceLevelMin: 2,
    experienceLevelMax: 5
  },
  {
    title: 'Senior Software Engineer',
    category: 'Engineering',
    seniorityLevel: 'Senior',
    industry: 'Technology',
    variations: [
      { variation: 'Senior SWE', confidence: 95 },
      { variation: 'Senior Software Developer', confidence: 90 },
      { variation: 'Lead Developer', confidence: 85 },
      { variation: 'Principal Engineer', confidence: 80 }
    ],
    requiredSkills: ['Programming', 'System Design', 'Leadership', 'Mentoring'],
    preferredSkills: ['Architecture', 'Performance Optimization', 'Team Leadership'],
    requiredKeywords: ['senior', 'software', 'programming', 'leadership', 'design'],
    experienceLevelMin: 5,
    experienceLevelMax: 10
  },
  {
    title: 'Frontend Developer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    variations: [
      { variation: 'Front-end Developer', confidence: 95 },
      { variation: 'UI Developer', confidence: 85 },
      { variation: 'Web Developer', confidence: 75 },
      { variation: 'JavaScript Developer', confidence: 80 }
    ],
    requiredSkills: ['HTML', 'CSS', 'JavaScript', 'React', 'Vue', 'Angular'],
    preferredSkills: ['TypeScript', 'Webpack', 'SASS', 'Responsive Design'],
    requiredKeywords: ['frontend', 'javascript', 'html', 'css', 'react', 'vue', 'angular'],
    experienceLevelMin: 2,
    experienceLevelMax: 5
  },
  {
    title: 'Data Scientist',
    category: 'Data',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    variations: [
      { variation: 'ML Engineer', confidence: 80 },
      { variation: 'Machine Learning Engineer', confidence: 85 },
      { variation: 'Data Analyst', confidence: 70 }
    ],
    requiredSkills: ['Python', 'Statistics', 'Machine Learning', 'Data Analysis'],
    preferredSkills: ['TensorFlow', 'PyTorch', 'SQL', 'R', 'Jupyter'],
    requiredKeywords: ['data', 'python', 'machine learning', 'statistics', 'analysis'],
    experienceLevelMin: 2,
    experienceLevelMax: 6
  },
  {
    title: 'Product Manager',
    category: 'Product',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    variations: [
      { variation: 'PM', confidence: 90 },
      { variation: 'Product Owner', confidence: 85 },
      { variation: 'Product Lead', confidence: 80 }
    ],
    requiredSkills: ['Product Strategy', 'Roadmap Planning', 'Stakeholder Management'],
    preferredSkills: ['Agile', 'Analytics', 'User Research', 'A/B Testing'],
    requiredKeywords: ['product', 'strategy', 'roadmap', 'stakeholder', 'requirements'],
    experienceLevelMin: 3,
    experienceLevelMax: 7
  }
];

async function seedDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🌱 Starting database seeding...');
    
    const client = await pool.connect();
    
    for (const jobData of seedData) {
      console.log(`📝 Seeding job title: ${jobData.title}`);
      
      // Insert canonical job title
      const jobResult = await client.query(`
        INSERT INTO canonical_job_titles (title, category, seniority_level, industry)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (title) DO UPDATE SET
          category = EXCLUDED.category,
          seniority_level = EXCLUDED.seniority_level,
          industry = EXCLUDED.industry,
          updated_at = NOW()
        RETURNING id
      `, [jobData.title, jobData.category, jobData.seniorityLevel, jobData.industry]);

      const canonicalId = jobResult.rows[0].id;

      // Insert job title variations
      for (const variation of jobData.variations) {
        await client.query(`
          INSERT INTO job_title_variations (canonical_id, variation, confidence_score)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [canonicalId, variation.variation, variation.confidence]);
      }

      // Insert role template
      await client.query(`
        INSERT INTO role_templates (
          canonical_job_id, required_skills, preferred_skills, required_keywords,
          experience_level_min, experience_level_max
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (canonical_job_id) DO UPDATE SET
          required_skills = EXCLUDED.required_skills,
          preferred_skills = EXCLUDED.preferred_skills,
          required_keywords = EXCLUDED.required_keywords,
          experience_level_min = EXCLUDED.experience_level_min,
          experience_level_max = EXCLUDED.experience_level_max,
          updated_at = NOW()
      `, [
        canonicalId,
        jobData.requiredSkills,
        jobData.preferredSkills,
        jobData.requiredKeywords,
        jobData.experienceLevelMin,
        jobData.experienceLevelMax
      ]);

      console.log(`✅ Seeded: ${jobData.title}`);
    }
    
    client.release();
    await pool.end();
    
    console.log('🎉 Database seeding completed successfully!');
    
  } catch (error) {
    console.error('❌ Database seeding failed:', error.message);
    process.exit(1);
  }
}

seedDatabase();