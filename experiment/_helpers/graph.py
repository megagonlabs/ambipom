"""Structural graph edit distance — vendored from the paper's analysis utils.

The library's `DAGPlan.calculate_graph_edit_distance` matches nodes by
(task, agent_name, input names, output names) — every textual attribute must
match exactly. The paper's §6.4 GED metric instead measures pure topological
divergence: strip every node/edge attribute and run networkx's GED on the
bare DAG. This file ports the paper's `graph_edit_distance_strip_attrs`.
"""

from __future__ import annotations

import networkx as nx


def _strip_attrs(g: nx.Graph) -> nx.Graph:
    h = g.__class__()
    h.add_nodes_from(g.nodes())
    h.add_edges_from(g.edges())
    return h


def graph_edit_distance_strip_attrs(
    g1: nx.Graph, g2: nx.Graph, timeout: float = 10.0
) -> float:
    return nx.graph_edit_distance(_strip_attrs(g1), _strip_attrs(g2), timeout=timeout)
