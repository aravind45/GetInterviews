// Simple script to run the Target Companies migration
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/migrate-target-companies',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Migration response:', data);
    try {
      const parsed = JSON.parse(data);
      if (parsed.success) {
        console.log('✅ Migration successful!');
        console.log(`   ${parsed.message}`);
      } else {
        console.log('❌ Migration failed:', parsed.error);
      }
    } catch (e) {
      console.log('Response:', data);
    }
    process.exit(parsed.success ? 0 : 1);
  });
});

req.on('error', (error) => {
  console.error('❌ Error running migration:', error.message);
  console.log('\n⚠️  Make sure the server is running:');
  console.log('   npm run dev');
  process.exit(1);
});

req.end();
