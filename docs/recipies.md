# Testing Recipes

Common patterns and real-world examples for container-based testing.

## Database Testing

### Recipe: PostgreSQL with Migrations

Run your database migrations before each test:

```typescript
import { test } from 'node:test';
import { useContainer } from '@fuzzy-street/dockhand';
import { migrate } from './migrations';

test('user CRUD operations', async () => {
  const { host, ports, exec, cleanup } = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({
      POSTGRES_DB: 'test',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test'
    })
    .start();

  // Wait for postgres to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Run migrations
  const connectionString = `postgres://test:test@${host}:${ports[5432]}/test`;
  await migrate(connectionString);

  // Now test your application
  const userService = new UserService(connectionString);
  const user = await userService.create({ email: 'test@example.com' });
  
  assert.ok(user.id);
  await cleanup();
});
```

### Recipe: PostgreSQL with Seed Data

Pre-populate your database with test data:

```typescript
test('finds existing users', async () => {
  const seedData = `
    INSERT INTO users (email, name) VALUES
    ('alice@example.com', 'Alice'),
    ('bob@example.com', 'Bob');
  `;

  const { host, ports, cleanup } = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({
      POSTGRES_DB: 'test',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test'
    })
    .withCopyContent([{
      content: seedData,
      target: '/docker-entrypoint-initdb.d/seed.sql'
    }])
    .start();

  // PostgreSQL automatically runs .sql files in that directory!
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Test with pre-populated data
  const users = await findAllUsers(connectionString);
  assert.equal(users.length, 2);

  await cleanup();
});
```

### Recipe: Testing Transactions

Ensure your transactions work correctly:

```typescript
test('transaction rollback on error', async () => {
  const { connectionInfo, cleanup } = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({ POSTGRES_PASSWORD: 'test' })
    .start();

  const client = connectionInfo.client;

  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO users (email) VALUES ($1)', ['test@example.com']);
    
    // Simulate an error
    await client.query('INSERT INTO invalid_table VALUES (1)');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
  }

  // Verify rollback worked
  const result = await client.query('SELECT * FROM users');
  assert.equal(result.rows.length, 0);

  await cleanup();
});
```

## Caching & Sessions

### Recipe: Redis for Session Testing

Test session management with real Redis:

```typescript
test('session lifecycle', async () => {
  const { host, ports, cleanup } = await useContainer('redis:latest')
    .withPort(6379)
    .start();

  const redis = createClient({ socket: { host, port: ports[6379] } });
  await redis.connect();

  // Create session
  const sessionId = 'sess_123';
  await redis.set(sessionId, JSON.stringify({ 
    userId: 'user_1',
    createdAt: new Date()
  }), { EX: 3600 }); // 1 hour expiry

  // Retrieve session
  const session = JSON.parse(await redis.get(sessionId));
  assert.equal(session.userId, 'user_1');

  // Test expiry (wait a bit)
  await redis.expire(sessionId, 1); // Set to 1 second
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  const expired = await redis.get(sessionId);
  assert.equal(expired, null);

  await redis.quit();
  await cleanup();
});
```

### Recipe: Testing Cache Invalidation

Verify your caching logic works:

```typescript
test('cache invalidation on update', async () => {
  const postgres = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({ POSTGRES_PASSWORD: 'test' })
    .start();

  const redis = await useContainer('redis:latest')
    .withPort(6379)
    .start();

  const userService = new UserService({
    db: createDbClient(postgres.host, postgres.ports[5432]),
    cache: createClient({ socket: { 
      host: redis.host, 
      port: redis.ports[6379] 
    }})
  });

  // Create user
  const user = await userService.create({ email: 'test@example.com' });

  // First fetch - from DB, stores in cache
  const fetched1 = await userService.getById(user.id);
  
  // Second fetch - from cache
  const fetched2 = await userService.getById(user.id);

  // Update user - should invalidate cache
  await userService.update(user.id, { email: 'new@example.com' });

  // Third fetch - from DB again (cache was cleared)
  const fetched3 = await userService.getById(user.id);
  assert.equal(fetched3.email, 'new@example.com');

  await postgres.cleanup();
  await redis.cleanup();
});
```

## Message Queues & Event-Driven

### Recipe: RabbitMQ Message Processing

Test your message queue consumers:

```typescript
test('message queue processing', async () => {
  const { host, ports, cleanup } = await useContainer('rabbitmq:3-management')
    .withPorts(5672, 15672) // AMQP and Management UI
    .start();

  const connection = await amqp.connect(`amqp://${host}:${ports[5672]}`);
  const channel = await connection.createChannel();
  
  const queueName = 'test_queue';
  await channel.assertQueue(queueName);

  // Publish a message
  channel.sendToQueue(queueName, Buffer.from(JSON.stringify({
    type: 'USER_CREATED',
    userId: 'user_123'
  })));

  // Consume the message
  const messages = [];
  await channel.consume(queueName, (msg) => {
    messages.push(JSON.parse(msg.content.toString()));
    channel.ack(msg);
  });

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 1000));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'USER_CREATED');

  await connection.close();
  await cleanup();
});
```

## API Testing

### Recipe: Testing Your API with Real Database

Test your entire API stack:

```typescript
test('POST /users creates user', async () => {
  // Start database
  const { host, ports, cleanup: cleanupDb } = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({ POSTGRES_PASSWORD: 'test' })
    .start();

  // Start your API (as a container!)
  const { 
    host: apiHost, 
    ports: apiPorts, 
    cleanup: cleanupApi 
  } = await useContainer('my-api:latest')
    .withPort(3000)
    .withEnv({
      DATABASE_URL: `postgres://postgres:test@${host}:${ports[5432]}/postgres`
    })
    .start();

  // Test the API
  const response = await fetch(`http://${apiHost}:${apiPorts[3000]}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com' })
  });

  assert.equal(response.status, 201);
  const user = await response.json();
  assert.ok(user.id);

  await cleanupApi();
  await cleanupDb();
});
```

### Recipe: Mock External APIs

Use containers to mock external services:

```typescript
test('integration with external API', async () => {
  // Start a mock API server
  const mockServerConfig = `
    {
      "endpoints": [
        {
          "path": "/weather",
          "method": "GET",
          "response": { "temp": 72, "condition": "sunny" }
        }
      ]
    }
  `;

  const { host, ports, cleanup } = await useContainer('mockserver/mockserver')
    .withPort(1080)
    .withCopyContent([{
      content: mockServerConfig,
      target: '/config/expectations.json'
    }])
    .start();

  // Your app uses the mock server
  const weatherService = new WeatherService({
    apiUrl: `http://${host}:${ports[1080]}`
  });

  const weather = await weatherService.getWeather('New York');
  assert.equal(weather.temp, 72);

  await cleanup();
});
```

## Multi-Service Testing

### Recipe: Full Stack Integration

Test your entire stack together:

```typescript
test('full user workflow', async () => {
  // Start all services with compose
  const { connectionInfo, getContainer, cleanup } = await useCompose<{
    postgres: PostgresInfo,
    redis: RedisInfo,
    elasticsearch: ElasticsearchInfo
  }>('./')
    .withService('postgres', postgresService)
    .withService('redis', redisService)
    .withService('elasticsearch', elasticsearchService)
    .start();

  const app = new Application({
    db: connectionInfo.postgres.client,
    cache: connectionInfo.redis.client,
    search: connectionInfo.elasticsearch.client
  });

  // 1. Create a user (saved to postgres)
  const user = await app.users.create({
    email: 'test@example.com',
    name: 'Test User'
  });

  // 2. Verify it's cached
  const cached = await connectionInfo.redis.client.get(`user:${user.id}`);
  assert.ok(cached);

  // 3. Verify it's searchable
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for indexing
  const searchResults = await app.search.users('Test');
  assert.equal(searchResults.length, 1);

  // 4. Check logs from postgres container
  const pgContainer = getContainer('postgres');
  const logs = await pgContainer.logs();
  
  logs.on('data', line => {
    if (line.includes('INSERT INTO users')) {
      console.log('Found insert query in logs!');
    }
  });

  await cleanup();
});
```

### Recipe: Microservices Communication

Test service-to-service communication:

```typescript
test('order service talks to inventory service', async () => {
  const network = await new Network().start();

  // Start inventory service
  const inventory = await useContainer('inventory-service:latest')
    .withPort(8080)
    .withNetwork(network)
    .withNetworkAliases('inventory')
    .start();

  // Start order service
  const orders = await useContainer('order-service:latest')
    .withPort(8081)
    .withNetwork(network)
    .withEnv({
      INVENTORY_SERVICE_URL: 'http://inventory:8080'
    })
    .start();

  // Create an order (should check inventory)
  const response = await fetch(
    `http://${orders.host}:${orders.ports[8081]}/orders`,
    {
      method: 'POST',
      body: JSON.stringify({ productId: 'prod_123', quantity: 2 })
    }
  );

  assert.equal(response.status, 201);

  await inventory.cleanup();
  await orders.cleanup();
  await network.stop();
});
```

## Performance Testing

### Recipe: Load Testing with Real Database

Test how your database handles load:

```typescript
test('concurrent user creation', async () => {
  const { connectionInfo, cleanup } = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({ POSTGRES_PASSWORD: 'test' })
    .start();

  const userService = new UserService(connectionInfo.client);

  // Create 100 users concurrently
  const startTime = Date.now();
  
  const promises = Array.from({ length: 100 }, (_, i) =>
    userService.create({ email: `user${i}@example.com` })
  );

  const users = await Promise.all(promises);
  
  const duration = Date.now() - startTime;

  assert.equal(users.length, 100);
  console.log(`Created 100 users in ${duration}ms`);
  assert.ok(duration < 5000, 'Should complete in under 5 seconds');

  await cleanup();
});
```

## Debugging Recipes

### Recipe: Keeping Container Running After Test

Debug a failing test by keeping the container alive:

```typescript
test('debug this test', async () => {
  const { host, ports, exec, cleanup } = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({ POSTGRES_PASSWORD: 'test' })
    .start();

  try {
    // Your failing test here
    await doSomething();
  } catch (error) {
    console.log('Test failed, container still running!');
    console.log(`Connect with: psql -h ${host} -p ${ports[5432]} -U postgres`);
    
    // Wait for manual inspection
    await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
    
    throw error;
  } finally {
    await cleanup();
  }
});
```

### Recipe: Inspecting Container State

Check what's happening inside the container:

```typescript
test('inspect container', async () => {
  const { exec, logs, cleanup } = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({ POSTGRES_PASSWORD: 'test' })
    .start();

  // Check if postgres is actually running
  const psCheck = await exec(['pg_isready']);
  console.log('Postgres ready:', psCheck.exitCode === 0);

  // List database contents
  const listDbs = await exec([
    'psql', '-U', 'postgres', '-c', '\\list'
  ]);
  console.log('Databases:', listDbs.output);

  // Check logs for errors
  const logStream = await logs();
  logStream.on('data', line => {
    if (line.includes('ERROR')) {
      console.error('Found error:', line);
    }
  });

  await cleanup();
});
```

## CI/CD Recipes

### Recipe: GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
        
      # Docker is already installed!
      # Containers just work!
```

### Recipe: Speed Up CI with Image Caching

```yaml
# Pre-pull images to speed up tests
- name: Pull Docker images
  run: |
    docker pull postgres:14
    docker pull redis:latest
    
- name: Run tests
  run: npm test
```

## Cleanup Recipes

### Recipe: Shared Container Across Test File

```typescript
// test/setup.ts
export class TestEnvironment {
  static postgres;
  static redis;

  static async setup() {
    this.postgres = await useContainer('postgres:14')
      .withPort(5432)
      .withEnv({ POSTGRES_PASSWORD: 'test' })
      .start();

    this.redis = await useContainer('redis:latest')
      .withPort(6379)
      .start();
  }

  static async teardown() {
    await this.postgres.cleanup();
    await this.redis.cleanup();
  }
}

// test/users.test.ts
import { describe, it, before, after } from 'node:test';
import { TestEnvironment } from './setup';

describe('user tests', () => {
  before(async () => {
    await TestEnvironment.setup();
  });

  after(async () => {
    await TestEnvironment.teardown();
  });

  it('test 1', async () => {
    // Use TestEnvironment.postgres
  });

  it('test 2', async () => {
    // Use TestEnvironment.postgres
  });
});
```

## Advanced Recipes

### Recipe: Custom Wait Strategy

Wait for your specific condition:

```typescript
import { Wait } from '@fuzzy-street/dockhand';

test('wait for custom condition', async () => {
  const { host, ports, cleanup } = await useContainer('my-app:latest')
    .withPort(8080)
    .withWaitStrategy(
      Wait.forHttp('/health', 8080)
        .forResponsePredicate(async (response) => {
          const body = await response.text();
          return body.includes('ready');
        })
        .withStartupTimeout(30000)
    )
    .start();

  // App is definitely ready now
  await cleanup();
});
```

### Recipe: Testing Database Replication

Test master-slave replication:

```typescript
test('postgres replication', async () => {
  const network = await new Network().start();

  // Master database
  const master = await useContainer('postgres:14')
    .withPort(5432)
    .withNetwork(network)
    .withNetworkAliases('pg-master')
    .withEnv({
      POSTGRES_PASSWORD: 'test',
      POSTGRES_REPLICATION: 'true'
    })
    .start();

  // Slave database
  const slave = await useContainer('postgres:14')
    .withPort(5432)
    .withNetwork(network)
    .withEnv({
      POSTGRES_MASTER_HOST: 'pg-master',
      POSTGRES_PASSWORD: 'test'
    })
    .start();

  // Write to master
  await master.exec([
    'psql', '-U', 'postgres', '-c',
    "INSERT INTO data VALUES ('test')"
  ]);

  // Wait for replication
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Read from slave
  const result = await slave.exec([
    'psql', '-U', 'postgres', '-c',
    "SELECT * FROM data"
  ]);

  assert.ok(result.output.includes('test'));

  await master.cleanup();
  await slave.cleanup();
  await network.stop();
});
```

## Pro Tips

### Tip 1: Use Container Reuse for Fast Tests

```typescript
// Add .withReuse() to avoid starting containers repeatedly
const { cleanup } = await useContainer('postgres:14')
  .withReuse()  // Reuses existing container if available!
  .start();
```

### Tip 2: Pre-pull Images in Development

```bash
# In your package.json
{
  "scripts": {
    "test:setup": "docker pull postgres:14 && docker pull redis:latest",
    "test": "npm run test:setup && node --test"
  }
}
```

### Tip 3: Use .env Files with Compose

```typescript
// Load your .env file
const { connectionInfo } = await useCompose('./')
  .withEnvFile('.env.test')
  .withService('postgres', postgresService)
  .start();
```

### Tip 4: Tag Your Containers for Debugging

```typescript
const { cleanup } = await useContainer('postgres:14')
  .withLabels({ 
    'test-name': 'user-creation-test',
    'test-run': Date.now().toString()
  })
  .start();

// Later find it: docker ps -f label=test-name=user-creation-test
```

---

Remember: Start simple, add complexity only when needed. Most tests just need a single container! 🤘
