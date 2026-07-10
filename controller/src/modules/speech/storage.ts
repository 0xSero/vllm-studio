import { chmodSync, lstatSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UPLOAD_FILE = new RegExp(`^${UUID}\\.(?:input|wav)$`, "i");
const OUTPUT_FILE = new RegExp(`^${UUID}\\.wav$`, "i");

export type ChatterboxStoragePaths = {
  readonly speechDirectory: string;
  readonly cacheDirectory: string;
  readonly voiceDirectory: string;
  readonly outputDirectory: string;
  readonly uploadDirectory: string;
};

export const secureSpeechDirectory = (path: string): void => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory()) throw new Error("Speech storage path is not a directory");
  chmodSync(path, 0o700);
};

const removeOwnedFiles = (directory: string, pattern: RegExp): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!pattern.test(entry.name) || (!entry.isFile() && !entry.isSymbolicLink())) continue;
    unlinkSync(join(directory, entry.name));
  }
};

export const prepareChatterboxStorage = (paths: ChatterboxStoragePaths): void => {
  [
    paths.speechDirectory,
    paths.cacheDirectory,
    paths.voiceDirectory,
    paths.outputDirectory,
    paths.uploadDirectory,
  ].forEach(secureSpeechDirectory);
  removeOwnedFiles(paths.uploadDirectory, UPLOAD_FILE);
  removeOwnedFiles(paths.outputDirectory, OUTPUT_FILE);
};

export const prepareVoicePlaintextStorage = (directory: string): void => {
  secureSpeechDirectory(directory);
  removeOwnedFiles(directory, OUTPUT_FILE);
};
