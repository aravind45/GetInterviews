# Claude Provider Debug Guide

## Quick Diagnosis Steps

### 1. Check Vercel Runtime Logs

**Go to:** https://vercel.com/dashboard → Your Project → Latest Deployment → Runtime Logs

**Trigger a test:**
1. Visit https://whynointerviews.vercel.app
2. Go to "Analyze Resume" tab
3. Select "Claude (Anthropic)" from dropdown
4. Upload resume + paste job description
5. Click "Analyze My Match"

**Expected log output patterns:**

#### ✅ Success Pattern:
```
📊 Using LLM provider: claude
🤖 Calling Claude API...
✓ Anthropic SDK loaded
✓ Calling Claude with model: claude-sonnet-4-5-20250929
✅ Claude response received
```

#### ❌ Error Patterns:

**Pattern 1: API Key Missing**
```
📊 Using LLM provider: claude
🤖 Calling Claude API...
⚠️  ANTHROPIC_API_KEY not set, falling back to Groq
```
**Fix:** Set ANTHROPIC_API_KEY in Vercel environment variables

**Pattern 2: Invalid API Key**
```
📊 Using LLM provider: claude
🤖 Calling Claude API...
✓ Anthropic SDK loaded
✓ Calling Claude with model: claude-sonnet-4-5-20250929
❌ Claude API Error: invalid x-api-key
   HTTP Status: 401
   Error details: {"type":"error","error":{"type":"authentication_error",...}}
   Falling back to Groq...
```
**Fix:** Verify API key format (should start with `sk-ant-api03-`)

**Pattern 3: Invalid Model**
```
❌ Claude API Error: model_not_found
   HTTP Status: 404
   Error details: {...}
```
**Fix:** Update CLAUDE_MODEL env var or use default

**Pattern 4: Rate Limit**
```
❌ Claude API Error: rate_limit_error
   HTTP Status: 429
   Error details: {...}
```
**Fix:** Wait or upgrade Anthropic plan

**Pattern 5: SDK Import Error**
```
❌ LLM Error: Cannot find module '@anthropic-ai/sdk'
⚠️  Falling back to Groq due to error
```
**Fix:** Rebuild deployment (should not happen - SDK is in package.json)

---

## 2. Verify Environment Variables

**Check in Vercel Dashboard:**

Settings → Environment Variables → Check these exist:

| Variable | Required | Expected Value |
|----------|----------|----------------|
| `ANTHROPIC_API_KEY` | ✅ Yes | `sk-ant-api03-...` (100+ chars) |
| `CLAUDE_MODEL` | ❌ Optional | `claude-sonnet-4-5-20250929` |
| `GROQ_API_KEY` | ✅ Yes | For fallback |

**Important:** After updating env vars, you MUST redeploy!

---

## 3. Test API Key Directly

Test your Anthropic API key works:

```bash
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: YOUR_API_KEY_HERE" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**Expected:** JSON response with Claude's greeting

**If 401:** API key is invalid
**If 404:** Model name is wrong
**If 429:** Rate limited

---

## 4. Verify API Key Format

**Correct format:**
- Starts with `sk-ant-api03-`
- Followed by 100+ alphanumeric characters
- No spaces, quotes, or line breaks
- Example: `sk-ant-api03-abcd1234...` (truncated for security)

**Common mistakes:**
- Extra spaces at beginning/end
- Quotes around the key (`"sk-ant-..."` is wrong)
- Incomplete key (missing characters)
- Old key format (should be api03)

---

## 5. Check Anthropic Console

**Go to:** https://console.anthropic.com

**Verify:**
1. API key is active (not revoked)
2. You have credits/billing set up
3. No usage limits exceeded
4. Key has correct permissions

**Regenerate key if needed:**
- Go to Settings → API Keys
- Delete old key
- Create new key
- Copy complete key to Vercel
- Redeploy

---

## 6. Common Solutions

### Solution 1: Fresh API Key
1. Go to https://console.anthropic.com/settings/keys
2. Create new API key
3. Copy the ENTIRE key (including `sk-ant-api03-`)
4. Go to Vercel → Settings → Environment Variables
5. Edit `ANTHROPIC_API_KEY`
6. Paste the new key (no quotes, no spaces)
7. Save
8. Go to Deployments → Latest → ⋯ → Redeploy

### Solution 2: Verify Model Name
The model `claude-sonnet-4-5-20250929` is the latest Sonnet 4.5.

If you get "model not found", try:
- `claude-sonnet-4-20250514` (older Sonnet 4)
- `claude-3-5-sonnet-20241022` (Sonnet 3.5)

Set in Vercel env vars:
```
CLAUDE_MODEL=claude-sonnet-4-20250514
```

### Solution 3: Check Billing
If you see quota/billing errors:
1. Go to https://console.anthropic.com/settings/billing
2. Verify you have credits or valid payment method
3. Check usage limits

---

## 7. Test After Fix

1. **Redeploy** after any env var changes
2. **Wait 1-2 minutes** for deployment to complete
3. **Hard refresh** the web app (Ctrl+Shift+R)
4. **Select Claude** from dropdown
5. **Analyze resume**
6. **Check logs** for success pattern

---

## 8. Fallback is Working

The good news: Even if Claude fails, the app falls back to Groq automatically.

Your users won't see errors - they'll just get Groq results.

But the logs will show WHY Claude failed so we can fix it.

---

## Need More Help?

If the logs don't match any pattern above, share:
1. Complete error log output from Vercel
2. First 20 characters of your API key (e.g., `sk-ant-api03-abcd12...`)
3. Your Anthropic console usage/billing status

I'll help debug the specific issue.
