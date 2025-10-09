# Error Handling

Comprehensive error taxonomy and handling patterns using `@fuzzy-street/errors`.

## Error Hierarchy

All errors inherit from `ContainerError` and include rich contextual information:

```
ContainerError
├── ConfigurationError
│   ├── InvalidPortError
│   ├── InvalidImageError
│   ├── ConflictingConfigError
│   └── MissingConfigError
│
├── ContainerLifecycleError
│   ├── ContainerNotStartedError
│   ├── ContainerAlreadyStartedError
│   ├── ContainerStartFailedError
│   ├── ContainerTimeoutError
│   └── ContainerCleanupError
│
├── DockerDaemonError
│   ├── DockerNotAvailableError
│   ├── DockerPermissionError
│   └── DockerResourceError
│
├── ImageError
│   ├── ImageNotFoundError
│   ├── ImagePullError
│   └── ImageAuthError
│
├── NetworkError
│   ├── NetworkNotFoundError
│   ├── NetworkCreationError
│   └── PortBindingError
│
├── ComposeError
│   ├── ComposeFileNotFoundError
│   ├── InvalidComposeFileError
│   └── ServiceNotFoundError
│
├── ExecutionError
│   ├── ExecutionTimeoutError
│   └── CommandNotFoundError
│
├── FileSystemError
│   ├── FileNotFoundError
│   └── FilePermissionError
│
└── ValidationError
```

## Quick Reference Table

| Error | When It Happens | Key Context | What To Do |
|-------|----------------|-------------|------------|
| **Configuration Errors** |
| `InvalidPortError` | Invalid port number | `port`, `reason` | Check port is 1-65535 |
| `InvalidImageError` | Malformed image name | `imageName`, `reason` | Fix image format |
| `ConflictingConfigError` | Contradictory options | `option1`, `option2` | Remove conflicting config |
| `MissingConfigError` | Required config missing | `requiredKey`, `context` | Add missing configuration |
| **Lifecycle Errors** |
| `ContainerNotStartedError` | Accessing stopped container | `attemptedOperation` | Call `.start()` first |
| `ContainerAlreadyStartedError` | Starting started container | `containerId` | Check if already running |
| `ContainerStartFailedError` | Container failed to start | `reason`, `exitCode`, `logs` | Check container logs |
| `ContainerTimeoutError` | Startup took too long | `timeoutMs`, `waitStrategy` | Increase timeout or fix wait strategy |
| `ContainerCleanupError` | Cleanup failed | `reason`, `containerId` | Check Docker daemon, manual cleanup |
| **Docker Daemon Errors** |
| `DockerNotAvailableError` | Can't connect to Docker | `socketPath`, `suggestion` | Start Docker Desktop |
| `DockerPermissionError` | No permission to use Docker | `requiredPermission`, `suggestion` | Add user to docker group |
| `DockerResourceError` | Out of resources | `resourceType`, `available`, `required` | Free up resources |
| **Image Errors** |
| `ImageNotFoundError` | Image doesn't exist | `imageName`, `searchedIn` | Pull image or fix name |
| `ImagePullError` | Failed to pull image | `reason`, `statusCode` | Check network, auth |
| `ImageAuthError` | Auth required | `registry`, `suggestion` | Login with `docker login` |
| **Network Errors** |
| `NetworkNotFoundError` | Network doesn't exist | `networkName`, `suggestion` | Create network first |
| `NetworkCreationError` | Failed to create network | `reason` | Check Docker daemon |
| `PortBindingError` | Port unavailable | `port`, `hostPort`, `reason` | Use different port |
| **Compose Errors** |
| `ComposeFileNotFoundError` | Compose file missing | `filePath`, `searchedPaths` | Check file path |
| `InvalidComposeFileError` | Invalid YAML | `parseError`, `lineNumber` | Fix compose file syntax |
| `ServiceNotFoundError` | Service not in compose | `serviceName`, `availableServices` | Check service name |
| **Execution Errors** |
| `ExecutionError` | Command failed | `command`, `exitCode`, `stderr` | Check command and logs |
| `ExecutionTimeoutError` | Command took too long | `timeoutMs` | Increase timeout |
| `CommandNotFoundError` | Command not in container | `command`, `suggestion` | Install command or use correct path |
| **File System Errors** |
| `FileNotFoundError` | File doesn't exist | `path`, `operation` | Check file path |
| `FilePermissionError` | No permission | `requiredPermission` | Fix file permissions |

## Usage Examples

### Type-Safe Error Handling

```typescript
import { useContainer } from '@fuzzy-street/dockhand';
import {
  isError,
  ContainerNotStartedError,
  ImageNotFoundError,
  DockerNotAvailableError,
  ContainerTimeoutError
} from '@fuzzy-street/dockhand/errors';

try {
  const { exec, cleanup } = await useContainer('postgres:14')
    .withPort(5432)
    .start();
  
  const result = await exec(['psql', '--version']);
  await cleanup();
  
} catch (error) {
  // Type-safe error checking with full context access
  
  if (isError(error, DockerNotAvailableError)) {
    // Direct property access - fully typed!
    console.error(`Docker not available at: ${error.socketPath}`);
    console.log(`Suggestion: ${error.suggestion}`);
    // → "Start Docker Desktop or run: sudo systemctl start docker"
  }
  
  else if (isError(error, ImageNotFoundError)) {
    console.error(`Image not found: ${error.imageName}:${error.tag}`);
    console.log(`Searched in: ${error.searchedIn.join(', ')}`);
    console.log(`Suggestion: ${error.suggestion}`);
    // → "Pull the image manually: docker pull postgres:14"
  }
  
  else if (isError(error, ContainerTimeoutError)) {
    console.error(`Container timed out after ${error.timeoutMs}ms`);
    console.log(`Current state: ${error.currentState}`);
    console.log(`Wait strategy: ${error.waitStrategy}`);
    // Increase timeout or change wait strategy
  }
  
  else if (isError(error, ContainerNotStartedError)) {
    console.error(`Attempted ${error.attemptedOperation} on stopped container`);
    console.log(`Container: ${error.containerName}`);
    // Call .start() first
  }
  
  else {
    // Unknown error
    console.error('Unexpected error:', error);
  }
}
```

### Error Context Access

```typescript
import { ContainerError, isError } from '@fuzzy-street/dockhand/errors';

try {
  await useContainer('redis:latest').start();
} catch (error) {
  if (error instanceof ContainerError) {
    // Get full context with type safety
    const context = ContainerError.getContext(error);
    
    console.log('Container:', context.containerName);
    console.log('Image:', context.image);
    console.log('Operation:', context.operation);
    
    // Get error hierarchy
    const hierarchy = ContainerError.getErrorHierarchy(error);
    console.log('Error chain:', hierarchy);
  }
}
```

### Parent-Child Error Chains

```typescript
import {
  ContainerStartFailedError,
  ImagePullError,
  isError
} from '@fuzzy-street/dockhand/errors';

try {
  // Inner error
  try {
    await pullImage('myregistry.io/private:latest');
  } catch (pullError) {
    // Wrap with more context
    throw new ContainerStartFailedError({
      message: 'Container failed to start due to image pull failure',
      parent: pullError, // ← Link errors together
      cause: {
        containerName: 'my-container',
        image: 'myregistry.io/private:latest',
        reason: 'Image pull failed',
        operation: 'start'
      }
    });
  }
} catch (error) {
  if (isError(error, ContainerStartFailedError)) {
    console.log('Start failed:', error.reason);
    
    // Access parent error
    if (error.parent && isError(error.parent, ImagePullError)) {
      console.log('Root cause:', error.parent.reason);
      console.log('Status code:', error.parent.statusCode);
      console.log('Registry:', error.parent.registry);
    }
    
    // Get full error chain
    const chain = ContainerStartFailedError.followParentChain(error);
    console.log(`Error chain depth: ${chain.length}`);
  }
}
```

### Graceful Degradation

```typescript
import { useContainer } from '@fuzzy-street/dockhand';
import {
  isError,
  ImageNotFoundError,
  ContainerTimeoutError
} from '@fuzzy-street/dockhand/errors';

async function startContainerWithRetry(
  image: string,
  maxRetries: number = 3
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await useContainer(image)
        .withStartupTimeout(30000 * (i + 1)) // Increase timeout each retry
        .start();
        
    } catch (error) {
      if (isError(error, ImageNotFoundError)) {
        // Image doesn't exist - don't retry
        console.error(`Image not found: ${error.imageName}`);
        console.log(error.suggestion);
        throw error;
      }
      
      if (isError(error, ContainerTimeoutError)) {
        // Timeout - might work with longer timeout
        if (i < maxRetries - 1) {
          console.log(`Retry ${i + 1}/${maxRetries} with longer timeout...`);
          continue;
        }
      }
      
      throw error;
    }
  }
  
  throw new Error('All retries exhausted');
}
```

### Production Error Logging

```typescript
import { ContainerError, isError } from '@fuzzy-street/dockhand/errors';
import winston from 'winston';

const logger = winston.createLogger({
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

function logContainerError(error: unknown) {
  if (error instanceof ContainerError) {
    // Get full context
    const context = ContainerError.getContext(error);
    const hierarchy = ContainerError.getErrorHierarchy(error);
    
    logger.error('Container operation failed', {
      errorType: error.name,
      message: error.message,
      context,
      hierarchy,
      stack: error.stack,
      
      // Structured fields for alerting
      container: context.containerName,
      image: context.image,
      operation: context.operation
    });
    
    // Alert on specific errors
    if (isError(error, DockerNotAvailableError)) {
      // Critical: Docker daemon down
      alertOps('docker-daemon-down', error);
    }
  } else {
    logger.error('Unknown error', { error });
  }
}

// Usage
try {
  await useContainer('redis').start();
} catch (error) {
  logContainerError(error);
  throw error;
}
```

### Custom Error Messages

```typescript
import {
  createConfigError,
  createNotStartedError,
  createDockerNotAvailableError,
  createImageNotFoundError,
  createTimeoutError
} from '@fuzzy-street/dockhand/errors';

// Use helper functions for consistent error messages

// Configuration error
throw createConfigError(
  'port',
  -1,
  'positive integer between 1-65535'
);

// Container not started
throw createNotStartedError('my-container', 'execute command');

// Docker not available
throw createDockerNotAvailableError('/var/run/docker.sock');

// Image not found
throw createImageNotFoundError('postgres', '14');

// Timeout
throw createTimeoutError('my-container', 30000, 'forLogMessage("ready")');
```

## Error Prevention Patterns

### Validate Early

```typescript
import { InvalidPortError, InvalidImageError } from '@fuzzy-street/dockhand/errors';

class StandaloneContainer {
  withPort(port: number): this {
    // Validate immediately
    if (port < 1 || port > 65535) {
      throw new InvalidPortError({
        message: `Invalid port number: ${port}`,
        cause: {
          port,
          reason: 'Port must be between 1 and 65535',
          operation: 'configuration'
        }
      });
    }
    
    this.config.exposedPorts = [...(this.config.exposedPorts || []), port];
    return this;
  }
  
  withImage(image: string): this {
    // Validate format
    if (!image || typeof image !== 'string') {
      throw new InvalidImageError({
        message: 'Invalid image name',
        cause: {
          imageName: image,
          reason: 'Image name must be a non-empty string',
          operation: 'configuration'
        }
      });
    }
    
    return this;
  }
}
```

### Check Prerequisites

```typescript
import { DockerNotAvailableError } from '@fuzzy-street/dockhand/errors';

async function checkDockerAvailable(): Promise<void> {
  try {
    const client = await getContainerRuntimeClient();
    await client.info.get();
  } catch (error) {
    throw new DockerNotAvailableError({
      message: 'Docker daemon is not accessible',
      cause: {
        dockerHost: process.env.DOCKER_HOST,
        socketPath: '/var/run/docker.sock',
        reason: error.message,
        suggestion: 'Start Docker Desktop or run: sudo systemctl start docker'
      }
    });
  }
}

// Call before starting containers
await checkDockerAvailable();
const container = await useContainer('redis').start();
```

## Best Practices

### 1. Always Use Type-Safe Checking

```typescript
// ✅ Good - Type safe
if (isError(error, ImageNotFoundError)) {
  console.log(error.imageName); // Fully typed!
}

// ❌ Bad - Not type safe
if (error.name === 'ImageNotFoundError') {
  console.log(error.imageName); // TypeScript error!
}
```

### 2. Provide Helpful Context

```typescript
// ✅ Good - Rich context
throw new ContainerStartFailedError({
  message: 'Container failed to start',
  cause: {
    containerName: 'my-app',
    image: 'my-app:latest',
    reason: 'Health check failed',
    exitCode: 1,
    logs: containerLogs,
    operation: 'start'
  }
});

// ❌ Bad - No context
throw new Error('Container failed');
```

### 3. Chain Related Errors

```typescript
// ✅ Good - Full error chain
try {
  await operation1();
} catch (error1) {
  try {
    await operation2();
  } catch (error2) {
    throw new ContainerError({
      message: 'Multiple operations failed',
      parent: error2, // ← Link the errors
      cause: { operation: 'batch' }
    });
  }
}
```

### 4. Log Structured Errors

```typescript
// ✅ Good - Structured logging
logger.error('Operation failed', {
  error: error.name,
  context: ContainerError.getContext(error),
  hierarchy: ContainerError.getErrorHierarchy(error)
});

// ❌ Bad - String only
logger.error(error.toString());
```

## Summary

**Error System Benefits:**

- ✅ Hierarchical error taxonomy
- ✅ Type-safe error handling
- ✅ Rich contextual information
- ✅ Parent-child error chains
- ✅ Direct property access
- ✅ Easy debugging and logging

**Key Exports:**

```typescript
import {
  // Error classes
  ContainerError,
  ConfigurationError,
  ContainerLifecycleError,
  DockerDaemonError,
  ImageError,
  NetworkError,
  ComposeError,
  ExecutionError,
  FileSystemError,
  
  // Helper functions
  isError,
  createConfigError,
  createNotStartedError,
  createDockerNotAvailableError,
  createImageNotFoundError,
  createTimeoutError
} from '@fuzzy-street/dockhand/errors';
```

**Remember:** Errors are your friends! They provide context, help debugging, and make your library easier to use. 🎉
