import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ConfigEnv {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  home?: string;
}

export interface StoredConfig {
  api_key?: string;
}

/** The directory the key is kept in: $FIREMARK_CONFIG_DIR, $XDG_CONFIG_HOME/firemark, or the platform's own. */
export function configDir({ env, platform, home }: ConfigEnv): string {
  const h = home ?? homedir();
  if (env.FIREMARK_CONFIG_DIR) return env.FIREMARK_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "firemark");
  if (platform === "win32") return join(env.APPDATA ?? join(h, "AppData", "Roaming"), "firemark");
  if (platform === "darwin") return join(h, "Library", "Application Support", "firemark");
  return join(h, ".config", "firemark");
}

export function configPath(ce: ConfigEnv): string {
  return join(configDir(ce), "config.json");
}

export async function readConfig(path: string): Promise<StoredConfig | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as StoredConfig) : {};
  } catch {
    return {};
  }
}

/** True when the file can be read or written by anyone but its owner (POSIX only). */
export async function isLoose(path: string, platform: NodeJS.Platform): Promise<boolean> {
  if (platform === "win32") return false;
  try {
    const s = await stat(path);
    return (s.mode & 0o077) !== 0;
  } catch {
    return false;
  }
}

/** Writes the config with mode 600 in a directory with mode 700, replacing any earlier file atomically. */
export async function writeConfig(path: string, dir: string, config: StoredConfig): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
}

export async function removeConfig(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export const KEY_SHAPE = /^fmk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

/** The part of a key that is safe to show: `fmk_<8 hex>`. */
export function keyPrefix(key: string): string {
  const m = /^fmk_[0-9a-f]{8}/.exec(key);
  return m ? m[0] : "fmk_…";
}
