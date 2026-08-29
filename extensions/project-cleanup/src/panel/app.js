import { h } from "@/lib/dom";
import { listProjects, checkAllExist, deleteProjects } from "@/lib/projects";
import { cls, middleTruncate } from "@muxy/ui";

const FOLDER_ICON_PATH =
  "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z";

function svgIcon(path, size = 14) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", path);
  svg.appendChild(el);
  return svg;
}

export class CleanupPanel {
  constructor(root) {
    this.root = root;
    this.projects = [];
    this.exists = new Map(); // id -> true | false | null | undefined (checking)
    this.selected = new Set();
    this.loading = true;
    this.deleting = false;
    this.error = null;
  }

  start() {
    this.render();
    this.refresh();
    muxy.events.subscribe("command.refresh-cleanup", () => this.refresh());
    muxy.events.subscribe("projects.changed", () => this.refresh());
  }

  async refresh() {
    this.loading = true;
    this.error = null;
    this.exists.clear();
    this.render();

    try {
      this.projects = await listProjects();
    } catch (err) {
      this.error = err?.message || String(err);
      this.projects = [];
      this.loading = false;
      this.render();
      return;
    }

    // Drop selections for projects that no longer exist in the list.
    const ids = new Set(this.projects.map((p) => p.id));
    for (const id of [...this.selected]) if (!ids.has(id)) this.selected.delete(id);

    this.loading = false;
    this.render();

    checkAllExist(this.projects, (id, exists) => {
      this.exists.set(id, exists);
      this.render();
    });
  }

  toggleSelect(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.render();
  }

  selectableProjects() {
    return this.projects.filter((p) => !p.isHome);
  }

  selectAll() {
    const selectable = this.selectableProjects();
    const allSelected = selectable.length > 0 && selectable.every((p) => this.selected.has(p.id));
    this.selected = allSelected ? new Set() : new Set(selectable.map((p) => p.id));
    this.render();
  }

  selectMissing() {
    const missing = this.projects.filter((p) => this.exists.get(p.id) === false);
    this.selected = new Set(missing.map((p) => p.id));
    this.render();
  }

  async deleteSelected() {
    const targets = this.projects.filter((p) => this.selected.has(p.id));
    if (targets.length === 0 || this.deleting) return;

    const list = targets.map((p) => `• ${p.name}`).join("\n");
    const clicked = await muxy.dialog.confirm({
      title: targets.length === 1 ? `Delete "${targets[0].name}"?` : `Delete ${targets.length} projects?`,
      message:
        `This removes each project's worktrees, branches, and directories from disk. ` +
        `This cannot be undone.\n\n${list}\n\n` +
        `Muxy will also ask you to confirm each project individually.`,
      buttons: ["Delete", "Cancel"],
      style: "warning",
    });
    if (clicked !== "Delete") return;

    this.deleting = true;
    this.deleteProgress = { done: 0, total: targets.length };
    this.render();

    const results = await deleteProjects(
      targets.map((p) => p.id),
      () => {
        this.deleteProgress.done += 1;
        this.render();
      },
    );

    this.deleting = false;
    for (const r of results) if (r.ok) this.selected.delete(r.id);

    await this.refresh();

    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      await muxy.dialog.alert({
        title: "Cleanup complete",
        message: `Deleted ${results.length} project${results.length === 1 ? "" : "s"}.`,
      });
    } else {
      const byId = new Map(targets.map((p) => [p.id, p.name]));
      const detail = failed.map((f) => `• ${byId.get(f.id) || f.id}: ${f.error}`).join("\n");
      await muxy.dialog.alert({
        title: "Some projects weren't deleted",
        message:
          `Deleted ${results.length - failed.length} of ${results.length}.\n\n${detail}`,
        style: "warning",
      });
    }
  }

  render() {
    const root = this.root;
    root.replaceChildren();

    const body = h("div", { class: "cleanup-body" });
    root.appendChild(body);

    if (this.loading && this.projects.length === 0) {
      body.appendChild(
        h(
          "div",
          { class: "mx-empty" },
          h("span", { class: "mx-spinner mx-spinner-lg" }),
          h("div", { class: "mx-empty-copy" }, "Loading projects…"),
        ),
      );
      return;
    }

    if (this.error) {
      body.appendChild(
        h(
          "div",
          { class: "mx-empty" },
          h("div", { class: "mx-empty-title" }, "Couldn't load projects"),
          h("div", { class: "mx-empty-copy" }, this.error),
          h("button", { class: "mx-btn", onclick: () => this.refresh() }, "Retry"),
        ),
      );
      return;
    }

    const selectable = this.selectableProjects();
    const missingCount = this.projects.filter((p) => this.exists.get(p.id) === false).length;
    const uncheckedCount = this.projects.filter((p) => this.exists.get(p.id) === null).length;
    const allSelected = selectable.length > 0 && selectable.every((p) => this.selected.has(p.id));

    body.appendChild(
      h(
        "div",
        { class: "mx-toolbar" },
        h(
          "button",
          { class: "mx-btn mx-btn-ghost", onclick: () => this.selectAll(), disabled: selectable.length === 0 },
          allSelected ? "Clear Selection" : "Select All",
        ),
        h(
          "button",
          {
            class: "mx-btn mx-btn-ghost",
            onclick: () => this.selectMissing(),
            disabled: missingCount === 0,
          },
          `Select Missing (${missingCount})`,
        ),
        h("span", { class: "mx-spacer" }),
        h(
          "span",
          { class: "mx-row-sub" },
          this.selected.size > 0 ? `${this.selected.size} selected` : `${this.projects.length} projects`,
        ),
      ),
    );

    if (uncheckedCount > 0) {
      body.appendChild(
        h(
          "div",
          { class: "cleanup-banner" },
          `${uncheckedCount} project${uncheckedCount === 1 ? "" : "s"} couldn't be checked ` +
            `(the folder test failed or timed out) — their folder status is unknown. ` +
            `They're never auto-selected as missing; verify manually before deleting.`,
        ),
      );
    }

    if (this.projects.length === 0) {
      body.appendChild(
        h(
          "div",
          { class: "mx-empty" },
          h("div", { class: "mx-empty-title" }, "No projects"),
          h("div", { class: "mx-empty-copy" }, "There's nothing to clean up yet."),
        ),
      );
      return;
    }

    const list = h("div", { class: "mx-list cleanup-list" });
    for (const project of this.projects) list.appendChild(this.renderRow(project));
    body.appendChild(list);

    body.appendChild(
      h(
        "div",
        { class: "cleanup-footer" },
        h(
          "button",
          {
            class: "mx-btn mx-btn-danger",
            disabled: this.selected.size === 0 || this.deleting,
            onclick: () => this.deleteSelected(),
          },
          this.deleting
            ? h("span", { class: "mx-spinner" })
            : null,
          this.deleting
            ? ` Deleting ${this.deleteProgress?.done ?? 0}/${this.deleteProgress?.total ?? 0}…`
            : `Delete Selected (${this.selected.size})`,
        ),
      ),
    );
  }

  renderRow(project) {
    const exists = this.exists.get(project.id);
    const isMissing = exists === false;
    const isChecking = exists === undefined;
    const selected = this.selected.has(project.id);

    return h(
      "div",
      { class: cls("mx-row", { "is-selected": selected }) },
      project.isHome
        ? h("span", { class: "cleanup-checkbox" })
        : h("input", {
            type: "checkbox",
            class: "cleanup-checkbox",
            checked: selected,
            onchange: () => this.toggleSelect(project.id),
          }),
      h("span", { style: `color: ${isMissing ? "var(--muxy-diff-remove)" : "var(--muxy-foreground-muted)"}` }, svgIcon(FOLDER_ICON_PATH)),
      h(
        "div",
        { class: "cleanup-row-main" },
        h(
          "div",
          { class: "cleanup-row-name" },
          h("span", null, project.name),
          project.isActive ? h("span", { class: "mx-badge mx-badge-accent" }, "Active") : null,
          project.isHome ? h("span", { class: "mx-badge" }, "Home") : null,
          isMissing ? h("span", { class: "mx-badge cleanup-badge-missing" }, "Missing") : null,
          isChecking ? h("span", { class: "mx-spinner" }) : null,
        ),
        h("div", { class: "mx-row-sub", title: project.path }, middleTruncate(project.path, 64)),
      ),
    );
  }
}
