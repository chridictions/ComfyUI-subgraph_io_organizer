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


def _remap_widget_values(n, order):
    # Promoted widget values follow the order of the instance's widget inputs. Instances that keep
    # promoted widgets by name in properties["proxyWidgets"] don't line up, and need no change.
    wv = n.get("widgets_values")
    widx = [i for i, s in enumerate(n["inputs"]) if "widget" in s]
    if not wv or len(wv) != len(widx):
        return
    pos = {i: k for k, i in enumerate(widx)}
    n["widgets_values"] = [wv[pos[o]] for o in order if o in pos]


def remap(wf, sg_id, side, keep):
    """keep: old slot indices of `side` ("inputs" or "outputs") in their new order. Slots left out are deleted with their links."""
    subs = wf["definitions"]["subgraphs"]
    sg = next((s for s in subs if s["id"] == sg_id), None)
    if sg is None:
        raise ValueError(f"Subgraph {sg_id} is not in this workflow.")
    n_old = len(sg[side])
    if len(set(keep)) != len(keep) or any(not 0 <= i < n_old for i in keep):
        raise ValueError(f"Invalid {side} order {keep} for {n_old} slots.")
    o2n = {old: new for new, old in enumerate(keep)}
    names = [s["name"] for s in sg[side]]

    # Links inside the subgraph: detach removed slots while the old indices are still valid, then shift the rest.
    io_id, end = (SG_IN, "origin") if side == "inputs" else (SG_OUT, "target")
    for l in list(sg.get("links", [])):
        f = lf(l)
        if f[f"{end}_id"] == io_id and f[f"{end}_slot"] not in o2n:
            _detach(sg, f["id"])
    for l in sg.get("links", []):
        f = lf(l)
        if f[f"{end}_id"] == io_id:
            set_slot(l, f"{end}_slot", o2n[f[f"{end}_slot"]])
    sg[side] = [sg[side][o] for o in keep]

    # Every instance of the subgraph, in the root graph and in other subgraphs. Instance slots are
    # matched to the definition by name, since older saves only store some of them.
    inst_end = "target" if side == "inputs" else "origin"
    for g in [wf] + subs:
        for n in g.get("nodes", []):
            if n.get("type") != sg_id:
                continue
            local = {s["name"]: j for j, s in enumerate(n[side])}
            if not local.keys() <= set(names):
                raise ValueError(f"Node {n['id']} has {side} that aren't in subgraph {sg_id}.")
            order = [local[names[o]] for o in keep if names[o] in local]
            l2n = {old: new for new, old in enumerate(order)}
            if side == "inputs":
                _remap_widget_values(n, order)
            for l in list(g.get("links", [])):
                f = lf(l)
                if f[f"{inst_end}_id"] == n["id"] and f[f"{inst_end}_slot"] not in l2n:
                    _detach(g, f["id"])
            for l in g.get("links", []):
                f = lf(l)
                if f[f"{inst_end}_id"] == n["id"]:
                    set_slot(l, f"{inst_end}_slot", l2n[f[f"{inst_end}_slot"]])
            n[side] = [n[side][o] for o in order]
            for i, s in enumerate(n[side]):
                if "slot_index" in s:
                    s["slot_index"] = i
