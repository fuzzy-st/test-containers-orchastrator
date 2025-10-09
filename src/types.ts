import type {
	StartedDockerComposeEnvironment,
	StartedNetwork,
	StartedTestContainer,
	Wait,
	WaitStrategy,
} from "testcontainers";

export interface BaseRecord {
	[key: string]: unknown;
}

export type PortMapping =
	| number
	| {
			container: number;
			host: number;
	  };

export interface FileConfig {
	source: string;
	target: string;
	mode?: number;
}

// Core container configuration
export interface ContainerConfig {
	// Basic settings
	command?: string[];
	entrypoint?: string[];
	env?: Record<string, string>;
	platform?: string;
	workingDir?: string;
	user?: string;
	labels?: Record<string, string>;

	// Resource settings
	privileged?: boolean;
	resources?: {
		memory?: number; // GB
		cpu?: number; // CPU units
	};
	ulimits?: Record<
		string,
		{
			soft: number;
			hard: number;
		}
	>;
	sharedMemorySize?: number;
	capabilities?: {
		add?: string[];
		drop?: string[];
	};

	// Storage settings
	tmpFs?: Record<string, string>;
	copyFiles?: FileConfig[];
	copyDirectories?: FileConfig[];

	// Network settings
	network?: string; // Name of the network to join
	exposedPorts?: PortMapping[];
	networkMode?: string;
	networkAliases?: string[];
	extraHosts?: Array<{
		host: string;
		ipAddress: string;
	}>;
	ipcMode?: string;

	// Lifecycle
	waitStrategy?: WaitStrategy;
	// pullPolicy?: "always" | "ifNotPresent" | "never"; // Need a custom pull policy for 'ifNotPresent' & 'never'
	pullPolicy?: "alwaysPull" | "never";
	reuse?: boolean;
	defaultLogDriver?: boolean;
}

// Core compose configuration
export interface ComposeConfig {
	env?: Record<string, string>;
	envFile?: string;
	// pullPolicy?: "always" | "ifNotPresent" | "never";
	pullPolicy?: "alwaysPull" | "never";
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

// Service configuration that can be used for both standalone and compose services
export type ServiceConfig = {
	container: ContainerConfig;
} | {
	compose: ComposeConfig;
}


/**
 * Lifecycle interface that all container-based things implement
 */
export interface ContainerLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  isStarted(): boolean;
}

// Base interface that all container services must implement
export interface ContainerService<T extends BaseRecord> extends ContainerLifecycle {
	getName(): string;
	getConnectionInfo(): T;
	getWaitStrategy?(): WaitStrategy;
	getEnvironmentVariables?(): Record<string, string>;
	initializeFromContainer?(container: StartedTestContainer): Promise<void> | void;
}
