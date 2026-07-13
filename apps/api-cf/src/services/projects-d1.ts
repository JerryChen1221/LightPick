import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { DEV_USER_ID } from "./session";
import type { D1Database } from "@cloudflare/workers-types";
import { projects, assets, assetRefs } from "../db/app.schema";
import type { ProjectWithAssets } from "@lightpick/web-ui/lib/types";
import { signAssetPath } from "./asset-signing";

interface Env {
  DB: D1Database;
  NODE_ENV?: string;
  JWT_SECRET?: string;
}

async function ensureDevUser(db: ReturnType<typeof getDb>, env: Env) {
  if (env.NODE_ENV !== "development") return;
  await db.run(
    sql`INSERT OR IGNORE INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (${DEV_USER_ID}, ${"Dev User"}, ${"dev@local"}, ${0}, ${Date.now()}, ${Date.now()})`,
  );
}

export async function listProjectsWithAssets(
  env: Env,
  userId: string,
  limit = 10,
): Promise<ProjectWithAssets[]> {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);

  const projectsData = await db.query.projects.findMany({
    where: eq(projects.ownerId, userId),
    orderBy: [desc(projects.createdAt)],
    limit,
  });

  if (projectsData.length === 0) return [];

  // Project cards only need a small visual preview. Read it from asset_refs,
  // the durable project-to-asset index, instead of reconstructing it from a
  // live ProjectRoom canvas snapshot. This keeps covers available when the DO
  // is cold and also covers assets imported without a currently mounted node.
  const projectIds = projectsData.map((project) => project.id);
  const rows = await db
    .select({
      projectId: assetRefs.projectId,
      importedAt: assetRefs.importedAt,
      id: assets.id,
      kind: assets.kind,
      srcR2Key: assets.srcR2Key,
      coverR2Key: assets.coverR2Key,
    })
    .from(assetRefs)
    .innerJoin(assets, eq(assetRefs.assetId, assets.id))
    .where(inArray(assetRefs.projectId, projectIds))
    .orderBy(desc(assetRefs.importedAt));

  const rowsByProject = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.kind !== "image" && row.kind !== "video") continue;
    if (row.kind === "video" && !row.coverR2Key) continue;
    const projectRows = rowsByProject.get(row.projectId) ?? [];
    if (projectRows.length >= 4) continue;
    projectRows.push(row);
    rowsByProject.set(row.projectId, projectRows);
  }

  return Promise.all(
    projectsData.map(async (project) => ({
      ...project,
      assets: await Promise.all(
        (rowsByProject.get(project.id) ?? []).map(async (row) => ({
          id: row.id,
          url: await signAssetPath(
            env,
            row.kind === "video" ? row.coverR2Key! : row.srcR2Key,
          ),
          type: row.kind as "image" | "video",
          storageKey: row.srcR2Key,
          createdAt: row.importedAt,
        })),
      ),
    })),
  );
}

export async function getProjectById(env: Env, userId: string, id: string) {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);
  return db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
  });
}

export async function createNewProject(
  env: Env,
  userId: string,
  prompt: string,
) {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);
  const [project] = await db
    .insert(projects)
    .values({
      ownerId: userId,
      name: prompt.length > 20 ? prompt.substring(0, 20) + "..." : prompt,
      description: prompt,
    })
    .returning();
  return project;
}

export async function renameProject(
  env: Env,
  userId: string,
  id: string,
  name: string,
) {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);
  await db
    .update(projects)
    .set({ name })
    .where(and(eq(projects.id, id), eq(projects.ownerId, userId)));
}

export async function removeProject(env: Env, userId: string, id: string) {
  const db = getDb(env.DB);
  if (userId === DEV_USER_ID) await ensureDevUser(db, env);
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, userId)));
}
