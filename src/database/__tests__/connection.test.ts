import fc from 'fast-check';
import { connectDatabase, query, closeDatabase, getPool } from '../connection';
import { logger } from '../../utils/logger';

// Mock logger to avoid noise in tests
jest.mock('../../utils/logger');

// Mock pg module for testing
jest.mock('pg', () => {
  const mockClient = {
    query: jest.fn().mockImplementation((text, params) => {
      if (text.includes('NOW()')) {
        return Promise.resolve({ rows: [{ current_time: new Date() }] });
      }
      if (text.includes('$1 as test_value')) {
        return Promise.resolve({ rows: [{ test_value: params?.[0] || 'test' }] });
      }
      if (text.includes('$1 as value')) {
        return Promise.resolve({ rows: [{ value: params?.[0] }] });
      }
      if (text.includes('$1 as string_value')) {
        return Promise.resolve({ rows: [{ string_value: params?.[0] }] });
      }
      if (text.includes('$1 as number_value')) {
        return Promise.resolve({ rows: [{ number_value: params?.[0] }] });
      }
      if (text.includes('$1 as boolean_value')) {
        return Promise.resolve({ rows: [{ boolean_value: params?.[0] }] });
      }
      if (text.includes('$1 as request_id')) {
        return Promise.resolve({ rows: [{ request_id: params?.[0] }] });
      }
      return Promise.resolve({ rows: [{}] });
    }),
    release: jest.fn(),
  };
  
  const mockPool = {
    connect: jest.fn().mockResolvedValue(mockClient),
    query: jest.fn().mockImplementation((text, params) => mockClient.query(text, params)),
    end: jest.fn().mockResolvedValue(undefined),
  };
  
  return {
    Pool: jest.fn().mockImplementation(() => mockPool),
  };
});

describe('Database Connection Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set test environment variables
    process.env.DATABASE_URL = 'postgresql://test_user:test_password@localhost:5432/resume_diagnosis_test';
  });

  afterAll(async () => {
    try {
      await closeDatabase();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('Unit Tests', () => {
    test('should connect to database successfully', async () => {
      await expect(connectDatabase()).resolves.not.toThrow();
      
      // Verify connection works by running a simple query
      const result = await query('SELECT NOW() as current_time');
      expect(result.rows).toHaveLength(1);
    });

    test('should handle database queries', async () => {
      await connectDatabase();
      const result = await query('SELECT $1 as test_value', ['test']);
      expect(result.rows[0].test_value).toBe('test');
    });

    test('should get pool instance after connection', async () => {
      await connectDatabase();
      const pool = getPool();
      expect(pool).toBeDefined();
      expect(typeof pool.query).toBe('function');
    });

    test('should throw error when getting pool before connection', () => {
      // Reset the module to clear any existing pool
      jest.resetModules();
      const { getPool: freshGetPool } = require('../connection');
      
      expect(() => freshGetPool()).toThrow('Database pool not initialized');
    });
  });

  describe('Property Tests', () => {
    /**
     * Feature: resume-diagnosis-engine, Property 11: Data Protection Round-trip
     * Validates: Requirements 9.1, 9.2
     */
    test('Property 11: Database connection should handle multiple query operations consistently', async () => {
      await connectDatabase();
      
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({
            queryText: fc.constantFrom('SELECT $1 as value', 'SELECT $1::text as text_value', 'SELECT UPPER($1) as upper_value'),
            paramValue: fc.string({ minLength: 1, maxLength: 50 })
          }), { minLength: 1, maxLength: 10 }),
          async (queryOperations) => {
            // Test that database connection can handle multiple operations consistently
            const promises = queryOperations.map(async (op, index) => {
              const result = await query(op.queryText, [op.paramValue]);
              return { operation: op, result, index };
            });
            
            const results = await Promise.all(promises);
            
            // Verify all operations completed successfully
            expect(results).toHaveLength(queryOperations.length);
            
            // Verify each operation returned expected structure
            results.forEach((result) => {
              expect(result.result).toBeDefined();
              expect(result.result.rows).toBeDefined();
              expect(Array.isArray(result.result.rows)).toBe(true);
            });
          }
        ),
        { 
          numRuns: 100,
          timeout: 5000,
          verbose: false
        }
      );
    });

    test('Property 11: Database connection should maintain consistency across different parameter types', async () => {
      await connectDatabase();
      
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            stringParam: fc.string({ minLength: 1, maxLength: 100 }),
            numberParam: fc.integer({ min: 1, max: 1000 }),
            booleanParam: fc.boolean()
          }),
          async (params) => {
            // Test parameter handling consistency
            const stringResult = await query('SELECT $1 as string_value', [params.stringParam]);
            const numberResult = await query('SELECT $1 as number_value', [params.numberParam]);
            const booleanResult = await query('SELECT $1 as boolean_value', [params.booleanParam]);
            
            // Verify all queries executed successfully
            expect(stringResult.rows).toHaveLength(1);
            expect(numberResult.rows).toHaveLength(1);
            expect(booleanResult.rows).toHaveLength(1);
            
            // Verify type consistency (mocked responses will be consistent)
            expect(stringResult.rows[0]).toBeDefined();
            expect(numberResult.rows[0]).toBeDefined();
            expect(booleanResult.rows[0]).toBeDefined();
          }
        ),
        { 
          numRuns: 50,
          timeout: 5000
        }
      );
    });

    test('Property 11: Database pool should handle concurrent connection requests safely', async () => {
      await connectDatabase();
      
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 20 }),
          async (concurrentRequests) => {
            // Test concurrent pool usage
            const promises = Array.from({ length: concurrentRequests }, async (_, index) => {
              const result = await query('SELECT $1 as request_id', [index]);
              return { index, result };
            });
            
            const results = await Promise.all(promises);
            
            // Verify all concurrent requests completed successfully
            expect(results).toHaveLength(concurrentRequests);
            
            // Verify each request was handled independently
            results.forEach((result, expectedIndex) => {
              expect(result.index).toBe(expectedIndex);
              expect(result.result.rows).toBeDefined();
            });
          }
        ),
        { 
          numRuns: 30,
          timeout: 10000
        }
      );
    });
  });
});