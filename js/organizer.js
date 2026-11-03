import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const css = document.createElement("link");
css.rel = "stylesheet";
css.href = new URL("./organizer.css", import.meta.url).href;
document.head.appendChild(css);

const ROW = 40;
const HDR = 28;
// On the node, connection sockets are always drawn as a block above the widget rows, whatever their
// slot index, so each kind only reorders among itself.
const GROUP = { socket: "Connections", widget: "Widgets" };
const SHORT = { MODEL: "MDL", STRING: "STR", FLOAT: "FLT", COMBO: "CMB", IMAGE: "IMG", LATENT: "LAT", CONDITIONING: "COND", UPSCALE_MODEL: "UPSCL" };
const ICON = {
  close: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  remove: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1011 0a5.5 5.5 0 10-11 0M5.5 8h5"/></svg>',
  keep: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3L3 6l3 3M3 6h6.5a3.5 3.5 0 010 7H7"/></svg>',
  up: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>',
  down: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>',
  dash: '<svg class="sio-dash" aria-hidden="true"><rect width="100%" height="100%" rx="6"/></svg>',
  socket: '<svg class="sio-kind" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="6" cy="6" r="3.5"/></svg>',
  widget: '<svg class="sio-kind" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M1.5 6h9"/><circle cx="7.5" cy="6" r="2" fill="currentColor"/></svg>',
  lock: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2.5" y="5.5" width="7" height="5" rx="1"/><path d="M4 5.5V4a2 2 0 014 0v1.5"/></svg>',
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.filter((x) => x != null && x !== false));
  return el;
}

// Abbreviate the type tag when name + full tag would overflow the ~186px text area of a label.
function typeTag(name, type) {
  return name.length * 7 + type.length * 7.5 > 186 ? SHORT[type] ?? type : type;
}

function stats(list) {
  let moved = 0;
  for (const kind of ["socket", "widget"]) {
    const keep = list.filter((x) => x.kind === kind && !x.del);
    const byOrig = keep.slice().sort((a, b) => a.orig - b.orig);
    moved += keep.filter((x, i) => byOrig[i] !== x).length;
  }
  return { moved, removed: list.filter((x) => x.del).length };
}

// Contiguous kind groups of a side's list, with the column y of each group's first row.
function layout(list) {
  const groups = [];
  let top = 0;
  for (const kind of ["socket", "widget"]) {
    const start = list.findIndex((x) => x.kind === kind);
    if (start < 0) continue;
    const len = list.filter((x) => x.kind === kind).length;
    groups.push({ kind, start, len, top: top + HDR });
    top += HDR + len * ROW;
  }
  return { groups, height: top };
}

function items(slots, pre, kinds) {
  return slots.map((s, i) => ({ key: pre + i, name: s.label || s.name, type: String(s.type), orig: i, kind: kinds[i], del: false }));
}

function kept(list, kind) {
  return list.filter((x) => !x.del && (!kind || x.kind === kind)).map((x) => x.orig);
}

// Live instances of the subgraph, in the root graph and inside every subgraph definition.
function instances(subgraph) {
  const root = app.rootGraph;
  return [root, ...root.subgraphs.values()].flatMap((g) => g.nodes.filter((n) => n.type === subgraph.id));
}

// The frontend's own widget test on a live host. Hosts saved short don't list every input; for
// those, and when there is no host, ask the definition.
function kindOf(host, s) {
  const x = host?.inputs.find((i) => i.name === s.name);
  return (x ? x.widgetId || x.widget : s.getConnectedWidgets().length) ? "widget" : "socket";
}

async function applyOrder(subgraph, inputs, outputs) {
  const workflow = app.extensionManager.workflow.activeWorkflow;
  // widgets_values positions are counted over the inputs that have a widgetId, per instance.
  const widgets = Object.fromEntries(instances(subgraph).map((n) => [`${n.graph.id}:${n.id}`, n.inputs.filter((s) => s.widgetId).map((s) => s.name)]));
  const res = await api.fetchApi("/subgraph_io_organizer/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow: app.rootGraph.serialize(), sg_id: subgraph.id, inputs, outputs, widgets }),
  });
  if (!res.ok) {
    const json = res.headers.get("Content-Type")?.startsWith("application/json");
    throw new Error((json && (await res.json()).error) || `${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (app.extensionManager.workflow.activeWorkflow !== workflow) throw new Error("The workflow tab changed; nothing was applied.");

  const ct = workflow.changeTracker;
  const { initialState, activeState } = ct;
  ct.store();
  const loaded = await app.loadGraphData(data, true, false, workflow);
  // 1.48.6 resolves undefined even on success. Newer frontends resolve false when they refuse the
  // load, or undefined when another load superseded it, which leaves a different workflow active.
  if (loaded === false || app.extensionManager.workflow.activeWorkflow !== workflow) throw new Error("The workflow didn't reload; nothing was applied.");
  // loadGraphData makes the result the new clean baseline; put the old one back so the tab
  // stays modified and Ctrl+Z undoes the whole apply.
  ct.initialState = initialState;
  ct.activeState = activeState;
  ct.captureCanvasState();
}

let current = null;

class Organizer {
  constructor(subgraph, host) {
    this.sg = subgraph;
    this.kinds = subgraph.inputs.map((s) => kindOf(host, s));
    const inputs = items(subgraph.inputs, "i", this.kinds);
    this.base = { inputs: [...inputs.filter((x) => x.kind === "socket"), ...inputs.filter((x) => x.kind === "widget")], outputs: items(subgraph.outputs, "o", subgraph.outputs.map(() => "socket")) };
    this.was = {};
    for (const list of Object.values(this.base))
      for (const kind of ["socket", "widget"]) list.filter((x) => x.kind === kind).forEach((x, j) => (this.was[x.key] = j + 1));
    this.lists = { inputs: this.base.inputs.map((x) => ({ ...x })), outputs: this.base.outputs.map((x) => ({ ...x })) };
    this.drag = null;
    this.flash = null;
    this.busy = false;

    this.section = h("section", { class: "sio-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Subgraph IO Organizer", tabindex: "-1", onFocusin: () => this.updateFooter(), onFocusout: () => this.updateFooter() },
      h("header", { class: "sio-header" },
        h("div", null, h("span", { class: "sio-title" }, "Subgraph IO Organizer"), h("span", { class: "sio-sub" }, subgraph.name ?? "")),
        h("button", { class: "sio-close", "aria-label": "Close", html: ICON.close, onClick: () => this.close() })),
      h("div", { class: "sio-cols" },
        h("div", null, "Inputs", (this.nIn = h("span", { class: "sio-count" }))),
        h("div", null, "Outputs", (this.nOut = h("span", { class: "sio-count" })))),
      h("div", { class: "sio-viewport" },
        (this.body = h("div", { class: "sio-body", onScroll: () => this.updateFades() },
          (this.grid = h("div", { class: "sio-grid" },
            (this.colIn = h("div", { class: "sio-col" })),
            (this.colOut = h("div", { class: "sio-col sio-out" })))))),
        (this.fadeUp = h("div", { class: "sio-fade sio-up", hidden: true })),
        (this.fadeDown = h("div", { class: "sio-fade sio-down", hidden: true })),
        (this.autoUp = h("div", { class: "sio-auto sio-up", hidden: true, html: ICON.up })),
        (this.autoDown = h("div", { class: "sio-auto sio-down", hidden: true, html: ICON.down }))),
      h("footer", { class: "sio-footer" },
        (this.sum = h("span", { class: "sio-sum" })),
        (this.resetBtn = h("button", { class: "sio-btn", onClick: () => this.reset() }, "Reset")),
        h("button", { class: "sio-btn", onClick: () => this.close() }, "Cancel"),
        (this.applyBtn = h("button", { class: "sio-btn sio-primary", onClick: () => this.apply() }, "Apply"))));
    this.overlay = h("div", { class: "sio-overlay" }, this.section);
  }

  open() {
    current = this;
    document.body.append(this.overlay);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.swallow, true);
    this.render();
    this.section.focus();
  }

  close() {
    current = null;
    this.overlay.remove();
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.swallow, true);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  side(key) {
    return key[0] === "i" ? "inputs" : "outputs";
  }

  groupOf(key) {
    const list = this.lists[this.side(key)];
    const i = list.findIndex((x) => x.key === key);
    return { i, g: layout(list).groups.find((g) => g.kind === list[i].kind) };
  }

  focusKey(key) {
    this.grid.querySelector(`[data-k="${key}"]`)?.focus();
  }

  // The dialog is modal: keys never reach the canvas, so Delete or Ctrl+Z can't edit the graph behind it.
  swallow = (e) => e.stopImmediatePropagation();

  onKey = (e) => {
    e.stopImmediatePropagation();
    const key = e.target.closest?.("[data-k]")?.dataset.k;
    if (e.key === "Escape") {
      e.preventDefault();
      // Selection is label focus: Escape drops it first, then closes.
      if (key) this.section.focus();
      else this.close();
    } else if (key && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const { i, g } = this.groupOf(key);
      this.move(key, Math.max(g.start, Math.min(g.start + g.len - 1, i + (e.key === "ArrowUp" ? -1 : 1))));
    } else if (key && e.key === "Delete") {
      e.preventDefault();
      this.toggleDel(key);
    }
  };

  move(key, to) {
    const list = this.lists[this.side(key)];
    const [it] = list.splice(list.findIndex((x) => x.key === key), 1);
    list.splice(to, 0, it);
    this.flash = null;
    this.render();
    this.focusKey(key);
  }

  toggleDel(key) {
    const it = this.lists[this.side(key)].find((x) => x.key === key);
    it.del = !it.del;
    this.flash = null;
    this.render();
    this.focusKey(key);
  }

  reset() {
    this.lists = { inputs: this.base.inputs.map((x) => ({ ...x })), outputs: this.base.outputs.map((x) => ({ ...x })) };
    this.flash = null;
    this.render();
  }

  down(e, key) {
    if (e.button !== 0) return;
    e.currentTarget.focus();
    const { i, g } = this.groupOf(key);
    const cy = e.clientY - this.body.getBoundingClientRect().top + this.body.scrollTop;
    this.pend = { key, grab: cy - (g.top + (i - g.start) * ROW), x: e.clientX, y: e.clientY, g };
    this.cy = e.clientY;
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  onMove = (e) => {
    this.cy = e.clientY;
    if (!this.drag && Math.abs(e.clientX - this.pend.x) + Math.abs(e.clientY - this.pend.y) < 4) return;
    this.track();
  };

  // Auto-scroll zones straddle the viewport edge: 24px inside, ramping to full speed 48px outside.
  track() {
    const p = this.pend, b = this.body;
    const vy = this.cy - b.getBoundingClientRect().top;
    const vh = b.clientHeight;
    const max = b.scrollHeight - vh;
    let speed = 0;
    if (vy < 24 && b.scrollTop > 0) speed = -(2 + 18 * Math.min(1, (24 - vy) / 72));
    else if (vy > vh - 24 && b.scrollTop < max) speed = 2 + 18 * Math.min(1, (vy - vh + 24) / 72);
    this.speed = speed;
    const g = p.g;
    const y = Math.max(g.top, Math.min(g.top + (g.len - 1) * ROW, vy + b.scrollTop - p.grab));
    this.drag = { key: p.key, kind: g.kind, y, to: g.start + Math.round((y - g.top) / ROW) };
    this.autoUp.hidden = speed >= 0;
    this.autoDown.hidden = speed <= 0;
    this.render();
    if (speed && !this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  tick = () => {
    this.raf = null;
    if (!this.drag || !this.speed) return;
    this.body.scrollTop += this.speed;
    this.track();
  };

  onUp = () => {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    const d = this.drag;
    this.drag = null;
    this.pend = null;
    this.speed = 0;
    this.autoUp.hidden = this.autoDown.hidden = true;
    if (d) this.move(d.key, d.to);
  };

  // n: position within the item's group, as seen on the node. was: its original position in that group.
  row(it, n, was, ph) {
    const moved = !it.del && was !== n;
    const kind = it.kind === "widget" ? "widget" : "connection";
    const label = h("button", {
      class: "sio-label" + (it.del ? " sio-del" : "") + (ph ? " sio-ph" : ""),
      "data-k": it.key,
      title: `${it.name} (${it.type}, ${kind})`,
      "aria-label": `${it.name}, ${it.type} ${kind}, ${kind} ${n}. Drag or press Alt+Arrow to move within ${GROUP[it.kind].toLowerCase()}, Delete to remove.`,
      html: ICON.dash,
      onPointerdown: (e) => this.down(e, it.key),
    },
      h("span", { class: "sio-inner" },
        h("span", { class: "sio-n" }, String(n)),
        h("span", { class: "sio-icon", html: ICON[it.kind] }),
        h("span", { class: "sio-name" }, it.name),
        h("span", { class: "sio-type" }, typeTag(it.name, it.type)),
        (it.del || moved) && h("span", { class: "sio-badge " + (it.del ? "sio-rm" : "sio-was") }, it.del ? "removing" : `was ${was}`)));
    const xLabel = it.del ? `Keep ${it.name}` : `Remove ${it.name}`;
    const x = h("button", { class: "sio-x", title: xLabel, "aria-label": xLabel, html: it.del ? ICON.keep : ICON.remove, onClick: () => this.toggleDel(it.key) });
    return h("div", { class: "sio-row" }, label, x);
  }

  render() {
    const d = this.drag;
    const n = { inputs: this.lists.inputs.length, outputs: this.lists.outputs.length };
    const ht = { inputs: layout(this.lists.inputs).height, outputs: layout(this.lists.outputs).height };
    for (const side of ["inputs", "outputs"]) {
      let order = this.lists[side];
      const mine = d && this.side(d.key) === side;
      if (mine) {
        const it = order.find((x) => x.key === d.key);
        order = order.filter((x) => x !== it);
        order.splice(d.to, 0, it);
      }
      const kids = layout(order).groups.map((g) => {
        const locked = mine && g.kind !== d.kind;
        const title = GROUP[g.kind];
        return h("div", { class: "sio-grp" + (locked ? " sio-locked" : ""), role: "group", "aria-label": title },
          h("div", { class: "sio-ghead", title: locked ? `Can't move here: ${title.toLowerCase()} stay in their own group on the node` : null },
            h("span", { class: "sio-icon", html: locked ? ICON.lock : ICON[g.kind] }),
            h("b", null, title)),
          ...order.slice(g.start, g.start + g.len).map((it, j) => this.row(it, j + 1, this.was[it.key], mine && it.key === d.key)));
      });
      if (ht[side] < Math.max(ht.inputs, ht.outputs)) kids.push(h("div", { class: "sio-end", style: `top: ${ht[side] + 12}px` }, h("span"), `end of ${side}`, h("span")));
      if (mine) {
        const it = this.lists[side].find((x) => x.key === d.key);
        kids.push(h("div", { class: "sio-float", style: `top: ${d.y + 6}px` }, h("span", { class: "sio-icon", html: ICON[it.kind] }), h("span", { class: "sio-name" }, it.name), h("span", { class: "sio-type" }, it.type)));
      }
      (side === "inputs" ? this.colIn : this.colOut).replaceChildren(...kids);
    }
    this.grid.style.height = `${Math.max(ht.inputs, ht.outputs)}px`;
    this.nIn.textContent = n.inputs;
    this.nOut.textContent = n.outputs;
    this.section.classList.toggle("sio-dragging", !!d);
    this.updateFooter();
    this.updateFades();
  }

  updateFooter() {
    const a = stats(this.lists.inputs), b = stats(this.lists.outputs);
    const moved = a.moved + b.moved, removed = a.removed + b.removed;
    const changed = moved + removed > 0;
    const key = document.activeElement?.dataset?.k;
    const picked = key && this.lists[this.side(key)].find((x) => x.key === key);
    let text = picked ? `${picked.name} selected · Alt+↑/↓ to move · Del to remove · Esc to deselect` : "Drag to reorder · Alt+↑/↓ to move · Del to remove";
    if (changed) text = `${moved} moved · ${removed} removed` + (removed ? " — removed slots lose their links" : "");
    if (this.drag) text = this.drag.kind === "widget" ? "Widgets move among widgets — they're always shown below connections" : "Connections move among connections — widgets always sit below them";
    if (this.flash) text = this.flash;
    this.sum.textContent = text;
    this.sum.className = "sio-sum" + (this.flash ? " sio-error" : changed ? " sio-changed" : "");
    this.resetBtn.disabled = this.applyBtn.disabled = !changed || this.busy;
  }

  updateFades() {
    const b = this.body;
    this.fadeUp.hidden = !!this.drag || b.scrollTop <= 0;
    this.fadeDown.hidden = !!this.drag || b.scrollTop + b.clientHeight >= b.scrollHeight - 1;
  }

  async apply() {
    // Each kind refills the slot positions it held before, so the socket/widget interleave of the
    // definition is kept and only the order within each kind changes.
    const q = { socket: kept(this.lists.inputs, "socket"), widget: kept(this.lists.inputs, "widget") };
    const inputs = this.kinds.map((k) => q[k].shift()).filter((o) => o !== undefined);
    const a = stats(this.lists.inputs), b = stats(this.lists.outputs);
    this.busy = true;
    this.updateFooter();
    try {
      await applyOrder(this.sg, inputs, kept(this.lists.outputs));
    } catch (err) {
      this.busy = false;
      this.flash = `Apply failed: ${err.message}`;
      this.updateFooter();
      return;
    }
    this.close();
    app.extensionManager.toast.add({ severity: "success", summary: "Subgraph IO Organizer", detail: `${a.moved + b.moved} moved, ${a.removed + b.removed} removed. Links kept.`, life: 3000 });
  }
}

// host: the instance the dialog was opened from, else any instance.
function open(subgraph, host = instances(subgraph)[0]) {
  if (!current) new Organizer(subgraph, host).open();
}

// The selected subgraph node wins; otherwise the subgraph currently open on the canvas.
function target() {
  const node = Object.values(app.canvas.selected_nodes ?? {}).find((n) => n.isSubgraphNode?.());
  if (node) return [node.subgraph, node];
  const g = app.canvas.graph;
  return g && !g.isRootGraph ? [g] : [];
}

app.registerExtension({
  name: "SubgraphIOOrganizer",
  commands: [{
    id: "SubgraphIOOrganizer.open",
    label: "Subgraph IO Organizer",
    function: () => {
      const [sg, node] = target();
      if (sg) open(sg, node);
      else app.extensionManager.toast.add({ severity: "info", summary: "Subgraph IO Organizer", detail: "Select a subgraph node or open a subgraph first.", life: 3000 });
    },
  }],
  keybindings: [{ combo: { key: "r", alt: true }, commandId: "SubgraphIOOrganizer.open" }],
  menuCommands: [{ path: ["Extensions"], commands: ["SubgraphIOOrganizer.open"] }],
  getNodeMenuItems(node) {
    return node.isSubgraphNode?.() ? [{ content: "Subgraph IO Organizer…", callback: () => open(node.subgraph, node) }] : [];
  },
  getCanvasMenuItems(canvas) {
    const g = canvas.graph;
    return g && !g.isRootGraph ? [{ content: "Subgraph IO Organizer…", callback: () => open(g) }] : [];
  },
});
