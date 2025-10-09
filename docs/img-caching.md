# Image Caching: Why Containers Are Fast

One of the most important (and least understood) performance features of container-based testing.

## The Magic: Automatic Caching

**Docker automatically caches images on your machine.** This is why your second test run is 10-15x faster than the first!

## Visual Example

```
First Test Run:
┌──────────────────────────────────────────────┐
│ useContainer('postgres:14').start()          │
│                                               │
│ Step 1: Check local cache        [✗ NOT FOUND] │
│ Step 2: Pull from Docker Hub     [⏱️ 30 sec]   │
│ Step 3: Save to cache            [✓ SAVED]    │
│ Step 4: Start container          [⏱️ 2 sec]    │
│                                               │
│ Total: 32 seconds                            │
└──────────────────────────────────────────────┘

Second Test Run:
┌──────────────────────────────────────────────┐
│ useContainer('postgres:14').start()          │
│                                               │
│ Step 1: Check local cache        [✓ FOUND!]   │
│ Step 2: Start container          [⏱️ 2 sec]    │
│                                               │
│ Total: 2 seconds ⚡                           │
└──────────────────────────────────────────────┘
```

## Why This Matters

### For Testing

**Your test suite gets progressively faster:**

```bash
# First run (Monday morning)
npm test
# Downloads: postgres, redis, mongodb
# Time: 90 seconds

# All runs for the rest of the week
npm test  # 10 seconds ⚡
npm test  # 10 seconds ⚡
npm test  # 10 seconds ⚡
```

**On CI/CD:**

Most CI systems preserve Docker cache between runs:

```yaml
# GitHub Actions automatically caches Docker images!
- name: Run tests
  run: npm test
  # First run: 90 seconds
  # Subsequent runs: 10 seconds
```

### For Production

**Users never wait for image pulls:**

```typescript
// Your deployment script
async function deploy() {
  console.log('Pre-pulling images...');
  await exec('docker pull python:3.11-alpine');
  await exec('docker pull node:18-alpine');
  console.log('Images cached!');
  
  console.log('Starting service...');
  startServer();
}

// Now all user requests are fast:
// - No image pulling
// - Container starts in ~2 seconds
// - User gets response quickly
```

## How Docker Caching Works

### Image Layers

Docker images are built in **layers**. Each layer is cached independently:

```dockerfile
FROM alpine:latest          # ← Layer 1 (5MB)
RUN apk add python3         # ← Layer 2 (40MB)
COPY requirements.txt .     # ← Layer 3 (1KB)
RUN pip install -r requirements.txt  # ← Layer 4 (50MB)
COPY . .                    # ← Layer 5 (Your code)
```

**When you pull `python:3.11-alpine`:**
- Layer 1 (alpine): Cached and shared with ALL alpine-based images
- Layer 2 (python): Cached and shared with ALL python:3.11 images

**This means:**

```typescript
// Pull alpine base
await useContainer('alpine:latest').start();
// Downloads: 5MB

// Pull Python (built on alpine)
await useContainer('python:3.11-alpine').start();
// Downloads: 45MB (Python layer only, alpine cached!)

// Pull Node (also built on alpine)
await useContainer('node:18-alpine').start();
// Downloads: 50MB (Node layer only, alpine cached!)

// Total downloaded: 100MB
// Without caching: 100MB + 50MB + 55MB = 205MB
// Savings: 50%+
```

## Where Are Images Stored?

```bash
# Linux
/var/lib/docker/overlay2/

# Mac (inside VM)
~/Library/Containers/com.docker.docker/Data/

# Windows (inside VM)
C:\ProgramData\DockerDesktop\
```

**Check what's cached:**

```bash
docker images

# Example output:
REPOSITORY     TAG           SIZE      CREATED
postgres       14            374MB     2 days ago
redis          latest        117MB     3 days ago
python         3.11-alpine   52MB      1 week ago
```

**See total cache size:**

```bash
docker system df

# Example:
TYPE            TOTAL   ACTIVE   SIZE      RECLAIMABLE
Images          15      5        2.5GB     1.8GB (72%)
Containers      20      2        100MB     80MB (80%)
```

## Optimization Strategies

### 1. Pre-Pull Popular Images

**In your test setup:**

```typescript
// test/setup.js
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

before(async function() {
  this.timeout(120000); // 2 minute timeout
  
  console.log('Pre-pulling images...');
  
  await execAsync('docker pull postgres:14');
  await execAsync('docker pull redis:latest');
  await execAsync('docker pull mongodb:7');
  
  console.log('Images ready!');
});
```

**In package.json:**

```json
{
  "scripts": {
    "test:setup": "docker pull postgres:14 && docker pull redis:latest",
    "test": "npm run test:setup && node --test"
  }
}
```

### 2. Use Smaller Images

**Size comparison:**

| Image | Full | Slim | Alpine |
|-------|------|------|--------|
| Python | 1GB | 183MB | **52MB** |
| Node | 1.1GB | 244MB | **178MB** |
| Ruby | 893MB | 172MB | **54MB** |

```typescript
// ❌ Slow to pull (1GB)
useContainer('python:3.11')

// ✅ Fast to pull (52MB)
useContainer('python:3.11-alpine')

// Result: 20x smaller, 20x faster initial pull!
```

### 3. Pin Versions

```typescript
// ❌ Cache invalidates when :latest changes
useContainer('postgres:latest')

// ✅ Cached forever
useContainer('postgres:14.10-alpine')

// ✅ Even better - digest is immutable
useContainer('postgres@sha256:abc123...')
```

### 4. Clean Up Periodically

Images pile up over time:

```bash
# Remove unused images (weekly cron)
docker image prune -a -f

# Remove images older than 7 days
docker image prune -a --filter "until=168h" -f

# Nuclear option (careful!)
docker system prune -a --volumes -f
```

## Performance Benchmarks

Real-world measurements on a typical development machine:

### Initial Pull Times (100 Mbps connection)

| Image | Size | Pull Time | Start Time | Total |
|-------|------|-----------|------------|-------|
| `alpine:latest` | 7MB | 1s | 0.5s | **1.5s** |
| `redis:alpine` | 32MB | 3s | 1s | **4s** |
| `postgres:14-alpine` | 238MB | 20s | 2s | **22s** |
| `python:3.11-alpine` | 52MB | 5s | 2s | **7s** |
| `node:18-alpine` | 178MB | 15s | 2s | **17s** |

### Cached Start Times (All Subsequent Runs)

| Image | Start Time |
|-------|------------|
| `alpine:latest` | **0.5s** ⚡ |
| `redis:alpine` | **1s** ⚡ |
| `postgres:14-alpine` | **2s** ⚡ |
| `python:3.11-alpine` | **2s** ⚡ |
| `node:18-alpine` | **2s** ⚡ |

**Key insight:** After caching, image size doesn't matter! All start in 1-2 seconds.

## CI/CD Caching

### GitHub Actions

```yaml
name: Tests

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      # Docker layer caching (automatic!)
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      
      - name: Cache Docker images
        uses: actions/cache@v3
        with:
          path: /tmp/.buildx-cache
          key: ${{ runner.os }}-buildx-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-buildx-
      
      - name: Run tests
        run: npm test
        # First run: ~60 seconds (downloading images)
        # Subsequent runs: ~10 seconds (cached)
```

### GitLab CI

```yaml
test:
  image: docker:latest
  services:
    - docker:dind
  cache:
    paths:
      - /var/lib/docker/  # Cache Docker images
  script:
    - npm test
```

### CircleCI

```yaml
jobs:
  test:
    docker:
      - image: cimg/node:18
    steps:
      - checkout
      - setup_remote_docker:
          docker_layer_caching: true  # ← Enable caching
      - run: npm test
```

## Common Questions

### Q: Do images take up disk space?

**A:** Yes, but they're shared across all containers.

```bash
# 10 containers using postgres:14
# Disk usage: 374MB (not 3.74GB!)
```

### Q: How do I free up space?

**A:** Clean unused images periodically:

```bash
docker system prune -a
```

Or set up automatic cleanup:

```bash
# /etc/cron.weekly/docker-cleanup
#!/bin/bash
docker image prune -a -f --filter "until=168h"
```

### Q: What if my image changes?

**A:** Docker checks the registry and updates if needed:

```typescript
// If postgres:latest was updated upstream
await useContainer('postgres:latest').start();
// Docker pulls the new version

// Digest pins never change
await useContainer('postgres@sha256:abc123...').start();
// Always the same image, forever
```

### Q: Can I pre-download images in production?

**A:** Yes! Pre-pull during deployment:

```bash
# In your deploy script
docker pull python:3.11-alpine
docker pull node:18-alpine
docker pull redis:alpine

# Now your app starts instantly
npm start
```

### Q: Does this work with private registries?

**A:** Yes! Just authenticate first:

```bash
# Login to your registry
docker login myregistry.io

# Pull private images
docker pull myregistry.io/my-private-image:latest

# Now useContainer works
await useContainer('myregistry.io/my-private-image:latest').start();
```

## The Bottom Line

**Image caching is why containers are fast:**

- ✅ First run: One-time cost (seconds to minutes)
- ✅ All subsequent runs: Near-instant (1-2 seconds)
- ✅ Shared across all containers on the machine
- ✅ Works automatically, no configuration needed
- ✅ Layer deduplication saves tons of space
- ✅ CI/CD systems cache between runs

**Your tests might seem slow the first time, but that's just Docker being smart** - it's downloading and caching images for instant reuse.

After the first run, your tests will fly! 🚀

## See Also

- [Docker Image Caching Docs](https://docs.docker.com/storage/storagedriver/)
- [Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [DEPLOYMENT.md](DEPLOYMENT.md#image-caching-your-secret-performance-weapon) - Production caching strategies