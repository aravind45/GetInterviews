# Resume Diagnosis Engine

AI-powered resume analysis that identifies why you're not getting interviews. Get specific problems, evidence-based root causes, and actionable recommendations.

## Features

- **Resume Upload**: PDF and Word document support (up to 10MB, 10 pages)
- **Job Title Normalization**: Smart matching to canonical job titles
- **AI Diagnosis**: Identifies root causes preventing interview success
- **Evidence-Based**: Every finding backed by specific resume citations
- **Actionable Recommendations**: Prioritized, implementable fixes
- **Confidence Scoring**: Transparent reliability indicators
- **Privacy-First**: Data encrypted, auto-deleted within 24 hours

## Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL (Neon)
- **Cache**: Redis
- **AI**: Groq (Llama 3)
- **Deployment**: Vercel

## Requirements Compliance

| Requirement | Status |
|------------|--------|
| 1. Resume Input Processing | ✅ PDF, DOC, DOCX support with 30s timeout |
| 2. Job Target Configuration | ✅ Title normalization, generic detection |
| 3. AI Diagnosis Generation | ✅ Groq-powered analysis with 60s timeout |
| 4. Root Cause Analysis | ✅ Max 5 issues, prioritized, with evidence |
| 5. Actionable Recommendations | ✅ Max 3 fixes with implementation steps |
| 6. Confidence Scoring | ✅ 0-100 score with explanation |
| 7. Clear Output Presentation | ✅ Structured, prioritized display |
| 8. Scoring Framework | ✅ Severity/Impact scores with evidence |
| 9. Privacy & Security | ✅ Encryption, 24h TTL, deletion API |
| 10. Processing Limits | ✅ 10 pages max, 120s timeout |

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database (Neon recommended)
- Redis instance
- Groq API key

### Installation

```bash
# Clone and install
git clone <repository>
cd resume-diagnosis-engine
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run migrations
npm run db:migrate

# Seed job titles
npm run db:seed

# Start development server
npm run dev
```

### Environment Variables

Required variables in `.env`:

```bash
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
GROQ_API_KEY=gsk_...
ADMIN_KEY=your-admin-key
ENCRYPTION_KEY=32-character-key
```

## API Endpoints

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload resume and create session |
| POST | `/api/analyze` | Run AI diagnosis |
| GET | `/api/session/:id` | Get session status |
| GET | `/api/results/:id` | Get diagnosis results |
| DELETE | `/api/session/:id` | Delete session and data |

### Admin Endpoints (requires `Authorization: Bearer {ADMIN_KEY}`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/health` | Comprehensive health check |
| POST | `/api/admin/migrate` | Run database migrations |
| POST | `/api/admin/seed` | Seed job titles |
| POST | `/api/admin/cleanup` | Manual data cleanup |
| GET | `/api/admin/stats` | System statistics |

## Usage Example

### 1. Upload Resume

```bash
curl -X POST http://localhost:3000/api/upload \
  -F "resume=@resume.pdf" \
  -F "targetJobTitle=Senior Software Engineer" \
  -F "jobDescription=Looking for a senior engineer..."
```

Response:
```json
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "sessionToken": "...",
    "fileInfo": {
      "originalName": "resume.pdf",
      "pageCount": 2
    },
    "targetJob": {
      "canonical": "Senior Software Engineer",
      "confidence": 100
    }
  }
}
```

### 2. Run Analysis

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "uuid", "targetJobTitle": "Senior Software Engineer"}'
```

Response includes:
- `rootCauses`: Top 5 issues with severity, impact, and evidence
- `recommendations`: Top 3 actionable fixes with steps
- `overallConfidence`: 0-100 score with explanation
- `isCompetitive`: Boolean assessment

### 3. Delete Data

```bash
curl -X DELETE http://localhost:3000/api/session/{sessionId}
```

## Deployment

### Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
# Then deploy to production
vercel --prod
```

### Post-Deployment Setup

1. Run migrations:
```bash
curl -X POST https://your-app.vercel.app/api/admin/migrate \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```

2. Seed database:
```bash
curl -X POST https://your-app.vercel.app/api/admin/seed \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```

3. Verify health:
```bash
curl https://your-app.vercel.app/health
```

## Project Structure

```
src/
├── index.ts              # Application entry point
├── components/           # Business logic
│   ├── ResumeParser.ts   # PDF/DOC parsing
│   └── JobTitleNormalizer.ts
├── database/
│   ├── connection.ts     # PostgreSQL connection
│   ├── schema.sql        # Database schema
│   ├── migrate.ts        # Migration runner
│   └── seed.ts           # Seed data
├── cache/
│   └── redis.ts          # Redis cache
├── services/
│   ├── groq.ts           # AI analysis
│   └── encryption.ts     # Data encryption
├── routes/
│   ├── api.ts            # Public API routes
│   └── admin.ts          # Admin routes
├── middleware/
│   ├── errorHandler.ts   # Error handling
│   └── fileUpload.ts     # Multer config
├── types/
│   └── index.ts          # TypeScript types
├── utils/
│   └── logger.ts         # Winston logger
└── public/
    └── index.html        # Frontend
```

## Security Features

- **Encryption**: AES-256-GCM for resume content
- **PII Anonymization**: Removed before AI processing
- **24-Hour TTL**: Automatic data deletion
- **Audit Logging**: All data operations logged
- **Session Tokens**: Secure random generation
- **Admin Auth**: Bearer token for admin endpoints

## License

MIT
