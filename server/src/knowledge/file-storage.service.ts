import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { AppConfig } from '../config/configuration';

/**
 * Original files of uploaded documents, on disk below STORAGE_DIR.
 * Kept behind this class so it can move to S3/MinIO without touching callers.
 */
@Injectable()
export class FileStorageService {
  private readonly root: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.root = resolve(config.get('knowledge', { infer: true }).storageDir);
  }

  async write(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  /** Deletes a file or a whole folder (all files of a company); missing paths are fine. */
  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { recursive: true, force: true });
  }

  private pathOf(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) {
      throw new Error(`Storage key outside of the storage directory: ${key}`);
    }
    return path;
  }
}
