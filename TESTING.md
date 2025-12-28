# Testing Guide

## Quick Test

Run the automated test suite to verify both LLM providers are working:

```bash
npm run test:providers
```

This will test:
- ✅ `/api/llm-providers` endpoint returns both Groq and Claude
- ✅ Server health check
- ✅ Provider availability status

## Test Against Local Server

```bash
# Start local server
npm run dev

# In another terminal, run tests
npm run test:providers:local
```

## Manual Testing

### 1. Test Provider Selection

1. Go to https://whynointerviews.vercel.app
2. Navigate to "Analyze Resume" tab
3. Look for "🤖 AI Model" dropdown
4. Verify it shows both:
   - Groq (Llama)
   - Claude (Anthropic)

### 2. Test Groq Provider

1. Select "Groq (Llama)" from dropdown
2. Upload a test resume
3. Paste a job description
4. Click "Analyze My Match"
5. Verify:
   - Analysis completes successfully
   - Results show "🤖 Analyzed by: Groq (Llama)"
   - Model shows as "llama-3.1-8b-instant"

### 3. Test Claude Provider

1. Select "Claude (Anthropic)" from dropdown
2. Upload the same resume
3. Use the same job description
4. Click "Analyze My Match"
5. Verify:
   - Analysis completes successfully (may take 5-10 seconds)
   - Results show "🤖 Analyzed by: Claude (Anthropic)"
   - Model shows as "claude-sonnet-4-5-20250929"

### 4. Compare Results

Upload the same resume twice:
- Once with Groq selected
- Once with Claude selected

Compare the quality and depth of analysis between the two providers.

## API Endpoint Testing

### Check Available Providers

```bash
curl https://whynointerviews.vercel.app/api/llm-providers
```

Expected response:
```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "name": "groq",
        "displayName": "Groq (Llama)",
        "available": true
      },
      {
        "name": "claude",
        "displayName": "Claude (Anthropic)",
        "available": true
      }
    ],
    "default": "groq"
  }
}
```

### Check Server Health

```bash
curl https://whynointerviews.vercel.app/health
```

Expected response:
```json
{
  "status": "ok"
}
```

## Troubleshooting

### Provider Shows as Unavailable

**Symptom**: Provider shows `"available": false` in `/api/llm-providers`

**Solutions**:
1. Check environment variable is set in Vercel:
   - `GROQ_API_KEY` for Groq
   - `ANTHROPIC_API_KEY` for Claude
2. Verify API key is valid and not expired
3. Check Vercel deployment logs for initialization errors

### Authentication Error (401)

**Symptom**: Error message shows "invalid x-api-key" or "authentication_error"

**Solutions**:
1. Verify API key is complete and correctly copied
2. Check for extra spaces or quotes in environment variable
3. Regenerate API key from provider console
4. Redeploy after updating key

### Database Error

**Symptom**: Error about missing `llm_provider` column

**Solutions**:
1. The code has backwards compatibility, so this shouldn't happen
2. If it does, run the migration:
   ```sql
   ALTER TABLE resume_analyses ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(50) DEFAULT 'groq';
   ALTER TABLE diagnosis_results ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(50) DEFAULT 'groq';
   ```

### Dropdown Not Showing

**Symptom**: AI Model dropdown doesn't appear on page

**Solutions**:
1. Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)
2. Clear browser cache
3. Check browser console for JavaScript errors
4. Verify `/api/llm-providers` endpoint is accessible

## Performance Testing

### Expected Response Times

| Provider | Typical Response Time |
|----------|----------------------|
| Groq (Llama 3.1) | 2-3 seconds |
| Claude (Sonnet 4.5) | 5-10 seconds |

### Load Testing

For production load testing:

```bash
# Install artillery
npm install -g artillery

# Run load test (adjust as needed)
artillery quick --count 10 --num 2 https://whynointerviews.vercel.app/api/llm-providers
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Test LLM Providers

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:providers
```

## Cost Monitoring

### Groq
- Free tier: ~30 requests/minute
- Track usage at: https://console.groq.com

### Claude
- Pay-per-use pricing
- Approximate cost per analysis: $0.003-0.005
- Track usage at: https://console.anthropic.com

Monitor API usage regularly to avoid unexpected costs!
