
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

// Initialize Database
import { connectDatabase } from './database/connection';
import { initializeProviders } from './services/llmProvider';

connectDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

// Initialize LLM Providers
initializeProviders();

// Import Routes
import apiRoutes from './routes/api';
import icaRoutes from './routes/ica';
import targetCompanyRoutes from './routes/targetCompanies';
import jobsRoutes from './routes/jobs';

// Initialize App
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', apiRoutes);
app.use('/api/ica', icaRoutes);
app.use('/api/target-companies', targetCompanyRoutes);
app.use('/api/jobs', jobsRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Frontend Catch-all (for SPA support if needed, though this is a single page mostly)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
// Start Server
if (require.main === module && process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

export default app;
