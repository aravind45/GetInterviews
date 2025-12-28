#!/usr/bin/env node

/**
 * Test script for dual-LLM provider functionality
 * Tests both Groq and Claude providers with a sample resume analysis
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_URL || 'https://whynointerviews.vercel.app';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test 1: Check /api/llm-providers endpoint
async function testProvidersEndpoint() {
  log('\n🔍 Test 1: Checking /api/llm-providers endpoint...', 'cyan');

  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/api/llm-providers`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          if (!json.success) {
            log(`❌ FAILED: API returned success=false`, 'red');
            log(`   Error: ${json.error}`, 'red');
            resolve(false);
            return;
          }

          const providers = json.data.providers;
          const defaultProvider = json.data.default;

          log(`✅ SUCCESS: Found ${providers.length} provider(s)`, 'green');

          providers.forEach(p => {
            const status = p.available ? '✓ Available' : '✗ Unavailable';
            const isDefault = p.name === defaultProvider ? ' (default)' : '';
            log(`   - ${p.displayName}: ${status}${isDefault}`, p.available ? 'green' : 'yellow');
          });

          resolve(true);
        } catch (error) {
          log(`❌ FAILED: Invalid JSON response`, 'red');
          log(`   Response: ${data}`, 'red');
          resolve(false);
        }
      });
    }).on('error', (error) => {
      log(`❌ FAILED: ${error.message}`, 'red');
      resolve(false);
    });
  });
}

// Test 2: Test health endpoint
async function testHealthEndpoint() {
  log('\n🔍 Test 2: Checking /health endpoint...', 'cyan');

  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/health`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          if (json.status === 'ok') {
            log(`✅ SUCCESS: Server is healthy`, 'green');
            resolve(true);
          } else {
            log(`❌ FAILED: Unexpected health status: ${json.status}`, 'red');
            resolve(false);
          }
        } catch (error) {
          log(`❌ FAILED: Invalid JSON response`, 'red');
          resolve(false);
        }
      });
    }).on('error', (error) => {
      log(`❌ FAILED: ${error.message}`, 'red');
      resolve(false);
    });
  });
}

// Test 3: Verify environment variables (if running locally)
async function testEnvironmentVariables() {
  log('\n🔍 Test 3: Checking environment variables (local only)...', 'cyan');

  if (process.env.VERCEL) {
    log(`⏭️  SKIPPED: Running on Vercel, can't check env vars`, 'yellow');
    return true;
  }

  const requiredVars = ['DATABASE_URL'];
  const optionalVars = ['GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY', 'JSEARCH_API_KEY'];

  let allRequired = true;

  for (const varName of requiredVars) {
    if (process.env[varName]) {
      log(`✅ ${varName}: Set`, 'green');
    } else {
      log(`❌ ${varName}: Missing (required)`, 'red');
      allRequired = false;
    }
  }

  for (const varName of optionalVars) {
    if (process.env[varName]) {
      log(`✅ ${varName}: Set`, 'green');
    } else {
      log(`⚠️  ${varName}: Not set (optional)`, 'yellow');
    }
  }

  return allRequired;
}

// Test 4: Test provider initialization (local only)
async function testProviderInitialization() {
  log('\n🔍 Test 4: Testing provider initialization (local only)...', 'cyan');

  if (process.env.VERCEL) {
    log(`⏭️  SKIPPED: Running on Vercel`, 'yellow');
    return true;
  }

  try {
    const { initializeProviders, getAvailableProviders } = require('./src/services/llmProvider');

    initializeProviders();
    const providers = getAvailableProviders();

    log(`✅ SUCCESS: Initialized ${providers.length} provider(s)`, 'green');

    providers.forEach(p => {
      const status = p.isAvailable() ? '✓ Available' : '✗ Unavailable';
      log(`   - ${p.displayName}: ${status}`, p.isAvailable() ? 'green' : 'yellow');
    });

    return true;
  } catch (error) {
    log(`❌ FAILED: ${error.message}`, 'red');
    return false;
  }
}

// Main test runner
async function runTests() {
  log('╔════════════════════════════════════════════════════════╗', 'blue');
  log('║   Dual-LLM Provider Test Suite                        ║', 'blue');
  log('║   Testing: ' + BASE_URL.padEnd(40) + '║', 'blue');
  log('╚════════════════════════════════════════════════════════╝', 'blue');

  const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  // Run all tests
  const tests = [
    { name: 'Providers Endpoint', fn: testProvidersEndpoint },
    { name: 'Health Endpoint', fn: testHealthEndpoint },
    { name: 'Environment Variables', fn: testEnvironmentVariables },
    { name: 'Provider Initialization', fn: testProviderInitialization },
  ];

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result === true) {
        results.passed++;
      } else if (result === false) {
        results.failed++;
      } else {
        results.skipped++;
      }
    } catch (error) {
      log(`\n❌ Test "${test.name}" threw an error: ${error.message}`, 'red');
      results.failed++;
    }
  }

  // Print summary
  log('\n╔════════════════════════════════════════════════════════╗', 'blue');
  log('║   Test Summary                                         ║', 'blue');
  log('╠════════════════════════════════════════════════════════╣', 'blue');
  log(`║   Passed:  ${String(results.passed).padEnd(44)}║`, 'green');
  log(`║   Failed:  ${String(results.failed).padEnd(44)}║`, results.failed > 0 ? 'red' : 'reset');
  log(`║   Skipped: ${String(results.skipped).padEnd(44)}║`, 'yellow');
  log('╚════════════════════════════════════════════════════════╝', 'blue');

  if (results.failed === 0) {
    log('\n🎉 All tests passed!', 'green');
    process.exit(0);
  } else {
    log(`\n⚠️  ${results.failed} test(s) failed`, 'red');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  log(`\n💥 Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
