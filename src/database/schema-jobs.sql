-- Job Search & Tracking Schema Extension
-- Add to existing schema.sql

-- ============================================
-- Job Search Configuration
-- ============================================

CREATE TABLE IF NOT EXISTS job_searches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    diagnosis_id UUID REFERENCES diagnosis_results(id) ON DELETE SET NULL,
    job_title VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL DEFAULT 'remote',
    location_type VARCHAR(50) NOT NULL DEFAULT 'remote' CHECK (location_type IN ('remote', 'hybrid', 'onsite', 'any')),
    experience_level VARCHAR(50),
    boolean_string TEXT NOT NULL,
    search_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    run_daily BOOLEAN DEFAULT FALSE,
    last_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_searches_session ON job_searches(session_id);
CREATE INDEX IF NOT EXISTS idx_job_searches_active ON job_searches(is_active) WHERE is_active = TRUE;

-- ============================================
-- Job Listings (Found Jobs)
-- ============================================

CREATE TABLE IF NOT EXISTS job_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    search_id UUID NOT NULL REFERENCES job_searches(id) ON DELETE CASCADE,
    external_id VARCHAR(255), -- ID from ATS platform if available
    title VARCHAR(500) NOT NULL,
    company VARCHAR(255),
    location VARCHAR(255),
    url TEXT NOT NULL,
    ats_platform VARCHAR(100),
    description_preview TEXT,
    salary_range VARCHAR(100),
    posted_date DATE,
    discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_new BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(search_id, url)
);

CREATE INDEX IF NOT EXISTS idx_job_listings_search ON job_listings(search_id);
CREATE INDEX IF NOT EXISTS idx_job_listings_discovered ON job_listings(discovered_at);
CREATE INDEX IF NOT EXISTS idx_job_listings_new ON job_listings(is_new) WHERE is_new = TRUE;

-- ============================================
-- Job Applications Tracker
-- ============================================

CREATE TABLE IF NOT EXISTS job_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    listing_id UUID REFERENCES job_listings(id) ON DELETE SET NULL,
    job_title VARCHAR(500) NOT NULL,
    company VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    job_url TEXT,
    ats_platform VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'applied' CHECK (status IN (
        'saved', 'applied', 'screening', 'interviewing', 
        'offer', 'rejected', 'withdrawn', 'ghosted'
    )),
    applied_date DATE NOT NULL DEFAULT CURRENT_DATE,
    response_date DATE,
    interview_dates JSONB DEFAULT '[]',
    notes TEXT,
    resume_version VARCHAR(100),
    cover_letter_used BOOLEAN DEFAULT FALSE,
    referral_source VARCHAR(255),
    salary_offered VARCHAR(100),
    follow_up_dates JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_applications_session ON job_applications(session_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);
CREATE INDEX IF NOT EXISTS idx_job_applications_date ON job_applications(applied_date);

-- ============================================
-- Application Statistics View
-- ============================================

CREATE OR REPLACE VIEW application_stats AS
SELECT 
    session_id,
    COUNT(*) as total_applications,
    COUNT(*) FILTER (WHERE status = 'applied') as applied,
    COUNT(*) FILTER (WHERE status = 'screening') as screening,
    COUNT(*) FILTER (WHERE status = 'interviewing') as interviewing,
    COUNT(*) FILTER (WHERE status = 'offer') as offers,
    COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
    COUNT(*) FILTER (WHERE status = 'ghosted') as ghosted,
    COUNT(*) FILTER (WHERE applied_date >= CURRENT_DATE - INTERVAL '7 days') as applied_last_7_days,
    COUNT(*) FILTER (WHERE applied_date >= CURRENT_DATE - INTERVAL '30 days') as applied_last_30_days,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'interviewing' OR status = 'offer')::numeric / 
        NULLIF(COUNT(*), 0) * 100, 1
    ) as interview_rate,
    MIN(applied_date) as first_application,
    MAX(applied_date) as last_application
FROM job_applications
GROUP BY session_id;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_job_searches_updated_at ON job_searches;
CREATE TRIGGER update_job_searches_updated_at
    BEFORE UPDATE ON job_searches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_job_applications_updated_at ON job_applications;
CREATE TRIGGER update_job_applications_updated_at
    BEFORE UPDATE ON job_applications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
