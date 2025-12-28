-- Seed data for Target Companies feature
-- Initial list of 15 popular tech companies for job seekers

-- Note: This seeds a default/global list that can be copied to user sessions
-- Or can be used as suggestions when users create their target companies

-- First, create a temporary global companies table (optional - for suggestions)
CREATE TABLE IF NOT EXISTS global_company_suggestions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL UNIQUE,
    company_domain VARCHAR(255),
    industry VARCHAR(100),
    company_size VARCHAR(50),
    description TEXT,
    careers_page_url TEXT,
    linkedin_url TEXT,
    is_popular BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert the 15 target companies
INSERT INTO global_company_suggestions (company_name, company_domain, industry, company_size, description, careers_page_url, linkedin_url) VALUES
('Revolut', 'revolut.com', 'Fintech', 'large', 'Global financial technology company offering banking services', 'https://www.revolut.com/careers/', 'https://www.linkedin.com/company/revolut/'),
('Kraken', 'kraken.com', 'Cryptocurrency', 'large', 'Cryptocurrency exchange and bank', 'https://www.kraken.com/careers', 'https://www.linkedin.com/company/kraken-exchange/'),
('Teramind', 'teramind.com', 'Cybersecurity', 'medium', 'Employee monitoring and data loss prevention software', 'https://www.teramind.com/careers', 'https://www.linkedin.com/company/teramind/'),
('Paylocity', 'paylocity.com', 'HR Tech', 'large', 'Cloud-based payroll and human capital management software', 'https://www.paylocity.com/careers/', 'https://www.linkedin.com/company/paylocity/'),
('Superside', 'superside.com', 'Design Services', 'medium', 'Design subscription service for brands', 'https://www.superside.com/careers', 'https://www.linkedin.com/company/superside/'),
('HubSpot', 'hubspot.com', 'Marketing Tech', 'enterprise', 'CRM platform and inbound marketing, sales, and service software', 'https://www.hubspot.com/careers', 'https://www.linkedin.com/company/hubspot/'),
('Docker Inc.', 'docker.com', 'DevOps', 'large', 'Platform for developing, shipping, and running applications in containers', 'https://www.docker.com/career-openings/', 'https://www.linkedin.com/company/docker/'),
('Canonical', 'canonical.com', 'Open Source', 'large', 'Publisher of Ubuntu Linux and provider of enterprise solutions', 'https://canonical.com/careers', 'https://www.linkedin.com/company/canonical/'),
('Jerry', 'getjerry.com', 'Insurtech', 'startup', 'AI-powered insurance comparison and savings app', 'https://www.getjerry.com/careers', 'https://www.linkedin.com/company/getjerry/'),
('Alpaca', 'alpaca.markets', 'Fintech', 'medium', 'Commission-free stock trading API platform', 'https://alpaca.markets/careers', 'https://www.linkedin.com/company/alpacahq/'),
('Toast', 'toasttab.com', 'Restaurant Tech', 'large', 'Restaurant point of sale and management platform', 'https://careers.toasttab.com/', 'https://www.linkedin.com/company/toast-inc/'),
('HackerOne', 'hackerone.com', 'Cybersecurity', 'medium', 'Vulnerability coordination and bug bounty platform', 'https://www.hackerone.com/careers', 'https://www.linkedin.com/company/hackerone/'),
('Coderio', 'coderio.co', 'Software Development', 'small', 'Custom software development and IT consulting', 'https://www.coderio.co/careers', 'https://www.linkedin.com/company/coderio/'),
('Socure', 'socure.com', 'Identity Verification', 'medium', 'Digital identity verification and fraud prevention', 'https://www.socure.com/careers', 'https://www.linkedin.com/company/socure-inc/'),
('Zapier', 'zapier.com', 'Automation', 'large', 'Workflow automation platform connecting apps and services', 'https://zapier.com/jobs', 'https://www.linkedin.com/company/zapier/')
ON CONFLICT (company_name) DO NOTHING;

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_global_company_suggestions_name ON global_company_suggestions(LOWER(company_name));
CREATE INDEX IF NOT EXISTS idx_global_company_suggestions_industry ON global_company_suggestions(industry);
CREATE INDEX IF NOT EXISTS idx_global_company_suggestions_popular ON global_company_suggestions(is_popular) WHERE is_popular = TRUE;

-- Function to copy default companies to a user's session
CREATE OR REPLACE FUNCTION add_default_target_companies(p_session_id UUID)
RETURNS TABLE(companies_added INTEGER) AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    INSERT INTO target_companies (
        session_id,
        company_name,
        company_domain,
        industry,
        company_size,
        priority,
        notes,
        is_active
    )
    SELECT
        p_session_id,
        gcs.company_name,
        gcs.company_domain,
        gcs.industry,
        gcs.company_size,
        3, -- Default priority
        'Default company from suggestions. Add notes about why you''re interested.',
        TRUE
    FROM global_company_suggestions gcs
    WHERE gcs.is_popular = TRUE
    ON CONFLICT (session_id, company_name) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT add_default_target_companies('your-session-uuid-here');
