# API Keys Checklist - Fix GPT and Claude

## Current Status

### ✅ Groq (Working)
- API Key: Set ✅
- Model: llama-3.3-70b-versatile ✅
- Status: **Working**

### ❌ OpenAI GPT (Not Working)
- API Key: **NOT SET** ❌
- Model: Would use gpt-4o-mini
- Status: **Missing API Key**

### ❌ Claude (Not Working)
- API Key: Set but **INVALID** ❌
- Model: claude-sonnet-4-5-20250929
- Error: `401 authentication_error - invalid x-api-key`
- Status: **Invalid API Key**

---

## Fix OpenAI GPT

### Step 1: Get OpenAI API Key
1. Go to: https://platform.openai.com/api-keys
2. Sign in (or create account)
3. Click **"Create new secret key"**
4. Name: `WhyNoInterviews`
5. **Copy the full key** (starts with `sk-proj-` or `sk-`)

### Step 2: Add to Vercel
1. Go to: https://vercel.com/dashboard
2. Open your **whynointerviews** project
3. Settings → Environment Variables
4. Click **"Add New"**
5. Name: `OPENAI_API_KEY`
6. Value: Paste your OpenAI key
7. Environment: **Production** ✅
8. Click **Save**

### Step 3: Redeploy
- Go to Deployments
- Latest deployment → ⋯ → **Redeploy**

---

## Fix Claude

The Claude API key you added is being rejected by Anthropic's API. This could mean:

1. **Key was regenerated/deleted** in Anthropic Console
2. **Account billing issue** - No credits or payment method
3. **Key permissions** - Restricted access
4. **Typo in key** - Missing characters when copying

### Step 1: Delete Old Key in Anthropic
1. Go to: https://console.anthropic.com/settings/keys
2. Find your current API key
3. Click **Delete** (if it exists)

### Step 2: Create Fresh API Key
1. Still on https://console.anthropic.com/settings/keys
2. Click **"Create Key"**
3. Name: `WhyNoInterviews Production`
4. **Copy the ENTIRE key** (will be very long, 100+ characters)
5. Key format: `sk-ant-api03-xxxxxxxxxx...`

### Step 3: Verify Billing
1. Go to: https://console.anthropic.com/settings/billing
2. **Add payment method** if not already set
3. Verify you have credits or valid billing

### Step 4: Update in Vercel
1. Vercel Dashboard → whynointerviews → Settings → Environment Variables
2. Find `ANTHROPIC_API_KEY`
3. Click ⋯ → **Edit**
4. **Paste the NEW key** (entire key, no quotes, no spaces)
5. Click **Save**

### Step 5: Redeploy
- Deployments → Latest → ⋯ → **Redeploy**

---

## Issue 2: LLM Scoring Differences

You mentioned "huge difference in score how LLM score high". This is expected because:

### Why Scores Differ Between LLMs

1. **Model Quality:**
   - **Llama 3.1 8B** (old): Smaller, less nuanced
   - **Llama 3.3 70B** (new): Much better, more accurate
   - **Claude Sonnet**: Best quality, most conservative
   - **GPT-4o-mini**: Good balance

2. **Scoring Philosophy:**
   - **Llama models**: Tend to be more optimistic
   - **Claude**: More critical/realistic
   - **GPT**: Balanced between the two

3. **This is GOOD:**
   - Different perspectives help users understand their actual position
   - You can compare results between models
   - More conservative scores (Claude) are often more realistic

### Recommendation for Best Results

**For Most Accurate Analysis:**
1. Use **Claude Sonnet 4.5** (once fixed)
   - Most thorough
   - Most realistic scoring
   - Best at identifying issues

**For Balanced View:**
1. Use **GPT-4o** (upgrade from gpt-4o-mini)
   - Good quality
   - Reasonable scoring
   - Fast and reliable

**For Speed/Free:**
1. Use **Llama 3.3 70B** (current)
   - Free on Groq
   - Much better than 8B
   - Slightly optimistic

### To Make Scoring More Consistent

I can adjust the prompts to be more specific about scoring thresholds. Would you like me to:

1. **Add explicit scoring guidelines** to the prompt (e.g., "Score above 80 only if exceptional match")
2. **Normalize scores** after receiving from LLM
3. **Show comparison** when using multiple LLMs

Let me know and I can implement whichever approach you prefer.

---

## Quick Test After Fixes

After adding API keys and redeploying:

1. **Test Groq** (should work):
   - Upload resume
   - Select "Groq (Llama)"
   - Should show: `llama-3.3-70b-versatile`

2. **Test OpenAI** (should work after adding key):
   - Select "GPT-4 (OpenAI)"
   - Should show: `gpt-4o-mini`

3. **Test Claude** (should work after new key):
   - Select "Claude (Anthropic)"
   - Should show: `claude-sonnet-4-5-20250929`

All three should now work independently!
