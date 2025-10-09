import { useContainer, useCompose } from "./index";
import { Wait } from "testcontainers";
import { BlobServiceClient } from "@azure/storage-blob";

// ============================================
// Example 1: Simple Standalone Container
// ============================================
async function example1_standalone() {
  console.log("Example 1: Standalone Redis Container");

  const { host, ports, cleanup } = await useContainer("redis:latest")
    .withPort(6379)
    .withEnv({ REDIS_PASSWORD: "mypassword" })
    .start();

  console.log(`Redis running at ${host}:${ports[6379]}`);

  // Your test code here...

  await cleanup();
}
// example1_standalone();
// ============================================
// Example 2: Multiple Containers with Network
// ============================================
async function example2_network() {
  console.log("Example 2: Multiple Containers with Network");

  const postgres = await useContainer("postgres:14")
    .withPort(5432)
    .withEnv({
      POSTGRES_DB: "myapp",
      POSTGRES_USER: "user",
      POSTGRES_PASSWORD: "pass",
    })
    .start();

  const redis = await useContainer("redis:latest").withPort(6379).start();

  console.log(`Postgres: ${postgres.host}:${postgres.ports[5432]}`);
  console.log(`Redis: ${redis.host}:${redis.ports[6379]}`);

  // Run your tests...

  await redis.cleanup();
  await postgres.cleanup();
}

// ============================================
// Example 3: Docker Compose (The Best One!)
// ============================================

// Define your service types
interface MyServices {
  postgres: {
    host: string;
    port: number;
    database: string;
  };
  redis: {
    host: string;
    port: number;
  };
}

// Create simple connectors (or use BaseContainerService for more complex ones)
const postgresConnector = {
  getName: () => "postgres",
  start: async () => {},
  stop: async () => {},
  getConnectionInfo: () => ({
    host: "localhost",
    port: 5432,
    database: "myapp",
  }),
  initializeFromContainer: (container: any) => {
    // Initialize connection from started container
  },
};

const redisConnector = {
  getName: () => "redis",
  start: async () => {},
  stop: async () => {},
  getConnectionInfo: () => ({
    host: "localhost",
    port: 6379,
  }),
  initializeFromContainer: (container: any) => {
    // Initialize connection from started container
  },
};

async function example3_compose() {
  console.log("Example 3: Docker Compose");

  const { connectionInfo, network, cleanup } = await useCompose<MyServices>(
    "./",
    "docker-compose.yml",
  )
    .withService("postgres", postgresConnector)
    .withService("redis", redisConnector)
    .withEnv({ LOG_LEVEL: "debug" })
    .withBuild()
    .start();

  // Fully typed connection info!
  console.log(`Postgres: ${connectionInfo.postgres.host}:${connectionInfo.postgres.port}`);
  console.log(`Redis: ${connectionInfo.redis.host}:${connectionInfo.redis.port}`);
  console.log(`Network: ${network}`);

  // Run your integration tests...

  await cleanup();
}

// ============================================
// Example 4: Real World - Azurite (Azure Storage Emulator)
// ============================================
// async function example4_azurite() {
// 	console.log("Example 4: Azurite Storage Emulator");

// 	const { host, ports, cleanup } = await useContainer(
// 		"mcr.microsoft.com/azure-storage/azurite",
// 	)
// 		.withPorts(10000, 10001, 10002) // Blob, Queue, Table
// 		.withWaitStrategy(Wait.forLogMessage("Azurite Blob service is starting"))
// 		.start();

// 	// Create Azure Storage client
// 	const blobServiceClient = BlobServiceClient.fromConnectionString(
// 		`DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://${host}:${ports[10000]}/devstoreaccount1`,
// 	);

// 	// Test blob storage
// 	const containerClient = blobServiceClient.getContainerClient("test-container");
// 	await containerClient.create();

// 	console.log("Azurite container created successfully!");

// 	await cleanup();
// }

// ============================================
// Example 5: Custom Wait Strategy
// ============================================
async function example5_waitStrategy() {
  console.log("Example 5: Custom Wait Strategy");

  const { host, ports, cleanup } = await useContainer("nginx:latest")
    .withPort(80)
    .withWaitStrategy(Wait.forHttp("/", 80).forStatusCode(200).withStartupTimeout(30000))
    .start();

  console.log(`Nginx ready at http://${host}:${ports[80]}`);

  await cleanup();
}

// ============================================
// Example 6: Container Reuse (Faster Tests!)
// ============================================
async function example6_reuse() {
  console.log("Example 6: Container Reuse");

  // First run: starts container
  const first = await useContainer("redis:latest")
    .withPort(6379)
    .withReuse() // This container will be reused!
    .start();

  console.log("First container started");
  await first.cleanup(); // Doesn't actually remove it

  // Second run: reuses the same container (much faster!)
  const second = await useContainer("redis:latest").withPort(6379).withReuse().start();

  console.log("Second container reused!");
  await second.cleanup(); // Now it can be removed
}

// ============================================
// Run all examples
// ============================================
async function runAllExamples() {
  try {
    const examples = [
      { fn: example1_standalone, name: "Example 1: Standalone Redis Container" },
      { fn: example2_network, name: "Example 2: Multiple Containers with Network" },
      // { fn: example3_compose, name: "Example 3: Docker Compose" }, // Requires docker-compose.yml
      // { fn: example4_azurite, name: "Example 4: Azurite Storage Emulator" },
      { fn: example5_waitStrategy, name: "Example 5: Custom Wait Strategy" },
      { fn: example6_reuse, name: "Example 6: Container Reuse" },
    ];

    for (const { fn, name } of examples) {
      const start = performance.now();
      console.log(`Starting: ${name}`);
      await fn();
      const end = performance.now();
      console.log(`Completed: ${name} in ${(end - start).toFixed(2)} ms`);
      console.log("\n---\n");
    }
  } catch (error) {
    console.error("Error running examples:", error);
  }
}

// Uncomment to run:
runAllExamples();
