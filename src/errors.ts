import { createCustomError } from "@fuzzy-street/errors";

/**
 * =====================================
 * Re-export from @fuzzy-street/errors
 * =====================================
 * These utilities are re-exported for convenience, allowing users of this library
 * to access error handling utilities without needing to install @fuzzy-street/errors separately.
 * This helps maintain consistency in error handling across projects using this library.
 */
export {
  isError,
  getErrorClass,
  listErrorClasses,
} from "@fuzzy-street/errors";

/**
 * =====================================
 * Base Error Hierarchy
 * =====================================
 */

/**
 * Generic container-related error
 * This is the base error class for all container-related errors.
 * It captures common properties like container name, image, and operation.
 *
 * @example
 * ```ts
 * throw new ContainerError({
 *   message: "Failed to start container",
 *   cause: {
 *     containerName: "my-container",
 *     image: "my-image:latest",
 *     operation: "start"
 *   }
 * });
 * ```
 */
export const ContainerError = createCustomError<{
  containerName?: string;
  image?: string;
  operation?: string;
}>("Container Error", ["containerName", "image", "operation"]);

/**
 * ======================================
 * Configuration Errors
 * ======================================
 */

/**
 * Errors related to invalid configuration
 * This error is thrown when there are issues with the configuration provided to the container orchestrator.
 * It captures details about the specific configuration key, the provided value, and the expected type.
 */
export const ConfigurationError = createCustomError<
  {
    configKey?: string;
    providedValue?: unknown;
    expectedType?: string;
  },
  typeof ContainerError
>("Configuration Error", ["configKey", "providedValue", "expectedType"], ContainerError);

/**
 * Invalid image name or format
 * This error is thrown when the specified Docker image name is invalid or improperly formatted.
 * It captures the image name and the reason for invalidity.
 */
export const InvalidImageError = createCustomError<
  {
    imageName: string;
    reason: string;
  },
  typeof ConfigurationError
>("InvalidImageError", ["imageName", "reason"], ConfigurationError);

/**
 * Conflicting configuration options
 * This error is thrown when there are conflicting options in the configuration.
 * It captures the conflicting options and the reason for the conflict.
 */
export const ConflictingConfigError = createCustomError<
  {
    option1: string;
    option2: string;
    reason: string;
  },
  typeof ConfigurationError
>("ConflictingConfigError", ["option1", "option2", "reason"], ConfigurationError);

/**
 * Missing required configuration
 * This error is thrown when a required configuration key is missing.
 * It captures the missing key and the context in which it is required.
 */
export const MissingConfigError = createCustomError<
  {
    requiredKey: string;
    context: string;
  },
  typeof ConfigurationError
>("MissingConfigError", ["requiredKey", "context"], ConfigurationError);

// ============================================
// Container Lifecycle Errors
// ============================================

/**
 * Errors related to container lifecycle and state
 *
 */
export const ContainerLifecycleError = createCustomError<
  {
    currentState?: "starting" | "running" | "stopped" | "failed" | "unknown";
    expectedState?: "starting" | "running" | "stopped" | "failed";
    containerId?: string;
  },
  typeof ContainerError
>("ContainerLifecycleError", ["currentState", "expectedState", "containerId"], ContainerError);

/**
 * Container not started yet
 */
export const ContainerNotStartedError = createCustomError<
  {
    attemptedOperation: string;
  },
  typeof ContainerLifecycleError
>("ContainerNotStartedError", ["attemptedOperation"], ContainerLifecycleError);

/**
 * Container already started
 */
export const ContainerAlreadyStartedError = createCustomError<
  {
    containerId: string;
  },
  typeof ContainerLifecycleError
>("ContainerAlreadyStartedError", ["containerId"], ContainerLifecycleError);

/**
 * Container failed to start
 */
export const ContainerStartFailedError = createCustomError<
  {
    reason: string;
    exitCode?: number;
    logs?: string;
  },
  typeof ContainerLifecycleError
>("ContainerStartFailedError", ["reason", "exitCode", "logs"], ContainerLifecycleError);

/**
 * Container startup timeout
 */
export const ContainerTimeoutError = createCustomError<
  {
    timeoutMs: number;
    waitStrategy?: string;
  },
  typeof ContainerLifecycleError
>("ContainerTimeoutError", ["timeoutMs", "waitStrategy"], ContainerLifecycleError);

/**
 * Container cleanup failed
 */
export const ContainerCleanupError = createCustomError<
  {
    reason: string;
    containerId?: string;
  },
  typeof ContainerLifecycleError
>("ContainerCleanupError", ["reason", "containerId"], ContainerLifecycleError);

// ============================================
// Docker Daemon Errors
// ============================================

/**
 * Errors related to Docker daemon
 */
export const DockerDaemonError = createCustomError<
  {
    dockerHost?: string;
    reason: string;
  },
  typeof ContainerError
>("DockerDaemonError", ["dockerHost", "reason"], ContainerError);

/**
 * Docker daemon not accessible
 */
export const DockerNotAvailableError = createCustomError<
  {
    socketPath?: string;
    suggestion: string;
  },
  typeof DockerDaemonError
>("DockerNotAvailableError", ["socketPath", "suggestion"], DockerDaemonError);

/**
 * Insufficient Docker permissions
 */
export const DockerPermissionError = createCustomError<
  {
    requiredPermission: string;
    currentUser?: string;
    suggestion: string;
  },
  typeof DockerDaemonError
>("DockerPermissionError", ["requiredPermission", "currentUser", "suggestion"], DockerDaemonError);

/**
 * Docker out of resources
 */
export const DockerResourceError = createCustomError<
  {
    resourceType: "memory" | "disk" | "cpu";
    available?: string;
    required?: string;
  },
  typeof DockerDaemonError
>("DockerResourceError", ["resourceType", "available", "required"], DockerDaemonError);

// ============================================
// Image Errors
// ============================================

/**
 * Errors related to Docker images
 */
export const ImageError = createCustomError<
  {
    imageName: string;
    tag?: string;
    registry?: string;
  },
  typeof ContainerError
>("ImageError", ["imageName", "tag", "registry"], ContainerError);

/**
 * Image not found locally or in registry
 */
export const ImageNotFoundError = createCustomError<
  {
    searchedIn: string[];
    suggestion: string;
  },
  typeof ImageError
>("ImageNotFoundError", ["searchedIn", "suggestion"], ImageError);

/**
 * Image pull failed
 */
export const ImagePullError = createCustomError<
  {
    reason: string;
    statusCode?: number;
    authenticated?: boolean;
  },
  typeof ImageError
>("ImagePullError", ["reason", "statusCode", "authenticated"], ImageError);

/**
 * Image authentication required
 */
export const ImageAuthError = createCustomError<
  {
    registry: string;
    suggestion: string;
  },
  typeof ImageError
>("ImageAuthError", ["registry", "suggestion"], ImageError);

/**
 * Image build failed
 */
export const ImageBuildError = createCustomError<
  {
    dockerfile: string;
    context: string;
    buildStage?: string;
    reason: string;
  },
  typeof ImageError
>("ImageBuildError", ["dockerfile", "context", "buildStage", "reason"], ImageError);

// ============================================
// Network Errors
// ============================================

/**
 * Errors related to container networking
 */
export const NetworkError = createCustomError<
  {
    networkName?: string;
    networkMode?: string;
  },
  typeof ContainerError
>("NetworkError", ["networkName", "networkMode"], ContainerError);

/**
 * Network not found
 */
export const NetworkNotFoundError = createCustomError<
  {
    networkName: string;
    suggestion: string;
  },
  typeof NetworkError
>("NetworkNotFoundError", ["networkName", "suggestion"], NetworkError);

/**
 * Network creation failed
 */
export const NetworkCreationError = createCustomError<
  {
    reason: string;
  },
  typeof NetworkError
>("NetworkCreationError", ["reason"], NetworkError);

/**
 * Port binding error
 */
export const PortBindingError = createCustomError<
  {
    port: number;
    hostPort?: number;
    reason: string;
  },
  typeof NetworkError
>("PortBindingError", ["port", "hostPort", "reason"], NetworkError);

// ============================================
// Compose Errors
// ============================================

/**
 * Errors related to Docker Compose
 */
export const ComposeError = createCustomError<
  {
    composePath?: string;
    composeFile?: string;
    serviceName?: string;
  },
  typeof ContainerError
>("ComposeError", ["composePath", "composeFile", "serviceName"], ContainerError);

/**
 * Compose file not found
 */
export const ComposeFileNotFoundError = createCustomError<
  {
    filePath: string;
    searchedPaths: string[];
  },
  typeof ComposeError
>("ComposeFileNotFoundError", ["filePath", "searchedPaths"], ComposeError);

/**
 * Invalid compose file format
 */
export const InvalidComposeFileError = createCustomError<
  {
    parseError: string;
    lineNumber?: number;
  },
  typeof ComposeError
>("InvalidComposeFileError", ["parseError", "lineNumber"], ComposeError);

/**
 * Service not found in compose file
 */
export const ServiceNotFoundError = createCustomError<
  {
    serviceName: string;
    availableServices: string[];
  },
  typeof ComposeError
>("ServiceNotFoundError", ["serviceName", "availableServices"], ComposeError);

// ============================================
// Execution Errors
// ============================================

/**
 * Errors during command execution in container
 */
export const ExecutionError = createCustomError<
  {
    command: string[];
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  },
  typeof ContainerError
>("ExecutionError", ["command", "exitCode", "stdout", "stderr"], ContainerError);

/**
 * Command execution timeout
 */
export const ExecutionTimeoutError = createCustomError<
  {
    timeoutMs: number;
  },
  typeof ExecutionError
>("ExecutionTimeoutError", ["timeoutMs"], ExecutionError);

/**
 * Command not found in container
 */
export const CommandNotFoundError = createCustomError<
  {
    command: string;
    searchPath?: string[];
    suggestion: string;
  },
  typeof ExecutionError
>("CommandNotFoundError", ["command", "searchPath", "suggestion"], ExecutionError);

// ============================================
// File System Errors
// ============================================

/**
 * Errors related to file operations with containers
 */
export const FileSystemError = createCustomError<
  {
    path: string;
    operation: "read" | "write" | "copy" | "delete";
  },
  typeof ContainerError
>("FileSystemError", ["path", "operation"], ContainerError);

/**
 * File not found
 */
export const FileNotFoundError = createCustomError<
  {
    containerPath?: string;
    hostPath?: string;
  },
  typeof FileSystemError
>("FileNotFoundError", ["containerPath", "hostPath"], FileSystemError);

/**
 * Permission denied for file operation
 */
export const FilePermissionError = createCustomError<
  {
    requiredPermission: string;
    currentPermissions?: string;
  },
  typeof FileSystemError
>("FilePermissionError", ["requiredPermission", "currentPermissions"], FileSystemError);

// ============================================
// Validation Errors
// ============================================

/**
 * Input validation errors
 */
export const ValidationError = createCustomError<
  {
    field: string;
    value: unknown;
    constraint: string;
  },
  typeof ContainerError
>("ValidationError", ["field", "value", "constraint"], ContainerError);

// ============================================
// Helper Functions
// ============================================

/**
 * Create configuration error with helpful message
 */
export function createConfigError(
  configKey: string,
  providedValue: unknown,
  expectedType: string,
  additionalContext?: string,
) {
  return new ConfigurationError({
    message: `Invalid configuration for '${configKey}': expected ${expectedType}, got ${typeof providedValue}${additionalContext ? `. ${additionalContext}` : ""}`,
    cause: {
      configKey,
      providedValue,
      expectedType,
      operation: "configuration",
    },
  });
}

/**
 * Create container not started error with helpful message
 */
export function createNotStartedError(containerName: string, attemptedOperation: string) {
  return new ContainerNotStartedError({
    message: `Cannot ${attemptedOperation}: container '${containerName}' has not been started. Call .start() first.`,
    cause: {
      containerName,
      attemptedOperation,
      currentState: "stopped",
      expectedState: "running",
    },
  });
}

/**
 * Create Docker not available error with helpful message
 */
export function createDockerNotAvailableError(socketPath?: string) {
  return new DockerNotAvailableError({
    message: `Docker daemon is not accessible${socketPath ? ` at ${socketPath}` : ""}. Make sure Docker is running.`,
    cause: {
      dockerHost: process.env.DOCKER_HOST,
      socketPath: socketPath || "/var/run/docker.sock",
      reason: "Connection refused or socket not found",
      suggestion: "Start Docker Desktop or run: sudo systemctl start docker",
    },
  });
}

/**
 * Create image not found error with helpful message
 */
export function createImageNotFoundError(imageName: string, tag: string = "latest") {
  return new ImageNotFoundError({
    message: `Image '${imageName}:${tag}' not found locally or in registry`,
    cause: {
      imageName,
      tag,
      searchedIn: ["local cache", "Docker Hub"],
      suggestion: `Pull the image manually: docker pull ${imageName}:${tag}`,
    },
  });
}

/**
 * Create timeout error with helpful message
 */
export function createTimeoutError(
  containerName: string,
  timeoutMs: number,
  waitStrategy?: string,
) {
  return new ContainerTimeoutError({
    message: `Container '${containerName}' failed to start within ${timeoutMs}ms${waitStrategy ? ` using ${waitStrategy}` : ""}`,
    cause: {
      containerName,
      timeoutMs,
      waitStrategy,
      currentState: "starting",
      expectedState: "running",
      operation: "start",
    },
  });
}

/**
 * Helper object to access all error creators
 *
 * - CONFIG: Configuration errors
 * - NOT_STARTED: Container not started errors
 * - DOCKER_NOT_AVAILABLE: Docker daemon not available errors
 * - IMAGE_NOT_FOUND: Image not found errors
 * - TIMEOUT: Container timeout errors
 *
 */
export const Errors = {
  CONFIG: createConfigError,
  NOT_STARTED: createNotStartedError,
  DOCKER_NOT_AVAILABLE: createDockerNotAvailableError,
  IMAGE_NOT_FOUND: createImageNotFoundError,
  TIMEOUT: createTimeoutError,
} as const satisfies Record<string, (...args: any[]) => Error>;
