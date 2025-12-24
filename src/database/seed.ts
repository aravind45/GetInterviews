import { query, connectDatabase, closeDatabase, transaction } from './connection';
import { logger } from '../utils/logger';
import { PoolClient } from 'pg';

interface SeedJobTitle {
  title: string;
  category: string;
  seniorityLevel: string;
  industry: string;
  isGeneric: boolean;
  variations: Array<{ variation: string; confidence: number }>;
  requiredSkills: string[];
  preferredSkills: string[];
  requiredKeywords: string[];
  atsKeywords: string[];
  experienceLevelMin: number;
  experienceLevelMax?: number;
  educationRequirements: string[];
}

const seedData: SeedJobTitle[] = [
  // Software Engineering
  {
    title: 'Software Engineer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'SWE', confidence: 95 },
      { variation: 'Software Developer', confidence: 90 },
      { variation: 'Programmer', confidence: 75 },
      { variation: 'Developer', confidence: 70 },
      { variation: 'Software Dev', confidence: 85 },
      { variation: 'Application Developer', confidence: 80 },
      { variation: 'Coder', confidence: 60 }
    ],
    requiredSkills: ['Programming', 'Problem Solving', 'Software Development', 'Version Control'],
    preferredSkills: ['Agile', 'Git', 'Testing', 'Code Review', 'CI/CD'],
    requiredKeywords: ['software', 'programming', 'development', 'code', 'engineer'],
    atsKeywords: ['software engineer', 'development', 'programming', 'agile', 'scrum'],
    experienceLevelMin: 2,
    experienceLevelMax: 5,
    educationRequirements: ['Computer Science', 'Software Engineering', 'Related Field']
  },
  {
    title: 'Senior Software Engineer',
    category: 'Engineering',
    seniorityLevel: 'Senior',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'Senior SWE', confidence: 95 },
      { variation: 'Senior Software Developer', confidence: 90 },
      { variation: 'Sr. Software Engineer', confidence: 95 },
      { variation: 'Sr Software Developer', confidence: 90 },
      { variation: 'Lead Developer', confidence: 80 },
      { variation: 'Staff Engineer', confidence: 75 }
    ],
    requiredSkills: ['Programming', 'System Design', 'Architecture', 'Leadership', 'Mentoring'],
    preferredSkills: ['Technical Leadership', 'Performance Optimization', 'Team Leadership', 'Code Review'],
    requiredKeywords: ['senior', 'software', 'engineering', 'architecture', 'leadership'],
    atsKeywords: ['senior software engineer', 'technical lead', 'system design', 'mentoring'],
    experienceLevelMin: 5,
    experienceLevelMax: 10,
    educationRequirements: ['Computer Science', 'Software Engineering']
  },
  {
    title: 'Frontend Developer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'Front-end Developer', confidence: 95 },
      { variation: 'UI Developer', confidence: 85 },
      { variation: 'Web Developer', confidence: 75 },
      { variation: 'JavaScript Developer', confidence: 80 },
      { variation: 'React Developer', confidence: 85 },
      { variation: 'Frontend Engineer', confidence: 95 }
    ],
    requiredSkills: ['HTML', 'CSS', 'JavaScript', 'React', 'Responsive Design'],
    preferredSkills: ['TypeScript', 'Vue', 'Angular', 'Webpack', 'SASS', 'Testing'],
    requiredKeywords: ['frontend', 'javascript', 'html', 'css', 'react', 'web'],
    atsKeywords: ['frontend developer', 'react', 'javascript', 'css', 'responsive'],
    experienceLevelMin: 2,
    experienceLevelMax: 5,
    educationRequirements: ['Computer Science', 'Web Development', 'Related Field']
  },
  {
    title: 'Backend Developer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'Back-end Developer', confidence: 95 },
      { variation: 'Server Developer', confidence: 80 },
      { variation: 'API Developer', confidence: 85 },
      { variation: 'Backend Engineer', confidence: 95 },
      { variation: 'Server-side Developer', confidence: 85 }
    ],
    requiredSkills: ['Server Programming', 'Database Design', 'API Development', 'SQL'],
    preferredSkills: ['Microservices', 'Docker', 'Cloud Platforms', 'DevOps', 'NoSQL'],
    requiredKeywords: ['backend', 'server', 'api', 'database', 'python', 'java', 'node'],
    atsKeywords: ['backend developer', 'api', 'database', 'microservices', 'cloud'],
    experienceLevelMin: 2,
    experienceLevelMax: 5,
    educationRequirements: ['Computer Science', 'Software Engineering']
  },
  {
    title: 'Full Stack Developer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'Full-Stack Developer', confidence: 95 },
      { variation: 'Fullstack Developer', confidence: 95 },
      { variation: 'Full Stack Engineer', confidence: 95 },
      { variation: 'Web Application Developer', confidence: 80 }
    ],
    requiredSkills: ['Frontend Development', 'Backend Development', 'Database', 'API Design'],
    preferredSkills: ['DevOps', 'Cloud', 'Testing', 'CI/CD'],
    requiredKeywords: ['full stack', 'frontend', 'backend', 'javascript', 'database'],
    atsKeywords: ['full stack', 'react', 'node', 'database', 'api'],
    experienceLevelMin: 3,
    experienceLevelMax: 7,
    educationRequirements: ['Computer Science', 'Software Engineering']
  },
  // Data & Analytics
  {
    title: 'Data Scientist',
    category: 'Data',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'ML Engineer', confidence: 80 },
      { variation: 'Machine Learning Engineer', confidence: 85 },
      { variation: 'Data Science Engineer', confidence: 90 },
      { variation: 'Applied Scientist', confidence: 75 }
    ],
    requiredSkills: ['Python', 'Statistics', 'Machine Learning', 'Data Analysis', 'SQL'],
    preferredSkills: ['TensorFlow', 'PyTorch', 'R', 'Jupyter', 'Deep Learning', 'NLP'],
    requiredKeywords: ['data science', 'machine learning', 'python', 'statistics', 'analytics'],
    atsKeywords: ['data scientist', 'machine learning', 'python', 'statistics', 'modeling'],
    experienceLevelMin: 2,
    experienceLevelMax: 6,
    educationRequirements: ['Computer Science', 'Statistics', 'Mathematics', 'PhD preferred']
  },
  {
    title: 'Data Analyst',
    category: 'Data',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'Business Analyst', confidence: 75 },
      { variation: 'Analytics Specialist', confidence: 85 },
      { variation: 'Data Analytics Specialist', confidence: 90 },
      { variation: 'Reporting Analyst', confidence: 70 }
    ],
    requiredSkills: ['SQL', 'Excel', 'Data Visualization', 'Statistical Analysis'],
    preferredSkills: ['Python', 'Tableau', 'Power BI', 'R', 'A/B Testing'],
    requiredKeywords: ['data analysis', 'sql', 'visualization', 'reporting', 'analytics'],
    atsKeywords: ['data analyst', 'sql', 'tableau', 'excel', 'reporting'],
    experienceLevelMin: 1,
    experienceLevelMax: 4,
    educationRequirements: ['Statistics', 'Mathematics', 'Business', 'Economics']
  },
  {
    title: 'Data Engineer',
    category: 'Data',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'ETL Developer', confidence: 80 },
      { variation: 'Data Pipeline Engineer', confidence: 90 },
      { variation: 'Big Data Engineer', confidence: 85 }
    ],
    requiredSkills: ['Python', 'SQL', 'ETL', 'Data Warehousing', 'Big Data'],
    preferredSkills: ['Spark', 'Airflow', 'Kafka', 'AWS', 'Snowflake'],
    requiredKeywords: ['data engineering', 'etl', 'pipeline', 'sql', 'warehouse'],
    atsKeywords: ['data engineer', 'etl', 'spark', 'airflow', 'data pipeline'],
    experienceLevelMin: 2,
    experienceLevelMax: 6,
    educationRequirements: ['Computer Science', 'Data Engineering']
  },
  // Product & Design
  {
    title: 'Product Manager',
    category: 'Product',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'PM', confidence: 90 },
      { variation: 'Product Owner', confidence: 85 },
      { variation: 'Product Lead', confidence: 80 },
      { variation: 'Technical Product Manager', confidence: 85 }
    ],
    requiredSkills: ['Product Strategy', 'Roadmap Planning', 'Stakeholder Management', 'User Research'],
    preferredSkills: ['Agile', 'Analytics', 'A/B Testing', 'SQL', 'Data Analysis'],
    requiredKeywords: ['product management', 'strategy', 'roadmap', 'stakeholder', 'requirements'],
    atsKeywords: ['product manager', 'roadmap', 'agile', 'stakeholder', 'requirements'],
    experienceLevelMin: 3,
    experienceLevelMax: 7,
    educationRequirements: ['Business', 'Computer Science', 'MBA preferred']
  },
  {
    title: 'UX Designer',
    category: 'Design',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'User Experience Designer', confidence: 95 },
      { variation: 'UX/UI Designer', confidence: 90 },
      { variation: 'Product Designer', confidence: 85 },
      { variation: 'Interaction Designer', confidence: 80 }
    ],
    requiredSkills: ['User Research', 'Wireframing', 'Prototyping', 'Usability Testing'],
    preferredSkills: ['Figma', 'Sketch', 'Adobe XD', 'Design Systems', 'HTML/CSS'],
    requiredKeywords: ['ux design', 'user experience', 'wireframe', 'prototype', 'usability'],
    atsKeywords: ['ux designer', 'figma', 'user research', 'prototype', 'wireframe'],
    experienceLevelMin: 2,
    experienceLevelMax: 5,
    educationRequirements: ['Design', 'HCI', 'Psychology', 'Related Field']
  },
  // DevOps & Infrastructure
  {
    title: 'DevOps Engineer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: false,
    variations: [
      { variation: 'Site Reliability Engineer', confidence: 85 },
      { variation: 'SRE', confidence: 85 },
      { variation: 'Platform Engineer', confidence: 80 },
      { variation: 'Infrastructure Engineer', confidence: 80 }
    ],
    requiredSkills: ['CI/CD', 'Cloud Platforms', 'Containerization', 'Infrastructure as Code'],
    preferredSkills: ['Kubernetes', 'Terraform', 'AWS', 'Docker', 'Monitoring'],
    requiredKeywords: ['devops', 'ci/cd', 'cloud', 'automation', 'infrastructure'],
    atsKeywords: ['devops engineer', 'kubernetes', 'aws', 'terraform', 'docker'],
    experienceLevelMin: 3,
    experienceLevelMax: 7,
    educationRequirements: ['Computer Science', 'IT', 'Systems Engineering']
  },
  // Generic titles that need specialization
  {
    title: 'Manager',
    category: 'Management',
    seniorityLevel: 'Mid',
    industry: 'General',
    isGeneric: true,
    variations: [
      { variation: 'Mgr', confidence: 90 }
    ],
    requiredSkills: ['Leadership', 'Communication', 'Team Management'],
    preferredSkills: ['Project Management', 'Budgeting', 'Strategic Planning'],
    requiredKeywords: ['management', 'leadership', 'team'],
    atsKeywords: ['manager', 'leadership', 'team management'],
    experienceLevelMin: 3,
    experienceLevelMax: 10,
    educationRequirements: ['Business', 'Related Field']
  },
  {
    title: 'Developer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'Technology',
    isGeneric: true,
    variations: [
      { variation: 'Dev', confidence: 90 }
    ],
    requiredSkills: ['Programming', 'Problem Solving'],
    preferredSkills: ['Version Control', 'Testing'],
    requiredKeywords: ['development', 'programming'],
    atsKeywords: ['developer', 'programming', 'software'],
    experienceLevelMin: 1,
    experienceLevelMax: 5,
    educationRequirements: ['Computer Science', 'Related Field']
  },
  {
    title: 'Engineer',
    category: 'Engineering',
    seniorityLevel: 'Mid',
    industry: 'General',
    isGeneric: true,
    variations: [],
    requiredSkills: ['Technical Skills', 'Problem Solving'],
    preferredSkills: ['Project Management', 'Documentation'],
    requiredKeywords: ['engineering', 'technical'],
    atsKeywords: ['engineer', 'technical'],
    experienceLevelMin: 1,
    experienceLevelMax: 5,
    educationRequirements: ['Engineering', 'Related Field']
  },
  {
    title: 'Analyst',
    category: 'Analytics',
    seniorityLevel: 'Mid',
    industry: 'General',
    isGeneric: true,
    variations: [],
    requiredSkills: ['Analysis', 'Data Interpretation', 'Reporting'],
    preferredSkills: ['Excel', 'SQL', 'Visualization'],
    requiredKeywords: ['analysis', 'reporting', 'data'],
    atsKeywords: ['analyst', 'analysis', 'reporting'],
    experienceLevelMin: 1,
    experienceLevelMax: 5,
    educationRequirements: ['Business', 'Related Field']
  }
];

const seedJobTitle = async (client: PoolClient, jobData: SeedJobTitle): Promise<void> => {
  // Insert canonical job title
  const jobResult = await client.query(`
    INSERT INTO canonical_job_titles (title, category, seniority_level, industry, is_generic)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (title) DO UPDATE SET
      category = EXCLUDED.category,
      seniority_level = EXCLUDED.seniority_level,
      industry = EXCLUDED.industry,
      is_generic = EXCLUDED.is_generic,
      updated_at = NOW()
    RETURNING id
  `, [jobData.title, jobData.category, jobData.seniorityLevel, jobData.industry, jobData.isGeneric]);

  const canonicalId = jobResult.rows[0].id;

  // Insert variations
  for (const variation of jobData.variations) {
    await client.query(`
      INSERT INTO job_title_variations (canonical_id, variation, confidence_score)
      VALUES ($1, $2, $3)
      ON CONFLICT (canonical_id, variation) DO UPDATE SET
        confidence_score = EXCLUDED.confidence_score
    `, [canonicalId, variation.variation, variation.confidence]);
  }

  // Insert role template
  await client.query(`
    INSERT INTO role_templates (
      canonical_job_id, required_skills, preferred_skills, required_keywords,
      ats_keywords, experience_level_min, experience_level_max, education_requirements
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (canonical_job_id) DO UPDATE SET
      required_skills = EXCLUDED.required_skills,
      preferred_skills = EXCLUDED.preferred_skills,
      required_keywords = EXCLUDED.required_keywords,
      ats_keywords = EXCLUDED.ats_keywords,
      experience_level_min = EXCLUDED.experience_level_min,
      experience_level_max = EXCLUDED.experience_level_max,
      education_requirements = EXCLUDED.education_requirements,
      updated_at = NOW()
  `, [
    canonicalId,
    jobData.requiredSkills,
    jobData.preferredSkills,
    jobData.requiredKeywords,
    jobData.atsKeywords,
    jobData.experienceLevelMin,
    jobData.experienceLevelMax || null,
    jobData.educationRequirements
  ]);
};

export const seedDatabase = async (): Promise<{ seeded: number }> => {
  let seeded = 0;
  
  await transaction(async (client) => {
    logger.info('Starting database seeding...');
    
    for (const jobData of seedData) {
      try {
        await seedJobTitle(client, jobData);
        seeded++;
        logger.debug(`Seeded: ${jobData.title}`);
      } catch (error) {
        logger.error(`Failed to seed ${jobData.title}:`, error);
        throw error;
      }
    }
    
    logger.info(`Database seeding completed: ${seeded} job titles`);
  });
  
  return { seeded };
};

// CLI execution
if (require.main === module) {
  (async () => {
    try {
      require('dotenv').config();
      await connectDatabase();
      const results = await seedDatabase();
      console.log('\n✅ Seeding completed:', results);
      await closeDatabase();
      process.exit(0);
    } catch (error) {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    }
  })();
}

export default seedDatabase;
