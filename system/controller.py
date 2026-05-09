"""Per-session UI-event dispatcher. Translates frontend interactions into calls on
`Planner` / `DAGPlan`, captures plan-history snapshots, and builds human-readable
change summaries for the chat panel."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO

from ambipom.planner import Planner
from ambipom.types import IOVariableOrigin
from ambipom.utils import current_exact_time


class Controller:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.interaction_log = []
        self.chat_history = []
        self.planner = Planner()

    def process_ui_interaction(self, interaction_data: dict):
        self.interaction_log.append(interaction_data)

        buf = StringIO()

        response_message = {"type": interaction_data["type"]}

        # Process the ui interaction and capture the output
        try:
            with redirect_stdout(buf), redirect_stderr(buf):
                match interaction_data["type"]:
                    case "add_node":  # DONE
                        node_new_id = self.planner.add_node()
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [node_new_id],
                                "modified_edges": [],
                            },
                            summary=f"Added a new node {node_new_id} to the plan",
                        )
                    case "remove_node":
                        node_id = interaction_data["node_id"]
                        skip_snapshot = interaction_data.get("skip_snapshot", False)
                        self.planner.remove_node(node_id)
                        # Capture history snapshot (unless skipped for batch operations)
                        if not skip_snapshot:
                            self.planner.capture_plan_snapshot(
                                changes={
                                    "deleted_nodes": [int(node_id)],
                                    "modified_nodes": [],
                                    "modified_edges": [],
                                },
                                summary=f"Removed node {node_id} from the plan",
                            )
                    case "duplicate_node":
                        original_node_id = int(interaction_data["node_id"])
                        node_new_id = self.planner.duplicate_node(
                            original_node_id, IOVariableOrigin.USER
                        )
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [node_new_id],
                                "modified_edges": [],
                            },
                            summary=f"Duplicated node {original_node_id} to create node {node_new_id}",
                        )
                    case "add_input_variable_key":
                        node_id = interaction_data["node_id"]
                        input_variable = interaction_data["input_variable"]
                        self.planner.add_input_variable_key(
                            int(node_id), input_variable, IOVariableOrigin.USER
                        )
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [int(node_id)],
                                "modified_edges": [],
                            },
                            summary=f'Node {node_id}: Added input variable "{input_variable}"',
                        )
                    case "remove_input_variable_key":
                        node_id = interaction_data["node_id"]
                        input_variable = interaction_data["input_variable"]
                        self.planner.remove_input_variable_key(
                            int(node_id), input_variable
                        )
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [int(node_id)],
                                "modified_edges": [],
                            },
                            summary=f'Node {node_id}: Removed input variable "{input_variable}"',
                        )
                    case "add_output_variable_key":
                        node_id = interaction_data["node_id"]
                        output_variable = interaction_data["output_variable"]
                        self.planner.add_output_variable_key(
                            int(node_id), output_variable, IOVariableOrigin.USER
                        )
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [int(node_id)],
                                "modified_edges": [],
                            },
                            summary=f'Node {node_id}: Added output variable "{output_variable}"',
                        )
                    case "remove_output_variable_key":
                        node_id = interaction_data["node_id"]
                        output_variable = interaction_data["output_variable"]
                        self.planner.remove_output_variable_key(
                            int(node_id), output_variable
                        )
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [int(node_id)],
                                "modified_edges": [],
                            },
                            summary=f'Node {node_id}: Removed output variable "{output_variable}"',
                        )
                    case "modify_input_variable_key":
                        node_id = interaction_data["node_id"]
                        old_input_name = interaction_data["old_input_name"]
                        new_input_name = interaction_data["new_input_name"]
                        self.planner.modify_input_variable_key(
                            int(node_id),
                            old_input_name,
                            new_input_name,
                            IOVariableOrigin.USER,
                        )
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [int(node_id)],
                                "modified_edges": [],
                            },
                            summary=f'Node {node_id}: Renamed input variable "{old_input_name}" to "{new_input_name}"',
                        )
                    case "modify_output_variable_key":
                        node_id = interaction_data["node_id"]
                        old_output_name = interaction_data["old_output_name"]
                        new_output_name = interaction_data["new_output_name"]
                        self.planner.modify_output_variable_key(
                            int(node_id),
                            old_output_name,
                            new_output_name,
                            IOVariableOrigin.USER,
                        )
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [int(node_id)],
                                "modified_edges": [],
                            },
                            summary=f'Node {node_id}: Renamed output variable "{old_output_name}" to "{new_output_name}"',
                        )
                    case "update_variable_value":
                        node_id = interaction_data["node_id"]
                        variable_name = interaction_data["variable_name"]
                        variable_value = interaction_data["variable_value"]
                        variable_type = interaction_data["variable_type"]
                        if variable_type == "input":
                            self.planner.assign_input_variable_value(
                                int(node_id),
                                variable_name,
                                variable_value,
                                IOVariableOrigin.USER,
                            )
                            # Capture history snapshot for input variable value update
                            self.planner.capture_plan_snapshot(
                                changes={
                                    "modified_nodes": [int(node_id)],
                                    "modified_edges": [],
                                },
                                summary=f'Node {node_id}: Updated input variable "{variable_name}"',
                            )
                        elif variable_type == "output":
                            self.planner.assign_output_variable_value(
                                int(node_id),
                                variable_name,
                                variable_value,
                                IOVariableOrigin.USER,
                            )
                            affected_nodes = self.planner.propagate_output_value(
                                int(node_id), variable_name
                            )
                            affected_nodes.append(int(node_id))
                            # Capture history snapshot for output variable value update
                            self.planner.capture_plan_snapshot(
                                changes={
                                    "modified_nodes": affected_nodes,
                                    "modified_edges": [],
                                },
                                summary=f'Node {node_id}: Updated output variable "{variable_name}"',
                            )
                        else:
                            raise ValueError(f"Invalid variable type: {variable_type}")
                    case "add_edge":
                        src_id = int(interaction_data["src_id"])
                        dest_id = int(interaction_data["dest_id"])
                        src_output = interaction_data["src_output"]
                        dest_input = interaction_data["dest_input"]
                        self.planner.add_edge(src_id, dest_id, src_output, dest_input)
                        # Capture history snapshot
                        edge_key = f"edge_{src_id}_{dest_id}_{src_output}_{dest_input}"
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": [],
                                "modified_edges": [edge_key],
                            },
                            summary=f"Connected node {src_id} ({src_output}) → node {dest_id} ({dest_input})",
                        )
                    case "remove_edge":
                        src_id = int(interaction_data["src_id"])
                        dest_id = int(interaction_data["dest_id"])
                        src_output = interaction_data["src_output"]
                        dest_input = interaction_data["dest_input"]
                        self.planner.remove_edge(
                            src_id, dest_id, src_output, dest_input
                        )
                        # Capture history snapshot
                        edge_key = f"edge_{src_id}_{dest_id}_{src_output}_{dest_input}"
                        self.planner.capture_plan_snapshot(
                            changes={"modified_nodes": [], "deleted_edges": [edge_key]},
                            summary=f"Disconnected node {src_id} ({src_output}) → node {dest_id} ({dest_input})",
                        )
                    case "update_node_agent_name":
                        node_id = int(interaction_data["node_id"])
                        agent_name = interaction_data["agent_name"]
                        self.planner.update_node_agent_name(node_id, agent_name)
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={"modified_nodes": [node_id], "modified_edges": []},
                            summary=f'Node {node_id}: Changed agent to "{agent_name}"',
                        )
                    case "update_node_task_description":
                        node_id = int(interaction_data["node_id"])
                        task_description = interaction_data["task_description"]
                        self.planner.update_node_task_description(
                            node_id, task_description
                        )
                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={"modified_nodes": [node_id], "modified_edges": []},
                            summary=f"Node {node_id}: Updated task description",
                        )
                    case "update_node_config":
                        node_id = int(interaction_data["node_id"])
                        model_name = interaction_data.get("modelName", "gpt-4o-mini")
                        temperature = interaction_data.get("temperature", 0)

                        # Wrap config as a dict
                        config = {"model": model_name, "temperature": temperature}

                        # Update node config using the dedicated method
                        self.planner.update_node_config(node_id, config)

                        # Capture history snapshot
                        self.planner.capture_plan_snapshot(
                            changes={"modified_nodes": [node_id], "modified_edges": []},
                            summary=f"Node {node_id}: Updated config (model: {model_name}, temperature: {temperature})",
                        )
                    case "execute_task":
                        node_id = int(interaction_data["node_id"])
                        agent_name = interaction_data["agent_name"]
                        skip_snapshot = interaction_data.get("skip_snapshot", False)
                        # Frontend also sends task_description / input_variables / output_variables,
                        # but execution uses the authoritative backend DAG state — they're ignored here.
                        self.planner.execute_node(node_id)
                        updated_outputs, updated_inputs = (
                            self.planner.extract_executed_outputs_and_inputs(node_id)
                        )

                        # Retrieve execution log from node data (now stored after execution)
                        node_data = self.planner.get_node(node_id)
                        list_latest_log = node_data.get("execution_log", [])

                        # Capture history snapshot after execution (unless skipped)
                        if not skip_snapshot:
                            self.planner.capture_plan_snapshot(
                                changes={
                                    "modified_nodes": [node_id],
                                    "modified_edges": [],
                                },
                                summary=f"Node {node_id}: Executed task with agent '{agent_name}'",
                            )

                        # For now, return a simulated result
                        execution_result = {
                            "status": "completed",
                            "message": f"Task executed successfully with agent '{agent_name}'",
                            "output_values": updated_outputs,
                            "input_values": updated_inputs,
                            "execution_log": list_latest_log,
                        }
                        response_message["execution_result"] = execution_result
                        response_message["status"] = "success"
                        response_message["message"] = (
                            "UI interaction processed successfully"
                        )
                        return response_message
                    case "execute_all_nodes":
                        # Get all node IDs before execution
                        all_node_ids = list(self.planner.plan.dag.nodes())

                        self.planner.execute_plan()
                        updated_outputs, updated_inputs = (
                            self.planner.extract_all_executed_outputs_and_inputs()
                        )

                        # Capture history snapshot after executing all nodes
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": all_node_ids,
                                "modified_edges": [],
                            },
                            summary="Executed all nodes",
                        )

                        execution_result = {
                            "status": "completed",
                            "message": "All nodes executed successfully",
                            "output_values": updated_outputs,
                            "input_values": updated_inputs,
                        }
                        response_message["execution_result"] = execution_result
                        response_message["status"] = "success"
                        response_message["message"] = "All nodes executed successfully"
                        return response_message
                    case "capture_execute_all_snapshot":
                        # Capture a single snapshot after executing all nodes
                        executed_node_ids = interaction_data.get(
                            "executed_node_ids", []
                        )
                        self.planner.capture_plan_snapshot(
                            changes={
                                "modified_nodes": executed_node_ids,
                                "modified_edges": [],
                            },
                            summary=f"Executed all {len(executed_node_ids)} nodes",
                        )
                        response_message["status"] = "success"
                        response_message["message"] = (
                            "Snapshot captured for execute all nodes"
                        )
                        return response_message
                    case "reset_plan":
                        skip_snapshot = interaction_data.get("skip_snapshot", False)
                        self.planner.reset_plan()
                        # Capture history snapshot after resetting plan (unless skipped)
                        # Reset creates an empty plan, so capture the new empty state
                        if not skip_snapshot:
                            self.planner.capture_plan_snapshot(
                                summary="Cleared all nodes and edges from the plan"
                            )

                    case "get_topological_order":
                        response_message["execution_result"] = {
                            "status": "completed",
                            "message": "Topological order retrieved successfully",
                            "topological_order": self.planner.get_plan_order(),
                        }

                    case "auto_split_node":
                        node_id = int(interaction_data["node_id"])
                        connected_edges = interaction_data["connected_edges"]
                        self.planner.auto_split_node(node_id, connected_edges)

                        # Capture history snapshot after splitting
                        # Split creates new nodes and modifies edges, so capture all changes
                        self.planner.capture_plan_snapshot(
                            summary=f"Auto split node {node_id}"
                        )

                        response_message["execution_result"] = {
                            "status": "completed",
                            "message": "Split node successfully",
                            "plan": self.planner.get_ui_plan(),
                        }
                        response_message["status"] = "success"
                        return response_message

                    case "sequential_split_node":
                        node_id = int(interaction_data["node_id"])
                        connected_edges = interaction_data["connected_edges"]
                        self.planner.sequential_split_node(
                            node_id, connected_edges, IOVariableOrigin.USER
                        )

                        # Capture history snapshot after sequential splitting
                        # Sequential split creates new nodes and modifies edges, so capture all changes
                        self.planner.capture_plan_snapshot(
                            summary=f"Sequential split node {node_id}"
                        )

                        response_message["execution_result"] = {
                            "status": "completed",
                            "message": "Sequential split node successfully",
                            "plan": self.planner.get_ui_plan(),
                        }
                        response_message["status"] = "success"
                        return response_message

                    case "check_nodes_mergeable":
                        node_ids = interaction_data["node_ids"]
                        response_message["mergeable"] = (
                            self.planner.check_nodes_mergeable(node_ids)
                        )

                    case "auto_merge_nodes":
                        node_ids = interaction_data["node_ids"]
                        connected_edges = interaction_data["connected_edges"]
                        self.planner.auto_merge_nodes(node_ids, connected_edges)

                        # Capture history snapshot after merging
                        # Merge deletes multiple nodes and creates a new one, so capture all changes
                        self.planner.capture_plan_snapshot(
                            summary=f"Auto merge nodes {', '.join(map(str, node_ids))}"
                        )

                        response_message["execution_result"] = {
                            "status": "completed",
                            "message": "Auto merge nodes successfully",
                            "plan": self.planner.get_ui_plan(),
                        }
                        response_message["status"] = "success"
                        return response_message

                    case "force_merge_nodes":
                        node_ids = interaction_data["node_ids"]
                        connected_edges = interaction_data["connected_edges"]
                        self.planner.force_merge_nodes(node_ids, connected_edges)

                        # Capture history snapshot after force merging
                        # Force merge deletes multiple nodes and creates a new one, so capture all changes
                        self.planner.capture_plan_snapshot(
                            summary=f"Regular merge nodes {', '.join(map(str, node_ids))}"
                        )

                        response_message["execution_result"] = {
                            "status": "completed",
                            "message": "Force merge nodes successfully",
                            "plan": self.planner.get_ui_plan(),
                        }
                        response_message["status"] = "success"
                        return response_message

                    case "move_node":
                        node_id = int(interaction_data["node_id"])
                        position = interaction_data["position"]  # {"x": 100, "y": 200}

                        # Capture a new snapshot with the moved node's position
                        # This creates a full snapshot where all nodes are marked as unchanged
                        # except the moved node which gets its position updated
                        self.planner.capture_plan_snapshot(
                            changes={"modified_nodes": [node_id], "modified_edges": []},
                            summary=f"Moved node {node_id} to position ({position['x']:.2f}, {position['y']:.2f})",
                        )

                        # Now update the position in the latest snapshot
                        self.planner.update_positions_in_latest_snapshot(
                            {str(node_id): position}
                        )

                    case "capture_batch_delete_snapshot":
                        deleted_node_ids = interaction_data.get("deleted_node_ids", [])
                        # Capture a snapshot after all nodes in the batch have been deleted
                        self.planner.capture_plan_snapshot(
                            changes={
                                "deleted_nodes": [
                                    int(node_id) for node_id in deleted_node_ids
                                ],
                                "modified_nodes": [],
                                "modified_edges": [],
                            },
                            summary=f"Deleted nodes {', '.join(map(str, deleted_node_ids))}",
                        )

        except Exception as e:
            print(f"Error processing UI interaction: {e, type(e)}")
            response_message["status"] = "error"
            response_message["message"] = "Error Message: " + str(e)
            return response_message

        captured_output = buf.getvalue()

        if captured_output != "":
            response_message["status"] = "error"
            if "message" in response_message:
                response_message["message"] += "Print out Message: " + captured_output
            else:
                response_message["message"] = "Print out Message: " + captured_output
        else:
            response_message["status"] = "success"
            response_message["message"] = "UI interaction processed successfully"

        if interaction_data["type"] == "add_node":
            response_message["node_id"] = node_new_id
        elif interaction_data["type"] == "duplicate_node":
            response_message["node_info"] = self.planner.get_ui_node(node_new_id)
            if isinstance(response_message["node_info"], dict):
                response_message["node_info"]["status"] = "completed"

        return response_message

    def process_user_message(self, user_message):
        self.append_conversation_history("user", user_message)

        self.planner.generate_plan(user_message)
        ui_plan = self.planner.get_ui_plan()

        return ui_plan

    def replan(self, user_message, conversation_history, ui_plan):
        self.append_conversation_history("user", user_message)

        self.planner.replan_from_ui(user_message, conversation_history, ui_plan)
        ui_plan = self.planner.get_ui_plan()

        return ui_plan

    def subplan_replan(
        self, user_message, conversation_history, ui_plan, selected_nodes
    ):
        self.append_conversation_history("user", user_message)

        self.planner.subplan_replan(
            user_message, conversation_history, ui_plan, selected_nodes
        )
        ui_plan = self.planner.get_ui_plan()

        return ui_plan

    def append_conversation_history(self, type, message):
        self.chat_history.append(
            {
                "type": type,
                "message": message,
                "timestamp": current_exact_time(),  # The time might be difference with the frontend as we dont sync time between front and backend
            }
        )
