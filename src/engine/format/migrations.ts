import type { Project } from "@/model/types";

/**
 * Client-side project migrations.
 *
 * Each migration is a pure function `(Project) → Project` that transforms
 * a v(n) document into v(n+1). The Rust loader does its own
 * forward-walk; this file mirrors the same concept for any tweaks we
 * only know how to do in the typed world.
 *
 * To add a new migration: bump CURRENT_CLIENT_SCHEMA_VERSION, append a
 * function to MIGRATIONS, and make sure the Rust side agrees.
 */

export const CURRENT_CLIENT_SCHEMA_VERSION = 1;

type Migration = (p: Project) => Project;

const MIGRATIONS: Record<number, Migration> = {
  // 1 → 2 would go here once it exists:
  // 1: (p) => ({ ...p, /* add new required field */ }),
};

export function migrateProject(p: Project, fromVersion: number): Project {
  let current = p;
  for (let v = fromVersion; v < CURRENT_CLIENT_SCHEMA_VERSION; v++) {
    const fn = MIGRATIONS[v];
    if (fn) current = fn(current);
  }
  return current;
}
