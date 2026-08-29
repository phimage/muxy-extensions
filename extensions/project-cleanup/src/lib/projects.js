// Wraps muxy.projects + existence checks. No background script needed —
// these calls are all synchronous-ish per-invocation, not durable state.

const EXISTS_TIMEOUT_MS = 4000;
const EXISTS_CONCURRENCY = 6;

function normalize(list) {
  const raw = Array.isArray(list) ? list : Array.isArray(list?.projects) ? list.projects : [];
  return raw
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      id: String(p.id ?? p.path ?? ""),
      name: String(p.name ?? (p.path ? p.path.split("/").pop() : "Untitled")),
      path: String(p.path ?? ""),
      isActive: !!p.isActive,
      isHome: !!p.isHome || p.id === "home",
    }))
    .filter((p) => p.id);
}

export async function listProjects() {
  const raw = await muxy.projects.list();
  return normalize(raw);
}

/** true = folder present, false = missing, null = could not be determined. */
async function checkExists(path) {
  if (!path) return null;
  try {
    const res = await muxy.exec(["test", "-d", path], { timeoutMs: EXISTS_TIMEOUT_MS });
    return res.exitCode === 0;
  } catch {
    return null;
  }
}

/** Runs existence checks with bounded concurrency and reports each result as it lands. */
export async function checkAllExist(projects, onResult) {
  let cursor = 0;
  async function worker() {
    while (cursor < projects.length) {
      const project = projects[cursor++];
      if (project.isHome) {
        onResult(project.id, true);
        continue;
      }
      const exists = await checkExists(project.path);
      onResult(project.id, exists);
    }
  }
  const workers = Array.from({ length: Math.min(EXISTS_CONCURRENCY, projects.length) }, worker);
  await Promise.all(workers);
}

/** Deletes each project in sequence (Muxy shows a native confirm per call). */
export async function deleteProjects(ids, onProgress) {
  const results = [];
  for (const id of ids) {
    try {
      await muxy.projects.delete(id);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err) });
    }
    onProgress?.(results.at(-1));
  }
  return results;
}
