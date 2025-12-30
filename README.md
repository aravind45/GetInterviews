# JobMatch AI - Intelligent Resume Analysis & Job Search Platform

> AI-powered platform that helps job seekers optimize their resumes, find relevant jobs, and connect with potential referrals.

![JobMatch AI](https://img.shields.io/badge/Status-Production-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-4.9-blue)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)

## 🚀 Features

### 1. Resume Analysis & Match Scoring
- **Dual Scoring System**: Compare AI assessment vs. realistic skill-based matching
- **Comprehensive Analysis**:
  - 6-second recruiter scan simulation
  - ATS compatibility check with keyword analysis
  - Experience gap assessment (over/under qualified)
  - Dealbreakers identification
  - Strengths highlighting
  - Hidden red flags detection
  - Competitor analysis
  - Application strategy recommendations
  - Prioritized action plan
- **Auto-save Resume**: Automatically loads your last uploaded resume on login
- **7-day Result Caching**: Analysis results cached in database for quick retrieval

### 2. Resume Optimizer (10-Point Audit)
- **Professional Resume Audit** covering:
  - ✅ Target Role Alignment
  - ✅ Summary Section Quality
  - ✅ Experience Section Effectiveness
  - ✅ Bullet Point Quality (Problem-Action-Result format)
  - ✅ Skills Section Optimization
  - ✅ Formatting & Readability
  - ✅ ATS Optimization
  - ✅ Results & Impact Test
  - ✅ Job-Specific Customization
  - ✅ Final Sanity Checks
- **Side-by-Side Comparison**: View original vs. optimized resume sections
- **Detailed Change Explanations**: Understand why each change improves your resume
- **Download & Copy**: Export optimized resume as text

### 3. AI-Powered Cover Letter Generator
- Company research via Tavily API (optional)
- Tailored to specific job descriptions
- Uses only factual information from your resume
- Includes metrics and achievements
- Save and manage multiple cover letters
- No fabricated content - fact-based only

### 4. Interview Preparation
- 20 personalized interview questions with suggested answers
- Questions to ask the interviewer
- Tips for each answer based on your experience
- Answers use actual achievements from your resume
- Save interview prep for multiple roles

### 5. Job Search & Tracking
- **Smart Search Links**: Quick access to LinkedIn, Indeed, Glassdoor, Google Jobs, ZipRecruiter, Dice, Wellfound
- **Real Job API Integration** (optional): Fetch and score real jobs via JSearch API
- **Profile Extraction**: Auto-extract skills, experience, and target titles from resume
- **Match Scoring**: Each job scored against your profile
- **Job Tracking**: Track application status (SAVED → APPLIED → INTERVIEW → OFFER → REJECTED)

### 6. Networking & Referrals (ICA - Intelligent Contact Analyzer)
- Find relevant contacts at target companies
- LinkedIn Sales Navigator search integration
- Contact management with relevance scoring
- Export contacts as CSV
- Track why each contact is relevant to your search

## 🎯 Why JobMatch AI?

### The Problem with Traditional Resume Reviews
Most tools give you inflated match scores that don't reflect reality. They'll say you're a "95% match" when recruiters disagree.

### Our Solution: Dual Scoring System
- **AI Assessment**: The optimistic view (what you hope for)
- **Skill-Based Score**: The realistic view (what actually matters)

This transparency helps you understand your true chances and focus on winnable opportunities.

### Dual-LLM Analysis
Choose between two AI models for resume analysis:
- **Groq (Llama 3.1)**: Lightning-fast analysis, free tier available, great for quick iterations
- **Claude (Sonnet 4.5)**: Superior analysis quality, better at catching subtle issues, more nuanced recommendations

Users can select their preferred LLM from a dropdown on the analysis page, allowing direct comparison of results.

### Match Score Calculation

```typescript
// Realistic skill-based scoring
matchedSkills = skills found in job description
totalSkills = all skills from resume

if (matchedSkills > 0):
  score = min(95, (matchedSkills / totalSkills) * 100)
else if (no skills match):
  score = min(40, AI_score || 20)  // Fallback capped at 40%
else:
  score = 30  // Default
```

### Verdict Thresholds
- **80%+** = STRONG MATCH ✅
- **60-79%** = MODERATE MATCH ⚠️
- **40-59%** = WEAK MATCH ⚠️
- **20-39%** = LONG SHOT ❌
- **<20%** = NOT A FIT ❌

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon serverless)
- **AI Models**: Dual-LLM Support (User Selectable)
  - **Groq** (llama-3.1-8b-instant) - Fast & Free
  - **Claude** (claude-sonnet-4-5) - Higher quality analysis
- **File Parsing**: pdf-parse, mammoth (PDF/DOC/DOCX support)
- **APIs**:
  - Groq OR Claude (At least one required for AI analysis)
  - Tavily (web research - optional)
  - JSearch (job listings - optional)

### Frontend
- **Pure Vanilla JavaScript** (no framework dependencies)
- **Dark Theme UI** with gradient accents
- **Responsive Design** (mobile-friendly)
- **Single HTML File** architecture for simplicity

### Deployment
- **Platform**: Vercel (serverless)
- **CI/CD**: Auto-deploy from `main` branch
- **Database**: Neon PostgreSQL (auto-scaling)

## 📦 Installation

### Prerequisites
```bash
Node.js 18+
PostgreSQL database
Groq API key (free at https://console.groq.com)
```

### Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/aravind45/WhyNoInterviews.git
cd WhyNoInterviews
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**

Create a `.env` file:

```env
# Database (Required)
DATABASE_URL=postgresql://user:password@host:5432/database

# AI APIs (At least one required - configure one or more providers)
GROQ_API_KEY=your_groq_api_key_here         # Groq (Llama) - Fast & Free
ANTHROPIC_API_KEY=your_anthropic_key_here   # Claude - Higher quality analysis
OPENAI_API_KEY=your_openai_key_here         # OpenAI GPT - Industry standard

# Optional: Choose which model to use for each provider
GROQ_MODEL=llama-3.1-8b-instant             # Default Groq model
CLAUDE_MODEL=claude-sonnet-4-5-20250929     # Default Claude model
OPENAI_MODEL=gpt-4o-mini                    # Default OpenAI model (gpt-4o-mini or gpt-4o)

# Optional APIs
TAVILY_API_KEY=your_tavily_key_here    # For company research in cover letters
JSEARCH_API_KEY=your_jsearch_key_here  # For real job search results

# Server
PORT=3000
```

4. **Database setup**

The app auto-creates tables on first run:
- `user_sessions` - User authentication
- `resume_analyses` - Uploaded resumes
- `diagnosis_results` - Analysis cache (7-day TTL)
- `ica_contacts` - Networking contacts
- `ica_sessions` - Contact search sessions

5. **Run development server**
```bash
npm run dev
```

Visit `http://localhost:3000`

6. **Build for production**
```bash
npm run build
npm start
```

## 🎮 Usage Guide

### Analyze Resume
1. Go to **Analyze Resume** tab
2. Upload resume (PDF, DOC, or DOCX - max 10MB)
3. Paste job description (min 50 chars)
4. Click **🎯 Analyze My Match**
5. View results:
   - Match score with AI vs Skill-based comparison
   - Interview probability
   - 4 action cards (Cover Letter, Interview Prep, Find Referrals)
   - Detailed analysis sections

### Optimize Resume
1. Go to **Resume Optimizer** tab
2. Upload resume
3. Paste target job description
4. Click **🚀 Optimize My Resume**
5. Review 10-point audit results
6. View before/after comparisons
7. Download optimized version

### Generate Cover Letter
1. After analyzing resume, click **Generate Cover Letter** card
2. AI researches company (if Tavily API configured)
3. Generates tailored letter using your actual achievements
4. Copy to clipboard or save for later

### Prepare for Interviews
1. After analyzing resume, click **Interview Prep** card
2. AI generates 20 personalized questions
3. Suggested answers based on your experience
4. Questions to ask the interviewer
5. Save prep for multiple roles

### Find Jobs
1. Go to **Find Jobs** tab
2. Upload resume (profile auto-extracted)
3. Enter search query and location
4. Click **Search Jobs**
5. View smart search links (always available)
6. If JSearch API configured: view scored real jobs

### Network & Get Referrals
1. Go to **Networking** tab
2. Upload resume for profile analysis
3. Click **Find Contacts**
4. Review relevant contacts at target companies
5. Export contact list as CSV

## 📊 Scoring Transparency

### Why Show Both Scores?

**AI Assessment (Purple Box)**
The LLM's optimistic evaluation considering:
- Overall qualifications
- Transferable experience
- Potential fit

**Skill-Based (Green Box)**
Realistic keyword matching:
- Exact skill matches only
- Industry-specific terms
- Technical requirements

### Example
```
AI Assessment: 85%    "Strong overall fit with relevant experience"
Skill-Based: 40%      "Only 6 of 15 required skills match"
```

**Verdict: WEAK MATCH** - The skill-based score determines final verdict.

## 🗂️ Project Structure

```
WhyNoInterviews/
├── src/
│   ├── index.ts                 # Main Express server + API routes
│   ├── database/
│   │   └── connection.ts        # PostgreSQL connection pool
│   ├── routes/
│   │   └── ica.ts              # Networking/Contacts endpoints
│   └── public/
│       └── index.html          # Complete frontend (single file)
├── package.json
├── tsconfig.json
├── vercel.json                 # Vercel deployment config
├── REQUIREMENTS.md             # Detailed feature specs
└── README.md                   # This file
```

## 🔐 Security & Privacy

- **Resume Storage**: Stored in database (consider encryption for production)
- **Session Management**: Email/password + Google OAuth support
- **File Validation**: PDF, DOC, DOCX only - max 10MB
- **API Keys**: Environment variables only (never in code)
- **Input Sanitization**: All user inputs validated
- **Cache Expiry**: Analysis results auto-delete after 7 days

## 📝 API Endpoints

### Core Analysis
```
POST /api/analyze-match              - Analyze resume vs job description
POST /api/generate-specific-cover-letter  - Generate tailored cover letter
POST /api/generate-interview-prep    - Generate interview questions
POST /api/optimize-resume            - Run 10-point resume audit
```

### Profile & Jobs
```
POST /api/extract-profile            - Extract profile from resume
POST /api/search-jobs                - Search and score jobs
POST /api/save-job                   - Save job to tracker
GET  /api/saved-jobs                 - Get tracked jobs
POST /api/update-job-status          - Update application status
```

### Networking (ICA)
```
POST   /api/ica/upload-resume        - Upload for contact analysis
POST   /api/ica/find-contacts        - Find relevant contacts
GET    /api/ica/contacts             - Get saved contacts
GET    /api/ica/statistics           - Get contact stats
DELETE /api/ica/contacts/:id         - Delete single contact
DELETE /api/ica/contacts             - Clear all contacts
```

### Health
```
GET /health                          - Health check
```

## 🚀 Deployment to Vercel

1. **Install Vercel CLI**
```bash
npm i -g vercel
```

2. **Deploy**
```bash
vercel
```

3. **Configure environment variables** in Vercel dashboard:
   - `DATABASE_URL`
   - `GROQ_API_KEY`
   - `TAVILY_API_KEY` (optional)
   - `JSEARCH_API_KEY` (optional)

   > **IMPORTANT**: After adding environment variables in Vercel, you MUST **Redeploy** the project for them to take effect. Go to Deployments -> (three dots) -> Redeploy.

4. **Deploy to production**
```bash
vercel --prod
```

Database tables will auto-create on first request.

## 🐛 Known Issues & Roadmap

### Current Limitations
- PDF download for optimized resume (downloads as .txt - convertible to PDF via Google Docs)
- Interview Coaching tab needs reimplementation (was in previous version)
- Google OAuth needs authorized domains configured

### Planned Features
- [ ] Export analysis as PDF
- [ ] Email reports
- [ ] Application deadline tracking
- [ ] Interview reminder notifications
- [ ] Resume version comparison
- [ ] A/B test different resumes
- [ ] Salary negotiation tips
- [ ] Offer comparison tool
- [ ] Native PDF generation for optimized resumes

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

MIT License - see LICENSE file for details.

## 👨‍💻 Author

**Aravind Thiyagarajan**

- GitHub: [@aravind45](https://github.com/aravind45)
- LinkedIn: [Aravind Thiyagarajan](https://linkedin.com/in/aravindthiyagarajan)

## 🙏 Acknowledgments

- **Groq** - Fast, free LLM inference
- **Tavily** - Web research API for company insights
- **Neon** - Serverless PostgreSQL hosting
- **Vercel** - Seamless deployment platform

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/aravind45/WhyNoInterviews/issues)
- **Documentation**: See [REQUIREMENTS.md](./REQUIREMENTS.md) for detailed specs

---

**Built with ❤️ to help job seekers land their dream jobs**

*Stop getting generic advice. Start getting interviews.*
