-- Quick Database Setup for ICA Feature
-- Run this in Neon SQL Editor to create essential tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Sessions table (required for session management)
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, expires_at);

-- Resume Analyses table (for target job title lookup)
CREATE TABLE IF NOT EXISTS resume_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
    target_job_title VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- LinkedIn Contacts table
CREATE TABLE IF NOT EXISTS linkedin_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email_address VARCHAR(255),
    company VARCHAR(255),
    position VARCHAR(500),
    connected_on DATE,
    linkedin_profile_url TEXT,
    ica_category VARCHAR(50) CHECK (ica_category IN ('high_potential', 'medium_potential', 'low_potential', 'uncategorized')) DEFAULT 'uncategorized',
    notes TEXT,
    last_contacted DATE,
    contact_frequency VARCHAR(50),
    relationship_strength INTEGER CHECK (relationship_strength >= 1 AND relationship_strength <= 5) DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    import_batch_id UUID,
    UNIQUE(session_id, first_name, last_name, company)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_session ON linkedin_contacts(session_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_category ON linkedin_contacts(ica_category);

-- Contact Import Batches table
CREATE TABLE IF NOT EXISTS contact_import_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    total_contacts INTEGER NOT NULL DEFAULT 0,
    successful_imports INTEGER NOT NULL DEFAULT 0,
    failed_imports INTEGER NOT NULL DEFAULT 0,
    duplicate_contacts INTEGER NOT NULL DEFAULT 0,
    import_errors JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_import_batches_session ON contact_import_batches(session_id);

-- Contact Interactions table
CREATE TABLE IF NOT EXISTS contact_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES linkedin_contacts(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) NOT NULL,
    interaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    outcome VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ICA Statistics View
CREATE OR REPLACE VIEW ica_stats AS
SELECT
    session_id,
    COUNT(*) as total_contacts,
    COUNT(*) FILTER (WHERE ica_category = 'high_potential') as high_potential_count,
    COUNT(*) FILTER (WHERE ica_category = 'medium_potential') as medium_potential_count,
    COUNT(*) FILTER (WHERE ica_category = 'low_potential') as low_potential_count,
    COUNT(*) FILTER (WHERE ica_category = 'uncategorized') as uncategorized_count,
    COUNT(DISTINCT company) as total_companies,
    MAX(created_at) as last_import_date
FROM linkedin_contacts
GROUP BY session_id;

-- Success message
SELECT 'Database setup complete! All tables created.' as message;
