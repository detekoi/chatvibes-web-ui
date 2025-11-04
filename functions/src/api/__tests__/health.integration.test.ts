/**
 * Integration tests for health endpoint
 */

import {describe, it, expect, beforeAll} from '@jest/globals';
import request from 'supertest';
import {createTestApp} from './appHelper';

describe('Health Endpoint Integration Tests', () => {
  let app: any;

  beforeAll(async () => {
    app = await createTestApp();
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

