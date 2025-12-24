import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

let redisClient: RedisClientType | null = null;

export const connectRedis = async (): Promise<void> => {
  try {
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      logger.warn('REDIS_URL not set, caching disabled');
      return;
    }

    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Redis reconnection failed after 10 attempts');
            return new Error('Redis reconnection failed');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis client error:', err);
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    await redisClient.connect();
    
    // Test connection
    await redisClient.ping();
    logger.info('Redis connected successfully');
  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    redisClient = null;
    // Don't throw - allow app to work without cache
  }
};

export const getRedisClient = (): RedisClientType | null => {
  return redisClient;
};

export const isRedisConnected = (): boolean => {
  return redisClient?.isOpen ?? false;
};

export const cacheSet = async (
  key: string, 
  value: any, 
  ttlSeconds: number = 3600
): Promise<boolean> => {
  if (!redisClient?.isOpen) {
    return false;
  }
  
  try {
    const serialized = JSON.stringify(value);
    await redisClient.setEx(key, ttlSeconds, serialized);
    return true;
  } catch (error) {
    logger.error('Cache set error:', { key, error });
    return false;
  }
};

export const cacheGet = async <T = any>(key: string): Promise<T | null> => {
  if (!redisClient?.isOpen) {
    return null;
  }
  
  try {
    const value = await redisClient.get(key);
    if (value) {
      return JSON.parse(value) as T;
    }
    return null;
  } catch (error) {
    logger.error('Cache get error:', { key, error });
    return null;
  }
};

export const cacheDelete = async (key: string): Promise<boolean> => {
  if (!redisClient?.isOpen) {
    return false;
  }
  
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    logger.error('Cache delete error:', { key, error });
    return false;
  }
};

export const cacheExists = async (key: string): Promise<boolean> => {
  if (!redisClient?.isOpen) {
    return false;
  }
  
  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (error) {
    logger.error('Cache exists error:', { key, error });
    return false;
  }
};

export const cacheSetWithLock = async (
  key: string,
  value: any,
  ttlSeconds: number = 3600,
  lockTimeout: number = 30
): Promise<boolean> => {
  if (!redisClient?.isOpen) {
    return false;
  }
  
  const lockKey = `lock:${key}`;
  
  try {
    // Try to acquire lock
    const acquired = await redisClient.setNX(lockKey, '1');
    if (!acquired) {
      return false;
    }
    
    // Set lock expiry
    await redisClient.expire(lockKey, lockTimeout);
    
    // Set the actual value
    const serialized = JSON.stringify(value);
    await redisClient.setEx(key, ttlSeconds, serialized);
    
    // Release lock
    await redisClient.del(lockKey);
    return true;
  } catch (error) {
    logger.error('Cache set with lock error:', { key, error });
    await redisClient.del(lockKey).catch(() => {});
    return false;
  }
};

export const closeRedis = async (): Promise<void> => {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
};

export default {
  connectRedis,
  getRedisClient,
  isRedisConnected,
  cacheSet,
  cacheGet,
  cacheDelete,
  cacheExists,
  cacheSetWithLock,
  closeRedis
};
