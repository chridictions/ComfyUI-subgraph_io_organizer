"""Reorder and delete subgraph IO slots in a serialized (non-API) workflow.

A slot's position in sg["inputs"] / sg["outputs"] is its index, and that index is
repeated on the links inside the subgraph (input node -10, output node -20), on every
instance node of the subgraph, and on the links into or out of those instances.
remap() rewrites all of them together.
"""

SG_IN, SG_OUT = -10, -20


def lf(l):
    """Normalize a link (list form [id, o_id, o_slot, t_id, t_slot, type] or dict form)."""
    if isinstance(l, list):
        return dict(id=l[0], origin_id=l[1], origin_slot=l[2], target_id=l[3], target_slot=l[4], type=l[5])
    return l


def set_slot(l, key, val):
    if isinstance(l, list):
        l[{"origin_slot": 2, "target_slot": 4}[key]] = val
    else:
        l[key] = val


def _detach(g, link_id):
    """Remove a link from graph g and clear it from both endpoint nodes."""
    nodes = {n["id"]: n for n in g.get("nodes", [])}
    for idx, l in enumerate(g.get("links", [])):
        f = lf(l)
        if f["id"] != link_id:
            continue
        o, t = nodes.get(f["origin_id"]), nodes.get(f["target_id"])
        if o:
            ls = o["outputs"][f["origin_slot"]].get("links") or []
            if link_id in ls:
                ls.remove(link_id)
        if t and t["inputs"][f["target_slot"]].get("link") == link_id:
            t["inputs"][f["target_slot"]]["link"] = None
        del g["links"][idx]
        return


def _remap_floating(g, end, nid, o2n):
    # Floating links aren't attached to node slots, so one at a removed slot is just dropped.
    if "floatingLinks" not in g:
        return
    g["floatingLinks"] = [l for l in g["floatingLinks"] if l[f"{end}_id"] != nid or l[f"{end}_slot"] in o2n]
    for l in g["floatingLinks"]:
        if l[f"{end}_id"] == nid:
            l[f"{end}_slot"] = o2n[l[f"{end}_slot"]]


def _remap_links(g, end, nid, o2n):
    """Move the `end` side of g's links at node nid to the slots in o2n. Links at removed slots are deleted."""
    # Detach removed slots while the old indices are still valid, then shift the rest.
    for l in list(g.get("links", [])):
        f = lf(l)
        if f[f"{end}_id"] == nid and f[f"{end}_slot"] not in o2n:
            _detach(g, f["id"])
    for l in g.get("links", []):
        f = lf(l)
        if f[f"{end}_id"] == nid:
            set_slot(l, f"{end}_slot", o2n[f[f"{end}_slot"]])
    _remap_floating(g, end, nid, o2n)


def _remap_widget_values(n, order, wnames, deleted):
    # Promoted widget values follow the order of the instance's inputs that have a widgetId in the
    # frontend (wnames), which can differ from the serialized "widget" flags (frontend #18990).
    for name in deleted:
        n.get("widgets_values_named", {}).pop(name, None)
    wv = n.get("widgets_values")
    widx = [i for i, s in enumerate(n["inputs"]) if s["name"] in wnames]
    if not wv or len(wv) != len(widx):
        return
    pos = {i: k for k, i in enumerate(widx)}
    n["widgets_values"] = [wv[pos[o]] for o in order if o in pos]


def _remap_definition(sg, side, keep):
    o2n = {old: new for new, old in enumerate(keep)}
    if side == "inputs":
        _remap_links(sg, "origin", SG_IN, o2n)
    else:
        _remap_links(sg, "target", SG_OUT, o2n)
        # Floating links to the output node can carry it on the origin side (frontend #12986).
        _remap_floating(sg, "origin", SG_OUT, o2n)
    sg[side] = [sg[side][o] for o in keep]


def _remap_instance(g, n, side, names, kept, widgets):
    # Instance slots are matched to the definition by name, since older saves only store some of them.
    local = {s["name"]: j for j, s in enumerate(n[side])}
    if not local.keys() <= set(names):
        raise ValueError(f"Node {n['id']} has {side} that aren't in subgraph {n['type']}.")
    order = [local[name] for name in kept if name in local]
    l2n = {old: new for new, old in enumerate(order)}
    if side == "inputs":
        _remap_widget_values(n, order, widgets[f"{g['id']}:{n['id']}"], set(names) - set(kept))
    _remap_links(g, "target" if side == "inputs" else "origin", n["id"], l2n)
    n[side] = [n[side][o] for o in order]
    for i, s in enumerate(n[side]):
        if "slot_index" in s:
            s["slot_index"] = i


def remap(wf, sg_id, side, keep, widgets=None):
    """keep: old slot indices of `side` ("inputs" or "outputs") in their new order. Slots left out are deleted with their links.

    widgets (inputs only): "<graph id>:<node id>" of every instance -> names of its inputs that have a widgetId.
    """
    subs = wf["definitions"]["subgraphs"]
    sg = next((s for s in subs if s["id"] == sg_id), None)
    if sg is None:
        raise ValueError(f"Subgraph {sg_id} is not in this workflow.")
    n_old = len(sg[side])
    if len(set(keep)) != len(keep) or any(not 0 <= i < n_old for i in keep):
        raise ValueError(f"Invalid {side} order {keep} for {n_old} slots.")
    names = [s["name"] for s in sg[side]]
    kept = [names[o] for o in keep]
    _remap_definition(sg, side, keep)
    # Every instance of the subgraph, in the root graph and in other subgraphs.
    for g in [wf] + subs:
        for n in g.get("nodes", []):
            if n.get("type") == sg_id:
                _remap_instance(g, n, side, names, kept, widgets)
