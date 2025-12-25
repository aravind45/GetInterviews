const Groq = require('groq-sdk');

async function testGroq() {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || 'your-groq-api-key-here'
  });

  try {
    console.log('Testing Groq API...');
    
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'user',
          content: 'Hello, please respond with a simple JSON object containing a greeting.'
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    console.log('✅ Groq API working!');
    console.log('Response:', response.choices[0]?.message?.content);

  } catch (error) {
    console.error('❌ Groq API Error:', error.message);
    if (error.status) {
      console.error('Status:', error.status);
    }
    if (error.error) {
      console.error('Details:', error.error);
    }
  }
}

testGroq();