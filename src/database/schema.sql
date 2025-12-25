-- Resume Diagnosis Engine Database Schema
-- Implements all requirements from requirements.md

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Job Title Normalization Tables
-- Requirement 2: Job Target Configuration
-- ============================================

CREATE TABLE IF NOT EXISTS canonical_job_titles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(100) NOT NULL,
    seniority_level VARCHAR(50) NOT NULL CHECK (seniority_level IN ('Entry', 'Junior', 'Mid', 'Senior', 'Lead', 'Principal', 'Executive')),
    industry VARCHAR(100),
    is_generic BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_job_titles_category ON canonical_job_titles(category);
CREATE INDEX IF NOT EXISTS idx_canonical_job_titles_seniority ON canonical_job_titles(seniority_level);

CREATE TABLE IF NOT EXISTS job_title_variations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canonical_id UUID NOT NULL REFERENCES canonical_job_titles(id) ON DELETE CASCADE,
    variation VARCHAR(255) NOT NULL,
    confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(canonical_id, variation)
);

CREATE INDEX IF NOT EXISTS idx_job_title_variations_variation ON job_title_variations(LOWER(variation));
CREATE INDEX IF NOT EXISTS idx_job_title_variations_canonical ON job_title_variations(canonical_id);

-- Role templates for analysis matching
CREATE TABLE IF NOT EXISTS role_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canonical_job_id UUID NOT NULL UNIQUE REFERENCES canonical_job_titles(id) ON DELETE CASCADE,
    required_skills TEXT[] NOT NULL DEFAULT '{}',
    preferred_skills TEXT[] DEFAULT '{}',
    required_keywords TEXT[] NOT NULL DEFAULT '{}',
    experience_level_min INTEGER NOT NULL DEFAULT 0 CHECK (experience_level_min >= 0),
    experience_level_max INTEGER CHECK (experience_level_max IS NULL OR experience_level_max >= experience_level_min),
    education_requirements TEXT[] DEFAULT '{}',
    industry_context JSONB DEFAULT '{}',
    ats_keywords TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_templates_canonical ON role_templates(canonical_job_id);

-- ============================================
-- Session Management Tables
-- Requirement 9: Privacy and Data Security
-- ============================================

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token VARCHAR(255) NOT NULL UNIQUE,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active) WHERE is_active = TRUE;

-- ============================================
-- Resume Analysis Tables
-- Requirements 1, 3, 9: Resume Processing, AI Diagnosis, Privacy
-- ============================================

CREATE TABLE IF NOT EXISTS resume_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    file_hash VARCHAR(64) NOT NULL,
    encrypted_content BYTEA NOT NULL,
    original_filename VARCHAR(255),
    file_type VARCHAR(10) NOT NULL CHECK (file_type IN ('pdf', 'doc', 'docx')),
    file_size INTEGER NOT NULL,
    page_count INTEGER,
    target_job_title VARCHAR(255) NOT NULL,
    canonical_job_id UUID REFERENCES canonical_job_titles(id),
    job_description TEXT,
    application_count INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'analyzing', 'completed', 'failed', 'timeout', 'deleted')),
    confidence_score INTEGER CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_resume_analyses_session ON resume_analyses(session_id);
CREATE INDEX IF NOT EXISTS idx_resume_analyses_status ON resume_analyses(status);
CREATE INDEX IF NOT EXISTS idx_resume_analyses_expires ON resume_analyses(expires_at);
CREATE INDEX IF NOT EXISTS idx_resume_analyses_hash ON resume_analyses(file_hash);

-- ============================================
-- Diagnosis Results Tables
-- Requirements 3, 4, 5, 6, 8: AI Diagnosis, Root Cause, Recommendations, Confidence, Scoring
-- ============================================

CREATE TABLE IF NOT EXISTS diagnosis_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_id UUID NOT NULL UNIQUE REFERENCES resume_analyses(id) ON DELETE CASCADE,
    overall_confidence INTEGER NOT NULL CHECK (overall_confidence >= 0 AND overall_confidence <= 100),
    confidence_explanation TEXT NOT NULL,
    is_competitive BOOLEAN NOT NULL DEFAULT FALSE,
    data_completeness INTEGER NOT NULL CHECK (data_completeness >= 0 AND data_completeness <= 100),
    model_used VARCHAR(100) NOT NULL,
    resume_processing_time INTEGER NOT NULL, -- milliseconds
    analysis_time INTEGER NOT NULL, -- milliseconds
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_results_analysis ON diagnosis_results(analysis_id);

-- Root causes table (max 5 per diagnosis, per Requirement 4)
CREATE TABLE IF NOT EXISTS root_causes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagnosis_id UUID NOT NULL REFERENCES diagnosis_results(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN (
        'keyword_mismatch', 'experience_gap', 'skill_deficiency', 
        'formatting_issue', 'ats_compatibility', 'quantification_missing',
        'relevance_issue', 'career_progression', 'education_mismatch', 'other'
    )),
    severity_score INTEGER NOT NULL CHECK (severity_score >= 1 AND severity_score <= 10),
    impact_score INTEGER NOT NULL CHECK (impact_score >= 1 AND impact_score <= 10),
    priority INTEGER NOT NULL CHECK (priority >= 1 AND priority <= 5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_root_causes_diagnosis ON root_causes(diagnosis_id);
CREATE INDEX IF NOT EXISTS idx_root_causes_priority ON root_causes(diagnosis_id, priority);

-- Evidence table for root causes
CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    root_cause_id UUID NOT NULL REFERENCES root_causes(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('resume_section', 'missing_keyword', 'formatting', 'market_data', 'comparison')),
    description TEXT NOT NULL,
    citation TEXT NOT NULL,
    location VARCHAR(255),
    confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_root_cause ON evidence(root_cause_id);

-- Recommendations table (max 3 per diagnosis, per Requirement 5)
CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagnosis_id UUID NOT NULL REFERENCES diagnosis_results(id) ON DELETE CASCADE,
    root_cause_id UUID REFERENCES root_causes(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    implementation_steps TEXT[] NOT NULL,
    expected_impact INTEGER NOT NULL CHECK (expected_impact >= 1 AND expected_impact <= 10),
    difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    time_estimate VARCHAR(100) NOT NULL,
    priority INTEGER NOT NULL CHECK (priority >= 1 AND priority <= 3),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_diagnosis ON recommendations(diagnosis_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_priority ON recommendations(diagnosis_id, priority);

-- ============================================
-- Audit and Compliance Tables
-- Requirement 9: Privacy and Data Security
-- ============================================

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(20) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    record_id UUID NOT NULL,
    session_id UUID REFERENCES user_sessions(id) ON DELETE SET NULL,
    ip_address INET,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_op ON audit_log(table_name, operation);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON audit_log(record_id);

-- Data deletion confirmations
CREATE TABLE IF NOT EXISTS deletion_confirmations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    analysis_id UUID NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmation_token VARCHAR(64) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_deletion_confirmations_token ON deletion_confirmations(confirmation_token);

-- ============================================
-- Functions and Triggers
-- ============================================

-- Cleanup expired data function (Requirement 9: 24-hour deletion)
CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS TABLE(sessions_deleted INTEGER, analyses_deleted INTEGER, audit_cleaned INTEGER) AS $$
DECLARE
    v_sessions INTEGER := 0;
    v_analyses INTEGER := 0;
    v_audit INTEGER := 0;
BEGIN
    -- Mark expired analyses as deleted
    UPDATE resume_analyses 
    SET deleted_at = NOW(), status = 'deleted', encrypted_content = ''::bytea
    WHERE expires_at < NOW() AND deleted_at IS NULL;
    GET DIAGNOSTICS v_analyses = ROW_COUNT;
    
    -- Delete expired sessions
    DELETE FROM user_sessions WHERE expires_at < NOW();
    GET DIAGNOSTICS v_sessions = ROW_COUNT;
    
    -- Clean up old audit logs (keep for 7 days)
    DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS v_audit = ROW_COUNT;
    
    RETURN QUERY SELECT v_sessions, v_analyses, v_audit;
END;
$$ LANGUAGE plpgsql;

-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, operation, record_id, old_values)
        VALUES (TG_TABLE_NAME, TG_OP, OLD.id, to_jsonb(OLD) - 'encrypted_content');
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, record_id, old_values, new_values)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, 
                to_jsonb(OLD) - 'encrypted_content', 
                to_jsonb(NEW) - 'encrypted_content');
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, operation, record_id, new_values)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, to_jsonb(NEW) - 'encrypted_content');
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Updated timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers (drop first if exists to avoid duplicates)
DROP TRIGGER IF EXISTS audit_resume_analyses ON resume_analyses;
CREATE TRIGGER audit_resume_analyses
    AFTER INSERT OR UPDATE OR DELETE ON resume_analyses
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS audit_user_sessions ON user_sessions;
CREATE TRIGGER audit_user_sessions
    AFTER INSERT OR UPDATE OR DELETE ON user_sessions
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS update_canonical_job_titles_updated_at ON canonical_job_titles;
CREATE TRIGGER update_canonical_job_titles_updated_at
    BEFORE UPDATE ON canonical_job_titles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_role_templates_updated_at ON role_templates;
CREATE TRIGGER update_role_templates_updated_at
    BEFORE UPDATE ON role_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Constraints for Requirements Compliance
-- ============================================

-- Ensure max 5 root causes per diagnosis (Requirement 4)
CREATE OR REPLACE FUNCTION check_root_cause_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM root_causes WHERE diagnosis_id = NEW.diagnosis_id) >= 5 THEN
        RAISE EXCEPTION 'Maximum of 5 root causes allowed per diagnosis';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_root_cause_limit ON root_causes;
CREATE TRIGGER enforce_root_cause_limit
    BEFORE INSERT ON root_causes
    FOR EACH ROW EXECUTE FUNCTION check_root_cause_limit();

-- Ensure max 3 recommendations per diagnosis (Requirement 5)
CREATE OR REPLACE FUNCTION check_recommendation_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM recommendations WHERE diagnosis_id = NEW.diagnosis_id) >= 3 THEN
        RAISE EXCEPTION 'Maximum of 3 recommendations allowed per diagnosis';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_recommendation_limit ON recommendations;
CREATE TRIGGER enforce_recommendation_limit
    BEFORE INSERT ON recommendations
    FOR EACH ROW EXECUTE FUNCTION check_recommendation_limit();
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
