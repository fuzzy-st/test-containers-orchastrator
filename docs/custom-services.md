# Creating Custom Services

How to create reusable service definitions using `BaseContainerService`.

## Why Create Custom Services?

**Use custom services when:**

- ✅ You use the same container configuration repeatedly
- ✅ You want typed connection info for compose
- ✅ You need to create client connections
- ✅ You want to share service definitions across projects

**Don't create custom services when:**

- ❌ You only need it once (use `useContainer()` instead)
- ❌ Simple configuration (use inline config)

## Basic Example

```typescript
import { BaseContainerService } from '@fuzzy-street/dockhand';
import { createClient, RedisClient } from 'redis';
import type { StartedTestContainer } from 'testcontainers';

// 1. Define your connection type
interface RedisConnection {
  client: RedisClient;
  host: string;
  port: number;
}

// 2. Extend BaseContainerService
class RedisService extends BaseContainerService<RedisConnection> {
  
  // 3. Implement start (for standalone usage)
  async start(): Promise<void> {
    const container = await new GenericContainer('redis:latest')
      .withExposedPorts(6379)
      .start();
    
    this.setContainer(container); // ← Store container
  }

  // 4. Implement stop
  async stop(): Promise<void> {
    await this.getContainer().stop();
    this.started = false;
  }

  // 5. Implement getConnectionInfo
  getConnectionInfo(): RedisConnection {
    this.validateStarted(); // ← Check container is running
    const container = this.getContainer(); // ← Get container
    
    const host = container.getHost();
    const port = container.getMappedPort(6379);
    
    return {
      client: createClient({ socket: { host, port } }),
      host,
      port
    };
  }
}

// Usage with compose
const { connectionInfo } = await useCompose<{ redis: RedisConnection }>('./')
  .withService('redis', new RedisService('redis'))
  .start();

const redisClient = connectionInfo.redis.client;
await redisClient.connect();
```

## With Configuration

```typescript
interface PostgresConnection {
  client: PostgresClient;
  database: string;
  connectionString: string;
}

// Define config type
interface PostgresConfig {
  database: string;
  user: string;
  password: string;
}

class PostgresService extends BaseContainerService<
  PostgresConnection,
  PostgresConfig // ← Config type
> {
  constructor(name: string, config: PostgresConfig) {
    super(name, config);
  }

  async start(): Promise<void> {
    const container = await new GenericContainer('postgres:14')
      .withExposedPorts(5432)
      .withEnvironment({
        POSTGRES_DB: this.serviceConfig.database,
        POSTGRES_USER: this.serviceConfig.user,
        POSTGRES_PASSWORD: this.serviceConfig.password
      })
      .start();
    
    this.setContainer(container);
  }

  async stop(): Promise<void> {
    await this.getContainer().stop();
    this.started = false;
  }

  getConnectionInfo(): PostgresConnection {
    this.validateStarted();
    const container = this.getContainer();
    
    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const connectionString = `postgres://${this.serviceConfig.user}:${this.serviceConfig.password}@${host}:${port}/${this.serviceConfig.database}`;
    
    return {
      client: new PostgresClient({ connectionString }),
      database: this.serviceConfig.database,
      connectionString
    };
  }

  // Optional: Compose integration
  getWaitStrategy() {
    return Wait.forLogMessage('database system is ready to accept connections');
  }

  getEnvironmentVariables() {
    return {
      POSTGRES_DB: this.serviceConfig.database,
      POSTGRES_USER: this.serviceConfig.user,
      POSTGRES_PASSWORD: this.serviceConfig.password
    };
  }
}

// Usage
const pgService = new PostgresService('postgres', {
  database: 'myapp',
  user: 'admin',
  password: 'secret'
});

const { connectionInfo } = await useCompose<{ postgres: PostgresConnection }>('./')
  .withService('postgres', pgService)
  .start();
```

## Helper Methods Available

When extending `BaseContainerService`, you get:

```typescript
// Protected methods you can use:

this.getContainer()      // Get the started container
this.setContainer(c)     // Store the container reference
this.validateStarted()   // Throw if not started
this.isStarted()         // Check if started
this.getName()           // Get service name
```

## Complete Example: MongoDB

```typescript
import { BaseContainerService } from '@fuzzy-street/dockhand';
import { MongoClient } from 'mongodb';
import { GenericContainer, Wait } from 'testcontainers';

interface MongoConnection {
  client: MongoClient;
  uri: string;
  database: string;
}

interface MongoConfig {
  database: string;
  rootUser?: string;
  rootPassword?: string;
}

export class MongoService extends BaseContainerService<MongoConnection, MongoConfig> {
  constructor(name: string, config: MongoConfig) {
    super(name, config);
  }

  async start(): Promise<void> {
    const rootUser = this.serviceConfig.rootUser || 'root';
    const rootPassword = this.serviceConfig.rootPassword || 'password';
    
    const container = await new GenericContainer('mongo:7')
      .withExposedPorts(27017)
      .withEnvironment({
        MONGO_INITDB_ROOT_USERNAME: rootUser,
        MONGO_INITDB_ROOT_PASSWORD: rootPassword,
        MONGO_INITDB_DATABASE: this.serviceConfig.database
      })
      .start();

    this.setContainer(container);
  }

  async stop(): Promise<void> {
    const container = this.getContainer();
    await container.stop();
    this.started = false;
  }

  getConnectionInfo(): MongoConnection {
    this.validateStarted();
    
    const container = this.getContainer();
    const host = container.getHost();
    const port = container.getMappedPort(27017);
    
    const rootUser = this.serviceConfig.rootUser || 'root';
    const rootPassword = this.serviceConfig.rootPassword || 'password';
    const uri = `mongodb://${rootUser}:${rootPassword}@${host}:${port}`;
    
    return {
      client: new MongoClient(uri),
      uri,
      database: this.serviceConfig.database
    };
  }

  getWaitStrategy() {
    return Wait.forLogMessage('Waiting for connections');
  }

  getEnvironmentVariables() {
    return {
      MONGO_INITDB_ROOT_USERNAME: this.serviceConfig.rootUser || 'root',
      MONGO_INITDB_ROOT_PASSWORD: this.serviceConfig.rootPassword || 'password',
      MONGO_INITDB_DATABASE: this.serviceConfig.database
    };
  }
}

// Usage
const mongo = new MongoService('mongo', { database: 'myapp' });

// Standalone
await mongo.start();
const { client } = mongo.getConnectionInfo();
await client.connect();
// ... use mongo ...
await mongo.stop();

// Or with compose
const { connectionInfo } = await useCompose<{ mongo: MongoConnection }>('./')
  .withService('mongo', mongo)
  .start();

await connectionInfo.mongo.client.connect();
```

## Testing Custom Services

```typescript
import { test } from 'node:test';
import assert from 'node:assert';

test('RedisService works', async () => {
  const redis = new RedisService('redis');
  
  await redis.start();
  
  const { client } = redis.getConnectionInfo();
  await client.connect();
  
  await client.set('key', 'value');
  const result = await client.get('key');
  
  assert.equal(result, 'value');
  
  await client.quit();
  await redis.stop();
});
```

## Publishing Custom Services

Create separate packages for reusable services:

```
@your-org/container-postgres
@your-org/container-redis
@your-org/container-mongodb
@your-org/container-rabbitmq
```

```typescript
// @your-org/container-postgres
export { PostgresService } from './postgres-service';
export type { PostgresConnection, PostgresConfig } from './types';
```

Users install what they need:

```bash
npm install @fuzzy-street/dockhand
npm install @your-org/container-postgres
```

## When NOT to Use Custom Services

**Just use `useContainer()` for simple cases:**

```typescript
// ❌ Overkill - don't create a service
class SimpleRedisService extends BaseContainerService<RedisConnection> {
  // 50 lines of code...
}

// ✅ Simple and clear
const { host, ports } = await useContainer('redis:latest')
  .withPort(6379)
  .start();

const client = createClient({ socket: { host, port: ports[6379] } });
```

## Summary

**Custom services are for:**

- Reusable configurations
- Typed connection info
- Client initialization
- Compose integration

**Implementation checklist:**

1. Define connection type
2. Extend `BaseContainerService<ConnectionType, ConfigType>`
3. Implement `start()`, `stop()`, `getConnectionInfo()`
4. Optionally implement `getWaitStrategy()` and `getEnvironmentVariables()`
5. Use `this.validateStarted()` and `this.getContainer()` helpers

**Use `useContainer()` instead when:**

- One-off usage
- Simple configuration
- No client initialization needed
