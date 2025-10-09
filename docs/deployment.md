# Deployment Guide

How to deploy services that use containers for ephemeral workloads.

## Critical Requirement: Docker Daemon Access

**This library requires a Docker daemon.** This means:

✅ **Can Deploy On:**

- Virtual Machines (EC2, Droplets, Compute Engine, etc.)
- Kubernetes clusters
- Container-optimized VMs
- Self-hosted servers
- CI/CD runners
- Managed container platforms

❌ **Cannot Deploy On:**

- AWS Lambda / Google Cloud Functions / Azure Functions
- Cloudflare Workers / Deno Deploy / Vercel Edge
- Any serverless/edge runtime without Docker access

## Why Serverless Doesn't Work

Serverless environments are **sandboxed** - they can't run Docker:

```typescript
// ❌ This will fail on Lambda
export const handler = async (event) => {
  const container = await useContainer('python:3.11').start();
  // Error: Cannot connect to Docker daemon
};
```

**Why?**

- No Docker daemon in serverless runtimes
- Security isolation prevents nested containers
- Ephemeral nature doesn't persist daemon

**Workaround:** Use serverless for the API, delegate to a container service:

```typescript
// Lambda function
export const handler = async (event) => {
  // ✅ Call your container service
  const response = await fetch('https://your-container-service.com/execute', {
    method: 'POST',
    body: JSON.stringify({ code: event.code })
  });
  return await response.json();
};

// Your container service (on EC2/K8s)
app.post('/execute', async (req, res) => {
  const { exec, cleanup } = await useContainer('python:3.11').start();
  // This works because EC2 has Docker!
});
```

---

## Deployment Architectures

### Architecture 1: Simple VM (Easiest)

**Best for:** Small scale, prototypes, simple services

```
┌─────────────────────────────────┐
│      Your VM (EC2/Droplet)      │
│                                  │
│  ┌────────────────────────────┐ │
│  │   Your Node.js Service     │ │
│  │   (Express/Fastify API)    │ │
│  └─────────────┬──────────────┘ │
│                │                 │
│  ┌─────────────▼──────────────┐ │
│  │      Docker Daemon         │ │
│  └─────────────┬──────────────┘ │
│                │                 │
│    Ephemeral Containers         │
│    (start → execute → cleanup)  │
└─────────────────────────────────┘
```

**Setup:**

```bash
# 1. Provision VM
# AWS EC2, DigitalOcean Droplet, Hetzner, etc.

# 2. Install Docker
sudo apt-get update
sudo apt-get install -y docker.io

# 3. Add your user to docker group
sudo usermod -aG docker $USER

# 4. Deploy your app
git clone your-repo
cd your-repo
npm install
npm start
```

**Code example:**

```typescript
// server.js
import express from 'express';
import { useContainer } from '@fuzzy-street/dockhand';

const app = express();
app.use(express.json());

app.post('/execute', async (req, res) => {
  const { code, language } = req.body;
  
  const { exec, cleanup } = await useContainer(`${language}:latest`)
    .withCopyContent([{ content: code, target: '/script' }])
    .withSandboxMode({ 
      network: 'none',
      memory: 0.5,
      timeout: 30000
    })
    .start();

  try {
    const result = await exec([language, '/script']);
    res.json({ success: true, output: result.output });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await cleanup();
  }
});

app.listen(3000);
```

**Pros:**

- Simple to understand
- Easy to debug
- Low operational complexity
- Cost-effective for small scale

**Cons:**

- Single point of failure
- Limited scalability
- Manual scaling

**When to use:**

- Prototypes and MVPs
- Low traffic services (<100 req/min)
- Internal tools
- Development/staging environments

---

### Architecture 2: VM with Queue (Better)

**Best for:** Medium scale, burst traffic, reliability

```
┌─────────────┐      ┌──────────────────────────┐
│   API VM    │      │     Worker VM(s)         │
│             │      │                           │
│  ┌────────┐ │      │  ┌─────────────────────┐ │
│  │  API   │ │      │  │  Worker Process 1   │ │
│  │ Server │ │      │  │  (pulls from queue) │ │
│  └───┬────┘ │      │  └──────────┬──────────┘ │
│      │      │      │             │             │
│      │      │      │  ┌──────────▼──────────┐ │
│      │      │      │  │   Docker Daemon     │ │
│      │      │      │  └─────────────────────┘ │
└──────┼──────┘      │                           │
       │             │  ┌─────────────────────┐ │
       │             │  │  Worker Process 2   │ │
       │             │  └─────────────────────┘ │
       │             └───────────────────────────┘
       │
    ┌──▼──────┐
    │  Queue  │
    │ (Redis, │
    │  SQS)   │
    └─────────┘
```

**Setup:**

```typescript
// api-server.js
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis({ host: 'redis-host' });
const queue = new Queue('code-execution', { connection });

app.post('/execute', async (req, res) => {
  const job = await queue.add('execute-code', {
    code: req.body.code,
    language: req.body.language
  });
  
  res.json({ jobId: job.id });
});

app.get('/result/:jobId', async (req, res) => {
  const job = await queue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  if (await job.isCompleted()) {
    res.json({ status: 'completed', result: job.returnvalue });
  } else {
    res.json({ status: 'pending' });
  }
});
```

```typescript
// worker.js
import { Worker } from 'bullmq';
import { useContainer } from '@fuzzy-street/dockhand';

const worker = new Worker('code-execution', async (job) => {
  const { code, language } = job.data;
  
  const { exec, cleanup } = await useContainer(`${language}:latest`)
    .withCopyContent([{ content: code, target: '/script' }])
    .withSandboxMode({ network: 'none' })
    .start();

  try {
    const result = await exec([language, '/script']);
    return { output: result.output, exitCode: result.exitCode };
  } finally {
    await cleanup();
  }
}, { connection });

console.log('Worker started');
```

**Deploy:**

```bash
# API server (doesn't need Docker!)
pm2 start api-server.js

# Worker server(s) (needs Docker)
pm2 start worker.js -i 4  # 4 worker processes
```

**Pros:**

- Separates API from execution
- Can scale workers independently
- Handles burst traffic
- More resilient (queue persists jobs)
- Workers can be added/removed dynamically

**Cons:**

- More complex setup
- Need to manage queue infrastructure
- Async execution (not immediate response)

**When to use:**

- Medium traffic (100-10k req/min)
- Burst workloads
- Long-running executions
- Need reliability/retries

---

### Architecture 3: Kubernetes (Production Scale)

**Best for:** High scale, multi-tenant, enterprise

```
┌─────────────────────────────────────────────────┐
│              Kubernetes Cluster                  │
│                                                  │
│  ┌────────────────┐      ┌──────────────────┐  │
│  │  API Pods      │      │  Worker Pods     │  │
│  │  (Deployment)  │      │  (Deployment)    │  │
│  │                │      │                   │  │
│  │  No Docker     │      │  DinD or         │  │
│  │  needed        │      │  Host Docker     │  │
│  └───────┬────────┘      └──────────────────┘  │
│          │                                       │
│          │          ┌──────────────────┐        │
│          └─────────▶│  Redis/Queue     │        │
│                     │  (StatefulSet)   │        │
│                     └──────────────────┘        │
└─────────────────────────────────────────────────┘
```

**Two approaches:**

#### Option A: Docker-in-Docker (DinD)

```yaml
# worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: container-worker
spec:
  replicas: 5
  template:
    spec:
      containers:
      - name: worker
        image: your-worker:latest
        volumeMounts:
        - name: docker-sock
          mountPath: /var/run/docker.sock
      - name: dind
        image: docker:dind
        securityContext:
          privileged: true
      volumes:
      - name: docker-sock
        emptyDir: {}
```

**Pros:** Isolated Docker daemon per pod  
**Cons:** Requires privileged containers (security concern)

#### Option B: Host Docker Socket

```yaml
# worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: container-worker
spec:
  replicas: 5
  template:
    spec:
      containers:
      - name: worker
        image: your-worker:latest
        volumeMounts:
        - name: docker-sock
          mountPath: /var/run/docker.sock
      volumes:
      - name: docker-sock
        hostPath:
          path: /var/run/docker.sock
          type: Socket
```

**Pros:** Simple, no privileged containers  
**Cons:** Shares host Docker (all pods use same daemon)

**Deployment:**

```bash
# Build image
docker build -t your-registry/worker:v1.0 .
docker push your-registry/worker:v1.0

# Deploy to K8s
kubectl apply -f api-deployment.yaml
kubectl apply -f worker-deployment.yaml
kubectl apply -f redis-statefulset.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml
```

**Pros:**

- Massive scale (1000s of workers)
- Auto-scaling (HPA)
- Self-healing
- Rolling updates
- Multi-cloud ready

**Cons:**

- Complex to set up
- Need K8s expertise
- More expensive (cluster overhead)
- Security considerations (Docker socket access)

**When to use:**

- High traffic (>10k req/min)
- Enterprise/production workloads
- Multi-tenant platforms
- Need auto-scaling
- Already using Kubernetes

---

### Architecture 4: Managed Platforms

**Best for:** Don't want to manage infrastructure

#### Modal / Replicate / Fly.io

These platforms handle Docker for you:

```python
# Modal example - they manage containers
import modal

stub = modal.Stub()

@stub.function(image=modal.Image.debian_slim().pip_install("requests"))
def my_function(code: str):
    # Modal handles the container lifecycle
    exec(code)
```

**Pros:**

- Zero infrastructure management
- Built-in scaling
- Pay per execution
- Optimized for this use case

**Cons:**

- Vendor lock-in
- Less control
- Can be expensive at scale

---

## Security Considerations

### 1. Docker Socket Access

**Problem:** Mounting Docker socket gives root access to host

```yaml
# ⚠️ This is dangerous
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

**Why it's risky:**

- Container can start privileged containers
- Can mount host filesystem
- Can escape container sandbox

**Mitigations:**

```typescript
// Limit what containers can do
.withSandboxMode({
  network: 'none',
  dropCapabilities: true,
  readOnlyRoot: true
})

// Use resource limits
.withResources(0.5, 1)  // Max 500MB RAM, 1 CPU

// Timeout everything
.withStartupTimeout(30000)
```

**Better:** Use Docker-in-Docker for isolation:

```yaml
# Each worker gets its own Docker daemon
- name: dind
  image: docker:dind
  securityContext:
    privileged: true  # Still privileged, but isolated
```

### 2. Image Security

**Pull from trusted registries:**

```typescript
// ✅ Official images
useContainer('python:3.11-alpine')

// ⚠️ Random DockerHub images
useContainer('random-user/sketchy-image')  // Might be malicious!
```

**Use image scanning:**

```bash
# Scan images before use
docker scan python:3.11-alpine

# Or use Trivy
trivy image python:3.11-alpine
```

**Pin versions:**

```typescript
// ✅ Specific, immutable version
useContainer('python:3.11.6-alpine@sha256:abc123...')

// ❌ Latest can change under you
useContainer('python:latest')
```

### 3. Network Isolation

**Always sandbox untrusted code:**

```typescript
// ✅ Good - no network access
.withSandboxMode({ network: 'none' })

// ⚠️ Risky - can call any external service
.withSandboxMode({ network: 'full' })

// ✅ Better - allowlist only
.withSandboxMode({
  network: 'allowlist',
  allowedDomains: ['api.openai.com']
})
```

### 4. Resource Exhaustion

**Prevent resource bombing:**

```typescript
// ✅ Always set limits
.withResources(
  0.5,    // 500MB max RAM
  1       // 1 CPU core max
)
.withStartupTimeout(30000)  // 30 second max

// ❌ Without limits, user can:
// - Fork bomb (create 1000s of processes)
// - Fill disk (write GBs of data)
// - Use all RAM (crash the host)
```

**Monitor resource usage:**

```typescript
// Track container stats
const stats = await container.container.stats();
console.log('Memory:', stats.memory_stats.usage);
console.log('CPU:', stats.cpu_stats.cpu_usage.total_usage);
```

---

## Scaling Strategies

### Vertical Scaling (Bigger Machines)

**Pros:** Simple  
**Cons:** Expensive, limited

```bash
# AWS EC2
t3.medium  → t3.xlarge  → t3.2xlarge
2 vCPU      4 vCPU        8 vCPU
4GB RAM     16GB RAM      32GB RAM
```

**When to use:** Up to ~50-100 concurrent containers

### Horizontal Scaling (More Machines)

**Pros:** Unlimited scale, cheaper  
**Cons:** Need orchestration

```bash
# Add more worker VMs
worker-1: 4 CPU, 8GB RAM
worker-2: 4 CPU, 8GB RAM
worker-3: 4 CPU, 8GB RAM
# ... scale to 100s
```

**Implementation:**

```typescript
// All workers pull from same queue
const worker = new Worker('code-execution', processJob, { connection });
```

**Auto-scaling:**

```yaml
# Kubernetes HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: worker-hpa
spec:
  scaleTargetRef:
    kind: Deployment
    name: container-worker
  minReplicas: 2
  maxReplicas: 50
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Hybrid: Spot Instances + Queue

**Best cost optimization:**

```
┌────────────┐
│ On-Demand  │  Always running, handle baseline
│ Workers    │
│ (2-3 VMs)  │
└─────┬──────┘
      │
      │  ┌──────────┐
      └─▶│  Queue   │
         └────┬─────┘
              │
      ┌───────▼──────┐
      │ Spot/Preempt │  Scale up for bursts, save 70%
      │ Workers      │
      │ (0-50 VMs)   │
      └──────────────┘
```

---

## Monitoring & Observability

### Key Metrics to Track

```typescript
import { Counter, Histogram } from 'prom-client';

const containerStarts = new Counter({
  name: 'containers_started_total',
  help: 'Total containers started'
});

const executionDuration = new Histogram({
  name: 'execution_duration_seconds',
  help: 'Execution time',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
});

app.post('/execute', async (req, res) => {
  containerStarts.inc();
  const start = Date.now();
  
  try {
    const { exec, cleanup } = await useContainer('python').start();
    const result = await exec(['python', 'script.py']);
    await cleanup();
    
    executionDuration.observe((Date.now() - start) / 1000);
    res.json(result);
  } catch (error) {
    // Track errors
  }
});
```

### What to Monitor

1. **Container metrics:**
   - Start time
   - Execution time
   - Memory usage
   - CPU usage
   - Cleanup success rate

2. **Queue metrics (if using):**
   - Queue depth
   - Wait time
   - Processing rate
   - Failed jobs

3. **System metrics:**
   - Docker daemon health
   - Disk space (images pile up!)
   - Network bandwidth
   - Host CPU/RAM

### Logging

```typescript
// Structured logging
const logger = winston.createLogger({
  format: winston.format.json(),
  defaultMeta: { service: 'container-executor' }
});

app.post('/execute', async (req, res) => {
  const requestId = crypto.randomUUID();
  
  logger.info('Starting execution', { 
    requestId,
    language: req.body.language,
    codeLength: req.body.code.length
  });
  
  try {
    const { exec, cleanup } = await useContainer('python').start();
    
    logger.info('Container started', { requestId, containerId: container.getId() });
    
    const result = await exec(['python', 'script.py']);
    
    logger.info('Execution completed', { 
      requestId, 
      exitCode: result.exitCode,
      duration: Date.now() - start
    });
    
    await cleanup();
  } catch (error) {
    logger.error('Execution failed', { 
      requestId, 
      error: error.message,
      stack: error.stack
    });
  }
});
```

---

## Image Caching: Your Secret Performance Weapon

**Docker automatically caches images on the host machine.** This is CRITICAL for performance:

### How It Works

```typescript
// First execution - downloads image
const run1 = await useContainer('python:3.11-alpine').start();
// ⏱️ Takes ~30 seconds (downloading 50MB)

await run1.cleanup();

// Second execution - uses cached image
const run2 = await useContainer('python:3.11-alpine').start();
// ⚡ Takes ~2 seconds (image already on disk!)
```

**What happens:**

1. First `useContainer('python:3.11')` → Docker pulls from Docker Hub
2. Image saved to local cache (`/var/lib/docker/`)
3. All subsequent uses = instant (reads from cache)
4. **All containers share the same cached images**

### Layer Caching (Even Better!)

Docker images are built in layers. Related images share layers:

```typescript
// Pull Alpine base (5MB)
await useContainer('alpine:latest').start();

// These share the Alpine layer!
await useContainer('python:3.11-alpine').start();  // +45MB (Python on top of Alpine)
await useContainer('node:18-alpine').start();      // +50MB (Node on top of Alpine)
await useContainer('rust:1.75-alpine').start();    // +200MB (Rust on top of Alpine)

// Total downloaded: ~300MB, not 300MB × 4
// They all share the 5MB Alpine base layer!
```

**Example:**

```bash
$ docker images
REPOSITORY          TAG        SIZE
python              3.11       1.01GB   # ← Full Python image
python              3.11-alpine 52.5MB  # ← Alpine variant (way smaller!)
alpine              latest      7.05MB  # ← Base layer (shared!)
```

### Performance Impact

**First container (cold start):**

```
Pull image:      30 seconds
Start container:  2 seconds
Total:           32 seconds ⏱️
```

**Subsequent containers (warm start):**

```
Pull image:       0 seconds (cached!)
Start container:  2 seconds
Total:            2 seconds ⚡
```

**16x faster!** 🚀

### Production Optimization: Pre-Pull Images

Don't let users wait for image pulls. Pre-pull during deployment:

```bash
#!/bin/bash
# deploy.sh

echo "Pre-pulling images..."
docker pull python:3.11-alpine
docker pull node:18-alpine
docker pull rust:1.75-alpine

echo "Starting application..."
npm start
```

**Or in your startup code:**

```typescript
// server.js
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function prePullImages() {
  const images = [
    'python:3.11-alpine',
    'node:18-alpine',
    'rust:1.75-alpine'
  ];

  console.log('Pre-pulling images...');
  
  for (const image of images) {
    try {
      await execAsync(`docker pull ${image}`);
      console.log(`✓ Pulled ${image}`);
    } catch (error) {
      console.error(`✗ Failed to pull ${image}:`, error.message);
    }
  }
  
  console.log('All images ready!');
}

// Pre-pull on startup
prePullImages().then(() => {
  app.listen(3000, () => {
    console.log('Server ready');
  });
});
```

**Systemd service example:**

```ini
# /etc/systemd/system/container-executor.service
[Unit]
Description=Container Executor Service
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=app
WorkingDirectory=/app

# Pre-pull images before starting
ExecStartPre=/usr/bin/docker pull python:3.11-alpine
ExecStartPre=/usr/bin/docker pull node:18-alpine

ExecStart=/usr/bin/node server.js

[Install]
WantedBy=multi-user.target
```

### Kubernetes: ImagePullPolicy

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
spec:
  template:
    spec:
      # Pre-pull images
      initContainers:
      - name: image-puller
        image: docker:latest
        command:
        - sh
        - -c
        - |
          docker pull python:3.11-alpine
          docker pull node:18-alpine
      
      containers:
      - name: worker
        image: your-worker:latest
        imagePullPolicy: IfNotPresent  # ← Use cached images!
```

### Cache Management

**Check cached images:**

```bash
docker images
```

**See how much space they use:**

```bash
docker system df

# Example output:
# Images          25      5       2.5GB     1.2GB (48%)
# Containers      10      2       100MB     50MB (50%)
# Local Volumes   5       1       500MB     200MB (40%)
```

**Clean up old images:**

```bash
# Remove unused images
docker image prune -a

# Remove everything (careful!)
docker system prune -a --volumes
```

**Automated cleanup (cron):**

```bash
# /etc/cron.daily/docker-cleanup
#!/bin/bash

# Keep images from last 7 days
docker image prune -a --filter "until=168h" -f

# Remove dangling images
docker image prune -f
```

### Multi-Region Deployments

Cache images in your container registry:

```bash
# Build once
docker build -t my-agent:v1.0 .

# Push to your registry
docker tag my-agent:v1.0 myregistry.io/my-agent:v1.0
docker push myregistry.io/my-agent:v1.0

# Now all your servers pull from your registry (faster!)
# us-east-1, eu-west-1, ap-south-1 all cache locally
```

### Image Size = Pull Time

**Optimize for size:**

```dockerfile
# ❌ Large image (1GB+)
FROM python:3.11

# ✅ Smaller image (~50MB)
FROM python:3.11-alpine

# ✅ Minimal image (~10MB base + your code)
FROM alpine:latest
RUN apk add --no-cache python3
```

**Size comparison:**

| Image | Size | Pull Time (100Mbps) | Cached Start |
|-------|------|---------------------|--------------|
| `python:3.11` | 1.01GB | ~80 seconds | 2 seconds |
| `python:3.11-slim` | 183MB | ~15 seconds | 2 seconds |
| `python:3.11-alpine` | 52MB | ~4 seconds | 2 seconds |

**After caching, all start in ~2 seconds!**

### Best Practices

**1. Use specific tags:**

```typescript
// ✅ Good - specific version, cached forever
useContainer('python:3.11.6-alpine')

// ⚠️ Risky - :latest changes, cache invalidates
useContainer('python:latest')
```

**2. Use alpine variants:**

```typescript
// ✅ Small, fast to pull
useContainer('python:3.11-alpine')    // 52MB
useContainer('node:18-alpine')        // 178MB
useContainer('rust:1.75-alpine')      // 400MB

// ❌ Large, slow to pull
useContainer('python:3.11')           // 1GB
useContainer('node:18')               // 1.1GB
```

**3. Warm the cache on deployment:**

```typescript
// In your deployment pipeline
await execAsync('docker pull python:3.11-alpine');
await execAsync('docker pull node:18-alpine');
```

**4. Monitor cache size:**

```bash
# Alert if cache > 50GB
CACHE_SIZE=$(docker system df --format "{{.Size}}" | head -1)
if [ "$CACHE_SIZE" -gt 50GB ]; then
  echo "Warning: Docker cache is large!"
fi
```

### The Performance Story

**Without pre-pulling (cold start):**

```
User request → Pull image (30s) → Start container (2s) → Execute (5s)
Total: 37 seconds 😴
```

**With pre-pulling (warm start):**

```
User request → Start container (2s) → Execute (5s)
Total: 7 seconds ⚡
```

**With container reuse (hot path):**

```
User request → Execute (5s)
Total: 5 seconds 🔥
```

### Real-World Example

```typescript
// Production service with image warming
import { useContainer } from '@fuzzy-street/dockhand';

class CodeExecutor {
  private imageCache = new Set<string>();

  async warmCache(images: string[]) {
    console.log('Warming image cache...');
    
    for (const image of images) {
      try {
        // Pull the image (Docker caches it)
        await execAsync(`docker pull ${image}`);
        this.imageCache.add(image);
        console.log(`✓ ${image} cached`);
      } catch (error) {
        console.error(`✗ Failed to cache ${image}`);
      }
    }
    
    console.log(`Cache ready with ${this.imageCache.size} images`);
  }

  async execute(code: string, language: string) {
    const image = `${language}:alpine`;
    
    // Verify image is cached
    if (!this.imageCache.has(image)) {
      console.warn(`Image ${image} not in cache, pulling now...`);
      await execAsync(`docker pull ${image}`);
      this.imageCache.add(image);
    }

    // Now start container (instant because cached!)
    const { exec, cleanup } = await useContainer(image)
      .withCopyContent([{ content: code, target: '/script' }])
      .start();

    try {
      return await exec([language, '/script']);
    } finally {
      await cleanup();
    }
  }
}

// Startup
const executor = new CodeExecutor();

await executor.warmCache([
  'python:3.11-alpine',
  'node:18-alpine',
  'rust:1.75-alpine'
]);

// Now all executions are fast!
app.listen(3000);
```

### Summary

**Image caching is your secret weapon:**

- ✅ First pull: One-time cost
- ✅ Subsequent uses: Instant
- ✅ Shared across all containers
- ✅ Layer deduplication saves space
- ✅ Pre-pull during deployment for best UX

**Key metrics:**

- Cold start: ~30 seconds (pulling)
- Warm start: ~2 seconds (cached)
- Hot path: ~0 seconds (reused container)

**Your users will think your service is blazing fast** because images are cached! 🚀

## Cost Optimization

### 1. Image Layer Caching

**Pre-pull common images:**

```bash
# On each worker, pre-pull images at startup
docker pull python:3.11-alpine
docker pull node:18-alpine
docker pull rust:1.75-alpine

# Or in your startup script
docker images | grep -q python:3.11-alpine || docker pull python:3.11-alpine
```

**Use multi-stage builds:**

```dockerfile
FROM node:18 AS builder
# ... build stuff ...

FROM node:18-alpine  # 10x smaller!
COPY --from=builder /app/dist /app
```

### 2. Container Reuse

```typescript
// Enable container reuse for faster tests
.withReuse()  // Reuses existing container if config matches
```

**Note:** Only for development/testing, not production!

### 3. Resource Right-Sizing

```typescript
// Don't over-provision
.withResources(
  0.25,  // 250MB is plenty for most scripts
  0.5    // Half a CPU core
)
```

**Cost example:**

- 1GB RAM, 1 CPU: $0.05/hour
- 0.25GB RAM, 0.5 CPU: $0.01/hour
- 5x cheaper!

### 4. Cleanup Strategy

```typescript
// Always cleanup!
try {
  const result = await exec(['python', 'script.py']);
  return result;
} finally {
  await cleanup();  // ← This is critical!
}
```

**Without cleanup:** Containers pile up, eat disk space, cost money

**Automatic cleanup (cron):**

```bash
# Clean up stopped containers daily
0 2 * * * docker container prune -f

# Remove unused images weekly
0 3 * * 0 docker image prune -a -f
```

---

## Example: Complete Production Service

Here's a complete example of a production code execution service:

```typescript
// server.js - Production-ready service
import express from 'express';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { useContainer } from '@fuzzy-street/dockhand';
import winston from 'winston';
import { Counter, Histogram, register } from 'prom-client';

// Metrics
const executionsTotal = new Counter({
  name: 'executions_total',
  help: 'Total executions',
  labelNames: ['language', 'status']
});

const executionDuration = new Histogram({
  name: 'execution_duration_seconds',
  help: 'Execution duration',
  labelNames: ['language']
});

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'execution.log' })
  ]
});

// Queue
const connection = new Redis(process.env.REDIS_URL);
const queue = new Queue('code-execution', { connection });

// API Server
const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/execute', async (req, res) => {
  const { code, language, timeout = 30000 } = req.body;
  
  // Validation
  if (!code || !language) {
    return res.status(400).json({ error: 'Missing code or language' });
  }
  
  if (code.length > 100000) {
    return res.status(400).json({ error: 'Code too large' });
  }
  
  // Add to queue
  const job = await queue.add('execute', {
    code,
    language,
    timeout
  }, {
    removeOnComplete: 100,  // Keep last 100
    removeOnFail: 1000      // Keep last 1000 failures
  });
  
  logger.info('Job queued', { jobId: job.id, language });
  
  res.json({ jobId: job.id });
});

app.get('/result/:jobId', async (req, res) => {
  const job = await queue.getJob(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const state = await job.getState();
  
  if (state === 'completed') {
    res.json({ status: 'completed', result: job.returnvalue });
  } else if (state === 'failed') {
    res.json({ status: 'failed', error: job.failedReason });
  } else {
    res.json({ status: 'pending' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(3000, () => {
  logger.info('API server started on port 3000');
});

// Worker Process
const worker = new Worker('code-execution', async (job) => {
  const { code, language, timeout } = job.data;
  const startTime = Date.now();
  
  logger.info('Starting execution', { 
    jobId: job.id, 
    language 
  });
  
  try {
    const { exec, cleanup } = await useContainer(`${language}:latest`)
      .withCopyContent([{ 
        content: code, 
        target: '/script' 
      }])
      .withSandboxMode({
        network: 'none',
        memory: 0.5,
        timeout
      })
      .start();

    const result = await exec([language, '/script']);
    
    await cleanup();
    
    const duration = (Date.now() - startTime) / 1000;
    executionDuration.observe({ language }, duration);
    executionsTotal.inc({ language, status: 'success' });
    
    logger.info('Execution completed', { 
      jobId: job.id, 
      duration,
      exitCode: result.exitCode
    });
    
    return {
      output: result.output,
      exitCode: result.exitCode,
      duration
    };
    
  } catch (error) {
    executionsTotal.inc({ language, status: 'error' });
    
    logger.error('Execution failed', { 
      jobId: job.id, 
      error: error.message 
    });
    
    throw error;
  }
}, {
  connection,
  concurrency: 4  // 4 concurrent executions
});

worker.on('completed', (job) => {
  logger.info('Job completed', { jobId: job.id });
});

worker.on('failed', (job, err) => {
  logger.error('Job failed', { 
    jobId: job?.id, 
    error: err.message 
  });
});

logger.info('Worker started');
```

**Deploy:**

```bash
# API server (can run anywhere)
pm2 start server.js --name api

# Workers (need Docker access)
pm2 start server.js --name worker-1
pm2 start server.js --name worker-2
```

---

## Summary

**Where to deploy:**

- ✅ VMs (AWS EC2, DigitalOcean, Hetzner)
- ✅ Kubernetes (EKS, GKE, AKS)
- ✅ Container platforms (Fly.io, Railway)
- ❌ Serverless (Lambda, Vercel Edge)
- ❌ Edge compute (Cloudflare Workers)

**Key requirements:**

- Docker daemon access
- Sufficient resources (CPU, RAM, disk)
- Network connectivity (for pulling images)

**Best practices:**

- Use queues for reliability
- Monitor everything
- Set resource limits
- Always cleanup containers
- Secure the Docker socket
- Use image scanning
- Pre-pull common images

**Scale strategy:**

1. Start: Single VM
2. Grow: VM + queue + workers
3. Scale: Kubernetes with auto-scaling
4. Optimize: Spot instances + queue

Now go build something awesome! 🚀
