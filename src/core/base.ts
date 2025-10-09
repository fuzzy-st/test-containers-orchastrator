import type { StartedTestContainer as ContainerSession, WaitStrategy } from "testcontainers";
import { ContainerLifecycleError, createNotStartedError } from "~/errors";
import type { BaseRecord, ContainerLifecycle, ContainerService, ServiceConfig } from "~/types";

// ============================================
// Class Hierarchy Summary
// ============================================

/*
**BaseContainerManager (abstract)**
├── Container lifecycle (start, stop, isStarted)
├── Protected container access (getContainer, setContainer)
├── Validation helpers (validateStarted)
├── **BaseContainerService<T> (abstract)**
    ├── Implements: ContainerService<T>
    ├── Adds: getConnectionInfo()
    ├── Adds: Optional compose hooks (getWaitStrategy, etc.)
    └── Used for: Custom services (PostgresService, RedisService)
*/

/**
 * Base abstraction for anything that manages a Docker container
 */
export abstract class BaseContainerManager implements ContainerLifecycle {
  protected started = false;
  protected session: ContainerSession | null = null;

  constructor(protected readonly name: string) {}

  getName(): string {
    return this.name;
  }

  isStarted(): boolean {
    return this.started;
  }

  protected getContainer(): ContainerSession {
    if (!this.session) {
      throw new ContainerLifecycleError({
        message: `Container '${this.name}' has not been initialized`,
        cause: {
          currentState: "stopped",
          expectedState: "running",
          containerId: undefined,
        },
      });
    }
    return this.session;
  }

  protected setContainer(container: ContainerSession): void {
    this.session = container;
    this.started = true;
  }

  protected validateStarted(): void {
    if (!this.started) {
      throw createNotStartedError(this.name, "perform this operation");
    }
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}

/**
 * Base class for custom services (PostgresService, RedisService, etc.)
 * Used primarily with docker-compose
 */
export abstract class BaseContainerService<
    T extends BaseRecord,
    Config extends ServiceConfig | null = null,
  >
  extends BaseContainerManager
  implements ContainerService<T>
{
  constructor(
    name: string,
    protected readonly serviceConfig?: Config,
  ) {
    super(name);
  }

  abstract getConnectionInfo(): T;

  // Optional overrides for compose integration
  getWaitStrategy?(): WaitStrategy;
  getEnvironmentVariables?(): Record<string, string>;

  /**
   * Initialize from a compose-started container
   */
  initializeFromContainer(container: ContainerSession): void {
    this.setContainer(container);
  }
}
