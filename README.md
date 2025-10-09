# 🐳 Dockhand

> A clean, type-safe wrapper around [testcontainers](https://node.testcontainers.org/) for your integration tests.

## Why?

Testcontainers is powerful but verbose. Setting up containers for integration tests involves a lot of boilerplate:

```typescript
// The old way 😐
const container = await new GenericContainer("postgres:14")
  .withExposedPorts(5432)
  .withEnvironment({
    POSTGRES_DB: "test",
    POSTGRES_USER: "test",
    POSTGRES_PASSWORD: "test",
  })
  .withWaitStrategy(Wait.forLogMessage("ready to accept connections"))
  .start();

const host = container.getHost();
const port = container.getMappedPort(5432);
// ... now create your connection
```

This library gives you a cleaner API with two simple functions:

```typescript
// The new way 🤘
const postgres = await useContainer("postgres:14")
  .withPort(5432)
  .withEnv({ POSTGRES_DB: "test", POSTGRES_USER: "test", POSTGRES_PASSWORD: "test" })
  .start();

// Or even better - use your existing docker-compose.yml!
const { connectionInfo } = await useCompose<{ postgres: PostgresInfo }>('./')
  .withService('postgres', postgresConnector)
  .start();
```

## Installation

```bash
npm install @fuzzy-street/dockhand testcontainers
```

## Quick Start

### Standalone Containers

Spin up a single container for testing:

```typescript
import { useContainer } from '@fuzzy-street/dockhand';

// Start Redis
const { host, ports, cleanup } = await useContainer('redis:latest')
  .withPort(6379)
  .start();

console.log(`Redis running at ${host}:${ports[6379]}`);

// Run your tests...

// Clean up
await cleanup();
```

### Docker Compose (The Killer Feature 🔥)

**Use your existing docker-compose.yml in tests with typed connection info:**

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
import { useCompose } from '@fuzzy-street/dockhand';

interface MyServices {
  postgres: { client: PostgresClient; database: string };
  redis: { client: RedisClient; port: number };
}

const { connectionInfo, cleanup } = await useCompose<MyServices>('./')
  .withService('postgres', postgresConnector)
  .withService('redis', redisConnector)
  .start();

// Fully typed! ✨
const pgClient = connectionInfo.postgres.client;
const redisClient = connectionInfo.redis.client;

// Run your tests...

await cleanup();
```

## API Reference

### `useContainer(image: string)`

Create a standalone container.

#### Methods

- `.withPort(port: number)` - Expose a single port
- `.withPorts(...ports: number[])` - Expose multiple ports
- `.withEnv(env: Record<string, string>)` - Set environment variables
- `.withCommand(...command: string[])` - Override container command
- `.withEntrypoint(...entrypoint: string[])` - Override entrypoint
- `.withWorkingDir(dir: string)` - Set working directory
- `.withUser(user: string)` - Set user
- `.withNetwork(network: string | StartedNetwork)` - Join a network
- `.withWaitStrategy(strategy: WaitStrategy)` - Set wait strategy
- `.withPullPolicy(policy: 'alwaysPull' | 'never')` - Set pull policy
- `.withReuse()` - Enable container reuse
- `.start()` - Start the container

#### Returns

```typescript
{
  container: StartedTestContainer;
  host: string;
  ports: Record<number, number>;
  cleanup: () => Promise<void>;
}
```

### `useCompose<T>(path: string, file?: string)`

Create a compose environment from a docker-compose file.

#### Methods

- `.withService<K>(name: K, service: ContainerService<T[K]>)` - Register a service with typed connection
- `.withEnv(env: Record<string, string>)` - Add environment variables
- `.withEnvFile(path: string)` - Load environment from file
- `.withBuild()` - Build images before starting
- `.withProfiles(...profiles: string[])` - Set compose profiles
- `.withProjectName(name: string)` - Set project name
- `.withPullPolicy(policy: 'alwaysPull' | 'never')` - Set pull policy
- `.start()` - Start the compose environment

#### Returns

```typescript
{
  environment: StartedDockerComposeEnvironment;
  connectionInfo: T;
  network: string;
  cleanup: () => Promise<void>;
}
```

## Examples

### Example 1: Quick Integration Test

```typescript
import { test } from 'node:test';
import { useContainer } from '@fuzzy-street/dockhand';

test('redis integration', async () => {
  const { ports, cleanup } = await useContainer('redis:latest')
    .withPort(6379)
    .start();

  const redis = createRedisClient({ port: ports[6379] });
  
  await redis.set('key', 'value');
  const result = await redis.get('key');
  
  assert.equal(result, 'value');
  await cleanup();
});
```

### Example 2: Multiple Containers with Network

```typescript
import { useContainer, Network } from '@fuzzy-street/dockhand';

const network = await new Network().start();

const postgres = await useContainer('postgres:14')
  .withPort(5432)
  .withEnv({ POSTGRES_PASSWORD: 'test' })
  .withNetwork(network)
  .start();

const app = await useContainer('my-app:latest')
  .withPort(3000)
  .withEnv({ DATABASE_URL: 'postgres://postgres:test@postgres:5432/postgres' })
  .withNetwork(network)
  .start();

// App can talk to postgres using container name 'postgres'!
```

### Example 3: Using Your Dev Docker Compose

```typescript
// This is THE feature - use the same compose file you use for local dev!
import { useCompose } from '@fuzzy-street/dockhand';

const { connectionInfo, cleanup } = await useCompose('./', 'docker-compose.dev.yml')
  .withService('postgres', postgresConnector)
  .withService('redis', redisConnector)
  .withEnv({ LOG_LEVEL: 'debug' })
  .start();

// Your entire dev environment is now running in your tests 🎉
```

### Example 4: Custom Service Connectors

Create reusable service definitions:

```typescript
import { BaseContainerService } from '@fuzzy-street/dockhand';

interface PostgresConnection {
  client: PostgresClient;
  database: string;
}

class PostgresService extends BaseContainerService<PostgresConnection> {
  async start(): Promise<void> {
    // Container is started by compose, we just initialize here
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  getConnectionInfo(): PostgresConnection {
    this.validateStarted();
    const container = this.getContainer();
    
    const client = new PostgresClient({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: 'myapp',
      user: 'user',
      password: 'pass',
    });

    return { client, database: 'myapp' };
  }

  initializeFromContainer(container: StartedTestContainer) {
    this.setContainer(container);
  }
}

// Use it
const postgresService = new PostgresService('postgres', {});

const { connectionInfo } = await useCompose<{ postgres: PostgresConnection }>('./')
  .withService('postgres', postgresService)
  .start();

// Fully typed connection!
const { client, database } = connectionInfo.postgres;
```

## Testing Patterns

### Pattern 1: Setup/Teardown

```typescript
import { describe, it, before, after } from 'node:test';

describe('integration tests', () => {
  let cleanup: () => Promise<void>;
  let connectionInfo: any;

  before(async () => {
    const result = await useCompose('./')
      .withService('postgres', postgresService)
      .start();
    
    connectionInfo = result.connectionInfo;
    cleanup = result.cleanup;
  });

  after(async () => {
    await cleanup();
  });

  it('should work', async () => {
    // Use connectionInfo.postgres here
  });
});
```

### Pattern 2: Per-Test Isolation

```typescript
import { test } from 'node:test';

test('each test gets fresh containers', async () => {
  const { connectionInfo, cleanup } = await useContainer('redis:latest')
    .withPort(6379)
    .start();

  // Test in isolation
  
  await cleanup();
});
```

## Advanced Usage

### Custom Wait Strategies

```typescript
import { Wait } from '@fuzzy-street/dockhand';

const { container } = await useContainer('my-app:latest')
  .withPort(8080)
  .withWaitStrategy(
    Wait.forHttp('/health', 8080)
      .forStatusCode(200)
      .withStartupTimeout(30000)
  )
  .start();
```

### Container Reuse

Speed up tests by reusing containers:

```typescript
const redis = await useContainer('redis:latest')
  .withPort(6379)
  .withReuse() // Container will be reused across test runs
  .start();
```

### Copy Files to Container

```typescript
const app = await useContainer('nginx:latest')
  .withPort(80)
  .withCopyFiles([
    { source: './nginx.conf', target: '/etc/nginx/nginx.conf' },
    { source: './html', target: '/usr/share/nginx/html' }
  ])
  .start();
```

## Migration from Raw Testcontainers

### Before

```typescript
const container = await new GenericContainer('postgres:14')
  .withExposedPorts(5432)
  .withEnvironment({
    POSTGRES_DB: 'test',
    POSTGRES_USER: 'test',
    POSTGRES_PASSWORD: 'test'
  })
  .withWaitStrategy(Wait.forLogMessage('ready to accept connections'))
  .start();

const host = container.getHost();
const port = container.getMappedPort(5432);
const connectionString = `postgres://test:test@${host}:${port}/test`;

// Don't forget to stop!
await container.stop();
```

### After

```typescript
const { host, ports, cleanup } = await useContainer('postgres:14')
  .withPort(5432)
  .withEnv({ POSTGRES_DB: 'test', POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test })
  .withWaitStrategy(Wait.forLogMessage('ready to accept connections'))
  .start();

const connectionString = `postgres://test:test@${host}:${ports[5432]}/test`;

await cleanup(); // Much cleaner!
```

## Alternative Container Runtimes

This library works with **any runtime that testcontainers supports** - including Podman, Colima, and Rancher Desktop!

### Podman

```bash
# MacOS
export DOCKER_HOST=unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock

# Linux (rootless)
export DOCKER_HOST=unix://$(podman info --format '{{.Host.RemoteSocket.Path}}')
export TESTCONTAINERS_RYUK_DISABLED=true

# Then run your tests normally!
npm test
```

### Colima

```bash
export DOCKER_HOST=unix://${HOME}/.colima/default/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
export NODE_OPTIONS=--dns-result-order=ipv4first
npm test
```

### Rancher Desktop

```bash
export DOCKER_HOST=unix://${HOME}/.rd/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
npm test
```

**No code changes needed** - just set environment variables and go! 🚀

For more details, see [testcontainers runtime docs](https://node.testcontainers.org/supported-container-runtimes/).

## FAQ

**Q: Does this replace testcontainers?**
No! This is a thin wrapper that makes testcontainers easier to use. All testcontainers features are still available.

**Q: Can I use this with Vitest/Jest/Mocha?**
Yes! This works with any test framework.

**Q: What about Docker Compose v2?**
Fully supported! Uses whatever Docker Compose version you have installed.

**Q: Can I mix compose and standalone containers?**
Absolutely! Use both in the same test suite.

**Q: Performance concerns?**
Containers start in parallel and can be reused. Tests typically run in seconds, not minutes.

**Q: Do I need Docker Desktop?**
Nope! Works with Docker, Podman, Colima, Rancher Desktop, or anything testcontainers supports.

## Documentation

- **[Getting Started](docs/GETTING_STARTED.md)** - New to container testing? Start here!
- **[Concepts](docs/CONCEPTS.md)** - Understand WHY and HOW container-based testing works
- **[Recipes](docs/RECIPES.md)** - Common patterns and real-world examples
- **[API Reference](docs/API_REFERENCE.md)** - Complete method documentation
- **[Deployment](docs/DEPLOYMENT.md)** - Deploy services using containers (VMs, K8s, not serverless!)
- **[Shipping Guide](SHIPPING.md)** - How to publish this library

## License

MIT

## Credits

Built on top of the excellent [testcontainers](https://node.testcontainers.org/) library.
