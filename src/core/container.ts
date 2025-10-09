import {
  GenericContainer,
  type StartedTestContainer,
  type WaitStrategy,
  PullPolicy,
  type StartedNetwork,
  BuildOptions,
} from "testcontainers";

import type { ContainerConfig, PortMapping, FileConfig } from "../types";
import {
  ComposeFileNotFoundError,
  ConfigurationError,
  ContainerLifecycleError,
  createNotStartedError,
  ExecutionError,
  ImageBuildError,
  ImageError,
  ImagePullError,
  InvalidComposeFileError,
  isError,
  PortBindingError,
} from "~/errors";
import path from "node:path";

export interface ExecOptions {
  user?: string;
  workingDir?: string;
  env?: Record<string, string>;
}

export interface ExecResponse {
  output: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ContainerController {
  instance: StartedTestContainer;
  host: string;
  ports: Record<number, number>;

  // Runtime operations
  exec: (cmd: string[], opts?: ExecOptions) => Promise<ExecResponse>;
  logs: () => Promise<NodeJS.ReadableStream>;
  restart: () => Promise<void>;
  getIpAddress: (networkName: string) => string;

  cleanup: () => Promise<void>;
}

export interface DockerfileConfig {
  /**
   * Path to the Dockerfile
   */
  dockerfile: string;
  /**
   * Build context directory (defaults to directory containing Dockerfile)
   */
  context?: string;
  /**
   * Build arguments
   */
  buildArgs?: Record<string, string>;
  /**
   * Target stage for multi-stage builds
   */
  target?: string;
  /**
   * Optional tag for the built image
   */
  tag?: string;

  /**
   * Platform for the build (e.g., "linux/amd64")
   */
  platform?: string;

  /**
   * Lifecycle Management
   * If true, the built image will be removed when the container is stopped.
   * Defaults to false.
   */
  deleteOnExit?: boolean;
}

export class StandaloneContainer {
  private containerDef: GenericContainer;
  private config: Partial<ContainerConfig> = {};
  private containerInstance: StartedTestContainer | null = null;
  private isFromDockerfile = false;
  private imageName: string;

  constructor(imageOrContainer: string | GenericContainer) {
    if (typeof imageOrContainer === "string") {
      this.imageName = imageOrContainer;
      this.containerDef = new GenericContainer(imageOrContainer);
    } else {
      this.imageName = "<from-dockerfile>";
      this.containerDef = imageOrContainer;
      this.isFromDockerfile = true;
    }
  }

  /**
   * Build from a Dockerfile
   */
  static async fromDockerfile(config: DockerfileConfig): Promise<StandaloneContainer> {
    const context = config.context || ".";

    try {
      // Validate Dockerfile exists (optional but helpful)
      const dockerfilePath = path.join(context, config.dockerfile);

      let builder = GenericContainer.fromDockerfile(context, config.dockerfile);

      // Apply build args
      if (config.buildArgs) {
        try {
          builder = builder.withBuildArgs(config.buildArgs);
        } catch (error) {
          throw new ConfigurationError({
            message: `Invalid build arguments for Dockerfile '${config.dockerfile}'`,
            cause: {
              configKey: "buildArgs",
              providedValue: config.buildArgs,
              expectedType: "Record<string, string>",
            },
            parent: error instanceof Error ? error : undefined,
          });
        }
      }

      // Set target stage for multi-stage builds
      if (config.target) {
        try {
          builder = builder.withTarget(config.target);
        } catch (error) {
          throw new ConfigurationError({
            message: `Invalid target stage '${config.target}' for multi-stage build`,
            cause: {
              configKey: "target",
              providedValue: config.target,
              expectedType: "string",
            },
            parent: error instanceof Error ? error : undefined,
          });
        }
      }

      // Apply platform if specified
      if (config.platform) {
        try {
          builder = builder.withPlatform(config.platform);
        } catch (error) {
          throw new ConfigurationError({
            message: `Invalid platform '${config.platform}'`,
            cause: {
              configKey: "platform",
              providedValue: config.platform,
              expectedType: 'string (e.g., "linux/amd64")',
            },
            parent: error instanceof Error ? error : undefined,
          });
        }
      }

      // Build the image - this is the critical operation that can fail
      const buildOptions: BuildOptions = {
        deleteOnExit: config.deleteOnExit ?? true,
      };

      let builtContainer: GenericContainer;

      try {
        console.log(`Building Docker image from '${config.dockerfile}'...`);
        builtContainer = await builder.build(config.tag, buildOptions);
        console.log(`✅ Successfully built image${config.tag ? ` '${config.tag}'` : ""}`);
      } catch (error) {
        // Determine the type of build failure
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        // Check for specific error patterns
        if (errorMessage.includes("pull") || errorMessage.includes("registry")) {
          throw new ImagePullError({
            message: `Failed to pull base image while building '${config.dockerfile}'`,
            cause: {
              imageName: config.dockerfile,
              tag: config.tag,
              reason: errorMessage,
              authenticated: false,
            },
            parent: error instanceof Error ? error : undefined,
          });
        }

        if (errorMessage.includes("not found") || errorMessage.includes("no such file")) {
          throw new ComposeFileNotFoundError({
            message: `Dockerfile not found: '${config.dockerfile}'`,
            cause: {
              composePath: context,
              filePath: dockerfilePath,
              searchedPaths: [context, dockerfilePath],
            },
            parent: error instanceof Error ? error : undefined,
          });
        }

        if (errorMessage.includes("parse") || errorMessage.includes("syntax")) {
          throw new InvalidComposeFileError({
            message: `Invalid Dockerfile syntax in '${config.dockerfile}'`,
            cause: {
              composeFile: config.dockerfile,
              parseError: errorMessage,
            },
            parent: error instanceof Error ? error : undefined,
          });
        }

        // Generic image build error
        throw new ImageBuildError({
          message: "Failed to build image from Dockerfile",
          cause: {
            imageName: config.dockerfile,
            dockerfile: config.dockerfile,
            context: context,
            buildStage: config.target,
            reason: errorMessage,
          },
          parent: error instanceof Error ? error : undefined,
        });
      }

      const instance = new StandaloneContainer(builtContainer);
      instance.isFromDockerfile = true;
      instance.imageName = config.tag || `${config.dockerfile}:latest`;

      return instance;
    } catch (error) {
      // Re-throw custom errors
      if (
        isError(error, ImageError) ||
        isError(error, ImagePullError) ||
        isError(error, ConfigurationError) ||
        isError(error, ComposeFileNotFoundError) ||
        isError(error, InvalidComposeFileError)
      ) {
        throw error;
      }

      // Wrap any unexpected errors
      throw new ContainerLifecycleError({
        message: `Unexpected error building from Dockerfile '${config.dockerfile}'`,
        cause: {
          currentState: "failed",
          expectedState: "running",
          operation: "build",
        },
        parent: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Use an image from a custom registry
   */
  static fromRegistry(registry: string, image: string, tag = "latest"): StandaloneContainer {
    return new StandaloneContainer(`${registry}/${image}:${tag}`);
  }
  /**
   * Expose a single port
   */
  withPort(port: number): this {
    this.config.exposedPorts = [...(this.config.exposedPorts || []), port];
    return this;
  }

  /**
   * Expose multiple ports
   */
  withPorts(...ports: PortMapping[]): this {
    this.config.exposedPorts = [...(this.config.exposedPorts || []), ...ports];
    return this;
  }

  /**
   * Set environment variables
   */
  withEnv(env: Record<string, string>): this {
    this.config.env = { ...this.config.env, ...env };
    return this;
  }

  /**
   * Set container command
   */
  withCommand(...command: string[]): this {
    this.config.command = command;
    return this;
  }

  /**
   * Set entrypoint
   */
  withEntrypoint(...entrypoint: string[]): this {
    this.config.entrypoint = entrypoint;
    return this;
  }

  /**
   * Set working directory
   */
  withWorkingDir(dir: string): this {
    this.config.workingDir = dir;
    return this;
  }

  /**
   * Set user
   */
  withUser(user: string): this {
    this.config.user = user;
    return this;
  }

  /**
   * Add labels
   */
  withLabels(labels: Record<string, string>): this {
    this.config.labels = { ...this.config.labels, ...labels };
    return this;
  }

  /**
   * Run in privileged mode
   */
  withPrivilegedMode(): this {
    this.config.privileged = true;
    return this;
  }

  /**
   * Set resource limits
   */
  withResources(memory?: number, cpu?: number): this {
    this.config.resources = { memory, cpu };
    return this;
  }

  /**
   * Copy files to container
   */
  withCopyFiles(...files: FileConfig[]): this {
    this.config.copyFiles = [...(this.config.copyFiles || []), ...files];
    return this;
  }

  /**
   * Copy directories to container
   */
  withCopyDirectories(...dirs: FileConfig[]): this {
    this.config.copyDirectories = [...(this.config.copyDirectories || []), ...dirs];
    return this;
  }

  /**
   * Add extra host entries
   */
  withExtraHosts(hosts: Array<{ host: string; ipAddress: string }>): this {
    this.config.extraHosts = hosts;
    return this;
  }

  /**
   * Copy content to container (inline content, not files)
   */
  withCopyContent(content: Array<{ content: string; target: string; mode?: number }>): this {
    // Store for later processing
    (this.config as any).copyContent = content;
    return this;
  }

  /**
   * Join a network (pass network name or StartedNetwork)
   */
  withNetwork(network: string | StartedNetwork): this {
    if (typeof network === "string") {
      this.config.network = network;
    } else {
      // Store the actual network object to apply later
      this.config.network = network as any;
    }
    return this;
  }

  /**
   * Set network aliases
   */
  withNetworkAliases(...aliases: string[]): this {
    this.config.networkAliases = aliases;
    return this;
  }

  /**
   * Set wait strategy
   */
  withWaitStrategy(strategy: WaitStrategy): this {
    this.config.waitStrategy = strategy;
    return this;
  }

  /**
   * Set pull policy
   */
  withPullPolicy(policy: "alwaysPull" | "never"): this {
    this.config.pullPolicy = policy;
    return this;
  }

  /**
   * Enable container reuse
   */
  withReuse(): this {
    this.config.reuse = true;
    return this;
  }

  /**
   * Use default log driver
   */
  withDefaultLogDriver(): this {
    this.config.defaultLogDriver = true;
    return this;
  }

  /**
   * Set platform
   */
  withPlatform(platform: string): this {
    this.config.platform = platform;
    return this;
  }

  /**
   * Set tmpfs mounts
   */
  withTmpFs(tmpfs: Record<string, string>): this {
    this.config.tmpFs = { ...this.config.tmpFs, ...tmpfs };
    return this;
  }

  /**
   * Add capabilities
   */
  withCapabilities(add?: string[], drop?: string[]): this {
    this.config.capabilities = { add, drop };
    return this;
  }

  /**
   * Start the container
   */
  async start(): Promise<ContainerController> {
    try {
      let configured = this.containerDef;

      // Apply all configuration
      if (this.config.command) {
        configured = configured.withCommand(this.config.command);
      }

      if (this.config.entrypoint) {
        configured = configured.withEntrypoint(this.config.entrypoint);
      }

      if (this.config.env) {
        configured = configured.withEnvironment(this.config.env);
      }

      if (this.config.platform) {
        configured = configured.withPlatform(this.config.platform);
      }

      if (this.config.workingDir) {
        configured = configured.withWorkingDir(this.config.workingDir);
      }

      if (this.config.user) {
        configured = configured.withUser(this.config.user);
      }

      if (this.config.labels) {
        configured = configured.withLabels(this.config.labels);
      }

      if (this.config.privileged) {
        configured = configured.withPrivilegedMode();
      }

      if (this.config.resources) {
        configured = configured.withResourcesQuota(this.config.resources);
      }

      if (this.config.tmpFs) {
        configured = configured.withTmpFs(this.config.tmpFs);
      }

      if (this.config.copyFiles) {
        configured = configured.withCopyFilesToContainer(this.config.copyFiles);
      }

      if (this.config.copyDirectories) {
        configured = configured.withCopyDirectoriesToContainer(this.config.copyDirectories);
      }

      if (this.config.exposedPorts) {
        try {
          configured = configured.withExposedPorts(...this.config.exposedPorts);
        } catch (error) {
          throw new PortBindingError({
            message: `Failed to expose ports for ${this.image}`,
            cause: {
              port: this.config.exposedPorts[0] as number,
              reason: error instanceof Error ? error.message : "Unknown error",
            },
            parent: error instanceof Error ? error : undefined,
          });
        }
      }

      if (this.config.networkAliases) {
        configured = configured.withNetworkAliases(...this.config.networkAliases);
      }

      if (this.config.extraHosts) {
        configured = configured.withExtraHosts(this.config.extraHosts);
      }

      // Handle inline content
      if ((this.config as any).copyContent) {
        configured = configured.withCopyContentToContainer((this.config as any).copyContent);
      }

      if (this.config.waitStrategy) {
        configured = configured.withWaitStrategy(this.config.waitStrategy);
      }

      if (this.config.pullPolicy === "alwaysPull") {
        configured = configured.withPullPolicy(PullPolicy.alwaysPull());
      }

      if (this.config.reuse) {
        configured = configured.withReuse();
      }

      if (this.config.defaultLogDriver) {
        configured = configured.withDefaultLogDriver();
      }

      if (this.config.capabilities) {
        if (this.config.capabilities.add) {
          configured = configured.withAddedCapabilities(...this.config.capabilities.add);
        }
        if (this.config.capabilities.drop) {
          configured = configured.withDroppedCapabilities(...this.config.capabilities.drop);
        }
      }

      // Handle network - could be string or StartedNetwork
      if (this.config.network) {
        if (typeof this.config.network === "string") {
          // If it's a string, we can't actually join it without a StartedNetwork object
          // User needs to pass the actual network object or manage networks separately
          console.warn(
            "Network name provided but network object is needed. Use `.withNetwork(startedNetwork)` instead.",
          );
        } else {
          configured = configured.withNetwork(this.config.network as any);
        }
      }

      // Start the container
      try {
        this.containerInstance = await configured.start();
      } catch (error) {
        throw new ContainerLifecycleError({
          message: `Failed to start container from image '${this.imageName}'`,
          cause: {
            currentState: "failed",
            expectedState: "running",
            containerId: this.containerInstance?.getId(),
          },
          parent: error instanceof Error ? error : undefined,
        });
      }

      // Map ports
      const ports: Record<number, number> = {};
      if (this.config.exposedPorts) {
        for (const port of this.config.exposedPorts) {
          const containerPort = typeof port === "number" ? port : port.container;
          try {
            ports[containerPort] = this.containerInstance.getMappedPort(containerPort);
          } catch (error) {
            throw new PortBindingError({
              message: `Failed to get mapped port for container port ${containerPort}`,
              cause: {
                port: containerPort,
                reason: error instanceof Error ? error.message : "Port mapping failed",
              },
              parent: error instanceof Error ? error : undefined,
            });
          }
        }
      }

      return {
        instance: this.containerInstance,
        host: this.containerInstance.getHost(),
        ports,

        // Runtime operations
        exec: async (cmd: string[], opts?: ExecOptions) => {
          if (!this.containerInstance) {
            throw createNotStartedError(this.imageName, "execute command");
          }
          try {
            return await this.containerInstance.exec(cmd, opts);
          } catch (error) {
            throw new ExecutionError({
              message: `Failed to execute command in container: ${cmd.join(" ")}`,
              cause: {
                command: cmd,
                exitCode: (error as any)?.exitCode,
                stderr: (error as any)?.stderr,
              },
              parent: error instanceof Error ? error : undefined,
            });
          }
        },

        logs: async () => {
          if (!this.containerInstance) {
            throw createNotStartedError(this.imageName, "fetch logs");
          }
          return await this.containerInstance.logs();
        },

        restart: async () => {
          if (!this.containerInstance) {
            throw createNotStartedError(this.imageName, "restart");
          }

          try {
            await this.containerInstance.restart();
          } catch (error) {
            throw new ContainerLifecycleError({
              message: `Failed to restart container '${this.imageName}'`,
              cause: {
                currentState: "unknown",
                expectedState: "running",
                containerId: this.containerInstance.getId(),
              },
              parent: error instanceof Error ? error : undefined,
            });
          }
        },

        getIpAddress: (networkName: string) => {
          if (!this.containerInstance) {
            throw createNotStartedError(this.imageName, "get IP address");
          }
          return this.containerInstance.getIpAddress(networkName);
        },

        cleanup: async () => {
          if (this.containerInstance) {
            try {
              await this.containerInstance.stop();
            } catch (error) {
              throw new ContainerLifecycleError({
                message: `Failed to cleanup container '${this.imageName}'`,
                cause: {
                  currentState: "unknown",
                  expectedState: "stopped",
                  containerId: this.containerInstance.getId(),
                },
                parent: error instanceof Error ? error : undefined,
              });
            } finally {
              this.containerInstance = null;
            }
          }
        },
      };
    } catch (error) {
      // Rethrow custom errors, wrap unknown errors
      if (
        isError(error, ContainerLifecycleError) ||
        isError(error, PortBindingError) ||
        isError(error, ExecutionError)
      ) {
        throw error;
      }

      throw new ContainerLifecycleError({
        message: `Unexpected error starting container '${this.imageName}'`,
        cause: {
          currentState: "failed",
          expectedState: "running",
        },
        parent: error instanceof Error ? error : undefined,
      });
    }
  }
}

/**
 * Create a standalone container
 *
 * @example
 * ```typescript
 * const { container, host, ports, cleanup } = await useContainer('redis:latest')
 *   .withPort(6379)
 *   .withEnv({ REDIS_PASSWORD: 'secret' })
 *   .start();
 * ```
 */
export function useContainer(image: string): StandaloneContainer {
  return new StandaloneContainer(image);
}

/**
 * Build and use a container from a Dockerfile
 *
 * @example
 * ```typescript
 * const custom = await useDockerfile({
 *   dockerfile: './Dockerfile',
 *   context: '.',
 *   buildArgs: { VERSION: '1.0' }
 * })
 *   .withPort(8080)
 *   .start();
 * ```
 */
export async function useDockerfile(config: DockerfileConfig): Promise<StandaloneContainer> {
  return await StandaloneContainer.fromDockerfile(config);
}

/**
 * Use a container from a custom registry
 *
 * @example
 * ```typescript
 * const app = await useRegistry('ghcr.io', 'owner/repo', 'latest')
 *   .withPort(3000)
 *   .start();
 * ```
 */
export function useRegistry(registry: string, image: string, tag = "latest"): StandaloneContainer {
  return StandaloneContainer.fromRegistry(registry, image, tag);
}
