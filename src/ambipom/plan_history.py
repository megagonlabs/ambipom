"""
Plan History Module

This module manages the temporal state tracking of plan modifications.
Each snapshot contains a summary and the plan state (delta-based).

Structure:
[
    {  # Index 0
        "summary": "Initial plan created",
        "plan": {
            "node_id_1": {...full node data...},
            "node_id_2": {...full node data...},
            "edge_src_1_dest_2": [{...edge data...}]
        }
    },
    {  # Index 1
        "summary": "Added node_3 and removed node_2",
        "plan": {
            "node_id_1": {...updated node data...},
            "edge_src_1_dest_2": {}  # empty = unchanged
            # node_id_2 missing = deleted
        }
    }
]

Semantics for plan data:
- Key with data: node/edge was created or updated
- Key with empty dict/list {}: node/edge unchanged from previous snapshot
- Key missing entirely: node/edge was deleted (if existed before) or never existed
"""

import copy
from typing import Any, Dict, List, Optional


class PlanHistory:
    """Manages temporal state tracking for plan modifications."""

    def __init__(self):
        """Initialize an empty plan history."""
        self.history: List[Dict[str, Any]] = []
        self._current_state: Dict[str, Any] = {}  # Cache of current full state
        self._current_step_index: int = (
            -1
        )  # Track current position in history (-1 = no history yet)

    def snapshot(
        self,
        nodes: Dict[int, Any],
        edges: List[Dict[str, Any]],
        changes: Optional[Dict[str, Any]] = None,
        summary: str = "",
    ) -> int:
        """
        Record a new snapshot in history.

        Args:
            nodes: Current nodes dict {node_id: node_data}
            edges: Current edges list
            changes: Optional dict specifying what changed:
                {
                    "modified_nodes": [node_id1, node_id2, ...],
                    "deleted_nodes": [node_id3, ...],
                    "modified_edges": [edge_key1, edge_key2, ...],
                    "deleted_edges": [edge_key3, ...]
                }
                If None, assume all nodes/edges are new or modified.
            summary: Human-readable summary of this action (e.g., "Added node 3", "Removed edge 1->2")

        Returns:
            index: The index of this snapshot in the history list
        """
        snapshot_data = {}

        # Convert edges list to dict with composite keys
        edges_dict = {}
        for edge in edges:
            edge_key = self._create_edge_key(
                edge.get("src_node") or edge.get("source"),
                edge.get("dest_node") or edge.get("target"),
                edge.get("src_output", ""),
                edge.get("dest_input", ""),
            )
            edges_dict[edge_key] = edge

        # If this is the first snapshot, record everything
        if not self.history:
            # Record all nodes
            for node_id, node_data in nodes.items():
                node_key = f"node_{node_id}"
                snapshot_data[node_key] = copy.deepcopy(node_data)

            # Record all edges
            for edge_key, edge_data in edges_dict.items():
                snapshot_data[edge_key] = copy.deepcopy(edge_data)

            self._current_state = copy.deepcopy(snapshot_data)
        else:
            # Incremental snapshot
            if changes:
                # Process nodes
                for node_id, node_data in nodes.items():
                    node_key = f"node_{node_id}"

                    if node_id in changes.get("modified_nodes", []):
                        # Node was modified
                        snapshot_data[node_key] = copy.deepcopy(node_data)
                    elif node_key in self._current_state:
                        # Node exists but unchanged
                        snapshot_data[node_key] = {}

                # Mark deleted nodes (they simply won't appear in snapshot_data)
                # No action needed - missing key means deleted

                # Process edges
                for edge_key, edge_data in edges_dict.items():
                    if edge_key in changes.get("modified_edges", []):
                        # Edge was modified
                        snapshot_data[edge_key] = copy.deepcopy(edge_data)
                    elif edge_key in self._current_state:
                        # Edge exists but unchanged
                        snapshot_data[edge_key] = {}

                # Mark deleted edges (they simply won't appear in snapshot_data)
                # No action needed - missing key means deleted
            else:
                # No changes specified - treat all as potentially modified
                # This is a fallback for when we don't track changes explicitly
                for node_id, node_data in nodes.items():
                    node_key = f"node_{node_id}"
                    snapshot_data[node_key] = copy.deepcopy(node_data)

                for edge_key, edge_data in edges_dict.items():
                    snapshot_data[edge_key] = copy.deepcopy(edge_data)

            # Update current state cache
            # Remove deleted items
            new_state = {}
            for key in snapshot_data:
                if snapshot_data[key]:  # Has data (created/modified)
                    new_state[key] = snapshot_data[key]
                elif key in self._current_state:  # Empty (unchanged)
                    new_state[key] = self._current_state[key]

            self._current_state = new_state

        # When adding a new snapshot:
        # 1. If we're not at the latest position (user did undo), we need to truncate future history
        # 2. Add the new snapshot at the current position + 1

        if self._current_step_index < len(self.history) - 1:
            # User has done undo and is now making a change
            # Remove all future snapshots (redo history is lost)
            self.history = self.history[: self._current_step_index + 1]

        # Create snapshot entry with summary and plan data
        snapshot_entry = {
            "summary": summary or "Snapshot created",
            "plan": snapshot_data,
        }

        # Append the new snapshot
        self.history.append(snapshot_entry)

        # Update current step index to point to this new snapshot
        self._current_step_index = len(self.history) - 1

        return self._current_step_index

    def get_current_step_index(self) -> int:
        """Return the index of the current snapshot within history (-1 if empty)."""
        return self._current_step_index

    def get_history(self) -> List[Dict[str, Any]]:
        """
        Get the complete history.

        Returns:
            Complete history list
        """
        return copy.deepcopy(self.history)

    def get_state_at_index(self, target_index: int) -> Dict[str, Any]:
        """
        Reconstruct the complete state at a specific index.

        Args:
            target_index: The index to reconstruct

        Returns:
            Complete state dict at that index
        """
        if target_index < 0 or target_index >= len(self.history):
            raise ValueError(f"Index {target_index} not found in history")

        state = {}

        # Get all snapshots up to and including target index
        relevant_snapshots = self.history[: target_index + 1]

        # Apply changes from each snapshot
        for snapshot_entry in relevant_snapshots:
            snapshot = snapshot_entry["plan"]  # Extract plan data from snapshot entry
            keys_in_snapshot = set(snapshot.keys())
            keys_in_state = set(state.keys())

            # First, update/create entries that are in the snapshot
            for key, value in snapshot.items():
                if value:  # Has data (created/modified)
                    state[key] = copy.deepcopy(value)
                # If value is empty, the key still exists but is unchanged
                # so we don't modify state[key] if it exists

            # Then, delete keys that are no longer in the snapshot
            # (missing key = deleted)
            deleted_keys = keys_in_state - keys_in_snapshot
            for key in deleted_keys:
                del state[key]

        return state

    def get_latest_state(self) -> Dict[str, Any]:
        """
        Get the latest complete state.

        Returns:
            Latest complete state dict
        """
        return copy.deepcopy(self._current_state)

    def clear_history(self):
        """Clear all history and reset to empty state."""
        self.history = []
        self._current_state = {}
        self._current_step_index = -1

    def _create_edge_key(
        self, src_node: int, dest_node: int, src_output: str = "", dest_input: str = ""
    ) -> str:
        """
        Create a consistent edge key.

        Args:
            src_node: Source node ID
            dest_node: Destination node ID
            src_output: Source output variable
            dest_input: Destination input variable

        Returns:
            Edge key string
        """
        # Include output/input variables in the key to handle multiple edges between same nodes
        return f"edge_{src_node}_{dest_node}_{src_output}_{dest_input}"

    def get_snapshot_count(self) -> int:
        """
        Get the total number of snapshots in history.

        Returns:
            Number of snapshots
        """
        return len(self.history)

    def update_positions_in_latest_snapshot(
        self, positions: Dict[str, Dict[str, float]]
    ):
        """
        Update node positions in the latest snapshot.
        Only updates positions for nodes that are provided.

        Args:
            positions: Dict mapping node_id (as string) to position dict
                {
                    "1": {"x": 100, "y": 200},
                    "2": {"x": 300, "y": 400}
                }
        """
        if not self.history:
            return  # No snapshots to update

        # Get the latest snapshot's plan data
        latest_snapshot = self.history[-1]["plan"]

        # Update positions for all nodes
        for node_id, position in positions.items():
            node_key = f"node_{node_id}"

            # Ensure node exists in snapshot (materialize if needed)
            if node_key not in latest_snapshot:
                # Node not in snapshot - add it from current state if available
                if node_key in self._current_state:
                    latest_snapshot[node_key] = copy.deepcopy(
                        self._current_state[node_key]
                    )
                else:
                    # Node doesn't exist anywhere - skip it
                    continue
            elif not latest_snapshot[node_key]:
                # Node is in snapshot but empty (unchanged) - materialize from current state
                if node_key in self._current_state:
                    latest_snapshot[node_key] = copy.deepcopy(
                        self._current_state[node_key]
                    )

            # At this point, node should have data in the snapshot
            if latest_snapshot[node_key]:
                latest_snapshot[node_key]["position"] = position

            # Also update current state
            if node_key in self._current_state:
                self._current_state[node_key]["position"] = position

    def can_undo(self) -> bool:
        """
        Check if undo is available.

        Returns:
            True if we can undo (current step > 0), False otherwise
        """
        # Can undo if we have history and we're not at the first step (index 0)
        return len(self.history) > 1 and self._current_step_index > 0

    def can_redo(self) -> bool:
        """
        Check if redo is available.

        Returns:
            True if we can redo (current step < last step), False otherwise
        """
        if not self.history:
            return False
        return self._current_step_index < len(self.history) - 1

    def undo(self) -> Optional[Dict[str, Any]]:
        """
        Move back one step in history.

        Returns:
            The state at the previous step, or None if undo is not available
        """
        if not self.can_undo():
            return None

        # Move back one step
        self._current_step_index -= 1

        # Reconstruct and cache the state at this step
        state = self.get_state_at_index(self._current_step_index)
        self._current_state = state

        return copy.deepcopy(state)

    def redo(self) -> Optional[Dict[str, Any]]:
        """
        Move forward one step in history.

        Returns:
            The state at the next step, or None if redo is not available
        """
        if not self.can_redo():
            return None

        # Move forward one step
        self._current_step_index += 1

        # Reconstruct and cache the state at this step
        state = self.get_state_at_index(self._current_step_index)
        self._current_state = state

        return copy.deepcopy(state)
