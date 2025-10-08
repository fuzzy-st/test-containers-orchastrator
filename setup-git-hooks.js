#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';

// Check if .git-hooks directory exists
if (!fs.existsSync('.git-hooks')) {
  console.error('Error: .git-hooks directory not found. Please run this script from the project root.');
  process.exit(1);
}

// Configure git to use our hooks
try {
  execSync('git config core.hooksPath .git-hooks');
  console.log('Git hooks configured successfully! ✅');
} catch (error) {
  console.error('Error configuring git hooks:', error.message);
  process.exit(1);
}
