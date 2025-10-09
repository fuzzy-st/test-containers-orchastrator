# API Reference

Complete reference for all methods and types.

## Table of Contents

- [useContainer()](#usecontainer) - Standalone containers
- [useCompose()](#usecompose) - Docker Compose
- [ContainerResult](#containerresult) - Return type for useContainer
- [ComposeResult](#composeresult) - Return type for useCompose
- [Network](#network) - Network management
- [Wait Strategies](#wait-strategies) - When to consider container "ready"
- [BaseContainerService](#basecontainerservice) - Custom services
- [Types](#types) - TypeScript definitions

---

## useContainer()

Create and configure a standalone container.

### Syntax

```typescript
useContainer(image: string): StandaloneContainer
```

### Parameters

- **image** `string` - Docker image name (e.g., `'postgres:14'`, `'redis:latest'`)

### Returns

`StandaloneContainer` - A builder object with configuration methods

### Example

```typescript
const container = useContainer('redis:latest')
  .withPort(6379)
  .withEnv({ REDIS_PASSWORD: 'secret' });

const result = await container.start();
```

---

## StandaloneContainer Methods

All methods return `this` for chaining, except `.start()`.

### Configuration Methods

#### `.withPort(port: number)`

Expose a single container port.

```typescript
.withPort(6379)
```

**Why random host ports?** Prevents conflicts when running tests in parallel.

#### `.withPorts(...ports: PortMapping[])`

Expose multiple ports at once.

```typescript
.withPorts(8080, 8443, 9090)
```

#### `.withEnv(env: Record<string, string>)`

Set environment variables.

```typescript
.withEnv({
  POSTGRES_DB: 'test',
  POSTGRES_USER: 'admin',
  POSTGRES_PASSWORD: 'secret'
})
```

#### `.withCommand(...command: string[])`

Override the container's default command.

```typescript
.withCommand(['redis-server', '--appendonly', 'yes'])
```

#### `.withEntrypoint(...entrypoint: string[])`

Override the container's entrypoint.

```typescript
.withEntrypoint(['/bin/sh'])
```

#### `.withWorkingDir(dir: string)`

Set the working directory inside the container.

```typescript
.withWorkingDir('/app')
```

#### `.withUser(user: string)`

Run container as a specific user. Format: `user`, `user:group`, `uid`, or `uid:gid`.

```typescript
.withUser('1000:1000')
.withUser('nobody')
```

#### `.withLabels(labels: Record<string, string>)`

Add metadata labels to the container.

```typescript
.withLabels({
  'test-suite': 'integration',
  'test-file': 'users.test.ts'
})
```

#### `.withPrivilegedMode()`

Run container in privileged mode (rarely needed).

```typescript
.withPrivilegedMode()
```

⚠️ **Security warning:** Only use for specific use cases like Docker-in-Docker.

#### `.withResources(memory?: number, cpu?: number)`

Set resource limits (not supported in rootless runtimes).

```typescript
.withResources(0.5, 1)  // 0.5GB RAM, 1 CPU
```

#### `.withCopyFiles(...files: FileConfig[])`

Copy files into the container before it starts.

```typescript
.withCopyFiles([
  { source: './config.yml', target: '/etc/app/config.yml' },
  { source: './data.json', target: '/data/data.json', mode: 0o644 }
])
```

#### `.withCopyDirectories(...dirs: FileConfig[])`

Copy entire directories into the container.

```typescript
.withCopyDirectories([
  { source: './static', target: '/app/static' }
])
```

#### `.withCopyContent(content: ContentConfig[])`

Copy inline content (no need for temp files!).

```typescript
.withCopyContent([{
  content: 'server { listen 80; }',
  target: '/etc/nginx/nginx.conf',
  mode: 0o644
}])
```

#### `.withNetwork(network: string | StartedNetwork)`

Join a network for container-to-container communication.

```typescript
const network = await new Network().start();
.withNetwork(network)
```

#### `.withNetworkAliases(...aliases: string[])`

Set hostnames for this container on the network.

```typescript
.withNetworkAliases('database', 'db', 'postgres')
```

#### `.withExtraHosts(hosts: ExtraHost[])`

Add entries to the container's `/etc/hosts` file.

```typescript
.withExtraHosts([
  { host: 'api.example.com', ipAddress: '10.0.0.1' },
  { host: 'cache.local', ipAddress: '192.168.1.5' }
])
```

#### `.withWaitStrategy(strategy: WaitStrategy)`

Specify when the container is "ready". See [Wait Strategies](#wait-strategies).

```typescript
import { Wait } from '@fuzzy-street/dockhand';

.withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
```

#### `.withPullPolicy(policy: 'alwaysPull' | 'never')`

Control image pulling behavior.

```typescript
.withPullPolicy('alwaysPull')  // Always pull latest
```

#### `.withReuse()`

Reuse an existing container if one with the same config is running.

```typescript
.withReuse()  // Much faster for repeated test runs!
```

#### `.withDefaultLogDriver()`

Use Docker's default log driver (needed for log wait strategies in some environments).

```typescript
.withDefaultLogDriver()
```

#### `.withPlatform(platform: string)`

Specify platform (useful for ARM/x86 differences).

```typescript
.withPlatform('linux/amd64')
```

#### `.withTmpFs(tmpfs: Record<string, string>)`

Mount temporary filesystems.

```typescript
.withTmpFs({ '/temp': 'rw,noexec,nosuid,size=65536k' })
```

#### `.withCapabilities(add?: string[], drop?: string[])`

Add or drop Linux capabilities.

```typescript
.withCapabilities(['NET_ADMIN'], ['CHOWN'])
```

### Runtime Method

#### `.start()`

Start the container.

**Returns:** `Promise<ContainerResult>`

```typescript
const { host, ports, exec, logs, cleanup } = await container.start();
```

---

## ContainerResult

The object returned by `useContainer().start()`.

### Properties

#### `container: StartedTestContainer`

The underlying testcontainers object. Use this for advanced operations.

```typescript
const { container } = await useContainer('redis').start();
console.log(container.getId());
```

#### `host: string`

The host where the container is accessible (usually `'localhost'`).

```typescript
const { host } = await useContainer('redis').start();
// host === 'localhost'
```

#### `ports: Record<number, number>`

Map of container ports to host ports.

```typescript
const { ports } = await useContainer('postgres')
  .withPort(5432)
  .start();

console.log(ports[5432]);  // e.g., 54321
```

### Methods

#### `exec(cmd: string[], opts?: ExecOptions): Promise<ExecResult>`

Execute a command inside the running container.

```typescript
const result = await exec(['echo', 'hello'], {
  user: '1000:1000',
  workingDir: '/app',
  env: { DEBUG: 'true' }
});

console.log(result.output);    // Combined stdout + stderr
console.log(result.stdout);    // Just stdout
console.log(result.stderr);    // Just stderr
console.log(result.exitCode);  // 0 for success
```

**ExecOptions:**

- `user?: string` - Run as specific user
- `workingDir?: string` - Execute in directory
- `env?: Record<string, string>` - Environment variables

**ExecResult:**

- `output: string` - Combined output
- `stdout: string` - Standard output
- `stderr: string` - Standard error
- `exitCode: number` - Exit code (0 = success)

#### `logs(): Promise<NodeJS.ReadableStream>`

Get a stream of the container's logs.

```typescript
const stream = await logs();

stream.on('data', line => console.log(line));
stream.on('err', line => console.error(line));
stream.on('end', () => console.log('Stream closed'));
```

#### `restart(): Promise<void>`

Restart the container.

```typescript
await restart();
```

#### `getIpAddress(networkName: string): string`

Get the container's IP address on a specific network.

```typescript
const network = await new Network().start();
const { getIpAddress } = await useContainer('postgres')
  .withNetwork(network)
  .start();

const ip = getIpAddress(network.getName());
```

#### `cleanup(): Promise<void>`

Stop and remove the container.

```typescript
await cleanup();
```

---

## useCompose()

Create a Docker Compose environment with typed service connections.

### Syntax

```typescript
useCompose<T>(composePath: string, composeFile?: string): ComposeEnvironment<T>
```

### Parameters

- **composePath** `string` - Path to directory containing docker-compose file
- **composeFile** `string` (optional) - Name of compose file (default: `'docker-compose.yml'`)

### Type Parameter

- **T** - Type describing your services and their connection info

### Returns

`ComposeEnvironment<T>` - A builder object with configuration methods

### Example

```typescript
interface MyServices {
  postgres: { client: Client; database: string };
  redis: { client: RedisClient; port: number };
}

const compose = useCompose<MyServices>('./', 'docker-compose.yml')
  .withService('postgres', postgresService)
  .withService('redis', redisService);

const result = await compose.start();
```

---

## ComposeEnvironment Methods

### Configuration Methods

#### `.withService<K>(name: K, service: ContainerService<T[K]>)`

Register a service with a connection handler.

```typescript
.withService('postgres', postgresService)
```

See [BaseContainerService](#basecontainerservice) for creating services.

#### `.withEnv(env: Record<string, string>)`

Add environment variables for the compose environment.

```typescript
.withEnv({
  TAG: 'latest',
  LOG_LEVEL: 'debug'
})
```

These interpolate into your compose file:

```yaml
services:
  app:
    image: myapp:${TAG}
```

#### `.withEnvFile(path: string)`

Load environment variables from a file.

```typescript
.withEnvFile('.env.test')
```

#### `.withBuild()`

Build images before starting services.

```typescript
.withBuild()
```

#### `.withProfiles(...profiles: string[])`

Activate specific compose profiles.

```typescript
.withProfiles('testing', 'debugging')
```

#### `.withProjectName(name: string)`

Set the compose project name.

```typescript
.withProjectName('my-test-env')
```

#### `.withNoRecreate()`

Don't recreate containers if they already exist.

```typescript
.withNoRecreate()
```

#### `.withWaitStrategy(serviceName: string, strategy: WaitStrategy)`

Set wait strategy for a specific service.

```typescript
.withWaitStrategy('postgres', Wait.forHealthCheck())
```

#### `.withPullPolicy(policy: 'alwaysPull' | 'never')`

Control image pulling for all services.

```typescript
.withPullPolicy('alwaysPull')
```

### Runtime Method

#### `.start()`

Start the compose environment.

**Returns:** `Promise<ComposeResult<T>>`

```typescript
const { connectionInfo, getContainer, cleanup } = await compose.start();
```

---

## ComposeResult

The object returned by `useCompose().start()`.

### Properties

#### `environment: StartedDockerComposeEnvironment`

The underlying testcontainers compose object.

```typescript
const { environment } = await useCompose('./').start();
```

#### `connectionInfo: T`

Your typed service connection information.

```typescript
const { connectionInfo } = await useCompose<MyServices>('./').start();

// Fully typed!
const pgClient = connectionInfo.postgres.client;
const redisPort = connectionInfo.redis.port;
```

#### `network: string`

The default network name created by compose.

```typescript
const { network } = await useCompose('./').start();
// network might be 'myproject_default'
```

### Methods

#### `getContainer(serviceName: string): StartedTestContainer`

Get a specific container from the compose environment.

```typescript
const postgresContainer = getContainer('postgres');
const logs = await postgresContainer.logs();
```

#### `cleanup(): Promise<void>`

Stop and remove all containers in the environment.

```typescript
await cleanup();
```

---

## Network

Create isolated networks for container communication.

### Creating a Network

```typescript
import { Network } from '@fuzzy-street/dockhand';

const network = await new Network().start();
```

### Using a Network

```typescript
const container1 = await useContainer('postgres')
  .withNetwork(network)
  .withNetworkAliases('database')
  .start();

const container2 = await useContainer('app')
  .withNetwork(network)
  .withEnv({ DB_HOST: 'database' })
  .start();

// container2 can reach container1 at 'database:5432'
```

### Cleanup

```typescript
await network.stop();
```

---

## Wait Strategies

Wait strategies determine when a container is considered "ready".

### Import

```typescript
import { Wait } from '@fuzzy-street/dockhand';
```

### Default Strategy

If you don't specify a wait strategy, containers wait for listening ports (up to 60 seconds).

### Available Strategies

#### `Wait.forListeningPorts()`

Wait for exposed ports to be bound (default behavior).

```typescript
.withWaitStrategy(Wait.forListeningPorts())
```

#### `Wait.forLogMessage(message: string | RegExp, times?: number)`

Wait for a specific log message.

```typescript
// String match
.withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))

// Regex match
.withWaitStrategy(Wait.forLogMessage(/Listening on port \d+/))

// Must appear N times
.withWaitStrategy(Wait.forLogMessage('Server started', 2))
```

#### `Wait.forHealthCheck()`

Wait for the container's health check to pass.

```typescript
.withWaitStrategy(Wait.forHealthCheck())
```

Define a custom health check:

```typescript
.withHealthCheck({
  test: ['CMD-SHELL', 'curl -f http://localhost || exit 1'],
  interval: 1000,    // Check every second
  timeout: 3000,     // Timeout after 3 seconds
  retries: 5,        // Try 5 times
  startPeriod: 1000  // Wait 1 second before first check
})
.withWaitStrategy(Wait.forHealthCheck())
```

#### `Wait.forHttp(path: string, port: number)`

Wait for HTTP endpoint to respond.

```typescript
// Basic - wait for 200 status
.withWaitStrategy(Wait.forHttp('/health', 8080))

// With status code
.withWaitStrategy(
  Wait.forHttp('/health', 8080)
    .forStatusCode(201)
)

// With status code predicate
.withWaitStrategy(
  Wait.forHttp('/health', 8080)
    .forStatusCodeMatching(code => code >= 200 && code < 300)
)

// With response predicate
.withWaitStrategy(
  Wait.forHttp('/health', 8080)
    .forResponsePredicate(response => response === 'OK')
)

// With custom request
.withWaitStrategy(
  Wait.forHttp('/health', 8080)
    .withMethod('POST')
    .withHeaders({ 'X-API-Key': 'secret' })
    .withBasicCredentials('user', 'pass')
    .withReadTimeout(10_000)
)

// With TLS
.withWaitStrategy(
  Wait.forHttp('/health', 8443)
    .usingTls()
    .insecureTls()  // Skip certificate validation
)
```

#### `Wait.forSuccessfulCommand(command: string)`

Wait for a shell command to exit with code 0.

```typescript
.withWaitStrategy(Wait.forSuccessfulCommand('stat /tmp/app.lock'))
```

#### `Wait.forOneShotStartup()`

Wait for the container to stop (for containers that run once and exit).

```typescript
.withWaitStrategy(Wait.forOneShotStartup())
```

#### `Wait.forAll([...strategies])`

Combine multiple wait strategies.

```typescript
.withWaitStrategy(
  Wait.forAll([
    Wait.forListeningPorts(),
    Wait.forLogMessage('Ready to accept connections'),
    Wait.forHttp('/health', 8080)
  ])
)
```

### Timeout Configuration

Set a custom startup timeout:

```typescript
.withStartupTimeout(120_000)  // 120 seconds
```

Or on the wait strategy:

```typescript
.withWaitStrategy(
  Wait.forLogMessage('Ready')
    .withStartupTimeout(30_000)
)
```

---

## BaseContainerService

Create reusable service definitions for compose.

### Basic Structure

```typescript
import { BaseContainerService } from '@fuzzy-street/dockhand';
import type { StartedTestContainer } from 'testcontainers';

interface MyServiceConnection {
  client: MyClient;
  port: number;
}

class MyService extends BaseContainerService<MyServiceConnection> {
  async start(): Promise<void> {
    // Called for standalone usage (optional)
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  getConnectionInfo(): MyServiceConnection {
    this.validateStarted();
    const container = this.getContainer();
    
    return {
      client: createClient({
        host: container.getHost(),
        port: container.getMappedPort(5432)
      }),
      port: container.getMappedPort(5432)
    };
  }

  initializeFromContainer(container: StartedTestContainer) {
    this.setContainer(container);
  }
}
```

### Usage

```typescript
const myService = new MyService('my-service');

const { connectionInfo } = await useCompose<{ myService: MyServiceConnection }>('./')
  .withService('my-service', myService)
  .start();

const client = connectionInfo.myService.client;
```

---

## Types

### PortMapping

```typescript
type PortMapping = number | { container: number; host: number };
```

### FileConfig

```typescript
interface FileConfig {
  source: string;
  target: string;
  mode?: number;  // Octal, e.g., 0o644
}
```

### ExtraHost

```typescript
interface ExtraHost {
  host: string;
  ipAddress: string;
}
```

### ContainerConfig

Full configuration interface for containers:

```typescript
interface ContainerConfig {
  command?: string[];
  entrypoint?: string[];
  env?: Record<string, string>;
  platform?: string;
  workingDir?: string;
  user?: string;
  labels?: Record<string, string>;
  privileged?: boolean;
  resources?: { memory?: number; cpu?: number };
  ulimits?: Record<string, { soft: number; hard: number }>;
  sharedMemorySize?: number;
  capabilities?: { add?: string[]; drop?: string[] };
  tmpFs?: Record<string, string>;
  copyFiles?: FileConfig[];
  copyDirectories?: FileConfig[];
  network?: string;
  exposedPorts?: PortMapping[];
  networkMode?: string;
  networkAliases?: string[];
  extraHosts?: ExtraHost[];
  ipcMode?: string;
  waitStrategy?: WaitStrategy;
  pullPolicy?: 'alwaysPull' | 'never';
  reuse?: boolean;
  defaultLogDriver?: boolean;
}
```

### ComposeConfig

Configuration for Docker Compose:

```typescript
interface ComposeConfig {
  env?: Record<string, string>;
  envFile?: string;
  pullPolicy?: 'alwaysPull' | 'never';
  build?: boolean;
  profiles?: string[];
  projectName?: string;
  noRecreate?: boolean;
  waitStrategy?: WaitStrategy;
  down?: {
    timeout?: number;
    removeVolumes?: boolean;
  };
}
```

---

## Environment Variables

Configure testcontainers behavior with environment variables:

```bash
# Docker configuration
export DOCKER_HOST=tcp://docker:2375
export DOCKER_TLS_VERIFY=1

# Testcontainers configuration
export TESTCONTAINERS_RYUK_DISABLED=true  # Disable cleanup helper
export TESTCONTAINERS_REUSE_ENABLE=true  # Enable container reuse
export DEBUG=testcontainers*  # Enable debug logs

# For Podman/Colima
export DOCKER_HOST=unix://${HOME}/.colima/default/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

See [Configuration Docs](https://node.testcontainers.org/configuration/) for full list.

---

## Common Patterns

### Pattern: Shared Container

```typescript
let postgres;

before(async () => {
  postgres = await useContainer('postgres:14').start();
});

after(async () => {
  await postgres.cleanup();
});

test('test 1', async () => {
  // Use postgres
});
```

### Pattern: Fresh Container

```typescript
test('test 1', async () => {
  const { cleanup } = await useContainer('redis').start();
  // Fresh Redis just for this test
  await cleanup();
});
```

### Pattern: Multiple Services

```typescript
test('integration', async () => {
  const db = await useContainer('postgres').start();
  const cache = await useContainer('redis').start();
  
  // Test with both
  
  await cache.cleanup();
  await db.cleanup();
});
```

---

Remember: Start simple. Most tests only need `.withPort()` and `.withEnv()`!

For complex setups, use custom services and a docker compose file.
