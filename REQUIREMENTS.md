# WhyNoInterviews - Product Requirements Document

## Product Overview
JobMatch AI is a comprehensive job search platform that analyzes resumes against job descriptions, provides actionable feedback, generates application materials, and helps users find referrals.

---

## 1. ANALYZE RESUME Tab

### 1.1 Resume Upload & Analysis
**Status:** ✅ Implemented

**Features:**
- Upload resume (PDF, DOC, DOCX)
- Paste job description (minimum 50 characters)
- Auto-load saved resume on login
- Cache analysis results for 7 days (database-backed)

**Core Analysis:**
- **Match Score (0-100%)**: Skill-based realistic scoring
  - Calculates percentage of user skills found in job description
  - NO artificial bonuses or inflation
  - Overrides AI's inflated scores with actual skill match

**Score Display:**
- Match percentage with color-coded ring (red <50%, yellow 50-70%, green 70%+)
- Verdict badge based on score:
  - 80%+ = "STRONG MATCH"
  - 60-79% = "MODERATE MATCH"
  - 40-59% = "WEAK MATCH"
  - 20-39% = "LONG SHOT"
  - <20% = "NOT A FIT"
- Summary text explaining chances

### 1.2 Four Action Cards (Below Score)
**Status:** ✅ Implemented

**Layout:** 4-column grid (2x2 on mobile)

1. **Interview Probability Card**
   - Shows percentage matching the realistic score
   - Progress bar visualization
   - Details section with reasoning below cards

2. **Generate Cover Letter Card**
   - Purple gradient background
   - Clickable to generate tailored cover letter
   - Shows output below with copy/save buttons

3. **Interview Prep Card**
   - Blue gradient background
   - Generates practice questions with suggested answers
   - Questions to ask the interviewer

4. **Find Referrals Card**
   - Green gradient background
   - Links to Networking tab for company contacts

### 1.3 Detailed Analysis Sections

**6-Second Scan:**
- First impression
- Standout elements
- Red flags
- Would recruiter keep reading?

**ATS Compatibility:**
- Pass/fail likelihood
- Score (0-100%)
- Keywords found (green tags)
- Missing keywords (red tags)
- Suggestions to pass ATS

**Experience Gap:**
- Required vs. actual experience
- Gap assessment (OVER_QUALIFIED | GOOD_MATCH | SLIGHTLY_UNDER | SIGNIFICANTLY_UNDER)
- How to close the gap

**Dealbreakers:**
- Missing critical requirements
- Status (MISSING | WEAK)
- Urgent fixes

**Strengths:**
- Skills matching job requirements
- How each helps
- How to highlight them

**Hidden Red Flags:**
- Issues recruiters might see
- What they think
- How to address

**Competitor Analysis:**
- Typical winning candidate profile
- How user compares
- Competitive advantages/disadvantages

**Application Strategy:**
- Should apply? (true/false)
- Confidence level (HIGH | MEDIUM | LOW)
- Best approach (APPLY_NOW | CUSTOMIZE_HEAVILY | GET_REFERRAL | SKIP)
- Time worth investing

**Resume Rewrites:**
- Section to improve
- Current text
- Rewritten text
- Why it's better

**Prioritized Action Plan:**
- Before applying (must-do items)
- Quick wins (easy fixes)
- Worth the effort (harder but valuable)
- Long-term improvements

**Bottom Line:**
- Honest assessment
- One thing to fix (most important)
- Encouragement

### 1.4 Cover Letter Generation
**Status:** ✅ Implemented

**Features:**
- Company research via Tavily API (if available)
- Extracts achievements from resume
- Uses ONLY factual information
- Sections:
  1. Opening (interest in role)
  2. Why this company (research-based)
  3. Relevant experience
  4. Your achievements (with metrics)
  5. Value proposition
  6. Professional closing
- Copy to clipboard
- Save to user account
- View saved letters in "My Cover Letters" modal

**API Endpoint:** `POST /api/generate-specific-cover-letter`

### 1.5 Interview Prep Generation
**Status:** ✅ Implemented

**Features:**
- 20 standard interview questions with personalized answers
- Uses actual resume achievements
- Questions to ask the interviewer (6 default questions)
- Save interview prep
- Tips for each answer

**API Endpoint:** `POST /api/generate-interview-prep`

---

## 2. FIND JOBS Tab

### 2.1 Resume Upload & Profile Extraction
**Status:** ✅ Implemented

**Features:**
- Upload resume once
- Auto-extract profile:
  - Name, email, location
  - Current title
  - Years of experience
  - Experience level (ENTRY | MID | SENIOR | LEAD)
  - Target job titles
  - Hard skills (technical)
  - Soft skills
  - Education
  - Search keywords
- Auto-load saved profile on login

**API Endpoint:** `POST /api/extract-profile`

### 2.2 Profile Display
**Status:** ✅ Implemented

**Shows:**
- Name and title
- Years experience badge
- Experience level badge
- Location badge
- Skills tags (clickable)
- Search query input
- Location filter input
- Search Jobs button

### 2.3 Job Search

**Smart Search Links (Always Available):**
- Primary boards: LinkedIn, Indeed, Glassdoor
- Secondary: Google Jobs, ZipRecruiter, Dice, Wellfound
- Search by skill
- Search by target titles

**Real Job API (Optional - JSearch):**
- If API key configured: fetches real jobs
- Scores each job against profile (realistic skill matching)
- Shows:
  - Job title & company
  - Location
  - Salary range (if available)
  - Posted date
  - Match score (0-100%)
  - Matching skills
  - Recommendation (APPLY_NOW | WORTH_APPLYING | CUSTOMIZE_FIRST)
  - Quick take

**API Endpoint:** `POST /api/search-jobs`

### 2.4 Job Cards Display
**Status:** ⚠️ Needs verification

**Each card shows:**
- Match percentage (color-coded)
- Job title
- Company name
- Location
- Salary (if available)
- Posted date
- Matching skills (tags)
- Recommendation badge
- Save button

### 2.5 Job Tracking
**Status:** ⚠️ Needs verification

**Features:**
- Save jobs to tracker
- Update status: SAVED | APPLIED | INTERVIEW | OFFER | REJECTED
- Track application date
- View saved jobs

**API Endpoints:**
- `POST /api/save-job`
- `GET /api/saved-jobs`
- `POST /api/update-job-status`

---

## 3. TRACKER Tab

### 3.1 Application Statistics
**Status:** ⚠️ Needs implementation details

**Required Stats:**
- Total saved jobs
- Applied count
- Interview count
- Response rate

### 3.2 Job Status Management
**Status:** ⚠️ Needs implementation details

**Features:**
- Filter by status
- Update status with dropdown
- Delete jobs
- Sort by date

### 3.3 Application Timeline
**Status:** ❌ Not implemented

**Suggested Feature:**
- Visual timeline of applications
- Upcoming interview reminders
- Follow-up suggestions

---

## 4. NETWORKING Tab (Contacts/Referrals)

### 4.1 Resume Upload for Contact Analysis
**Status:** ✅ Implemented

**Features:**
- Upload resume to analyze profile
- Extract target companies, titles, skills
- Store session for contact finding

**API Endpoint:** `POST /api/ica/upload-resume`

### 4.2 Contact Discovery
**Status:** ✅ Implemented (ICA - Intelligent Contact Analyzer)

**Features:**
- Search LinkedIn Sales Navigator for relevant contacts
- Filter by:
  - Target companies
  - Job titles
  - Location
  - Keywords
- Returns contact profiles with:
  - Name, title, company
  - Profile URL
  - Why they're relevant
  - Connection strength

**API Endpoint:** `POST /api/ica/find-contacts`

### 4.3 Contact Management Table
**Status:** ✅ Implemented

**Columns:**
- Name
- Title
- Company
- LinkedIn URL (opens in new tab)
- Relevance score
- Why relevant

**Features:**
- Sortable columns
- Clickable LinkedIn links
- Export contacts (CSV)
- Clear contacts

**API Endpoints:**
- `GET /api/ica/contacts`
- `DELETE /api/ica/contacts/:id`
- `DELETE /api/ica/contacts` (clear all)

### 4.4 Hot Leads / Priority Contacts
**Status:** ⚠️ Needs verification

**Features:**
- Highlight contacts at companies actively hiring
- Filter contacts by company
- Priority scoring based on:
  - Company hiring status
  - Title relevance
  - Shared background

---

## 5. INTERVIEW COACHING Tab

### 5.1 Current Status
**Status:** ❌ NOT IMPLEMENTED

**This tab was mentioned as "missing now, implemented before"**

### 5.2 Required Features (Based on Previous Implementation)

**Should Include:**
1. **Mock Interview Practice**
   - Question-by-question practice mode
   - Record answers (audio/video)
   - Feedback on answers

2. **Company-Specific Prep**
   - Research specific company
   - Common questions for that company
   - Culture fit tips

3. **Behavioral Question Bank**
   - STAR method templates
   - Example answers
   - Practice exercises

4. **Technical Interview Prep**
   - Coding challenges
   - System design questions
   - Language-specific prep

5. **Saved Prep Sessions**
   - View all interview preps
   - Edit and update
   - Export to PDF

**Suggested API Endpoints:**
- `POST /api/interview-coach/practice`
- `GET /api/interview-coach/questions`
- `POST /api/interview-coach/feedback`
- `GET /api/interview-coach/saved-sessions`

---

## 6. USER AUTHENTICATION & DATA

### 6.1 Authentication
**Status:** ✅ Implemented

**Features:**
- Email/password signup and login
- Google OAuth integration
- Local storage for user data
- Stable session IDs based on email

### 6.2 User Data Storage
**Status:** ✅ Implemented

**Stored per user:**
- Name, email
- Saved resumes (max 3, with base64 file data)
- Last resume auto-loaded on login
- Saved profile
- Saved cover letters
- Saved interview preps (partial)
- Session token

**LocalStorage Keys:**
- `jobmatch_users` - All user accounts
- `jobmatch_user` - Current logged-in user
- `jobmatch_session` - Stable session ID

### 6.3 Database Storage
**Status:** ✅ Implemented (PostgreSQL)

**Tables:**
- `user_sessions` - Session tracking
- `resume_analyses` - Uploaded resumes and analysis cache
- `diagnosis_results` - Analysis results with 7-day cache
- `ica_contacts` - Networking contacts
- `ica_sessions` - Contact search sessions

---

## 7. TECHNICAL REQUIREMENTS

### 7.1 Backend
- **Framework:** Express.js + TypeScript
- **Database:** PostgreSQL (Neon)
- **AI Model:** Groq (llama-3.1-8b-instant)
- **APIs:**
  - Tavily (web research/company info)
  - JSearch (optional, real job listings)

### 7.2 Frontend
- **Single HTML file** with inline JavaScript
- **No framework** (vanilla JS)
- **Dark theme** UI
- **Responsive** design (mobile-friendly)

### 7.3 Deployment
- **Hosting:** Vercel
- **Branch Strategy:**
  - `main` - production
  - `gallant-swanson` - current development
  - Feature branches as needed

---

## 8. SCORING LOGIC (CRITICAL)

### 8.1 Match Score Calculation
**Implementation:** `src/index.ts:293-306`

```typescript
// Count matching skills
const matchedSkills = profileSkills.filter(skill =>
  jobDescription.toLowerCase().includes(skill.toLowerCase())
);

// Calculate realistic percentage
const realisticScore = profileSkills.length > 0
  ? Math.min(95, Math.round((matchedSkills.length / profileSkills.length) * 100))
  : 30;

// Override AI's inflated score
analysis.overallScore = realisticScore;
analysis.interviewProbability.percentage = realisticScore;
```

**Key Points:**
- Based on ACTUAL skill matches only
- NO artificial bonuses
- Capped at 95% max
- Overrides AI-generated inflated scores
- Interview probability = match score (realistic)

### 8.2 Verdict Mapping
**Implementation:** `src/public/index.html:1435-1440`

```javascript
let accurateVerdict = 'NOT A FIT';
if (score >= 80) accurateVerdict = 'STRONG MATCH';
else if (score >= 60) accurateVerdict = 'MODERATE MATCH';
else if (score >= 40) accurateVerdict = 'WEAK MATCH';
else if (score >= 20) accurateVerdict = 'LONG SHOT';
```

---

## 9. KNOWN ISSUES & MISSING FEATURES

### 9.1 Critical Fixes Needed
- [ ] **Interview Coaching tab** - Completely missing, needs reimplementation
- [ ] **Job Tracker** - Basic structure exists but needs full implementation
- [ ] **Find Jobs** - Verify job cards display and save functionality

### 9.2 Enhancement Opportunities
- [ ] Export analysis as PDF
- [ ] Email reports
- [ ] Application deadline tracking
- [ ] Interview reminder notifications
- [ ] Resume version comparison
- [ ] A/B test different resumes
- [ ] Salary negotiation tips
- [ ] Offer comparison tool

---

## 10. API DOCUMENTATION

### 10.1 Analysis Endpoints

**POST /api/analyze-match**
```json
Request:
- resume: File (multipart/form-data)
- jobDescription: string
- sessionId: string (optional)

Response:
{
  "success": true,
  "data": {
    "overallScore": 45,
    "verdict": "WEAK MATCH",
    "summary": "...",
    "interviewProbability": { "percentage": 45, "reasoning": "..." },
    "sixSecondScan": { ... },
    "atsAnalysis": { ... },
    "qualificationGap": { ... },
    "dealbreakers": [ ... ],
    "strengths": [ ... ],
    "hiddenRedFlags": [ ... ],
    "competitorAnalysis": { ... },
    "applicationStrategy": { ... },
    "resumeRewrites": [ ... ],
    "prioritizedActionPlan": { ... },
    "bottomLine": { ... }
  },
  "sessionId": "sess_xyz",
  "cached": false
}
```

**POST /api/generate-specific-cover-letter**
```json
Request:
{
  "sessionId": "sess_xyz",
  "jobDescription": "...",
  "analysisData": { ... },
  "companyName": "Company Inc" (optional)
}

Response:
{
  "success": true,
  "data": {
    "coverLetter": "...",
    "companyResearch": "...",
    "companyName": "Company Inc"
  }
}
```

**POST /api/generate-interview-prep**
```json
Request:
{
  "sessionId": "sess_xyz",
  "jobDescription": "...",
  "analysisData": { ... }
}

Response:
{
  "success": true,
  "data": {
    "questions": [
      {
        "question": "Tell me about yourself",
        "suggestedAnswer": "...",
        "tips": "..."
      }
    ],
    "questionsToAsk": ["..."],
    "companyResearch": "...",
    "companyName": "..."
  }
}
```

### 10.2 Profile & Job Search Endpoints

**POST /api/extract-profile**
```json
Request:
- resume: File

Response:
{
  "success": true,
  "data": {
    "sessionId": "sess_xyz",
    "profile": {
      "name": "...",
      "email": "...",
      "currentTitle": "...",
      "yearsExperience": 5,
      "experienceLevel": "SENIOR",
      "targetTitles": ["..."],
      "hardSkills": ["..."],
      "softSkills": ["..."],
      "education": { ... },
      "summary": "...",
      "searchKeywords": ["..."]
    },
    "resumeText": "..."
  }
}
```

**POST /api/search-jobs**
```json
Request:
{
  "sessionId": "sess_xyz",
  "searchQuery": "Software Engineer",
  "location": "San Francisco",
  "useRealApi": true
}

Response:
{
  "success": true,
  "data": {
    "jobs": [
      {
        "id": "job_123",
        "title": "...",
        "company": "...",
        "location": "...",
        "matchScore": 75,
        "matchingSkills": ["..."],
        "recommendation": "APPLY_NOW",
        "quickTake": "...",
        "applyUrl": "..."
      }
    ],
    "searchLinks": { ... },
    "hasRealApi": true
  }
}
```

### 10.3 Networking Endpoints

**POST /api/ica/upload-resume**
**POST /api/ica/find-contacts**
**GET /api/ica/contacts**
**GET /api/ica/statistics**
**DELETE /api/ica/contacts/:id**
**DELETE /api/ica/contacts**

(See Networking section for details)

---

## 11. FILE STRUCTURE

```
WhyNoInterviews/
├── src/
│   ├── index.ts                 # Main Express server
│   ├── database/
│   │   └── connection.ts        # PostgreSQL connection
│   ├── routes/
│   │   └── ica.ts              # Networking/Contacts routes
│   └── public/
│       └── index.html          # Single-page frontend
├── package.json
├── tsconfig.json
├── vercel.json
└── REQUIREMENTS.md             # This file
```

---

## CHANGELOG

### Latest Updates (2025-12-27)
- ✅ Fixed match verdict to use realistic score instead of AI verdict
- ✅ Fixed interview probability to match score (not inflated)
- ✅ Added resume auto-load on login
- ✅ Redesigned UI with 4-column action cards
- ✅ Fixed cover letter and interview prep button clicks
- ✅ Created comprehensive requirements document

---

**Document Version:** 1.0
**Last Updated:** 2025-12-27
**Status:** Active Development
