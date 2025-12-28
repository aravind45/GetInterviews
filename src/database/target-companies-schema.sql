-- ============================================
-- TARGET COMPANIES FEATURE
-- Allows users to maintain a list of target companies
-- and search for jobs specifically at those companies
-- ============================================

-- Target Companies Master Table
CREATE TABLE IF NOT EXISTS target_companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,

    -- Company Information
    company_name VARCHAR(255) NOT NULL,
    company_domain VARCHAR(255), -- e.g., revolut.com
    industry VARCHAR(100),
    company_size VARCHAR(50) CHECK (company_size IN ('startup', 'small', 'medium', 'large', 'enterprise')),

    -- User-defined metadata
    priority INTEGER CHECK (priority >= 1 AND priority <= 5) DEFAULT 3,
    notes TEXT,
    referral_contact VARCHAR(255),

    -- Job search preferences for this company
    target_roles TEXT[] DEFAULT '{}', -- Specific roles to search for at this company
    location_preference VARCHAR(255),

    -- Tracking
    is_active BOOLEAN DEFAULT TRUE,
    date_added DATE DEFAULT CURRENT_DATE,
    last_searched_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Prevent duplicate companies per session
    UNIQUE(session_id, company_name)
);

CREATE INDEX IF NOT EXISTS idx_target_companies_session ON target_companies(session_id);
CREATE INDEX IF NOT EXISTS idx_target_companies_active ON target_companies(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_target_companies_priority ON target_companies(session_id, priority);

-- Company Job Searches (Track searches performed for specific companies)
CREATE TABLE IF NOT EXISTS company_job_searches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,

    -- Search parameters
    search_query VARCHAR(500) NOT NULL,
    search_platform VARCHAR(100) NOT NULL, -- linkedin, indeed, company_website, etc.
    search_url TEXT NOT NULL,

    -- Results
    jobs_found INTEGER DEFAULT 0,
    new_jobs_count INTEGER DEFAULT 0,

    -- Tracking
    searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_job_searches_company ON company_job_searches(company_id);
CREATE INDEX IF NOT EXISTS idx_company_job_searches_session ON company_job_searches(session_id);
CREATE INDEX IF NOT EXISTS idx_company_job_searches_date ON company_job_searches(searched_at);

-- Company-specific job listings (Found jobs at target companies)
CREATE TABLE IF NOT EXISTS company_job_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
    search_id UUID REFERENCES company_job_searches(id) ON DELETE SET NULL,
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,

    -- Job Details
    job_title VARCHAR(500) NOT NULL,
    job_url TEXT NOT NULL,
    location VARCHAR(255),
    employment_type VARCHAR(50) CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
    remote_type VARCHAR(50) CHECK (remote_type IN ('remote', 'hybrid', 'onsite')),

    -- Job Description
    description_preview TEXT,
    requirements_preview TEXT,
    salary_range VARCHAR(100),

    -- Metadata
    posted_date DATE,
    discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_new BOOLEAN DEFAULT TRUE,
    match_score INTEGER CHECK (match_score >= 0 AND match_score <= 100),

    -- Application tracking
    applied BOOLEAN DEFAULT FALSE,
    applied_date DATE,
    application_id UUID REFERENCES job_applications(id) ON DELETE SET NULL,

    -- User actions
    bookmarked BOOLEAN DEFAULT FALSE,
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Prevent duplicate job listings
    UNIQUE(company_id, job_url)
);

CREATE INDEX IF NOT EXISTS idx_company_job_listings_company ON company_job_listings(company_id);
CREATE INDEX IF NOT EXISTS idx_company_job_listings_session ON company_job_listings(session_id);
CREATE INDEX IF NOT EXISTS idx_company_job_listings_new ON company_job_listings(is_new) WHERE is_new = TRUE;
CREATE INDEX IF NOT EXISTS idx_company_job_listings_bookmarked ON company_job_listings(bookmarked) WHERE bookmarked = TRUE;
CREATE INDEX IF NOT EXISTS idx_company_job_listings_discovered ON company_job_listings(discovered_at);

-- ============================================
-- VIEWS FOR ANALYTICS
-- ============================================

-- Target Companies Summary View
CREATE OR REPLACE VIEW target_companies_summary AS
SELECT
    tc.session_id,
    tc.id as company_id,
    tc.company_name,
    tc.industry,
    tc.priority,
    tc.is_active,
    tc.date_added,
    tc.last_searched_at,
    COUNT(DISTINCT cjl.id) as total_jobs_found,
    COUNT(DISTINCT cjl.id) FILTER (WHERE cjl.is_new = TRUE) as new_jobs_count,
    COUNT(DISTINCT cjl.id) FILTER (WHERE cjl.bookmarked = TRUE) as bookmarked_jobs,
    COUNT(DISTINCT cjl.id) FILTER (WHERE cjl.applied = TRUE) as applied_jobs,
    MAX(cjl.discovered_at) as latest_job_discovered,
    AVG(cjl.match_score) as avg_match_score,
    COUNT(DISTINCT cjs.id) as total_searches_performed
FROM target_companies tc
LEFT JOIN company_job_listings cjl ON cjl.company_id = tc.id
LEFT JOIN company_job_searches cjs ON cjs.company_id = tc.id
GROUP BY tc.session_id, tc.id, tc.company_name, tc.industry, tc.priority,
         tc.is_active, tc.date_added, tc.last_searched_at;

-- Target Companies Stats by Session
CREATE OR REPLACE VIEW target_companies_stats AS
SELECT
    session_id,
    COUNT(*) as total_companies,
    COUNT(*) FILTER (WHERE is_active = TRUE) as active_companies,
    COUNT(*) FILTER (WHERE priority = 1) as high_priority,
    COUNT(*) FILTER (WHERE priority = 2) as medium_high_priority,
    COUNT(*) FILTER (WHERE priority = 3) as medium_priority,
    COUNT(DISTINCT industry) as industries_targeted,
    MIN(date_added) as first_company_added,
    MAX(date_added) as latest_company_added,
    COUNT(*) FILTER (WHERE last_searched_at >= NOW() - INTERVAL '7 days') as searched_last_7_days
FROM target_companies
GROUP BY session_id;

-- ============================================
-- TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS update_target_companies_updated_at ON target_companies;
CREATE TRIGGER update_target_companies_updated_at
    BEFORE UPDATE ON target_companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_job_listings_updated_at ON company_job_listings;
CREATE TRIGGER update_company_job_listings_updated_at
    BEFORE UPDATE ON company_job_listings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update last_searched_at when a new search is performed
CREATE OR REPLACE FUNCTION update_company_last_searched()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE target_companies
    SET last_searched_at = NEW.searched_at
    WHERE id = NEW.company_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_company_last_searched_trigger ON company_job_searches;
CREATE TRIGGER update_company_last_searched_trigger
    AFTER INSERT ON company_job_searches
    FOR EACH ROW EXECUTE FUNCTION update_company_last_searched();
