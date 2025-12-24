# Deployment Guide

## Vercel Deployment

### Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **GitHub Repository**: Already set up at https://github.com/aravind45/WhyNoInterviews
3. **Database**: Set up PostgreSQL database (Vercel Postgres recommended)
4. **Redis**: Set up Redis instance (Upstash Redis recommended)
5. **Groq API Key**: Get API key from [Groq](https://groq.com)

### Step 1: Connect GitHub to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import from GitHub: `aravind45/WhyNoInterviews`
4. Configure project settings:
   - Framework Preset: Other
   - Build Command: `npm run vercel-build`
   - Output Directory: `dist`
   - Install Command: `npm install`

### Step 2: Set up Database (Neon - Recommended)

1. Go to [Neon Console](https://console.neon.tech)
2. Sign up and create a new project
3. Create a database named `resume_diagnosis`
4. Copy the connection string from the dashboard
5. Add to Vercel environment variables

**Alternative: Vercel Postgres**
1. In Vercel Dashboard, go to Storage tab
2. Create new Postgres database
3. Copy connection strings to environment variables

**Alternative: Railway**
1. Go to [Railway](https://railway.app)
2. Create new project with PostgreSQL template
3. Copy connection string from variables tab

### Step 3: Set up Redis (Upstash Redis)

1. Go to [Upstash Console](https://console.upstash.com)
2. Create new Redis database
3. Copy connection details to environment variables

### Step 4: Configure Environment Variables

In Vercel project settings, add these environment variables:

```bash
# Database
DATABASE_URL=postgresql://...
POSTGRES_URL=postgresql://...
POSTGRES_PRISMA_URL=postgresql://...
POSTGRES_URL_NON_POOLING=postgresql://...

# Redis
REDIS_URL=redis://...
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...

# Groq API
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama3-8b-8192

# Application
NODE_ENV=production
JWT_SECRET=your_jwt_secret_32_chars_min
ENCRYPTION_KEY=your_32_character_encryption_key
CORS_ORIGIN=https://your-app.vercel.app

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_DIR=/tmp/uploads
TEMP_DIR=/tmp/temp

# Security
SESSION_SECRET=your_session_secret

# Data Retention
DATA_TTL_HOURS=24
CLEANUP_INTERVAL_MINUTES=60
```

### Step 5: Deploy

1. Click "Deploy" in Vercel
2. Wait for build to complete
3. Run database migrations (see below)

### Step 6: Initialize Database

After deployment, you need to run migrations:

1. Go to Vercel Functions tab
2. Create a serverless function to run migrations, or
3. Use Vercel CLI locally:

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Link project
vercel link

# Run migration (you'll need to create a migration endpoint)
curl -X POST https://your-app.vercel.app/api/migrate
```

### Step 7: Seed Database

Run the seeding process to populate job titles:

```bash
curl -X POST https://your-app.vercel.app/api/seed
```

## Local Development with Production Environment

To test production configuration locally:

```bash
# Copy production environment
cp .env.production.example .env.production

# Edit with your production values
# Then run with production env
NODE_ENV=production npm run dev
```

## Monitoring and Logs

- **Vercel Dashboard**: Monitor deployments and function logs
- **Application Logs**: Check Vercel Functions logs for errors
- **Database**: Monitor connection and query performance
- **Redis**: Monitor cache hit rates and memory usage

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify DATABASE_URL is correct
   - Check if database allows connections from Vercel IPs
   - Ensure database is running and accessible

2. **File Upload Issues**
   - Vercel has 50MB request limit
   - Temporary files are stored in `/tmp` (limited space)
   - Consider using cloud storage for production

3. **Memory Limits**
   - Vercel Hobby plan has 1GB memory limit
   - Optimize file processing for large resumes
   - Consider upgrading to Pro plan if needed

4. **Cold Starts**
   - First request may be slow due to cold start
   - Consider implementing keep-alive pings
   - Use Vercel Pro for better performance

### Performance Optimization

1. **Enable Caching**
   - Redis caching is already implemented
   - Add CDN caching for static assets

2. **Database Optimization**
   - Use connection pooling (already configured)
   - Add database indexes for frequently queried fields
   - Monitor slow queries

3. **File Processing**
   - Implement streaming for large files
   - Add progress indicators for long operations
   - Consider background job processing

## Security Considerations

1. **Environment Variables**
   - Never commit real secrets to Git
   - Use Vercel's secure environment variable storage
   - Rotate secrets regularly

2. **File Upload Security**
   - File type validation is implemented
   - File size limits are enforced
   - Temporary files are automatically cleaned up

3. **Database Security**
   - Use SSL connections (already configured)
   - Implement proper access controls
   - Regular security updates

## Scaling Considerations

As the application grows, consider:

1. **Database Scaling**
   - Read replicas for better performance
   - Database sharding for large datasets
   - Connection pooling optimization

2. **File Storage**
   - Move to cloud storage (AWS S3, Google Cloud Storage)
   - Implement CDN for file delivery
   - Add file compression

3. **Caching Strategy**
   - Implement multi-level caching
   - Add application-level caching
   - Use edge caching for global performance

4. **Monitoring**
   - Add application performance monitoring (APM)
   - Implement error tracking (Sentry)
   - Set up alerts for critical issues