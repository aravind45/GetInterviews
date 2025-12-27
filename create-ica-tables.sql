-- ICA (Ideal Contact Advocates) Schema
-- Run this SQL script in your Neon database console

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- LinkedIn Contacts table
CREATE TABLE IF NOT EXISTS linkedin_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,

    -- Contact Information from LinkedIn Export
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email_address VARCHAR(255),
    company VARCHAR(255),
    position VARCHAR(500),
    connected_on DATE,

    -- Additional LinkedIn Fields
    profile_url TEXT,
    linkedin_profile_url TEXT,
    websites TEXT[],

    -- ICA Categorization (3 categories based on job/interview opportunity)
    ica_category VARCHAR(50) CHECK (ica_category IN ('high_potential', 'medium_potential', 'low_potential', 'uncategorized')) DEFAULT 'uncategorized',
    category_reason TEXT,

    -- Metadata
    notes TEXT,
    last_contacted DATE,
    contact_frequency VARCHAR(50) CHECK (contact_frequency IN ('never', 'rare', 'occasional', 'regular', 'frequent')),
    relationship_strength INTEGER CHECK (relationship_strength >= 1 AND relationship_strength <= 5) DEFAULT 3,

    -- Tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    import_batch_id UUID,

    -- Unique constraint to prevent duplicate contacts per session
    UNIQUE(session_id, first_name, last_name, company)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_session ON linkedin_contacts(session_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_category ON linkedin_contacts(ica_category);
CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_company ON linkedin_contacts(company);
CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_batch ON linkedin_contacts(import_batch_id);

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
    interaction_type VARCHAR(50) NOT NULL CHECK (interaction_type IN ('message', 'call', 'email', 'meeting', 'referral', 'introduction', 'note')),
    interaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    outcome VARCHAR(50) CHECK (outcome IN ('positive', 'neutral', 'negative', 'no_response')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact ON contact_interactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_interactions_date ON contact_interactions(interaction_date);

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
SELECT 'ICA tables created successfully!' as status;
