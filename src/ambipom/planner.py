"""LLM-backed plan generation and revision.

Wraps OpenAI / Fireworks clients with Pydantic structured-output and exposes the
interaction primitives used by the system UI and the plan-revision dataset:
`generate_plan`, `replan_from_ui`, `subplan_replan`, `subplan_replan_auto_reconnect`,
`refine_plan`, `auto_split_node`, `auto_merge_nodes`, plus the deterministic DM_low/high
helpers that delegate to `DAGPlan`."""

import io
import sys

from pydantic import BaseModel

from ambipom.plan import DAGPlan
from ambipom.plan_history import PlanHistory
from ambipom.prompts.atomic_refinement import (
    PROMPT_PLANNING_ATOMIC_REFINE,
    PROMPT_PLANNING_REFINEMENT_SYSTEM,
)
from ambipom.prompts.planner import (
    PROMPT_MERGE_NODE,
    PROMPT_PLANNING_SYSTEM,
    PROMPT_REPLANNING_FROM_UI,
    PROMPT_SELECTED_SUBPLAN,
    PROMPT_SPLIT_NODE,
    PROMPT_SUBPLAN_REPLAN_AUTO_RECONNECT,
    PROMPT_SYSTEM_SUBGRAPH_REPLANNING,
    PROMPT_SYSTEM_SUBGRAPH_REPLANNING_AUTO_RECONNECT,
)
from ambipom.types import (
    IOVariableOrigin,
    LLMPlan,
    RefinementPlan,
)
from ambipom.utils import (
    LOCAL_LLM_MODEL,
    fireworks_client,
    list_fireworks_model,
    list_legacy_openai_model,
    list_open_ai_model,
    local_client,
    openai_client,
)


class Planner:
    def __init__(self, config: dict = {"model": "gpt-4o", "temperature": 0}):
        # Plan Generation Prompts
        self.planning_prompt = PROMPT_PLANNING_SYSTEM
        self.replan_prompt = PROMPT_REPLANNING_FROM_UI
        self.subgraph_replan_system_prompt = PROMPT_SYSTEM_SUBGRAPH_REPLANNING
        self.split_node_prompt = PROMPT_SPLIT_NODE
        self.merge_node_prompt = PROMPT_MERGE_NODE
        self.subplan_replan_prompt = PROMPT_SELECTED_SUBPLAN
        self.subplan_replan_auto_reconnect_prompt = PROMPT_SUBPLAN_REPLAN_AUTO_RECONNECT
        self.subgraph_replan_system_prompt_auto_reconnect = (
            PROMPT_SYSTEM_SUBGRAPH_REPLANNING_AUTO_RECONNECT
        )
        # Plan Refinement Prompts
        self.atomic_refinement_system_prompt = PROMPT_PLANNING_REFINEMENT_SYSTEM
        self.atomic_refinement_prompt = PROMPT_PLANNING_ATOMIC_REFINE

        # Configuration
        self.config = config
        self.plan = DAGPlan()
        self.openai_client = openai_client
        self.list_fireworks_model = list_fireworks_model
        self.list_open_ai_model = list_open_ai_model
        self.list_legacy_openai_model = list_legacy_openai_model

        self.plan_history = PlanHistory()

        # Capture initial empty state (beginning state)
        self.capture_plan_snapshot(summary="Initial state")

    def openai_generate_plan(self, params: dict):
        try:
            response_openai = self.openai_client.responses.parse(
                **params,
            )
            return response_openai.output_parsed
        except Exception:
            # retry it one more time
            response_openai = self.openai_client.responses.parse(
                **params,
            )
            return response_openai.output_parsed

    def firework_generate_plan(
        self, model_name: str, params: dict, output_format: BaseModel = LLMPlan
    ):
        if not model_name.startswith("accounts/") and not model_name.startswith(
            "fireworks/"
        ):
            model_name = f"fireworks/{model_name}"
        try:
            response = fireworks_client.chat.completions.create(
                model=model_name,
                **params,
            )
            response_content = response.choices[0].message.content
            return output_format.parse_raw(response_content)
        except Exception:
            # retry once
            response = fireworks_client.chat.completions.create(
                model=model_name,
                **params,
            )
            response_content = response.choices[0].message.content
            return output_format.parse_raw(response_content)

    def local_generate_plan(self, params: dict, output_format: BaseModel):
        try:
            response = local_client.chat.completions.create(**params)
            return output_format.parse_raw(response.choices[0].message.content)
        except Exception:
            response = local_client.chat.completions.create(**params)
            return output_format.parse_raw(response.choices[0].message.content)

    def generate_plan_call(self, messages, output_format: BaseModel = LLMPlan):
        if self.config["model"] == "local":
            params = {
                "model": LOCAL_LLM_MODEL,
                "messages": messages,
                "temperature": self.config["temperature"],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "Result",
                        "schema": output_format.model_json_schema(),
                    },
                },
                "max_tokens": 16384,
            }
            return self.local_generate_plan(params, output_format)

        if self.config["model"] in self.list_fireworks_model:
            params = {
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "Result",
                        "schema": output_format.model_json_schema(),
                    },
                },
                "messages": messages,
                "temperature": self.config["temperature"],
                "max_tokens": 16384,
            }
            dict_result = self.firework_generate_plan(
                self.config["model"], params, output_format
            )
        elif self.config["model"] in self.list_legacy_openai_model:
            # Legacy OpenAI models (e.g. gpt-3.5-turbo) don't support json_schema structured outputs;
            # use chat.completions with json_object mode and parse manually.
            import json as _json

            schema_str = _json.dumps(output_format.model_json_schema(), indent=2)
            messages_with_schema = messages + [
                {
                    "role": "user",
                    "content": f"Respond with a valid JSON object matching this schema:\n{schema_str}",
                }
            ]
            response = self.openai_client.chat.completions.create(
                model=self.config["model"],
                messages=messages_with_schema,
                temperature=self.config["temperature"],
                response_format={"type": "json_object"},
                max_tokens=4096,
            )
            raw = response.choices[0].message.content
            parsed = _json.loads(raw)
            # gpt-3.5 sometimes returns numeric values where strings are expected; coerce them
            for node in parsed.get("nodes", []):
                for var in node.get("input", []):
                    if isinstance(var, dict) and not isinstance(var.get("value"), str):
                        var["value"] = str(var["value"])
            dict_result = output_format.model_validate(parsed)
        else:
            # handle undefined model
            model_name = self.config["model"]
            if self.config["model"] not in self.list_open_ai_model:
                model_name = "gpt-4o"
            # open ai model
            params = {
                "input": messages,
                "model": model_name,
                "temperature": self.config["temperature"],
                "text_format": output_format,
                "max_output_tokens": 16384,
            }
            dict_result = self.openai_generate_plan(params)

        return dict_result

    def generate_plan_call_with_openai_usage(
        self, messages, output_format: BaseModel = LLMPlan
    ):
        if self.config["model"] == "local":
            params = {
                "model": LOCAL_LLM_MODEL,
                "messages": messages,
                "temperature": self.config["temperature"],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "Result",
                        "schema": output_format.model_json_schema(),
                    },
                },
                "max_tokens": 16384,
            }
            response = local_client.chat.completions.create(**params)
            parsed = output_format.parse_raw(response.choices[0].message.content)
            return parsed, response.usage

        model_name = self.config["model"]
        if self.config["model"] not in self.list_open_ai_model:
            model_name = "gpt-4o"
        # open ai model
        params = {
            "input": messages,
            "model": model_name,
            "temperature": self.config["temperature"],
            "text_format": output_format,
            "max_output_tokens": 16384,
        }
        response_openai = self.openai_client.responses.parse(
            **params,
        )
        return response_openai.output_parsed, response_openai.usage

    def generate_plan(self, task: str):
        messages = [
            {"role": "system", "content": self.planning_prompt},
            {"role": "user", "content": task},
        ]

        dict_result = self.generate_plan_call(messages, LLMPlan)

        self.plan = DAGPlan(query=task).initialize_from_llm_plan(dict_result)

        # Capture history snapshot after generating plan
        self.capture_plan_snapshot(summary="Generated a new plan")

    def execute_plan(self):
        order = self.get_plan_order()
        for node_id in order:
            self.plan.execute_node(node_id)

    def execute_node(self, node_id: int):
        self.plan.execute_node(node_id)

    def reset_plan(self):
        self.plan = DAGPlan()

    def extract_executed_outputs_and_inputs(self, node_id: int):
        return self.plan.extract_executed_outputs_and_inputs(node_id)

    def extract_all_executed_outputs_and_inputs(self):
        return self.plan.extract_all_executed_outputs_and_inputs()

    def get_latest_log(self, node_id: int):
        return self.plan.get_latest_log(node_id, "start_execution")

    def refine_plan(self, feedback: str):
        """
        Refine the current plan using atomic operations based on user feedback.
        Unlike replan(), this applies minimal edits via tool calls instead of regenerating the entire plan.

        Args:
            feedback: User feedback describing what changes to make to the plan

        Returns:
            dict: The tool calls executed and the reasoning
        """
        current_plan = self.plan.get_llm_plan()

        messages = [
            {"role": "system", "content": self.atomic_refinement_system_prompt},
            {
                "role": "user",
                "content": self.atomic_refinement_prompt % (current_plan, feedback),
            },
        ]

        # Get the LLM response with tool calls (and token usage)
        dict_result, usage = self.generate_plan_call_with_openai_usage(
            messages, RefinementPlan
        )

        # Execute all tool calls
        execution_results = self._execute_tool_calls(dict_result.tool_calls)

        # Capture history snapshot after refinement
        self.capture_plan_snapshot(summary="Refined the plan with atomic operations")

        return {
            "tool_calls": dict_result.tool_calls,
            "reason": dict_result.reason,
            "execution_results": execution_results,
            "usage": {
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "total_tokens": usage.total_tokens,
            },
        }

    def replan_from_ui(self, user_message, conversation_history, ui_plan):
        current_plan = DAGPlan().initialize_from_ui_plan(ui_plan).get_llm_plan()

        message = [
            {"role": "system", "content": self.planning_prompt},
            {
                "role": "user",
                "content": self.replan_prompt
                % (conversation_history, current_plan, user_message),
            },
        ]

        dict_result = self.generate_plan_call(message, LLMPlan)

        # Preserve the original task as `query`. The replan prompt template is what
        # the LLM saw, not what the plan is "about" — overwriting query with it
        # would surface prompt boilerplate as a "user message" on later reload.
        original_query = self.plan.query
        self.plan = DAGPlan(query=original_query).initialize_from_llm_plan(dict_result)

        # Capture history snapshot after replanning from UI
        self.capture_plan_snapshot(summary="Replanned the plan")

    def get_dag_plan(self) -> DAGPlan:
        return self.plan.get_dag()

    def get_llm_plan(self) -> LLMPlan:
        return self.plan.get_llm_plan()

    def get_ui_plan(self):
        return self.plan.get_ui_plan()

    def get_ui_node(self, node_id: int):
        return self.plan.get_ui_node(node_id)

    def get_llm_node(self, node_id: int):
        return self.plan.get_llm_node(node_id)

    def get_llm_edge(self, node_id: int):
        return self.plan.get_llm_edge(node_id)

    def add_node(self, node_data: dict = None) -> int:
        if node_data is None:
            node_data = {}
        return self.plan.add_node(node_data)

    def duplicate_node(self, node_id: int, updated_by: IOVariableOrigin) -> int:
        return self.plan.duplicate_node(node_id, updated_by)

    def add_edge(self, src_id: int, dest_id: int, src_output: str, dest_input: str):
        self.plan.add_edge(src_id, dest_id, src_output, dest_input)

    def remove_edge(self, src_id, dest_id, src_output, dest_input):
        self.plan.remove_edge(src_id, dest_id, src_output, dest_input)

    def get_node(self, node_id):
        return self.plan.get_node(node_id)

    def update_node(self, node_id, node_data: dict):
        self.plan.update_node(node_id, node_data)

    def update_node_task_description(self, node_id, task_description: str):
        self.plan.update_node_task_description(node_id, task_description)

    def update_node_agent_name(self, node_id, agent_name: str):
        self.plan.update_node_agent_name(node_id, agent_name)

    def update_node_config(self, node_id, config: dict):
        self.plan.update_node_config(node_id, config)

    def remove_node(self, node_id):
        self.plan.remove_node(node_id)

    def add_input_variable_key(
        self, node_id, input_variable: str, updated_by: IOVariableOrigin
    ):
        self.plan.add_input_variable_key(node_id, input_variable, updated_by)

    def remove_input_variable_key(self, node_id, input_variable: str):
        self.plan.remove_input_variable_key(node_id, input_variable)

    def add_output_variable_key(
        self, node_id, output_variable: str, updated_by: IOVariableOrigin
    ):
        self.plan.add_output_variable_key(node_id, output_variable, updated_by)

    def remove_output_variable_key(self, node_id, output_variable: str):
        self.plan.remove_output_variable_key(node_id, output_variable)

    def modify_input_variable_key(
        self,
        node_id,
        old_input_name: str,
        new_input_name: str,
        updated_by: IOVariableOrigin,
    ):
        self.plan.modify_input_variable_key(
            node_id, old_input_name, new_input_name, updated_by
        )

    def modify_output_variable_key(
        self,
        node_id,
        old_output_name: str,
        new_output_name: str,
        updated_by: IOVariableOrigin,
    ):
        self.plan.modify_output_variable_key(
            node_id, old_output_name, new_output_name, updated_by
        )

    def assign_input_variable_value(
        self,
        node_id,
        input_variable: str,
        value: str,
        updated_by: IOVariableOrigin,
    ):
        self.plan.assign_input_variable_value(
            node_id, input_variable, value, updated_by
        )

    def assign_output_variable_value(
        self,
        node_id,
        output_variable: str,
        value: str,
        updated_by: IOVariableOrigin,
    ):
        self.plan.assign_output_variable_value(
            node_id, output_variable, value, updated_by
        )

    def propagate_output_value(self, node_id: int, output_variable: str) -> list[int]:
        return self.plan.propagate_output_value(node_id, output_variable)

    def get_plan_order(self):
        return self.plan.get_plan_order()

    def load_plan(self, file_path: str):
        self.plan, initial_query, assistant_response = DAGPlan().load_plan(file_path)
        return initial_query, assistant_response

    # Split/merge ops accept `connected_edges` from the UI as the currently-selected edge
    # context. Not consumed today — edges are derived internally via `get_llm_edge` —
    # kept on the shared signature so future edge-aware variants can hook it up without
    # touching the UI dispatch.

    def auto_split_node(self, node_id: int, connected_edges: list[dict]):
        node_info = self.get_llm_node(node_id)
        edge_info = self.get_llm_edge(node_id)
        # whole_plan = self.get_llm_plan()

        message = [
            {"role": "system", "content": self.subgraph_replan_system_prompt},
            {
                "role": "user",
                "content": self.split_node_prompt
                % (f"Node: {node_info}\nEdge: {edge_info}"),
            },
        ]
        dict_result = self.generate_plan_call(message, LLMPlan)

        list_node = dict_result.nodes
        list_edge = dict_result.edges

        for i in range(len(list_node)):
            list_node[i] = self.plan.convert_llm_node_to_dag(list_node[i])
        for i in range(len(list_edge)):
            list_edge[i] = self.plan.convert_llm_edge_to_dag(list_edge[i])

        self.plan.split_node(node_id, list_node, list_edge, IOVariableOrigin.PLANNER)

    def sequential_split_node(
        self,
        node_id: int,
        connected_edges: list[dict],
        updated_by: IOVariableOrigin,
    ):
        self.plan.sequential_split_node(node_id, updated_by)

    def check_nodes_mergeable(self, node_ids: list[int]):
        return self.plan.is_convex_set_cached(node_ids)

    def auto_merge_nodes(self, node_ids: list[int], connected_edges: list[dict]):
        node_info = []
        temp_edge_info = []
        for node_id in node_ids:
            node_llm = self.get_llm_node(node_id)
            if node_llm is None:
                raise ValueError(
                    f"Node {node_id} does not exist in the plan. Cannot auto merge."
                )
            node_info.append(node_llm)

            edge_llm = self.get_llm_edge(node_id)
            if edge_llm is not None:
                temp_edge_info.append(edge_llm)

        edge_info = self.plan.unique_edges_from_list_edges(temp_edge_info)

        message = [
            {"role": "system", "content": self.subgraph_replan_system_prompt},
            {
                "role": "user",
                "content": self.merge_node_prompt
                % (f"Node: {node_info}\nEdge: {edge_info}"),
            },
        ]

        dict_result = self.generate_plan_call(message, LLMPlan)

        list_node = dict_result.nodes
        list_edge = dict_result.edges

        for i in range(len(list_node)):
            list_node[i] = self.plan.convert_llm_node_to_dag(list_node[i])
        for i in range(len(list_edge)):
            list_edge[i] = self.plan.convert_llm_edge_to_dag(list_edge[i])

        merged_node = list_node[0]

        self.plan.merge_node(node_ids, merged_node, list_edge, IOVariableOrigin.PLANNER)

    def force_merge_nodes(self, node_ids: list[int], connected_edges: list[dict]):
        self.plan.force_merge_nodes(node_ids, IOVariableOrigin.USER)

    def subplan_replan(
        self, user_message, conversation_history, ui_plan, selected_nodes
    ):
        node_info = []
        temp_edge_info = []
        for node_id in selected_nodes:
            node_info.append(self.get_llm_node(node_id))
            temp_edge_info.append(self.get_llm_edge(node_id))

        edge_info = self.plan.unique_edges_from_list_edges(temp_edge_info)

        message = [
            {"role": "system", "content": self.subgraph_replan_system_prompt},
            {
                "role": "user",
                "content": self.subplan_replan_prompt
                % (f"Node: {node_info}\nEdge: {edge_info}", user_message),
            },
        ]
        dict_result = self.generate_plan_call(message, LLMPlan)
        list_node = dict_result.nodes
        list_edge = dict_result.edges

        for i in range(len(list_node)):
            list_node[i] = self.plan.convert_llm_node_to_dag(list_node[i])
        for i in range(len(list_edge)):
            list_edge[i] = self.plan.convert_llm_edge_to_dag(list_edge[i])

        self.plan.subplan_replan(
            selected_nodes, list_node, list_edge, IOVariableOrigin.PLANNER
        )

        # Capture history snapshot after subplan replanning
        self.capture_plan_snapshot(summary="Replanned the targeted subplan")

    def subplan_replan_auto_reconnect(self, user_message, selected_nodes):
        node_info = []
        temp_edge_info = []
        for node_id in selected_nodes:
            node_info.append(self.get_llm_node(node_id))
            temp_edge_info.append(self.get_llm_edge(node_id))

        edge_info = self.plan.unique_edges_from_list_edges(temp_edge_info)

        external_node_info = []
        for src_id, dest_id, src_output, dest_input in edge_info:
            if src_id in selected_nodes and dest_id not in selected_nodes:
                external_node_info.append(self.get_llm_node(src_id))
            if dest_id in selected_nodes and src_id not in selected_nodes:
                external_node_info.append(self.get_llm_node(dest_id))

        message = [
            {
                "role": "system",
                "content": self.subgraph_replan_system_prompt_auto_reconnect,
            },
            {
                "role": "user",
                "content": self.subplan_replan_auto_reconnect_prompt
                % (
                    f"Node: {node_info}\nEdge: {edge_info}",
                    f"External Node: {external_node_info}",
                    user_message,
                ),
            },
        ]
        dict_result = self.generate_plan_call(message, LLMPlan)

        list_node = dict_result.nodes
        list_edge = dict_result.edges

        for i in range(len(list_node)):
            list_node[i] = self.plan.convert_llm_node_to_dag(list_node[i])
        for i in range(len(list_edge)):
            list_edge[i] = self.plan.convert_llm_edge_to_dag(list_edge[i])

        self.plan.subplan_replan_auto_reconnect(
            selected_nodes, list_node, list_edge, IOVariableOrigin.PLANNER
        )

        # Capture history snapshot after subplan replanning
        self.capture_plan_snapshot(
            summary="Replanned the targeted subplan and automatically reconnected the external nodes"
        )

    def capture_plan_snapshot(self, changes=None, summary=""):
        """
        Capture a snapshot of the current plan state and add it to history.

        Args:
            changes: Optional dict specifying what changed:
                {
                    "modified_nodes": [node_id1, node_id2, ...],
                    "deleted_nodes": [node_id3, ...],
                    "modified_edges": [edge_key1, edge_key2, ...],
                    "deleted_edges": [edge_key3, ...]
                }
            summary: Human-readable summary of this action

        Returns:
            int: The index of the snapshot
        """
        # Get current plan state from networkx graph
        nodes = {}
        for node_id, node_data in self.plan.dag.nodes(data=True):
            # Create a copy excluding agent_instance (not serializable due to thread locks and HTTP clients)
            # The agent_instance will be recreated from agent_name when restoring
            node_copy = {}
            for key, value in node_data.items():
                if key == "agent_instance":
                    node_copy["agent_config"] = value.get_config()
                else:
                    node_copy[key] = value
            nodes[node_id] = node_copy

        # Get edges
        edges = []
        for src_id, dest_id, edge_data in self.plan.dag.edges(data=True):
            edges.append(
                {
                    "src_node": src_id,
                    "dest_node": dest_id,
                    "src_output": edge_data.get("src_output", ""),
                    "dest_input": edge_data.get("dest_input", ""),
                }
            )

        # Record snapshot
        snapshot_index = self.plan_history.snapshot(nodes, edges, changes, summary)
        return snapshot_index

    def get_plan_history(self):
        """Get the complete plan history."""
        return self.plan_history.get_history()

    def get_plan_state_at_index(self, index: int):
        """Get the reconstructed plan state at a specific index."""
        return self.plan_history.get_state_at_index(index)

    def get_latest_plan_state_from_history(self):
        """Get the latest plan state from history."""
        return self.plan_history.get_latest_state()

    def clear_plan_history(self):
        """Clear all plan history."""
        self.plan_history.clear_history()

    def get_snapshot_count(self):
        """Get the total number of snapshots in history."""
        return self.plan_history.get_snapshot_count()

    def update_positions_in_latest_snapshot(self, positions: dict):
        """
        Update node positions in the latest history snapshot.
        Called by frontend after rendering is complete.

        Args:
            positions: Dict mapping node_id to position {"node_id": {"x": float, "y": float}}
        """
        self.plan_history.update_positions_in_latest_snapshot(positions)

    def can_undo(self) -> bool:
        """Check if undo is available."""
        return self.plan_history.can_undo()

    def can_redo(self) -> bool:
        """Check if redo is available."""
        return self.plan_history.can_redo()

    def undo(self):
        """
        Undo the last action by restoring the previous plan state.

        Returns:
            dict: Complete state including node data and positions, or None if undo is not available
        """
        previous_state = self.plan_history.undo()
        if previous_state is None:
            return None

        # Restore the plan DAG from the previous state (excluding positions)
        self._restore_plan_from_state(previous_state)

        # Convert state to UI format with positions for frontend
        return self._state_to_ui_plan(previous_state)

    def redo(self):
        """
        Redo the last undone action by restoring the next plan state.

        Returns:
            dict: Complete state including node data and positions, or None if redo is not available
        """
        next_state = self.plan_history.redo()
        if next_state is None:
            return None

        # Restore the plan DAG from the next state (excluding positions)
        self._restore_plan_from_state(next_state)

        # Convert state to UI format with positions for frontend
        return self._state_to_ui_plan(next_state)

    def _restore_plan_from_state(self, state: dict):
        """
        Restore the plan's DAG from a history state.
        Note: This does NOT restore positions - positions are handled separately for frontend.

        Args:
            state: State dict from plan history containing node and edge data
        """
        # Clear the current DAG
        self.plan.dag.clear()

        # Restore nodes (excluding positions, recreating agent_instance)
        for key, value in state.items():
            if key.startswith("node_"):
                node_id = int(key.split("_")[1])
                # Create a copy excluding position (UI-only)
                node_data = {}
                for k, v in value.items():
                    if k != "position":
                        node_data[k] = v

                # Recreate agent_instance from agent_name (agent_instance is not serializable)
                if "agent_name" in node_data:
                    # Extract config from agent_config if available (saved during snapshot)
                    if "agent_config" in node_data:
                        agent_config = node_data["agent_config"]
                    else:
                        # Fallback for backward compatibility
                        agent_config = {
                            "model": node_data.get("modelName", "gpt-4o-mini"),
                            "temperature": node_data.get("temperature", 0),
                        }
                    node_data["agent_instance"] = self.plan._create_agent_for_node(
                        node_data["agent_name"], agent_config
                    )

                self.plan.dag.add_node(node_id, **node_data)

        # Restore edges
        for key, value in state.items():
            if key.startswith("edge_"):
                # Use the edge data from value, not by parsing the key
                # The value contains: {'src_node', 'dest_node', 'src_output', 'dest_input'}
                src_id = value["src_node"]
                dest_id = value["dest_node"]
                src_output = value.get("src_output", "")
                dest_input = value.get("dest_input", "")

                self.plan.dag.add_edge(
                    src_id, dest_id, src_output=src_output, dest_input=dest_input
                )

    def _state_to_ui_plan(self, state: dict):
        """
        Convert a history state to UI plan format with positions.
        This should match the format from get_ui_plan() but include positions.

        Args:
            state: State dict from plan history

        Returns:
            dict: UI plan with nodes (including positions) and edges
        """
        nodes = []
        edges = []

        # Convert nodes with positions
        for key, value in state.items():
            if key.startswith("node_"):
                node_id = int(key.split("_")[1])

                # Get position and ensure it's JSON-serializable
                position = value.get("position", {})
                x_pos = (
                    float(position.get("x", 0))
                    if position.get("x") is not None
                    else 0.0
                )
                y_pos = (
                    float(position.get("y", 0))
                    if position.get("y") is not None
                    else 0.0
                )

                # Extract agent config for UI
                agent_config = value.get("agent_config", {})
                model_name = (
                    agent_config.get("model", "gpt-4o-mini")
                    if agent_config
                    else "gpt-4o-mini"
                )
                temperature = agent_config.get("temperature", 0) if agent_config else 0

                # Get execution_log as list - FastAPI will serialize it automatically
                execution_log = value.get("execution_log", [])

                node_ui = {
                    "id": node_id,
                    "task": str(value.get("task", "")),
                    "agent_name": str(value.get("agent_name", "")),
                    "input": {},
                    "output": {},
                    "execution_log": execution_log,
                    "x": x_pos,
                    "y": y_pos,
                    "modelName": model_name,
                    "temperature": temperature,
                }
                if "input" in value:
                    # Extract only the value field and ensure it's JSON-serializable
                    node_ui["input"] = {
                        str(input_key): str(value["input"][input_key]["value"])
                        if value["input"][input_key]["value"] is not None
                        else ""
                        for input_key in value["input"]
                    }
                if "output" in value:
                    # Extract only the value field and ensure it's JSON-serializable
                    node_ui["output"] = {
                        str(output_key): str(value["output"][output_key]["value"])
                        if value["output"][output_key]["value"] is not None
                        else ""
                        for output_key in value["output"]
                    }
                nodes.append(node_ui)

        # Convert edges - use same format as get_ui_plan() (src_id, dest_id, src_output, dest_input)
        for key, value in state.items():
            if key.startswith("edge_"):
                edge_ui = {
                    "src_id": int(value["src_node"]),
                    "dest_id": int(value["dest_node"]),
                    "src_output": str(value["src_output"]),
                    "dest_input": str(value["dest_input"]),
                }
                edges.append(edge_ui)

        return {"nodes": nodes, "edges": edges}

    def _args_to_dict(self, args_list, output_holders):
        """
        Convert List[AtomicToolArgs] to a dictionary.

        Args:
            args_list: List of AtomicToolArgs objects with key, value, and output_holder
            output_holders: Dictionary mapping output_holder names to their actual values
        Returns:
            dict: Converted arguments dictionary
        """
        result = {}
        for arg in args_list:
            # Skip empty keys (for add_node which has no args)
            if not arg.key:
                continue

            value = arg.value

            # If the value references an output_holder, resolve it
            if value in output_holders:
                value = output_holders[value]
            # Otherwise, try to convert to int if it looks like a number
            elif value.isdigit():
                value = int(value)

            result[arg.key] = value
        return result

    def _execute_tool_calls(self, tool_calls):
        """
        Execute a list of tool calls sequentially.

        Each result dict includes a ``printed_output`` field containing any text
        that was printed to stdout during that specific tool call (warnings,
        errors from deeper plan operations, etc.).  The output is also echoed to
        the real stdout so console visibility is preserved.

        Args:
            tool_calls: List of ToolCall objects

        Returns:
            list: List of execution results for each tool call, each containing:
                - tool: tool name
                - status: "success" or "error"
                - printed_output: captured stdout text for this call (or None)
                - (plus tool-specific fields)
        """
        results = []
        output_holders = {}  # Store return values from tools that return results

        for tool_call in tool_calls:
            tool_name = tool_call.tool
            args_dict = self._args_to_dict(tool_call.args, output_holders)

            # Extract output_holder name (if any)
            output_holder_name = ""
            for arg in tool_call.args:
                if arg.output_holder:
                    output_holder_name = arg.output_holder
                    break

            # Redirect stdout so we can capture prints from this tool call
            # while still echoing them to the real console (tee behaviour).
            _capture = io.StringIO()
            _real_stdout = sys.stdout
            sys.stdout = _capture

            tool_result = None

            try:
                # Map tool names to planner methods
                if tool_name == "add_node":
                    new_node_id = self.add_node()
                    # Store the result in output_holders if an output_holder is specified
                    if output_holder_name:
                        output_holders[output_holder_name] = new_node_id
                    tool_result = {
                        "tool": tool_name,
                        "status": "success",
                        "new_node_id": new_node_id,
                        "output_holder": output_holder_name,
                    }

                elif tool_name == "remove_node":
                    self.remove_node(args_dict["node_id"])
                    tool_result = {
                        "tool": tool_name,
                        "status": "success",
                        "node_id": args_dict["node_id"],
                    }

                elif tool_name == "add_edge":
                    self.add_edge(
                        args_dict["src_node"],
                        args_dict["dest_node"],
                        args_dict["src_output"],
                        args_dict["dest_input"],
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "remove_edge":
                    self.remove_edge(
                        args_dict["src_node"],
                        args_dict["dest_node"],
                        args_dict["src_output"],
                        args_dict["dest_input"],
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "update_node_task_description":
                    self.update_node_task_description(
                        args_dict["node_id"], args_dict["task_description"]
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "update_node_agent_name":
                    self.update_node_agent_name(
                        args_dict["node_id"], args_dict["agent_name"]
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "duplicate_node":
                    new_node_id = self.duplicate_node(
                        args_dict["node_id"], IOVariableOrigin.PLANNER
                    )
                    # Store the result in output_holders if an output_holder is specified
                    if output_holder_name:
                        output_holders[output_holder_name] = new_node_id
                    tool_result = {
                        "tool": tool_name,
                        "status": "success",
                        "new_node_id": new_node_id,
                        "output_holder": output_holder_name,
                    }

                elif tool_name == "add_input_variable_key":
                    self.add_input_variable_key(
                        args_dict["node_id"],
                        args_dict["input_variable"],
                        IOVariableOrigin.PLANNER,
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "remove_input_variable_key":
                    self.remove_input_variable_key(
                        args_dict["node_id"], args_dict["input_variable"]
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "modify_input_variable_key":
                    self.modify_input_variable_key(
                        args_dict["node_id"],
                        args_dict["key_from_value"],
                        args_dict["key_to_value"],
                        IOVariableOrigin.PLANNER,
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "assign_input_variable_value":
                    self.assign_input_variable_value(
                        args_dict["node_id"],
                        args_dict["input_variable"],
                        args_dict["value"],
                        IOVariableOrigin.PLANNER,
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "add_output_variable_key":
                    self.add_output_variable_key(
                        args_dict["node_id"],
                        args_dict["output_variable"],
                        IOVariableOrigin.PLANNER,
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "remove_output_variable_key":
                    self.remove_output_variable_key(
                        args_dict["node_id"], args_dict["output_variable"]
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "modify_output_variable_key":
                    self.modify_output_variable_key(
                        args_dict["node_id"],
                        args_dict["key_from_value"],
                        args_dict["key_to_value"],
                        IOVariableOrigin.PLANNER,
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "assign_output_variable_value":
                    self.assign_output_variable_value(
                        args_dict["node_id"],
                        args_dict["output_variable"],
                        args_dict["value"],
                        IOVariableOrigin.PLANNER,
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "modify_edge_src_output":
                    # First remove old edge, then add new edge
                    self.remove_edge(
                        args_dict["src_node"],
                        args_dict["dest_node"],
                        args_dict["src_output"],
                        args_dict["dest_input"],
                    )
                    self.add_edge(
                        args_dict["new_src_id"],
                        args_dict["dest_node"],
                        args_dict["new_src_output"],
                        args_dict["dest_input"],
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                elif tool_name == "modify_edge_dest_input":
                    # First remove old edge, then add new edge
                    self.remove_edge(
                        args_dict["src_node"],
                        args_dict["dest_node"],
                        args_dict["src_output"],
                        args_dict["dest_input"],
                    )
                    self.add_edge(
                        args_dict["src_node"],
                        args_dict["new_dest_id"],
                        args_dict["src_output"],
                        args_dict["new_dest_input"],
                    )
                    tool_result = {"tool": tool_name, "status": "success"}

                else:
                    error_msg = f"Unknown tool: {tool_name}"
                    print(f"ERROR: {error_msg}")
                    tool_result = {
                        "tool": tool_name,
                        "status": "error",
                        "error": error_msg,
                    }

            except Exception as e:
                error_msg = f"Error executing {tool_name}: {str(e)}"
                print(f"ERROR: {error_msg}")
                tool_result = {
                    "tool": tool_name,
                    "status": "error",
                    "error": error_msg,
                }

            finally:
                # Restore real stdout
                sys.stdout = _real_stdout
                _printed = _capture.getvalue()
                # Echo captured output to the real console
                if _printed:
                    _real_stdout.write(_printed)
                # Attach captured output to the result; demote "success" → "warning"
                # if anything was printed (unexpected output from deeper operations)
                if tool_result is not None:
                    _printed_stripped = _printed.strip()
                    tool_result["printed_output"] = (
                        _printed_stripped if _printed_stripped else None
                    )
                    if _printed_stripped and tool_result.get("status") == "success":
                        tool_result["status"] = "warning"
                    results.append(tool_result)

        return results
