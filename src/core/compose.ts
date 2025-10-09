import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  type WaitStrategy,
  PullPolicy,
  type StartedTestContainer,
} from "testcontainers";
import type { ContainerService, ComposeConfig, BaseRecord } from "../types";
import { ComposeError, ContainerLifecycleError, isError, ServiceNotFoundError } from "~/errors";

export interface ComposeController<T> {
  environment: StartedDockerComposeEnvironment;
  services: T;
  network: string;
  getContainerInstance: (serviceName: string) => StartedTestContainer;
  cleanup: () => Promise<void>;
}

interface ServiceDefinition<T extends BaseRecord> {
  name: string;
  service: ContainerService<T>;
}

export class ComposeEnvironment<T extends Record<string, any>> {
  private services = new Map<keyof T, ServiceDefinition<T[keyof T]>>();
  private config: ComposeConfig = {};

  constructor(
    private readonly composePath: string,
    private readonly composeFile: string = "docker-compose.yml",
  ) {}

  /**
   * Register a service with a typed connection handler
   */
  withService<K extends keyof T>(name: K, service: ContainerService<T[K]>): this {
    this.services.set(name, {
      name: name as string,
      service,
    });
    return this;
  }

  /**
   * Add environment variables
   */
  withEnv(env: Record<string, string>): this {
    this.config.env = { ...this.config.env, ...env };
    return this;
  }

  /**
   * Load environment from file
   */
  withEnvFile(path: string): this {
    this.config.envFile = path;
    return this;
  }

  /**
   * Enable building images
   */
  withBuild(): this {
    this.config.build = true;
    return this;
  }

  /**
   * Set compose profiles to use
   */
  withProfiles(...profiles: string[]): this {
    this.config.profiles = profiles;
    return this;
  }

  /**
   * Set project name
   */
  withProjectName(name: string): this {
    this.config.projectName = name;
    return this;
  }

  /**
   * Don't recreate containers if they exist
   */
  withNoRecreate(): this {
    this.config.noRecreate = true;
    return this;
  }

  /**
   * Set wait strategy for a service
   */
  withWaitStrategy(serviceName: string, strategy: WaitStrategy): this {
    this.config.waitStrategy = strategy;
    return this;
  }

  /**
   * Always pull images
   */
  withPullPolicy(policy: "alwaysPull" | "never"): this {
    this.config.pullPolicy = policy;
    return this;
  }

  /**
   * Start the compose environment
   */
  async start(): Promise<ComposeController<T>> {
    try {
      let environment = new DockerComposeEnvironment(this.composePath, this.composeFile);

      // Apply configuration
      if (this.config.env) {
        environment = environment.withEnvironment(this.config.env);
      }

      if (this.config.envFile) {
        environment = environment.withEnvironmentFile(this.config.envFile);
      }

      if (this.config.pullPolicy === "alwaysPull") {
        environment = environment.withPullPolicy(PullPolicy.alwaysPull());
      }

      if (this.config.build) {
        environment = environment.withBuild();
      }

      if (this.config.profiles) {
        environment = environment.withProfiles(...this.config.profiles);
      }

      if (this.config.projectName) {
        environment = environment.withProjectName(this.config.projectName);
      }

      if (this.config.noRecreate) {
        environment = environment.withNoRecreate();
      }

      // Configure each service
      for (const [_, def] of this.services) {
        if (def.service.getWaitStrategy) {
          environment = environment.withWaitStrategy(def.name, def.service.getWaitStrategy());
        }

        if (def.service.getEnvironmentVariables) {
          environment = environment.withEnvironment(def.service.getEnvironmentVariables());
        }
      }

      // Start the environment
      let startedEnv: StartedDockerComposeEnvironment;
      try {
        startedEnv = await environment.up();
      } catch (error) {
        throw new ComposeError({
          message: `Failed to start compose environment from '${this.composeFile}'`,
          cause: {
            composePath: this.composePath,
            composeFile: this.composeFile,
          },
          parent: error instanceof Error ? error : undefined,
        });
      }

      // Initialize services with their container instances
      for (const [serviceName, def] of this.services) {
        try {
          if (def.service.initializeFromContainer) {
            const instance = startedEnv.getContainer(def.name);
            await def.service.initializeFromContainer(instance);
          }
        } catch (error) {
          throw new ServiceNotFoundError({
            message: `Failed to initialize service '${def.name}'`,
            cause: {
              composePath: this.composePath,
              composeFile: this.composeFile,
              serviceName: def.name,
              availableServices: Array.from(this.services.keys()).map(String),
            },
            parent: error instanceof Error ? error : undefined,
          });
        }
      }
      // Collect connection info
      const connectionInfo = {} as T;
      for (const [name, def] of this.services) {
        connectionInfo[name] = def.service.getConnectionInfo() as T[keyof T];
      }

      // Get network name from compose project
      const network = this.config.projectName ? `${this.config.projectName}_default` : "default";

      return {
        environment: startedEnv,
        services: connectionInfo,
        network,

        getContainerInstance: (serviceName: string) => {
          try {
            return startedEnv.getContainer(serviceName);
          } catch (error) {
            throw new ServiceNotFoundError({
              message: `Service '${serviceName}' not found in compose environment`,
              cause: {
                composePath: this.composePath,
                composeFile: this.composeFile,
                serviceName,
                availableServices: Array.from(this.services.keys()).map(String),
              },
              parent: error instanceof Error ? error : undefined,
            });
          }
        },

        cleanup: async () => {
          const errors: Error[] = [];

          try {
            await startedEnv.down({
              timeout: this.config.down?.timeout,
              removeVolumes: this.config.down?.removeVolumes,
            });
          } catch (error) {
            errors.push(
              new ComposeError({
                message: "Failed to stop compose environment",
                cause: {
                  composePath: this.composePath,
                  composeFile: this.composeFile,
                },
                parent: error instanceof Error ? error : undefined,
              }),
            );
          }

          // Stop all services
          for (const def of Array.from(this.services.values()).reverse()) {
            try {
              await def.service.stop();
            } catch (error) {
              errors.push(
                new ContainerLifecycleError({
                  message: `Error stopping service '${def.name}'`,
                  cause: {
                    containerName: def.name,
                    currentState: "unknown",
                    expectedState: "stopped",
                    operation: "cleanup",
                  },
                  parent: error instanceof Error ? error : undefined,
                }),
              );
            }
          }

          if (errors.length > 0) {
            throw errors[0];
          }
        },
      };
    } catch (error) {
      // Rethrow known errors
      if (
        isError(error, ComposeError) ||
        isError(error, ServiceNotFoundError) ||
        isError(error, ContainerLifecycleError)
      )
        throw error;

      throw new ComposeError({
        message: "Unexpected error in compose environment",
        cause: {
          composePath: this.composePath,
          composeFile: this.composeFile,
        },
        parent: error instanceof Error ? error : undefined,
      });
    }
  }
}

/**
 * Create a compose environment from a docker-compose file
 *
 * @example
 * ```typescript
 * const { connectionInfo, cleanup } = await useCompose<{ postgres: PostgresInfo }>('./')
 *   .withService('postgres', postgresService)
 *   .withEnv({ POSTGRES_PASSWORD: 'test' })
 *   .start();
 * ```
 */
export function useCompose<T extends Record<string, any>>(
  composePath: string,
  composeFile = "docker-compose.yml",
): ComposeEnvironment<T> {
  return new ComposeEnvironment<T>(composePath, composeFile);
}
