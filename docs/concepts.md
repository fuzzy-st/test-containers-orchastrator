# Understanding Container-Based Testing

This guide explains WHY container-based testing is valuable and HOW it changes the way you write tests.

## The Testing Pyramid Problem

You've probably heard of the testing pyramid:

```
      /\
     /  \    ← Few E2E tests (slow, flaky)
    /----\
   / Unit \  ← Many unit tests (fast, isolated)
  /--------\
```

**The problem:** There's a huge gap between unit tests and E2E tests.

### Unit Tests

**What they test:** Individual functions in isolation

```typescript
function add(a, b) {
  return a + b;
}

test('add works', () => {
  assert.equal(add(2, 3), 5);  // ✅ Fast, reliable
});
```

**Problem:** Doesn't test database queries, API calls, or how components work together.

### E2E Tests

**What they test:** The entire application, browser to database

```typescript
test('user can login', async () => {
  await browser.goto('https://myapp.com');
  await browser.type('#email', 'user@test.com');
  await browser.click('#login-button');
  // ⚠️ Slow, flaky, requires full deployed app
});
```

**Problem:** Slow (minutes), flaky, expensive to run, hard to debug.

### The Missing Middle: Integration Tests

**What you actually need:** Tests for the layer in between!

```typescript
test('UserService creates user in database', async () => {
  // Use a REAL database (not mocked, not production)
  const { connectionInfo, cleanup } = await useCompose('./')
    .withService('postgres', postgresService)
    .start();

  // Test your real service logic
  const userService = new UserService(connectionInfo.postgres.client);
  const user = await userService.createUser({ 
    email: 'test@example.com' 
  });

  // Verify in the real database
  const saved = await userService.findUser(user.id);
  assert.equal(saved.email, 'test@example.com');

  await cleanup();
});
```

**This is the sweet spot:**

- ✅ Tests real database logic
- ✅ Fast (seconds, not minutes)
- ✅ Reliable (isolated environment)
- ✅ Easy to debug
- ✅ Catches real bugs

## Why Containers?

### Traditional Approach: Shared Test Database

```typescript
// Bad: Using a shared test database
const db = new Database('postgres://test-db-server/testdb');

test('creates user', async () => {
  await db.query('INSERT INTO users...');
  // ⚠️ What if another test is running?
  // ⚠️ What if previous test didn't clean up?
  // ⚠️ Can't run tests in parallel
});
```

**Problems:**

- Tests interfere with each other
- Random failures ("works on my machine!")
- Can't run tests in parallel
- Slow (waiting for cleanup)
- Setup is complicated

### Container Approach: Isolated Environments

```typescript
test('creates user', async () => {
  // Start a fresh database just for this test
  const { connectionInfo, cleanup } = await useContainer('postgres:14')
    .withEnv({ POSTGRES_PASSWORD: 'test' })
    .start();

  // This database is YOURS. No one else is using it.
  const db = connectionInfo.postgres.client;
  await db.query('INSERT INTO users...');
  
  // Clean up - container disappears
  await cleanup();
});
```

**Benefits:**

- ✅ Every test gets a clean database
- ✅ Tests can run in parallel
- ✅ Fast (containers start in seconds)
- ✅ Same environment everywhere (laptop, CI, teammate's machine)
- ✅ No setup required

## Real-World Example

Let's say you're building a blog platform. You need to test:

1. Creating posts (database)
2. Caching posts (Redis)
3. Full-text search (Elasticsearch)

### The Old Way (Painful)

**Setup:**

1. Install PostgreSQL on your machine
2. Install Redis
3. Install Elasticsearch
4. Configure all three
5. Create test databases
6. Write cleanup scripts
7. Hope teammates do the same setup
8. Hope CI server is configured the same

**Time:** 2-3 hours of setup, ongoing maintenance

### The New Way (Easy)

**Setup:**

```bash
npm install --save-dev @fuzzy-street/dockhand testcontainers
```

**Test:**

```typescript
test('blog post workflow', async () => {
  // Start all three services (takes 5 seconds)
  const { connectionInfo, cleanup } = await useCompose('./')
    .withService('postgres', postgresService)
    .withService('redis', redisService)
    .withService('elasticsearch', elasticsearchService)
    .start();

  // Test the real workflow
  const post = await createPost(connectionInfo.postgres.client, {
    title: 'My Post',
    content: 'Hello world'
  });

  // Was it cached?
  const cached = await connectionInfo.redis.client.get(`post:${post.id}`);
  assert.ok(cached);

  // Is it searchable?
  const results = await connectionInfo.elasticsearch.client.search({
    query: { match: { content: 'hello' } }
  });
  assert.equal(results.hits.length, 1);

  await cleanup();
});
```

**Time:** 30 seconds to write the test, runs forever

## Key Mental Models

### 1. Containers Are Cheap

**Old thinking:** "Starting a database is expensive"

**Reality with containers:**

- First start: ~30 seconds (downloading image)
- Subsequent starts: ~2 seconds (image cached on disk!)
- Uses ~100MB of RAM
- Automatically cleaned up
- Can run dozens in parallel

**Docker caches images automatically:**

```typescript
// First test - downloads image
await useContainer('redis:latest').start();  // 30 seconds

// Second test - uses cached image
await useContainer('redis:latest').start();  // 2 seconds!
```

All containers on your machine share the same cached images. Once an image is pulled, it's instant forever.

**Think of containers like functions:**

```typescript
// Would you worry about calling a function?
const result = myFunction();

// Don't worry about starting a container either
const { cleanup } = await useContainer('postgres').start();
```

### 2. Isolation is Good

**Old thinking:** "Reuse the same database to save time"

**Better thinking:** "Isolation prevents bugs"

```typescript
// Test 1
test('creates user', async () => {
  const { connectionInfo, cleanup } = await useContainer('postgres').start();
  // Fresh database, no interference
  await cleanup();
});

// Test 2
test('deletes user', async () => {
  const { connectionInfo, cleanup } = await useContainer('postgres').start();
  // Different fresh database, completely isolated
  await cleanup();
});
```

Each test is like a parallel universe - they can't affect each other.

### 3. Real is Better Than Fake

**Old thinking:** "Mock the database to make tests faster"

```typescript
// Fake database - does this behave like the real one?
const mockDb = {
  query: () => Promise.resolve([{ id: 1 }])
};
```

**Better thinking:** "Use a real database, catch real bugs"

```typescript
// Real PostgreSQL - catches real bugs
const { connectionInfo } = await useContainer('postgres:14').start();
const result = await connectionInfo.client.query('SELECT * FROM users');

// This will catch:
// - SQL syntax errors
// - Type mismatches
// - Constraint violations
// - Transaction issues
// - Performance problems
```

### 4. Composition Over Configuration

**Old thinking:** "Set up a complex shared environment once"

**Better thinking:** "Compose simple containers as needed"

```typescript
// Need just PostgreSQL?
await useContainer('postgres:14').start();

// Need PostgreSQL + Redis?
const postgres = await useContainer('postgres:14').start();
const redis = await useContainer('redis:latest').start();

// Need your entire production stack?
await useCompose('./docker-compose.yml').start();
```

Start with simple, add complexity only when needed.

## When NOT to Use Containers

Containers aren't the solution to everything. Here's when NOT to use them:

### Don't Use for Pure Logic

```typescript
// ❌ Overkill - no external dependencies needed
test('calculateTotal', async () => {
  const { cleanup } = await useContainer('postgres').start();
  const result = calculateTotal([1, 2, 3]);
  assert.equal(result, 6);
  await cleanup();
});

// ✅ Better - simple unit test
test('calculateTotal', () => {
  assert.equal(calculateTotal([1, 2, 3]), 6);
});
```

**Rule:** If there's no external service (database, API, cache), don't use containers.

### Don't Use for UI Testing (Usually)

```typescript
// ❌ Wrong tool - use Playwright/Cypress for this
test('button click changes color', async () => {
  const { cleanup } = await useContainer('chrome').start();
  // ... browser automation ...
  await cleanup();
});
```

**Rule:** Use containers for backend/API testing, not frontend. (Though browser automation in containers IS valid for other use cases - see the deployment docs!)

### Don't Use As Production Infrastructure

```typescript
// ❌ NEVER DO THIS - replacing real infrastructure
if (process.env.NODE_ENV === 'production') {
  const db = await useContainer('postgres').start();
  app.set('database', db);  // NO!
}
```

**Why this is wrong:**

- Your app shouldn't manage its own database
- Use managed services (RDS, managed Postgres, etc.)
- Containers dying = app breaks
- Not designed for long-lived infrastructure

**Rule:** Don't replace production databases, caches, or message queues with containers.

### But DO Use for Ephemeral Production Workloads

```typescript
// ✅ TOTALLY FINE - ephemeral execution
app.post('/execute-code', async (req, res) => {
  const { exec, cleanup } = await useContainer('python:3.11')
    .withSandboxMode({ network: 'none' })
    .start();
  
  const result = await exec(['python', 'script.py']);
  await cleanup();
  
  res.json(result);
});
```

**Why this is fine:**

- Container is ephemeral (exists only for the request)
- Your service IS the product (code execution platform)
- This is how Modal, Replicate, Replit work
- Short-lived isolation is the goal

**Valid production use cases:**

- ✅ Code execution APIs
- ✅ Agent runtimes
- ✅ Build/CI pipelines
- ✅ Job/task processing
- ✅ Data transformations
- ✅ Browser automation services

See [DEPLOYMENT.md](DEPLOYMENT.md) for how to deploy these workloads properly.

## The Big Picture

Think of container-based testing as **"local production"**:

```
Your Development Journey:

1. Unit Tests (Fast, Isolated)
   ↓
2. Integration Tests with Containers (Fast, Real)  ← You are here
   ↓
3. Staging Environment (Slow, Real)
   ↓
4. Production (Real)
```

**Container tests are the bridge** between fast-but-fake unit tests and slow-but-real production.

## Common Questions

### "Isn't this slow?"

**Short answer:** No! Containers start in 1-3 seconds.

**Long answer:**

- First run downloads images (~30 seconds)
- Subsequent runs are FAST (~2 seconds)
- Much faster than mocking everything manually
- Much faster than E2E tests (seconds vs minutes)

### "What about CI/CD?"

**It just works!** All major CI systems support Docker:

```yaml
# GitHub Actions
- name: Run tests
  run: npm test
  # Docker is already installed!
```

Same tests, same containers, everywhere.

### "Is this just for databases?"

**No!** Use containers for anything:

- Databases (PostgreSQL, MySQL, MongoDB)
- Caches (Redis, Memcached)
- Message queues (RabbitMQ, Kafka)
- Search engines (Elasticsearch)
- APIs (mock servers, third-party APIs)
- Even your own apps!

### "What about test data?"

**Great question!** You have options:

```typescript
// Option 1: Create data in each test
test('finds user', async () => {
  const { connectionInfo, cleanup } = await useContainer('postgres').start();
  
  // Create test data
  await connectionInfo.client.query(
    'INSERT INTO users (email) VALUES ($1)',
    ['test@example.com']
  );
  
  // Test finding it
  const user = await findUser('test@example.com');
  assert.ok(user);
  
  await cleanup();
});

// Option 2: Copy pre-populated data
const db = await useContainer('postgres:14')
  .withCopyContent([{
    content: fs.readFileSync('test-data.sql', 'utf8'),
    target: '/docker-entrypoint-initdb.d/data.sql'
  }])
  .start();

// Option 3: Use your docker-compose with seed data
await useCompose('./').start();
```

## Summary

**Container-based testing gives you:**

- ✅ Fast feedback (seconds)
- ✅ Real databases/services
- ✅ Isolated environments
- ✅ Parallel execution
- ✅ Same setup everywhere
- ✅ Easy debugging

**You don't need to:**

- ❌ Be a Docker expert
- ❌ Maintain shared test databases
- ❌ Write complex mocks
- ❌ Worry about test interference

**Remember:** Containers are just lightweight, isolated environments for your tests. Think of them as disposable, fast, real environments that help you catch bugs before production.

Start simple, with one container. Add more as needed. Your tests will thank you! 🎉
