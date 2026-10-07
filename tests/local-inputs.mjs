import { statSync } from 'node:fs';
import { resolve } from 'node:path';

// Optional manual tests require explicit inputs; never default to personal footage.
export function requiredInput(name, directory = false) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(
      `Set ${name} to ${directory ? 'a test footage directory' : 'a test input file'} before running this script. See README.md.`,
    );
  }
  const path = resolve(value);
  const stat = statSync(path);
  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    throw new Error(`${name} must point to ${directory ? 'a directory' : 'a file'}.`);
  }
  return path;
}

export function requiredMediaInputs() {
  return ['FRONT_FILE', 'REAR_FILE', 'CABIN_FILE'].map((name) => requiredInput(name));
}
