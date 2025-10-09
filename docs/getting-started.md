# Getting Started

Welcome! This guide will help you write better integration tests using containers, even if you've never used Docker before.

## What Problem Does This Solve?

### The Old Way (Painful) 😓

You're building an app that uses PostgreSQL and Redis. How do you test it?

**Option 1: Mock Everything**

```typescript
// Your tests become lies
const mockDb = {
  query: () => Promise.resolve([{ id: 1 }])
};
// Does your real database work? Who knows! 🤷
```

**Option 2: Install Locally**

- Install PostgreSQL on your machine
- Install Redis
- Configure them
- Hope everyone on your team has the same setup
- Different versions cause mysterious failures
- CI/CD environment is different from local
- "Works on my machine!" syndrome

**Option 3: Shared Test Database**

- Tests interfere with each other
- Can't run tests in parallel
- Slow cleanup between tests
- Flaky tests everywhere

### The New Way (Easy) ✨

```typescript
// Start a REAL PostgreSQL just for this test
const { connectionInfo, cleanup } = await useCompose('./')
  .withService('postgres', postgresService)
  .start();

// Use the REAL database
const result = await connectionInfo.postgres.client.query('SELECT 1');
assert.equal(result.rows[0], 1);

// Clean up automatically
await cleanup();
```

**What just happened?**

1. A real PostgreSQL container started (takes ~2 seconds)
2. Your test ran against real PostgreSQL
3. Container was cleaned up
4. Next test gets a fresh database

**Benefits:**

- ✅ Tests run against real databases
- ✅ Every test gets a clean environment
- ✅ Same setup on everyone's machine
- ✅ Same setup in CI/CD
- ✅ No installation needed (just Docker)
- ✅ Fast and reliable

## Prerequisites

### Install Docker Desktop

You need Docker installed. Don't worry, you don't need to learn Docker deeply!

**Mac/Windows:**

1. Download [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Install it
3. That's it!

**Linux:**

```bash
# Ubuntu/Debian
sudo apt-get install docker.io

# Or use Podman (Docker alternative)
sudo apt-get install podman
```

**Verify it works:**

```bash
docker --version
# Should print: Docker version 24.x.x...
```

### Install This Library

```bash
npm install --save-dev @fuzzy-street/dockhand testcontainers
```

## Your First Test

Let's write a test that uses a real Redis database.

### Step 1: Write the Test

```typescript
// test/redis.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { useContainer } from '@fuzzy-street/dockhand';
import { createClient } from 'redis';

test('redis integration', async () => {
  // Start a Redis container
  const { host, ports, cleanup } = await useContainer('redis:latest')
    .withPort(6379)
    .start();

  // Connect to it
  const redis = createClient({
    socket: { host, port: ports[6379] }
  });
  await redis.connect();

  // Use it!
  await redis.set('name', 'Alice');
  const value = await redis.get('name');
  
  assert.equal(value, 'Alice');

  // Clean up
  await redis.quit();
  await cleanup();
});
```

### Step 2: Run It

```bash
npm test
```

**What happens:**

1. Docker pulls the Redis image (first time only, ~30 seconds)
2. Redis container starts (~2 seconds)
3. Your test connects and runs
4. Container stops and removes itself
5. Test passes! ✅

### Step 3: Understanding What Happened

Let's break down each part:

```typescript
// 1. Start a container from the 'redis:latest' image
const { host, ports, cleanup } = await useContainer('redis:latest')
  .withPort(6379)  // Expose Redis's default port
  .start();

// 'host' is usually 'localhost'
// 'ports[6379]' is a random port like 54321 (avoids conflicts)
```

**Why a random port?**

- If tests run in parallel, they won't conflict
- You can run multiple Redis instances at once
- Your test is isolated from other tests

```typescript
// 2. Connect using the host and port we got
const redis = createClient({
  socket: { host, port: ports[6379] }
});
```

```typescript
// 3. Always clean up!
await cleanup();
```

This stops and removes the container. Without this, containers pile up.

## Common Patterns

### Pattern 1: Setup/Teardown (Shared Container)

If starting a container is slow, share it across tests:

```typescript
import { describe, it, before, after } from 'node:test';

describe('user service', () => {
  let postgres;
  let cleanup;

  // Start once for all tests
  before(async () => {
    const result = await useContainer('postgres:14')
      .withPort(5432)
      .withEnv({
        POSTGRES_DB: 'test',
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test'
      })
      .start();
    
    postgres = result;
    cleanup = result.cleanup;
  });

  // Stop after all tests
  after(async () => {
    await cleanup();
  });

  it('creates a user', async () => {
    // Use postgres here
  });

  it('deletes a user', async () => {
    // Use postgres here
  });
});
```

### Pattern 2: Fresh Container Per Test

For complete isolation:

```typescript
import { test } from 'node:test';

test('test 1', async () => {
  const { cleanup } = await useContainer('redis').start();
  // This test gets a fresh Redis
  await cleanup();
});

test('test 2', async () => {
  const { cleanup } = await useContainer('redis').start();
  // This test gets a DIFFERENT fresh Redis
  await cleanup();
});
```

### Pattern 3: Multiple Containers

Your app probably uses multiple services:

```typescript
test('app integration', async () => {
  // Start PostgreSQL
  const postgres = await useContainer('postgres:14')
    .withPort(5432)
    .withEnv({ POSTGRES_PASSWORD: 'test' })
    .start();

  // Start Redis
  const redis = await useContainer('redis:latest')
    .withPort(6379)
    .start();

  // Your app can now use both!
  // ... run your tests ...

  // Clean up
  await redis.cleanup();
  await postgres.cleanup();
});
```

### Pattern 4: Using Your docker-compose.yml

Already have a `docker-compose.yml` for local development? Use it!

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    ports:
      - "5432:5432"
  
  redis:
    image: redis:latest
    ports:
      - "6379:6379"
```

```typescript
// Your test
const { connectionInfo, cleanup } = await useCompose('./')
  .withService('postgres', postgresConnector)
  .withService('redis', redisConnector)
  .start();

// Everything from your compose file is now running!
await cleanup();
```

## Key Concepts

### Containers vs Virtual Machines

**Virtual Machine (Heavy):**

- Entire operating system
- Gigabytes of RAM
- Minutes to start
- Like renting an entire house

**Container (Light):**

- Just your application
- Megabytes of RAM
- Seconds to start
- Like renting a room

**For testing:** Containers are perfect because they're fast and isolated.

### Images vs Containers

**Image = Recipe**

- A template for creating containers
- Like a blueprint for a house
- Example: `postgres:14` is an image

**Container = Running Instance**

- A running copy of an image
- Like an actual house built from a blueprint
- You can have many containers from one image

```typescript
// 'postgres:14' is the image (recipe)
const container1 = await useContainer('postgres:14').start();
const container2 = await useContainer('postgres:14').start();
// Two different running containers from the same image
```

### Ports and Port Mapping

Containers run in isolation. To access them, we map ports:

```typescript
const { ports } = await useContainer('redis:latest')
  .withPort(6379)  // Container port
  .start();

console.log(ports[6379]);  // Might print: 54321
```

**What happened:**

- Inside the container, Redis listens on port `6379`
- On your machine, it's accessible on port `54321` (random)
- This prevents conflicts if you run multiple tests

**Think of it like:**

- Container port = apartment number (6379)
- Host port = external address (54321 Main St)

### Networks

Containers can talk to each other on a network:

```typescript
const network = await new Network().start();

// Container 1
const db = await useContainer('postgres:14')
  .withNetwork(network)
  .withNetworkAliases('database')  // Give it a hostname
  .start();

// Container 2
const app = await useContainer('my-app:latest')
  .withNetwork(network)
  .withEnv({ 
    DB_HOST: 'database'  // Use the hostname!
  })
  .start();

// App can now reach database at 'database:5432'
```

## Troubleshooting

### "Cannot connect to the Docker daemon"

**Problem:** Docker isn't running.

**Solution:** Start Docker Desktop (Mac/Windows) or run `sudo systemctl start docker` (Linux).

### "port is already allocated"

**Problem:** Something is using that port.

**Solution:** Don't specify fixed ports, let us assign random ones:

```typescript
// ❌ Bad - fixed port can conflict
.withExposedPorts({ container: 6379, host: 6379 })

// ✅ Good - random port
.withPort(6379)
```

### "No such image"

**Problem:** Image doesn't exist or typo in name.

**Solution:** Check the image name on [Docker Hub](https://hub.docker.com/):

```typescript
// ✅ Correct
useContainer('postgres:14')

// ❌ Typo
useContainer('postgress:14')  // Extra 's'
```

### Tests are slow on first run

**Problem:** Image needs to be downloaded.

**Solution:** This is normal! First run downloads images (~30 seconds). Subsequent runs are FAST (~2 seconds) because **Docker caches images on your machine**.

```bash
# First test run
npm test  # ⏱️ 35 seconds (downloading postgres image)

# Second test run  
npm test  # ⚡ 7 seconds (image cached!)
```

**Why?** Docker stores images in `/var/lib/docker/`. Once pulled, the image stays on your machine and is reused instantly.

You can pre-download images:

```bash
docker pull postgres:14
docker pull redis:latest
npm test  # Now it's fast from the start!
```

### Container won't start / times out

**Problem:** Container crashed or isn't ready yet.

**Solution:** Check the logs!

```typescript
const { logs, cleanup } = await useContainer('my-app:latest')
  .withPort(8080)
  .start();

// See what went wrong
const logStream = await logs();
logStream.on('data', line => console.log(line));
```

### "cleanup is not a function"

**Problem:** Forgot to destructure cleanup.

```typescript
// ❌ Bad
const result = await useContainer('redis').start();
await result.cleanup;  // Missing ()

// ✅ Good
const { cleanup } = await useContainer('redis').start();
await cleanup();
```

## Next Steps

Now that you understand the basics:

1. **Try the examples** - See `examples/` directory
2. **Read the API reference** - See `API_REFERENCE.md`
3. **Common recipes** - See `RECIPES.md`
4. **Join the community** - GitHub discussions

## FAQ

**Q: Do I need to learn Docker?**
No! This library handles Docker for you. Just understand: images are templates, containers run from images.

**Q: Will this slow down my tests?**
Containers start in 1-3 seconds. That's faster than setting up mocks, and you get real testing!

**Q: What if my team doesn't have Docker?**
They just need Docker Desktop installed. No configuration needed!

**Q: Can I use this in CI/CD?**
Yes! GitHub Actions, GitLab CI, CircleCI all support Docker. It just works.

**Q: What about Windows?**
Works great! Just install Docker Desktop for Windows.

**Q: Is this production-ready?**
These are for TESTS only, not production. Never run testcontainers in production!

## Remember

**The goal is simple:** Write tests against real databases without the hassle of setting them up manually.

You don't need to be a Docker expert. You don't need to learn Kubernetes. You just need to write good tests.

That's what this library is for. Happy testing! 🎉
