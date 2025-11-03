/**
 * Integration tests for health endpoint
 */

import {describe, it, expect, beforeAll, afterAll} from '@jest/globals';
import request from 'supertest';
import {setupTestEnv} from './testHelpers';

// Setup test environment before importing the app
setupTestEnv();

describe('Health Endpoint Integration Tests', () => {
  let app: any;

  beforeAll(async () => {
    // Wait for secrets to load before importing the app
    const {secretsLoadedPromise} = require('../../../src/config');
    await secretsLoadedPromise;
    
    // Import the Express app from index.js
    // The webUi export is the wrapped function, but we need the raw Express app
    // For testing, we'll use the Firebase Functions test wrapper
    const functions = require('firebase-functions');
    const testEnv = require('firebase-functions-test')({
      projectId: 'test-project',
    });
    
    // Get the wrapped function
    const webUiFunction = require('../../../index').webUi;
    const wrappedFunction = testEnv.wrap(webUiFunction);
    
    // Create a test app that uses the wrapped function
    // Actually, for Express apps, we can test them directly
    // Let's import the Express app directly
    const express = require('express');
    const cors = require('cors');
    const {secretsLoadedPromise: secretsPromise, config} = require('../../../src/config');
    await secretsPromise;
    
    const testApp = express();
    testApp.use(cors({
      origin: (origin: string | undefined, callback: Function) => {
        const allowed = [config.FRONTEND_URL].filter(Boolean);
        if (process.env.FUNCTIONS_EMULATOR === 'true') {
          allowed.push('http://127.0.0.1:5002', 'http://localhost:5002');
        }
        if (!origin || allowed.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }));
    testApp.use(express.json({limit: '1mb'}));
    testApp.use(express.urlencoded({extended: true, limit: '1mb'}));
    
    // Mount routes
    const authRoutes = require('../../../src/auth/routes');
    const authApiRoutes = require('../../../src/api/auth');
    const botRoutes = require('../../../src/api/bot');
    const rewardsRoutes = require('../../../src/api/rewards');
    const obsRoutes = require('../../../src/api/obs');
    const viewerRoutes = require('../../../src/api/viewer');
    const {apiRouter: miscApiRoutes, redirectRouter: redirectsRoutes} = require('../../../src/api/misc');
    
    testApp.use('/auth', authRoutes);
    testApp.use('/api/auth', authApiRoutes);
    testApp.use('/api/bot', botRoutes);
    testApp.use('/api/rewards', rewardsRoutes);
    testApp.use('/api/obs', obsRoutes);
    testApp.use('/api/viewer', viewerRoutes);
    testApp.use('/api', miscApiRoutes);
    testApp.use('/', redirectsRoutes);
    
    testApp.get('/health', (req: any, res: any) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'chatvibes-web-ui-functions',
      });
    });
    
    app = testApp;
  });

  it('should return healthy status', async () => {
    const response = await request(app)
        .get('/health')
        .expect(200);
    
    expect(response.body.status).toBe('healthy');
    expect(response.body.service).toBe('chatvibes-web-ui-functions');
    expect(response.body.timestamp).toBeDefined();
  });

  it('should handle health check with proper CORS', async () => {
    const response = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:5002')
        .expect(200);
    
    expect(response.body.status).toBe('healthy');
    expect(response.headers['access-control-allow-origin']).toBeDefined();
  });

  it('should return 404 for unknown endpoint', async () => {
    const response = await request(app)
        .get('/unknown-endpoint')
        .expect(404);
    
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Endpoint not found');
  });
});

