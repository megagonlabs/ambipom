"""Runtime DAG plan: networkx-backed graph + execution, merge/split/replan primitives,
conversions to and from the LLM and UI plan representations, and diff/GED utilities."""

import json
from copy import deepcopy
from typing import Optional

import networkx as nx

from ambipom.agents import CodeAgent, CommonsenseAgent, MathAgent, SearchAgent
from ambipom.types import (
    IOVariableOrigin,
    LLMEdge,
    LLMNode,
    LLMNodeInput,
    LLMPlan,
    PydanticJSONEncoder,
)
from ambipom.utils import create_uuid, current_exact_time


class DAGPlan:
    def __init__(
        self,
        query: str = "",
        list_node: list[LLMNode] = [],
        list_edge: list[LLMEdge] = [],
    ):
        """
        Initializes a DAGPlan instance.
        Store the planning query
        Convert node and edge data into the DAG format

        DAG attribute
        id, query, timestamp

        Node attribute
        id, task, agent_name, input, output, prereq, agent_instance
            input variables attribute
            {key: {value, value_updated, timestamp}}
            output variables attribute
            {key: {value, value_updated, timestamp}}

        Edge attribute
        src_id, dest_id, src_output, dest_input

        Args:
            query (str): The query associated with the plan.
            list_node (list): List of nodes associated with the plan.
            list_edge (list): List of edges associated with the plan.
        """
        self.dag = nx.MultiDiGraph(
            id=create_uuid(), query=query, timestamp=current_exact_time()
        )
        self.query = query

    def initialize_from_llm_plan(self, llmplan):
        # Accept either a Pydantic LLMPlan instance or a plain dict with
        # {"nodes": [...], "edges": [...]} (e.g. parsed from a clean dataset file).
        if isinstance(llmplan, dict):
            list_node = llmplan["nodes"]
            list_edge = llmplan["edges"]
        else:
            list_node = llmplan.nodes
            list_edge = llmplan.edges
        for node_data in list_node:
            if isinstance(node_data, dict):
                node_data = LLMNode(**node_data)

            node_id = node_data.id
            node_agent_name = (
                node_data.agent_name.strip("[]")
                if node_data.agent_name
                else node_data.agent_name
            )

            dict_node_data = self.convert_llm_node_to_dag(node_data)
            # Extract config from node_data if available
            agent_config = {
                "model": dict_node_data.get("modelName", "gpt-4o-mini"),
                "temperature": dict_node_data.get("temperature", 0),
            }
            dict_node_data["agent_instance"] = self._create_agent_for_node(
                node_agent_name, agent_config
            )

            self.dag.add_node(node_id, **dict_node_data)

        for edge_data in list_edge:
            if isinstance(edge_data, dict):
                edge_data = LLMEdge(**edge_data)
            # check if the src and dest node ids are existed in the plan
            if edge_data.src_node not in self.dag.nodes:
                print(
                    f"[Initialized from LLMPlan] node {edge_data.src_node} does not exist in the plan"
                )
                continue
            if edge_data.dest_node not in self.dag.nodes:
                print(
                    f"[Initialized from LLMPlan] node {edge_data.dest_node} does not exist in the plan"
                )
                continue
            # check if the src_output and dest_input are existed in the src and dest node
            if (
                edge_data.src_output in self.dag.nodes[edge_data.src_node]["output"]
                and edge_data.dest_input in self.dag.nodes[edge_data.dest_node]["input"]
            ):
                self.dag.add_edge(
                    edge_data.src_node,
                    edge_data.dest_node,
                    src_output=edge_data.src_output,
                    dest_input=edge_data.dest_input,
                )
            else:
                print(
                    f"[Initialized from LLMPlan] edge {edge_data.src_node} -> {edge_data.dest_node} with src_output {edge_data.src_output} and dest_input {edge_data.dest_input} does not exist"
                )

        return self

    def initialize_from_ui_plan(self, uiplan: dict):
        list_node = uiplan["nodes"]
        list_edge = uiplan["edges"]
        dict_node_id = {}
        for node_data in list_node:
            old_node_id = node_data["id"]
            new_node_data = {
                "task": node_data["task"],
                "agent_name": node_data["agent_name"],
                "input": {},
                "output": {},
            }
            if "input" in node_data:
                new_node_data["input"] = {
                    input_obj["name"]: input_obj["value"]
                    for input_obj in node_data["input"]
                }
            if "output" in node_data:
                new_node_data["output"] = {
                    output_obj["name"]: output_obj["value"]
                    for output_obj in node_data["output"]
                }
            new_node_id = self.add_node(new_node_data, updated_by=IOVariableOrigin.USER)
            dict_node_id[old_node_id] = new_node_id

        for edge_data in list_edge:
            old_src_node_id = edge_data["source"]
            old_dest_node_id = edge_data["target"]
            new_src_node_id = dict_node_id[old_src_node_id]
            new_dest_node_id = dict_node_id[old_dest_node_id]
            self.add_edge(
                new_src_node_id,
                new_dest_node_id,
                edge_data["sourceHandle"],
                edge_data["targetHandle"],
            )

        return self

    def convert_llm_node_to_dag(self, node_data: LLMNode) -> dict:
        node_id = node_data.id
        node_task = node_data.task
        node_agent_name = (
            node_data.agent_name.strip("[]")
            if node_data.agent_name
            else node_data.agent_name
        )
        node_input = node_data.input
        node_output = node_data.output
        node_prereq = node_data.prereq

        new_node_data = {
            "id": node_id,
            "task": node_task,
            "agent_name": node_agent_name,
            "prereq": node_prereq,
        }

        # Initialize input variables
        new_node_data["input"] = {}
        if node_input:
            for input_variable in node_input:
                value = input_variable.value
                new_node_data["input"][input_variable.variable] = {
                    "value": value,
                    "value_updated": IOVariableOrigin.PLANNER,
                    "timestamp": current_exact_time(),
                }

        # Initialize output variables
        new_node_data["output"] = {}
        for output_variable in node_output:
            new_node_data["output"][output_variable] = {
                "value": "",
                "value_updated": IOVariableOrigin.PLANNER,
                "timestamp": current_exact_time(),
            }

        return new_node_data

    def convert_llm_edge_to_dag(self, edge_data: LLMEdge) -> dict:
        return {
            "src_node": edge_data.src_node,
            "dest_node": edge_data.dest_node,
            "src_output": edge_data.src_output,
            "dest_input": edge_data.dest_input,
        }

    def get_dag(self) -> nx.MultiDiGraph:
        """
        Returns the DAG associated with the plan.

        Returns:
            nx.MultiDiGraph: The DAG associated with the plan.
        """
        return self.dag

    def get_query(self):
        """
        Returns the query associated with the plan.

        Returns:
            str: The query associated with the plan.
        """
        return self.query

    def _create_agent_for_node(self, node_agent_name: str, config: dict = None):
        """
        Creates a unique agent instance for a node based on its agent name and config.

        Args:
            node_agent_name (str): Agent name for the node.
            config (dict): Configuration dict with model and temperature settings.
                          Default: {"model": "gpt-4o-mini", "temperature": 0}

        Returns:
            Agent: A unique agent instance for the node.
        """
        # Use default config if none provided
        if config is None:
            config = {"model": "gpt-4o-mini", "temperature": 0}

        if not node_agent_name:
            # Default to commonsense agent if no agent name specified
            return CommonsenseAgent(config)

        # Create a new agent instance based on agent name with provided config
        if node_agent_name == "math":
            return MathAgent(config)
        elif node_agent_name == "code":
            return CodeAgent(config)
        elif node_agent_name == "commonsense":
            return CommonsenseAgent(config)
        elif node_agent_name == "search":
            return SearchAgent(config)
        else:
            # Default to commonsense agent for unknown agent names
            return CommonsenseAgent(config)

    def get_llm_plan(self) -> LLMPlan:
        """
        Returns the LLM plan format associated with the plan.

        Returns:
            LLMPlan: The LLM plan format associated with the plan.
        """
        list_node = []

        for node_id, node_data in self.dag.nodes(data=True):
            node_input = node_data.get("input", {})
            node_input_list = [
                LLMNodeInput(variable=key, value=str(node_input[key]["value"]))
                for key in node_input
            ]
            node_output = list(node_data.get("output", {}).keys())
            list_node.append(
                LLMNode(
                    id=node_data.get("id", ""),
                    task=node_data.get("task", ""),
                    agent_name=node_data.get("agent_name", ""),
                    input=node_input_list,
                    output=node_output,
                    prereq=node_data.get("prereq", []),
                )
            )

        list_edge = []
        for edge_data in self.dag.edges(data=True):
            list_edge.append(
                LLMEdge(
                    src_node=edge_data[0],
                    dest_node=edge_data[1],
                    src_output=edge_data[2]["src_output"],
                    dest_input=edge_data[2]["dest_input"],
                )
            )

        return {"nodes": list_node, "edges": list_edge}

    def get_ui_plan(self):
        """
        Returns the UI plan format associated with the plan.

        Returns:
            UIPlan: The UI plan format associated with the plan.
        """
        list_node = []
        for node_id, node_data in self.dag.nodes(data=True):
            dict_node = {}
            for key, value in node_data.items():
                if key == "agent_instance":
                    # Extract config from agent instance for frontend
                    agent_config = value.get_config()
                    dict_node["modelName"] = agent_config.get("model", "gpt-4o-mini")
                    dict_node["temperature"] = agent_config.get("temperature", 0)
                elif key == "execution_log":
                    # Preserve as list so the frontend can parse it correctly
                    dict_node[key] = value if isinstance(value, list) else []
                elif key not in ["input", "output"]:
                    dict_node[key] = str(value)
            if "input" in node_data:
                dict_node["input"] = {
                    key: str(node_data["input"][key]["value"])
                    if node_data["input"][key]["value"] is not None
                    else "None"
                    for key in node_data["input"]
                }
            if "output" in node_data:
                dict_node["output"] = {
                    key: str(node_data["output"][key]["value"])
                    if node_data["output"][key]["value"] is not None
                    else "None"
                    for key in node_data["output"]
                }
            list_node.append(dict_node)

        list_edge = []
        for edge_data in self.dag.edges(data=True):
            dict_edge = {
                "src_id": edge_data[0],
                "dest_id": edge_data[1],
                "src_output": edge_data[2]["src_output"],
                "dest_input": edge_data[2]["dest_input"],
            }

            list_edge.append(dict_edge)
        return {"nodes": list_node, "edges": list_edge}

    def save_plan(self, file_path: str, assistant_response: str = ""):
        """
        Saves the plan to a file.
        The plan will be saved in the networkx plan format.
        The node id will be the actual node id.
        The edge will be the actual edge.

        Args:
            file_path (str): The path to the file to save the plan to.
            assistant_response (str): The assistant's response message. Defaults to empty string.
        """
        list_node = []

        for node_id in self.get_plan_order():
            node_data = self.get_node(node_id)
            dict_node = {}
            for key, value in node_data.items():
                if key == "agent_instance":
                    dict_node["agent_config"] = value.get_config()
                else:
                    dict_node[key] = value

            list_node.append(dict_node)

        list_edge = []
        for edge_data in self.dag.edges(data=True):
            list_edge.append(
                {
                    "src_node": edge_data[0],
                    "dest_node": edge_data[1],
                    "src_output": edge_data[2]["src_output"],
                    "dest_input": edge_data[2]["dest_input"],
                }
            )
        dict_plan = {
            "initial_query": self.query,
            "assistant_response": assistant_response,
            "nodes": list_node,
            "edges": list_edge,
        }
        with open(file_path, "w") as f:
            json.dump(dict_plan, f, cls=PydanticJSONEncoder, indent=2)

    def save_plan_to_json(self, assistant_response: str = ""):
        """
        Saves the plan to a dictionary.

        Args:
            assistant_response (str): The assistant's response message. Defaults to empty string.

        Returns:
            dict: The plan in dictionary format.
        """
        list_node = []
        dict_node_id_to_new_node_id = {}
        current_id = 1
        for node_id in self.get_plan_order():
            dict_node_id_to_new_node_id[node_id] = current_id

            node_data = self.get_node(node_id)
            dict_node = {}
            for key, value in node_data.items():
                if key == "agent_instance":
                    dict_node["agent_config"] = value.get_config()
                else:
                    dict_node[key] = value
            dict_node["id"] = current_id
            list_node.append(dict_node)
            current_id += 1

        list_edge = []
        for edge_data in self.dag.edges(data=True):
            list_edge.append(
                {
                    "src_node": dict_node_id_to_new_node_id[edge_data[0]],
                    "dest_node": dict_node_id_to_new_node_id[edge_data[1]],
                    "src_output": edge_data[2]["src_output"],
                    "dest_input": edge_data[2]["dest_input"],
                }
            )
        dict_plan = {
            "initial_query": self.query,
            "assistant_response": assistant_response,
            "nodes": list_node,
            "edges": list_edge,
        }

        return dict_plan, dict_node_id_to_new_node_id

    def load_plan(self, file_path: str):
        """
        Loads a plan from a file. Accepts two on-disk shapes:

        - **Runtime dump** (what `save_plan_to_json` writes): full session state with
          per-variable `{value, value_updated, timestamp}` wrappers, `execution_log`,
          `agent_config`, `initial_query`, `assistant_response`. Used by UI Save.

        - **Clean LLMPlan** (what the dataset ships): minimal `LLMPlan` shape with a
          top-level `query` field, `input` as `[{variable, value}]`, `output` as
          `[str, ...]`, no execution state.

        The shape is detected automatically.

        Args:
            file_path (str): Path to the plan JSON file.

        Returns:
            tuple: (DAGPlan, query, assistant_response) — assistant_response is "" for
            clean LLMPlan files since the field doesn't exist there.
        """
        with open(file_path, "r") as f:
            dict_plan = json.load(f)

        if self._is_llm_plan_shape(dict_plan):
            query = dict_plan.get("query", "")
            self.query = query
            self.dag.graph["query"] = query
            self.initialize_from_llm_plan(dict_plan)
            return self, query, ""

        # Runtime-dump path
        initial_query = dict_plan.get("initial_query", "")
        assistant_response = dict_plan.get("assistant_response", "")

        self.query = initial_query
        self.dag.graph["query"] = initial_query

        list_node = dict_plan["nodes"]
        list_edge = dict_plan["edges"]

        dict_node_id_to_actual_node_id = {}
        for node_data in list_node:
            loaded_id = node_data["id"]
            new_id = self.add_node(node_data)
            dict_node_id_to_actual_node_id[loaded_id] = new_id
        for edge_data in list_edge:
            if edge_data["src_node"] not in dict_node_id_to_actual_node_id:
                print(f"node {edge_data['src_node']} does not exist in the loaded plan")
                continue
            if edge_data["dest_node"] not in dict_node_id_to_actual_node_id:
                print(f"node {edge_data['dest_node']} does not exist in the loadedplan")
                continue
            self.add_edge(
                dict_node_id_to_actual_node_id[edge_data["src_node"]],
                dict_node_id_to_actual_node_id[edge_data["dest_node"]],
                edge_data["src_output"],
                edge_data["dest_input"],
            )
        return self, initial_query, assistant_response

    @staticmethod
    def _is_llm_plan_shape(dict_plan: dict) -> bool:
        """Heuristic: clean LLMPlan files have node.output as a list of strings,
        whereas runtime-dump files have node.output as a dict of variable→state."""
        nodes = dict_plan.get("nodes") or []
        if not nodes:
            return False
        first_output = nodes[0].get("output")
        if isinstance(first_output, list):
            return len(first_output) == 0 or isinstance(first_output[0], str)
        return False

    def load_plan_from_json(self, dict_plan: dict):
        """
        Loads a plan from a dictionary.
        """
        list_node = dict_plan["nodes"]
        list_edge = dict_plan["edges"]
        dict_node_id_to_actual_node_id = {}
        for node_data in list_node:
            loaded_id = node_data["id"]
            new_id = self.add_node(node_data)
            dict_node_id_to_actual_node_id[loaded_id] = new_id
        for edge_data in list_edge:
            if edge_data["src_node"] not in dict_node_id_to_actual_node_id:
                print(f"node {edge_data['src_node']} does not exist in the loaded plan")
                continue
            if edge_data["dest_node"] not in dict_node_id_to_actual_node_id:
                print(f"node {edge_data['dest_node']} does not exist in the loadedplan")
                continue
            self.add_edge(
                dict_node_id_to_actual_node_id[edge_data["src_node"]],
                dict_node_id_to_actual_node_id[edge_data["dest_node"]],
                edge_data["src_output"],
                edge_data["dest_input"],
            )
        return self

    def add_node(
        self,
        node_data: dict = None,
        updated_by: IOVariableOrigin = IOVariableOrigin.PLANNER,
    ):
        """
        Adds a new node to the DAG. The node id is automatically generated and unique.
        The previous node id will not be reused.

        Args:
            node_data (dict): Data associated with the new node.

        Returns:
            int: The id of the new node.
        """
        if node_data is None:
            node_data = {}

        new_id = len(self.dag.nodes) + 1
        while new_id in self.dag.nodes:
            new_id += 1

        node_data["id"] = new_id
        # Create an agent for the new node if agent name is specified
        if "agent_name" in node_data:
            # Extract config from node_data if available
            if "agent_config" in node_data:
                agent_config = node_data["agent_config"]
            else:
                agent_config = {"model": "gpt-4o-mini", "temperature": 0}
            # Store modelName and temperature in node data for consistency
            node_data["modelName"] = agent_config.get("model", "gpt-4o-mini")
            node_data["temperature"] = agent_config.get("temperature", 0)
            node_data["agent_instance"] = self._create_agent_for_node(
                node_data["agent_name"], agent_config
            )
        else:
            # Default agent if no agent name specified
            node_data["agent_name"] = "commonsense"
            node_data["modelName"] = "gpt-4o-mini"
            node_data["temperature"] = 0
            node_data["agent_instance"] = CommonsenseAgent(
                {"model": "gpt-4o-mini", "temperature": 0}
            )

        if "task" not in node_data:
            node_data["task"] = ""

        # Initialize execution_log if not present
        if "execution_log" not in node_data:
            node_data["execution_log"] = []

        node_data["input"] = self.process_input_variables(
            node_data.get("input", {}), updated_by
        )
        node_data["output"] = self.process_output_variables(
            node_data.get("output", {}), updated_by
        )
        self.dag.add_node(new_id, **node_data)

        return new_id

    def get_node(self, node_id):
        """
        Returns the node associated with the plan.
        If the node id is not found, a message will be printed and None will be returned.

        Args:
            node_id (int): The id of the node to get.

        Returns:
            dict: The node associated with the plan.
        """
        if node_id not in self.dag.nodes:
            print(f"[Get node] node {node_id} does not exist in the plan")
            return None
        return self.dag.nodes[node_id]

    def get_ui_node(self, node_id: int):
        if node_id not in self.dag.nodes:
            print(f"[Get node UIPlan] node {node_id} does not exist in the plan")
            return None
        dict_node = {}
        for key, value in self.dag.nodes[node_id].items():
            if key not in ["agent_instance", "input", "output"]:
                dict_node[key] = value
        if "input" in self.dag.nodes[node_id]:
            dict_node["input"] = {
                key: str(self.dag.nodes[node_id]["input"][key]["value"])
                for key in self.dag.nodes[node_id]["input"]
            }
        if "output" in self.dag.nodes[node_id]:
            dict_node["output"] = {
                key: str(self.dag.nodes[node_id]["output"][key]["value"])
                for key in self.dag.nodes[node_id]["output"]
            }
        return dict_node

    def get_llm_node(self, node_id: int):
        if node_id not in self.dag.nodes:
            print(f"[Get node LLMPlan] node {node_id} does not exist in the plan")
            return None

        node_data = self.dag.nodes[node_id]
        node_input = node_data.get("input", {})
        node_input_list = [
            LLMNodeInput(variable=key, value=str(node_input[key]["value"]))
            for key in node_input
        ]
        node_output = list(node_data.get("output", {}).keys())

        return LLMNode(
            id=node_data.get("id", ""),
            task=node_data.get("task", ""),
            agent_name=node_data.get("agent_name", ""),
            input=node_input_list,
            output=node_output,
            prereq=node_data.get("prereq", []),
        )

    def get_llm_edge(self, node_id: int):
        if node_id not in self.dag.nodes:
            print(f"[Get edge LLMPlan] node {node_id} does not exist in the plan")
            return None
        list_edges = []
        for edge_data in self.dag.edges(data=True):
            if edge_data[0] == node_id or edge_data[1] == node_id:
                list_edges.append(
                    LLMEdge(
                        src_node=edge_data[0],
                        dest_node=edge_data[1],
                        src_output=edge_data[2]["src_output"],
                        dest_input=edge_data[2]["dest_input"],
                    )
                )
        return list_edges

    def unique_edges_from_list_edges(
        self, list_edges: list[list[LLMEdge]]
    ) -> list[LLMEdge]:
        seen = set()
        unique_edges = []
        for edges in list_edges:
            for edge_data in edges:
                key = (
                    edge_data.src_node,
                    edge_data.dest_node,
                    edge_data.src_output,
                    edge_data.dest_input,
                )
                if key not in seen:
                    seen.add(key)
                    unique_edges.append(edge_data)
        return unique_edges

    def update_node_task_description(self, node_id, task_description: str):
        """
        Updates the task description of the node associated with the plan.
        If the node id is not found, a message will be printed and the node will not be updated.

        Args:
            node_id (int): The id of the node to update.
            task_description (str): The task description to update.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Update node task description] node {node_id} does not exist in the plan"
            )
            return
        self._update_node(node_id, {"task": task_description})

    def update_node_agent_name(self, node_id, agent_name: str):
        """
        Updates the agent name of the node associated with the plan.
        If the node id is not found, a message will be printed and the node will not be updated.

        Args:
            node_id (int): The id of the node to update.
            agent_name (str): The agent name to update.
        """
        if node_id not in self.dag.nodes:
            print(f"[Update node agent name] node {node_id} does not exist in the plan")
            return
        self._update_node(node_id, {"agent_name": agent_name})

    def update_node_config(self, node_id, config: dict):
        """
        Updates the agent config (model and temperature) of the node associated with the plan.
        If the node id is not found, a message will be printed and the node will not be updated.
        This will also recreate the agent instance with the new config.

        Args:
            node_id (int): The id of the node to update.
            config (dict): Config dict with "model" and "temperature" keys.
        """
        if node_id not in self.dag.nodes:
            print(f"[Update node config] node {node_id} does not exist in the plan")
            return

        model_name = config.get("model", "gpt-4o-mini")
        temperature = config.get("temperature", 0)

        # Update the config fields in node data
        self._update_node(
            node_id, {"modelName": model_name, "temperature": temperature}
        )

        # Recreate agent instance with new config
        node_data = self.dag.nodes[node_id]
        agent_config = {"model": model_name, "temperature": temperature}
        if "agent_instance" in node_data:
            node_data["agent_instance"].update_config(agent_config)
        else:
            node_data["agent_instance"] = self._create_agent_for_node(
                node_data["agent_name"], agent_config
            )

    def _update_node(self, node_id, node_data: dict):
        """
        Updates the node associated with the plan internally.
        If the node id is not found, a message will be printed and the node will not be updated.
        Node id is not allowed to be updated. It will be removed from the source node data.

        Args:
            node_id (int): The id of the node to update.
            node_data (dict): The data associated with the node.
        """
        if node_id not in self.dag.nodes:
            print(f"[Update node] node {node_id} does not exist in the plan")
            return

        if "id" in node_data:
            node_data.pop("id")
            # print(f"[Update node] id {node_id} is not allowed to be updated")

        # If agent name is being updated, create a new agent instance if the agent name is different
        if "agent_name" in node_data:
            if node_data["agent_name"] != self.dag.nodes[node_id].get("agent_name", ""):
                # Extract config from existing node or use defaults
                agent_config = {
                    "model": self.dag.nodes[node_id].get("modelName", "gpt-4o-mini"),
                    "temperature": self.dag.nodes[node_id].get("temperature", 0),
                }
                node_data["agent_instance"] = self._create_agent_for_node(
                    node_data["agent_name"], agent_config
                )
                # Clear execution log when agent changes since previous results are no longer valid
                node_data["execution_log"] = []

        self.dag.nodes[node_id].update(node_data)

    def duplicate_node(self, node_id, updated_by: IOVariableOrigin) -> Optional[int]:
        """
        Duplicates the node associated with the plan.
        If the node id is not found, a message will be printed and the node will not be duplicated.
        The new node id is automatically generated and unique.
        The new node will have the same data as the original node except for the id and agent.

        Args:
            node_id (int): The id of the node to duplicate.

        Returns:
            Optional[int]: The id of the new node. If the node id is not found, None will be returned.
        """
        if node_id not in self.dag.nodes:
            print(f"[Duplicate node] node {node_id} does not exist in the plan")
            return None

        node_id_new = self.add_node(updated_by=updated_by)

        duplicated_node_data = self.dag.nodes[node_id]

        dict_duplicated_node_data = {}
        for key, value in duplicated_node_data.items():
            if key not in ["id", "agent_instance"]:
                dict_duplicated_node_data[key] = deepcopy(value)

        # Ensure config is preserved even if original node doesn't have modelName/temperature stored
        # (for backward compatibility with nodes created before the config storage fix)
        if (
            "agent_instance" in duplicated_node_data
            and duplicated_node_data["agent_instance"]
        ):
            original_config = duplicated_node_data["agent_instance"].get_config()
            dict_duplicated_node_data["modelName"] = original_config.get(
                "model", "gpt-4o-mini"
            )
            dict_duplicated_node_data["temperature"] = original_config.get(
                "temperature", 0
            )

        self._update_node(node_id_new, dict_duplicated_node_data)
        return node_id_new

    def remove_node(self, node_id):
        """
        Removes the node associated with the plan.
        If the node id is not found, a message will be printed.

        Args:
            node_id (int): The id of the node to remove.
        """
        # check if the node exists
        if node_id not in self.dag.nodes:
            print(f"[Remove node] node {node_id} does not exist in the plan")
            return
        self.dag.remove_node(node_id)

    def add_input_variable_key(
        self, node_id, input_variable: str, updated_by: IOVariableOrigin
    ):
        """
        Adds input variable(s) to the node.
        If the node id is not found, a message will be printed.
        If the input variable already exists, a message will be printed.
        The input variable will be added with an empty value.
        The value updated will be set to the origin of the input variable.
        The timestamp will be set to the current exact time.

        Args:
            node_id (int): The id of the node to add the input variable to.
            list_input_variable (list): The input variable(s) to add.
            updated_by (IOVariableOrigin): The origin of the input variable.
        """

        if node_id not in self.dag.nodes:
            print(f"[Add input variable key] node {node_id} does not exist in the plan")
            return
        if input_variable not in self.dag.nodes[node_id]["input"]:
            self.dag.nodes[node_id]["input"][input_variable] = {
                "value": "",
                "value_updated": updated_by,
                "timestamp": current_exact_time(),
            }
        else:
            print(
                f"[Add input variable key] input variable {input_variable} already exists in the node {node_id}"
            )

    def remove_input_variable_key(self, node_id, input_variable: str):
        """
        Removes an input variable from the node.
        If the node id is not found, a message will be printed.
        If the input variable does not exist, a message will be printed.
        The input variable key will be removed from the node.
        All corresponding edges that have the input variable as dest_input will be removed.

        Args:
            node_id (int): The id of the node to remove the input variable from.
            list_input_variable (list): The input variable to remove.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Remove input variable key] node {node_id} does not exist in the plan"
            )
            return

        if input_variable in self.dag.nodes[node_id]["input"]:
            self.dag.nodes[node_id]["input"].pop(input_variable, None)
            # Remove all corresponding edges that have input_variable as dest_input
            edges_to_remove = []
            for u, v, k in self.dag.edges(keys=True):
                edge_data = self.dag[u][v][k]
                if v == node_id and edge_data.get("dest_input") == input_variable:
                    edges_to_remove.append((u, v, k))
            for u, v, k in edges_to_remove:
                self.dag.remove_edge(u, v, k)
        else:
            print(
                f"[Remove input variable key] input variable {input_variable} does not exist in the node {node_id}"
            )

    def modify_input_variable_key(
        self, node_id, key_from_value, key_to_value, updated_by: IOVariableOrigin
    ):
        """
        Modifies an input variable in the node.
        If the node id is not found, a message will be printed.
        First check if the key_from_value exists in the node.
        If the key_from_value does not exist, a message will be printed.
        Then check if the key_to_value exists in the node.
        If the key_to_value exists, a message will be printed.

        Make sure the key_from_value is existed and the key_to_value is not existed in the node.
        The key_from_value will be removed and the key_to_value will be added.
        The value of the key_from_value will be set to the value of the key_to_value.
        The value updated will be set to the origin of the input variable.
        The timestamp will be set to the current exact time.

        All corresponding edges that have the key_from_value as dest_input will be removed and replaced by the new edge with the key_to_value as dest_input.

        Args:
            node_id (int): The id of the node to modify the input variable.
            key_from_value (str): The input variable to modify.
            key_to_value (str): The new input variable.
            updated_by (IOVariableOrigin): The origin of the input variable.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Modify input variable key] node {node_id} does not exist in the plan"
            )
            return
        if key_from_value not in self.dag.nodes[node_id]["input"]:
            print(
                f"[Modify input variable key] input variable {key_from_value} does not exist in the node {node_id}"
            )
            return
        if key_to_value in self.dag.nodes[node_id]["input"]:
            print(
                f"[Modify input variable key] input variable {key_to_value} already exists in the node {node_id}"
            )
            return

        value = self.dag.nodes[node_id]["input"][key_from_value]["value"]
        self.dag.nodes[node_id]["input"][key_to_value] = {
            "value": value,
            "last_update": updated_by,
            "timestamp": current_exact_time(),
        }
        self.dag.nodes[node_id]["input"].pop(key_from_value, None)

        list_edges_to_remove = []

        for u, v, key in self.dag.edges(keys=True):
            attrs = self.dag[u][v][key]
            if v == node_id and attrs["dest_input"] == key_from_value:
                list_edges_to_remove.append((u, v, key))

        for u, v, key in list_edges_to_remove:
            attrs = self.dag[u][v][key]
            self.dag.remove_edge(u, v, key)
            self.add_edge(u, v, attrs["src_output"], key_to_value)

    def assign_input_variable_value(
        self, node_id, input_variable: str, value: str, updated_by: IOVariableOrigin
    ):
        """
        Modifies a value of an input variable in the node.
        If the node id is not found, a message will be printed.
        If the input variable does not exist, a message will be printed.
        The value of the input variable will be set to the new value.
        The value updated will be set to the origin of the input variable.
        The timestamp will be set to the current exact time.

        Args:
            node_id (int): The id of the node to modify the input variable.
            input_variable (str): The input variable to modify.
            value (str): The new value of the input variable.
            updated_by (IOVariableOrigin): The origin of the input variable.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Assign input variable value] node {node_id} does not exist in the plan"
            )
            return
        if input_variable not in self.dag.nodes[node_id]["input"]:
            print(
                f"[Assign input variable value] input variable {input_variable} does not exist in the node {node_id}"
            )
            return

        self.dag.nodes[node_id]["input"][input_variable]["value"] = value
        self.dag.nodes[node_id]["input"][input_variable]["value_updated"] = updated_by
        self.dag.nodes[node_id]["input"][input_variable]["timestamp"] = (
            current_exact_time()
        )

    def add_output_variable_key(
        self, node_id, output_variable: str, updated_by: IOVariableOrigin
    ):
        """
        Adds an output variable to the node.
        If the node id is not found, a message will be printed.
        If the output variable already exists, a message will be printed.
        The output variable will be added with an empty value.
        The value updated will be set to the origin of the output variable.
        The timestamp will be set to the current exact time.

        Args:
            node_id (int): The id of the node to add the output variable to.
            output_variable (str): The output variable to add.
            updated_by (IOVariableOrigin): The origin of the output variable.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Add output variable key] node {node_id} does not exist in the plan"
            )
            return
        if output_variable not in self.dag.nodes[node_id]["output"]:
            self.dag.nodes[node_id]["output"][output_variable] = {
                "value": "",
                "value_updated": updated_by,
                "timestamp": current_exact_time(),
            }
        else:
            print(
                f"[Add output variable key] output variable {output_variable} already exists in the node {node_id}"
            )

    def remove_output_variable_key(self, node_id, output_variable: str):
        """
        Removes an output variable from the node.
        If the node id is not found, a message will be printed.
        If the output variable does not exist, a message will be printed.
        The output variable key will be removed from the node.
        All corresponding edges that have the output variable as src_output will be removed.

        Args:
            node_id (int): The id of the node to remove the output variable from.
            output_variable (str): The output variable to remove.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Remove output variable key] node {node_id} does not exist in the plan"
            )
            return
        if output_variable in self.dag.nodes[node_id]["output"]:
            self.dag.nodes[node_id]["output"].pop(output_variable, None)
            # Remove all corresponding edges that have output_variable as src_output
            edges_to_remove = []
            for u, v, k in self.dag.edges(keys=True):
                edge_data = self.dag[u][v][k]
                if u == node_id and edge_data.get("src_output") == output_variable:
                    edges_to_remove.append((u, v, k))
            for u, v, k in edges_to_remove:
                self.dag.remove_edge(u, v, k)
        else:
            print(
                f"[Remove output variable key] output variable {output_variable} does not exist in the node {node_id}"
            )

    def modify_output_variable_key(
        self, node_id, key_from_value, key_to_value, updated_by: IOVariableOrigin
    ):
        """
        Modifies an output variable in the node.
        If the node id is not found, a message will be printed.
        First check if the key_from_value exists in the node.
        If the key_from_value does not exist, a message will be printed.
        Then check if the key_to_value exists in the node.
        If the key_to_value exists, a message will be printed.

        Make sure the key_from_value is existed and the key_to_value is not existed in the node.
        The key_from_value will be removed and the key_to_value will be added.
        The value of the key_from_value will be set to the value of the key_to_value.
        The value updated will be set to the origin of the output variable.
        The timestamp will be set to the current exact time.

        All corresponding edges that have the key_from_value as src_output will be removed and replaced by the new edge with the key_to_value as src_output.

        Args:
            node_id (int): The id of the node to modify the output variable.
            key_from_value (str): The output variable to modify.
            key_to_value (str): The new output variable.
            updated_by (IOVariableOrigin): The origin of the output variable.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Modify output variable key] node {node_id} does not exist in the plan"
            )
            return
        if key_from_value not in self.dag.nodes[node_id]["output"]:
            print(
                f"[Modify output variable key] output variable {key_from_value} does not exist in the node {node_id}"
            )
            return
        if key_to_value in self.dag.nodes[node_id]["output"]:
            print(
                f"[Modify output variable key] output variable {key_to_value} already exists in the node {node_id}"
            )
            return

        value = self.dag.nodes[node_id]["output"][key_from_value]["value"]
        self.dag.nodes[node_id]["output"][key_to_value] = {
            "value": value,
            "value_updated": updated_by,
            "timestamp": current_exact_time(),
        }
        self.dag.nodes[node_id]["output"].pop(key_from_value, None)

        list_edges_to_remove = []
        for u, v, key in self.dag.edges(keys=True):
            attrs = self.dag[u][v][key]
            if u == node_id and attrs["src_output"] == key_from_value:
                list_edges_to_remove.append((u, v, key))
        for u, v, key in list_edges_to_remove:
            attrs = self.dag[u][v][key]
            self.dag.remove_edge(u, v, key)
            self.add_edge(u, v, key_to_value, attrs["dest_input"])

    def assign_output_variable_value(
        self, node_id, output_variable: str, value: str, updated_by: IOVariableOrigin
    ):
        """
        Assigns a value to an output variable in the node.
        If the node id is not found, a message will be printed.
        If the output variable does not exist, a message will be printed.
        The value of the output variable will be set to the new value.
        The value updated will be set to the origin of the output variable.
        The timestamp will be set to the current exact time.

        Args:
            node_id (int): The id of the node to assign the output variable to.
            output_variable (str): The output variable to add.
            value (str): The value to add.
            updated_by (IOVariableOrigin): The origin of the output variable.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Assign output variable value] node {node_id} does not exist in the plan"
            )
            return
        if output_variable not in self.dag.nodes[node_id]["output"]:
            print(
                f"[Assign output variable value] output variable {output_variable} does not exist in the node {node_id}"
            )
            return
        self.dag.nodes[node_id]["output"][output_variable]["value"] = value
        self.dag.nodes[node_id]["output"][output_variable]["value_updated"] = updated_by
        self.dag.nodes[node_id]["output"][output_variable]["timestamp"] = (
            current_exact_time()
        )

    def propagate_output_value(self, node_id: int, output_variable: str) -> list[int]:
        """
        Propagates an output variable's value to all connected downstream nodes' input variables.
        Goes through all outgoing edges from the specified node where src_output matches the output_variable,
        and updates the corresponding dest_input variables with the current output value.

        Args:
            node_id (int): The id of the node whose output variable to propagate.
            output_variable (str): The name of the output variable to propagate.

        Returns:
            list[int]: A list of node IDs that were affected by the propagation (downstream nodes that received the value).
        """
        if node_id not in self.dag.nodes:
            print(f"[Propagate output value] node {node_id} does not exist in the plan")
            return []

        if (
            "output" not in self.dag.nodes[node_id]
            or output_variable not in self.dag.nodes[node_id]["output"]
        ):
            print(
                f"[Propagate output value] output variable {output_variable} does not exist in node {node_id}"
            )
            return []

        # Get the current output variable's value and metadata
        output_value = self.dag.nodes[node_id]["output"][output_variable]["value"]
        output_updated_by = self.dag.nodes[node_id]["output"][output_variable][
            "value_updated"
        ]

        # Get all outgoing edges from this node
        output_edges = self.dag.out_edges(node_id, data=True)

        # Track which nodes were affected
        affected_node_ids = []

        # Propagate to all connected downstream inputs
        for out_edge in output_edges:
            dest_id = out_edge[1]
            src_output = out_edge[2]["src_output"]
            dest_input = out_edge[2]["dest_input"]

            # If this edge is connected to the specified output variable
            if src_output == output_variable:
                if (
                    "input" in self.dag.nodes[dest_id]
                    and dest_input in self.dag.nodes[dest_id]["input"]
                ):
                    self.dag.nodes[dest_id]["input"][dest_input]["value"] = output_value
                    self.dag.nodes[dest_id]["input"][dest_input]["value_updated"] = (
                        output_updated_by
                    )
                    self.dag.nodes[dest_id]["input"][dest_input]["timestamp"] = (
                        current_exact_time()
                    )
                    affected_node_ids.append(dest_id)

        return affected_node_ids

    def add_edge(self, src_id: int, dest_id: int, src_output: str, dest_input: str):
        """
        Adds an edge to the DAG.
        If the source and destination node ids are not found, a message will be printed.
        Check if src_output and dest_imput variables are existed in the source and destination nodes.
        If not, a message will be printed.
        Check if the edge already exists.
        If the edge already exists, a message will be printed.
        Check if the destination input variable is existed in one of the edges.
        If the destination input variable is existed in one of the edges, a message will be printed.
        Add the edge to the DAG.

        Args:
            src_id (int): The id of the source node.
            dest_id (int): The id of the destination node.
            src_output (str): The output of the source node.
            dest_input (str): The input of the destination node.
        """
        if src_id not in self.dag.nodes:
            print(f"[Add edge] node {src_id} does not exist in the plan")
            return
        if dest_id not in self.dag.nodes:
            print(f"[Add edge] node {dest_id} does not exist in the plan")
            return
        # check if src_output is existed in the source node
        if src_output not in self.dag.nodes[src_id]["output"]:
            # raise ValueError(f"src_output {src_output} is not existed in the source node {src_id}")
            print(
                f"[Add edge] src_output {src_output} is not existed in the source node {src_id}"
            )
            return
        # check if dest_input is existed in the destination node
        if dest_input not in self.dag.nodes[dest_id]["input"]:
            # raise ValueError(f"dest_input {dest_input} is not existed in the destination node {dest_id}")
            print(
                f"[Add edge] dest_input {dest_input} is not existed in the destination node {dest_id}"
            )
            return

        # check if the edge already exists
        for key, attrs in (self.dag.get_edge_data(src_id, dest_id) or {}).items():
            if attrs["src_output"] == src_output and attrs["dest_input"] == dest_input:
                print(
                    f"[Add edge] edge {src_id} -> {dest_id} with src_output {src_output} and dest_input {dest_input} already exists"
                )
                return

        # check if the destination input variable is existed in one of the edges
        for u, v, k, d in self.dag.in_edges(dest_id, data=True, keys=True):
            if d["dest_input"] == dest_input:
                print(
                    f"[Add edge] dest_input {dest_input} in node {dest_id} already have an input edge."
                )
                return

        self.dag.add_edge(src_id, dest_id, src_output=src_output, dest_input=dest_input)

    def remove_edge(self, src_id, dest_id, src_output, dest_input):
        """
        Removes an edge from the DAG.
        If the source and destination node ids are not found, a message will be printed.
        Check if the edge exists.
        If the edge exists, remove the edge from the DAG.
        If the edge does not exist, a message will be printed.

        Args:
            src_id (int): The id of the source node.
            dest_id (int): The id of the destination node.
            src_output (str): The output of the source node.
            dest_input (str): The input of the destination node.
        """
        if src_id not in self.dag.nodes:
            print(f"[Remove edge] node {src_id} does not exist in the plan")
            return
        if dest_id not in self.dag.nodes:
            print(f"[Remove edge] node {dest_id} does not exist in the plan")
            return
        for key, attrs in (self.dag.get_edge_data(src_id, dest_id) or {}).items():
            if attrs["src_output"] == src_output and attrs["dest_input"] == dest_input:
                self.dag.remove_edge(src_id, dest_id, key)
                return
        print(
            f"[Remove edge] edge {src_id} -> {dest_id} with src_output {src_output} and dest_input {dest_input} does not exist"
        )

    def modify_edge_src_output(
        self, src_id, dest_id, src_output, dest_input, new_src_id, new_src_output
    ):
        """
        Modifies an edge in the DAG.
        If the source and destination node ids are not found, a message will be printed.
        Check if the new edges exists.
        If the new edges exists, a message will be printed.
        Check if the src_output is existed in the new source node.
        If the src_output is not existed in the new source node, a message will be printed.
        Check if the edge exists.
        If the edge exists, remove the edge from the DAG and add the new edge.
        If the edge does not exist, a message will be printed.

        Args:
            src_id (int): The id of the source node.
            dest_id (int): The id of the destination node.
            src_output (str): The output key of the source node.
            dest_input (str): The input key of the destination node.
            new_src_id (int): The id of the new source node.
            new_src_output (str): The new output key of the new source node.
        """
        if src_id not in self.dag.nodes:
            print(f"[Modify edge src output] node {src_id} does not exist in the plan")
            return
        if dest_id not in self.dag.nodes:
            print(f"[Modify edge src output] node {dest_id} does not exist in the plan")
            return
        # check if the new edges exists
        for key, attrs in (self.dag.get_edge_data(new_src_id, dest_id) or {}).items():
            if (
                attrs["src_output"] == new_src_output
                and attrs["dest_input"] == dest_input
            ):
                print(
                    f"[Modify edge src output] edge {src_id} -> {dest_id} with src_output {new_src_output} and dest_input {dest_input} already exists"
                )
                return
        # check if the src_output is existed in the new source node
        if new_src_output not in self.dag.nodes[new_src_id]["output"]:
            print(
                f"[Modify edge src output] src_output {new_src_output} is not existed in the new source node {new_src_id}"
            )
            return

        for key, attrs in (self.dag.get_edge_data(src_id, dest_id) or {}).items():
            if attrs["src_output"] == src_output and attrs["dest_input"] == dest_input:
                self.remove_edge(src_id, dest_id, src_output, dest_input)
                self.add_edge(new_src_id, dest_id, new_src_output, dest_input)
                return
        print(
            f"[Modify edge src output] edge {src_id} -> {dest_id} with src_output {src_output} and dest_input {dest_input} does not exist"
        )

    def modify_edge_dest_input(
        self, src_id, dest_id, src_output, dest_input, new_dest_id, new_dest_input
    ):
        """
        Modifies an edge in the DAG.
        Check if the new edges exists.
        If the new edges exists, a message will be printed.
        Check if the dest_input is existed in the new destination node.
        If the dest_input is not existed in the new destination node, a message will be printed.
        Check if the edge exists.
        If the edge exists, remove the edge from the DAG and add the new edge.
        If the edge does not exist, a message will be printed.

        Args:
            src_id (int): The id of the source node.
            dest_id (int): The id of the destination node.
            src_output (str): The output key of the source node.
            dest_input (str): The input key of the destination node.
            new_dest_id (int): The id of the new destination node.
            new_dest_input (str): The new input key of the new destination node.
        """
        if src_id not in self.dag.nodes:
            print(f"[Modify edge dest input] node {src_id} does not exist in the plan")
            return
        if dest_id not in self.dag.nodes:
            print(f"[Modify edge dest input] node {dest_id} does not exist in the plan")
            return
        # check if the new edges exists
        for key, attrs in (self.dag.get_edge_data(src_id, new_dest_id) or {}).items():
            if attrs["dest_input"] == new_dest_input:
                if attrs["src_output"] == src_output:
                    # if the exact same edge exists
                    print(
                        f"[Modify edge dest input] edge {src_id} -> {new_dest_id} with src_output {src_output} and dest_input {new_dest_input} already exists"
                    )
                else:
                    # if the dest_input already have an input edge
                    print(
                        f"[Modify edge dest input] dest_input {new_dest_input} in node {new_dest_id} already have an input edge."
                    )
                return

        # check if the dest_input is existed in the new destination node
        if new_dest_input not in self.dag.nodes[new_dest_id]["input"]:
            print(
                f"[Modify edge dest input] dest_input {new_dest_input} is not existed in the new destination node {new_dest_id}"
            )
            return

        for key, attrs in (self.dag.get_edge_data(src_id, dest_id) or {}).items():
            if attrs["src_output"] == src_output and attrs["dest_input"] == dest_input:
                self.remove_edge(src_id, dest_id, src_output, dest_input)
                self.add_edge(src_id, new_dest_id, src_output, new_dest_input)
                return
        print(
            f"[Modify edge dest input] edge {src_id} -> {dest_id} with src_output {src_output} and dest_input {dest_input} does not exist"
        )

    def get_plan_order(self):
        """
        Gets the plan order by topological sort.
        """
        return list(nx.topological_sort(self.dag))

    def is_graph_valid(self):
        """
        Checks if the graph is valid.
        """
        return nx.is_directed_acyclic_graph(self.dag)

    def execute_node(self, node_id):
        """
        Executes the node.
        Check if the node exists.
        If the node does not exist, a message will be printed.

        Get the node in the dag.
        Get the task and output variables from the node.
        Get the input and output edges from the node.
        Get the agent assigned to this node.
        Get the input variables from the node.

        Check if all input variables have values.
        If the value is None, then we need to find the node that has the output variable.
        If the value is not None, then we can use the value.
        Execute the node.
        Update the output variables in the current node.

        Args:
            node_id (int): The id of the node to execute.
        """
        # check if the node exists
        if node_id not in self.dag:
            print(f"[Execute node] node {node_id} does not exist")
            return

        # find the node in the dag
        current_node = self.dag.nodes[node_id]
        current_node_task = current_node["task"]
        current_node_output = current_node["output"]

        # get input and output variables from previous nodes
        input_edge = list(self.dag.in_edges(node_id, data=True))
        output_edge = list(self.dag.out_edges(node_id, data=True))

        # get the agent assigned to this node
        current_agent_instance = current_node["agent_instance"]
        if "input" in current_node:
            dict_current_input = {}
            current_node_input = current_node["input"]
            # check if all input variables have values
            for input_variable in current_node_input:
                # if the value is None, then we need to find the node that has the output variable
                bol_found = False
                # Pull from upstream output only when the local value is empty.
                # Non-empty values (user-set or already-computed) take precedence.
                if current_node_input[input_variable]["value"] == "":
                    for edge in input_edge:
                        if edge[2]["dest_input"] == input_variable:
                            current_node_input[input_variable]["value"] = (
                                self.dag.nodes[edge[0]]["output"][
                                    edge[2]["src_output"]
                                ]["value"]
                            )
                            current_node_input[input_variable]["value_updated"] = (
                                self.dag.nodes[edge[0]]["output"][
                                    edge[2]["src_output"]
                                ]["value_updated"]
                            )
                            current_node_input[input_variable]["timestamp"] = (
                                self.dag.nodes[edge[0]]["output"][
                                    edge[2]["src_output"]
                                ]["timestamp"]
                            )
                            bol_found = True
                            break
                    if not bol_found:
                        print(
                            f"[Execute node] In node {node_id}, input variable {input_variable} does not have a value."
                        )
                        # return

                dict_current_input[input_variable] = current_node_input[input_variable][
                    "value"
                ]

            sub_task = (
                f"{current_node_task}\nInput variables: {dict_current_input}"
                if current_node_input
                else current_node_task
            )
        else:
            sub_task = current_node_task

        dict_result = current_agent_instance.execute(
            sub_task, list(current_node_output.keys())
        )

        for output_variable in current_node_output:
            if output_variable in dict_result:
                self.dag.nodes[node_id]["output"][output_variable]["value"] = (
                    dict_result[output_variable]
                )
                self.dag.nodes[node_id]["output"][output_variable]["value_updated"] = (
                    IOVariableOrigin.EXECUTION
                )
                self.dag.nodes[node_id]["output"][output_variable]["timestamp"] = (
                    current_exact_time()
                )
            else:
                self.dag.nodes[node_id]["output"][output_variable]["value"] = "None"
                self.dag.nodes[node_id]["output"][output_variable]["value_updated"] = (
                    IOVariableOrigin.EXECUTION
                )
                self.dag.nodes[node_id]["output"][output_variable]["timestamp"] = (
                    current_exact_time()
                )

        # Store execution log in node data for snapshot preservation
        latest_log = self.get_latest_log(node_id, "start_execution")
        self.dag.nodes[node_id]["execution_log"] = latest_log

        # update the output variables in the current node
        for out_edge in output_edge:
            dest_id = out_edge[1]
            src_output = out_edge[2]["src_output"]
            dest_input = out_edge[2]["dest_input"]
            if src_output in current_node_output:
                if "input" in self.dag.nodes[dest_id]:
                    self.dag.nodes[dest_id]["input"][dest_input]["value"] = (
                        self.dag.nodes[node_id]["output"][src_output]["value"]
                    )
                    self.dag.nodes[dest_id]["input"][dest_input]["value_updated"] = (
                        IOVariableOrigin.EXECUTION
                    )
                    self.dag.nodes[dest_id]["input"][dest_input]["timestamp"] = (
                        current_exact_time()
                    )

    def merge_node(
        self,
        list_node_id: list[int],
        merged_node_data: dict,
        list_edge_data: list[dict],
        updated_by: IOVariableOrigin,
    ):
        """
        Merges the node associated with the plan.
        If the nodes are not found, a message will be printed.
        Check if the nodes are mergeable (convex set).
        If the nodes are not mergeable, a message will be printed.
        Check if the input and output variables are existed in the nodes.
        If the input and output variables are not existed in the nodes, a message will be printed.
        Add the new merged node.
        Remove the old nodes.
        Add the new merged edges.

        Args:
            list_node_id (list[int]): The ids of the nodes to merge.
            merged_node_data (dict): The data of the new merged node.
            list_edge_data (list[dict]): The data of the new merged edges.
        """
        # check if the nodes are existed in the plan
        for node_id in list_node_id:
            if node_id not in self.dag.nodes:
                print(f"[Merge node] node {node_id} does not exist in the plan")
                return

        # check if the nodes are mergeable
        if not self.is_convex_set_cached(list_node_id):
            print("[Merge node] Nodes are not mergeable")
            return

        # check if the input out variables are existed in the nodes
        merged_node_id = merged_node_data["id"]
        for edge_data in list_edge_data:
            if edge_data["src_node"] != merged_node_id:
                # Check if source node exists before accessing it
                if edge_data["src_node"] not in self.dag.nodes:
                    print(
                        f"[Merge node] Source node {edge_data['src_node']} does not exist in the plan"
                    )
                    return
                if (
                    edge_data["src_output"]
                    not in self.dag.nodes[edge_data["src_node"]]["output"]
                ):
                    print(
                        f"[Merge node] src_output {edge_data['src_output']} is not existed in the source node {edge_data['src_node']}"
                    )
                    return
            if edge_data["dest_node"] != merged_node_id:
                # Check if destination node exists before accessing it
                if edge_data["dest_node"] not in self.dag.nodes:
                    print(
                        f"[Merge node] Destination node {edge_data['dest_node']} does not exist in the plan"
                    )
                    return
                if (
                    edge_data["dest_input"]
                    not in self.dag.nodes[edge_data["dest_node"]]["input"]
                ):
                    print(
                        f"[Merge node] dest_input {edge_data['dest_input']} is not existed in the destination node {edge_data['dest_node']}"
                    )
                    return

        # add new merged node
        dict_node_id_to_add_node = {}
        merged_node_data["input"] = self.process_input_variables(
            merged_node_data.get("input", {}), updated_by
        )
        merged_node_data["output"] = self.process_output_variables(
            merged_node_data.get("output", {}), updated_by
        )
        node_id_new = self.add_node(merged_node_data, updated_by)
        dict_node_id_to_add_node[merged_node_id] = node_id_new

        # need to remove the old nodes first
        for node_id in list_node_id:
            self.remove_node(node_id)

        # add new merged edges
        for edge_data in list_edge_data:
            if edge_data["src_node"] in dict_node_id_to_add_node:
                self.add_edge(
                    dict_node_id_to_add_node[edge_data["src_node"]],
                    edge_data["dest_node"],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )
            elif edge_data["dest_node"] in dict_node_id_to_add_node:
                self.add_edge(
                    edge_data["src_node"],
                    dict_node_id_to_add_node[edge_data["dest_node"]],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )

        return node_id_new

    def force_merge_nodes(self, list_node_id: list[int], updated_by: IOVariableOrigin):
        list_topological_order = self.get_plan_order()
        new_node_data = {
            "id": "template_holder",
            "task": "Merged Node:",
            "input": {},
            "output": [],
        }

        list_agent_name = []
        for node_id in list_topological_order:
            if node_id in list_node_id:
                temp_node_data = self.dag.nodes[node_id]
                if "agent_name" in temp_node_data:
                    if temp_node_data["agent_name"] not in list_agent_name:
                        list_agent_name.append(temp_node_data["agent_name"])
                if "task" in temp_node_data:
                    new_node_data["task"] += (
                        f"\nPrev Node ID {node_id}: {temp_node_data['task']}"
                    )
                if "input" in temp_node_data:
                    for input_variable in temp_node_data["input"]:
                        assinged_input_key = f"{input_variable}_{node_id}"
                        new_node_data["input"][assinged_input_key] = temp_node_data[
                            "input"
                        ][input_variable]["value"]
                if "output" in temp_node_data:
                    for output_variable in temp_node_data["output"]:
                        assinged_output_key = f"{output_variable}_{node_id}"
                        new_node_data["output"].append(assinged_output_key)

        list_edges = []

        for edge_data in self.dag.edges(data=True):
            src_id = edge_data[0]
            dest_id = edge_data[1]
            src_output = edge_data[2]["src_output"]
            dest_input = edge_data[2]["dest_input"]
            if src_id in list_node_id and dest_id in list_node_id:
                new_node_data["task"] += (
                    f"\nPrev Internal Edge {src_id} -> {dest_id}: {src_output} -> {dest_input}"
                )
            elif src_id in list_node_id and dest_id not in list_node_id:
                list_edges.append(
                    {
                        "src_node": "template_holder",
                        "dest_node": dest_id,
                        "src_output": f"{src_output}_{src_id}",
                        "dest_input": dest_input,
                    }
                )
            elif src_id not in list_node_id and dest_id in list_node_id:
                list_edges.append(
                    {
                        "src_node": src_id,
                        "dest_node": "template_holder",
                        "src_output": src_output,
                        "dest_input": f"{dest_input}_{dest_id}",
                    }
                )

        if len(list_agent_name) > 1 or len(list_agent_name) == 0:
            new_node_data["agent_name"] = "commonsense"
        else:
            new_node_data["agent_name"] = list_agent_name[0]

        self.merge_node(list_node_id, new_node_data, list_edges, updated_by)

    def is_convex_set_cached(self, list_node_id):
        """
        Checks if the given set of nodes forms a convex (mergeable) subgraph.

        A set of nodes is considered mergeable (convex) if, for every pair of nodes (a, b) in the set
        where there is a path from a to b, all intermediate nodes on any such path are also contained
        within the set. In other words, there is no node outside the set that lies on a path between
        any two nodes in the set.

        Args:
            list_node_id (list[int]): List of node IDs to check for convexity.

        Returns:
            bool: True if the set is convex (mergeable), False otherwise.
        """
        S = set(list_node_id)
        desc = {u: nx.descendants(self.dag, u) for u in S}
        anc = {u: nx.ancestors(self.dag, u) for u in S}
        for a in S:
            for b in S:
                if a == b or b not in desc[a]:  # skip if no a→…→b path
                    continue
                if (desc[a] & anc[b]) - S:  # some outside node on a→…→b
                    return False
        return True

    def split_node(
        self,
        node_id,
        list_split_node_data: list[dict],
        list_edge_data: list[dict],
        updated_by: IOVariableOrigin,
    ):
        """
        Splits the node associated with the plan.
        If the node id is not found, a message will be printed.
        Check if the new edges connect to the old node.
        If the new edges connect to the old node, a message will be printed.
        Check if the input and output variables are existed in the nodes.
        If the input and output variables are not existed in the nodes, a message will be printed.
        Add the new split nodes.
        Remove the old node.
        Add the new split edges.

        Args:
            node_id (int): The id of the node to split.
            list_split_node_data (list[dict]): The data of the new split nodes.
            list_edge_data (list[dict]): The data of the new split edges.
        """

        if node_id not in self.dag.nodes:
            print(f"[Split node] node {node_id} does not exist in the plan")
            return
        # add new split nodes
        list_split_node_id = []
        for node_data in list_split_node_data:
            list_split_node_id.append(node_data["id"])

        for edge_data in list_edge_data:
            # check if the new edges connect to the old node
            if edge_data["src_node"] == node_id or edge_data["dest_node"] == node_id:
                print("[Split node] The new edge should not connect to the old node.")
                return

            if edge_data["src_node"] in list_split_node_id:
                # check if the input variables are existed in the nodes
                if (
                    edge_data["dest_node"] in self.dag.nodes
                    and edge_data["dest_input"]
                    not in self.dag.nodes[edge_data["dest_node"]]["input"]
                ):
                    print(
                        f"[Split node] In the orignal node, dest_input {edge_data['dest_input']} is not existed in the destination node {edge_data['dest_node']}"
                    )
                    return
            if edge_data["dest_node"] in list_split_node_id:
                # check if the output variables are existed in the nodes
                if (
                    edge_data["src_node"] in self.dag.nodes
                    and edge_data["src_output"]
                    not in self.dag.nodes[edge_data["src_node"]]["output"]
                ):
                    print(
                        f"[Split node] In the orignal node, src_output {edge_data['src_output']} is not existed in the source node {edge_data['src_node']}"
                    )
                    return

        # add new split nodes
        dict_node_id_to_add_node = {}
        for node_data in list_split_node_data:
            given_node_id = node_data["id"]
            node_data["input"] = self.process_input_variables(
                node_data.get("input", {}), updated_by
            )
            node_data["output"] = self.process_output_variables(
                node_data.get("output", {}), updated_by
            )
            node_id_new = self.add_node(node_data, updated_by)
            dict_node_id_to_add_node[given_node_id] = node_id_new

        # remove the old node
        self.remove_node(node_id)

        # add new split edges
        for edge_data in list_edge_data:
            if (
                edge_data["src_node"] in dict_node_id_to_add_node
                and edge_data["dest_node"] not in dict_node_id_to_add_node
            ):
                self.add_edge(
                    dict_node_id_to_add_node[edge_data["src_node"]],
                    edge_data["dest_node"],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )
            elif (
                edge_data["dest_node"] in dict_node_id_to_add_node
                and edge_data["src_node"] not in dict_node_id_to_add_node
            ):
                self.add_edge(
                    edge_data["src_node"],
                    dict_node_id_to_add_node[edge_data["dest_node"]],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )
            elif (
                edge_data["src_node"] in dict_node_id_to_add_node
                and edge_data["dest_node"] in dict_node_id_to_add_node
            ):
                self.add_edge(
                    dict_node_id_to_add_node[edge_data["src_node"]],
                    dict_node_id_to_add_node[edge_data["dest_node"]],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )

        return list(dict_node_id_to_add_node.values())

    def sequential_split_node(self, node_id: int, updated_by: IOVariableOrigin):
        if node_id not in self.dag.nodes:
            print(f"[Sequential split node] node {node_id} does not exist in the plan")
            return

        old_node_data = self.dag.nodes[node_id]

        dict_new_node_1 = {
            "id": "placeholder_1",
            "task": old_node_data["task"],
            "agent_name": old_node_data["agent_name"],
            "input": old_node_data["input"],
            "output": ["template_holder"],
            "prereq": [],
        }
        dict_new_node_2 = {
            "id": "placeholder_2",
            "task": old_node_data["task"],
            "agent_name": old_node_data["agent_name"],
            "input": {"template_holder": ""},
            "output": old_node_data["output"],
            "prereq": [],
        }
        list_new_nodes = [dict_new_node_1, dict_new_node_2]

        list_new_edges = [
            {
                "src_node": dict_new_node_1["id"],
                "dest_node": dict_new_node_2["id"],
                "src_output": "template_holder",
                "dest_input": "template_holder",
            }
        ]

        # Handle outgoing edges (where node_id is the source)
        for edge_data in self.dag.edges(node_id, data=True):
            src_node = edge_data[0]
            dest_node = edge_data[1]
            src_output = edge_data[2]["src_output"]
            dest_input = edge_data[2]["dest_input"]
            list_new_edges.append(
                {
                    "src_node": dict_new_node_2["id"],
                    "dest_node": dest_node,
                    "src_output": src_output,
                    "dest_input": dest_input,
                }
            )

        # Handle incoming edges (where node_id is the destination)
        for edge_data in self.dag.in_edges(node_id, data=True):
            src_node = edge_data[0]
            dest_node = edge_data[1]
            src_output = edge_data[2]["src_output"]
            dest_input = edge_data[2]["dest_input"]
            list_new_edges.append(
                {
                    "src_node": src_node,
                    "dest_node": dict_new_node_1["id"],
                    "src_output": src_output,
                    "dest_input": dest_input,
                }
            )

        self.split_node(node_id, list_new_nodes, list_new_edges, updated_by)

    def subplan_replan(
        self,
        list_old_node_id,
        list_new_node_data,
        list_new_edge_data,
        update_by: IOVariableOrigin,
    ):
        # check if the nodes are existed in the plan
        for node_id in list_old_node_id:
            if node_id not in self.dag.nodes:
                print(f"[Subplan replan] node {node_id} does not exist in the plan")
                return

        # check if the nodes are mergeable
        if not self.is_convex_set_cached(list_old_node_id):
            print("[Subplan replan] Nodes are not mergeable")
            return

        # add new split nodes
        list_new_node_id = []
        for node_data in list_new_node_data:
            list_new_node_id.append(node_data["id"])

        # check if all edge data are valid
        for edge_data in list_new_edge_data:
            # check if the new edges connect to the old node
            if (
                edge_data["src_node"] in list_old_node_id
                or edge_data["dest_node"] in list_old_node_id
            ):
                print(
                    "[Subplan replan] The new edge should not connect to the old node."
                )
                return

            if edge_data["src_node"] in list_new_node_id:
                # check if the input variables are existed in the nodes
                if (
                    edge_data["dest_node"] in self.dag.nodes
                    and edge_data["dest_input"]
                    not in self.dag.nodes[edge_data["dest_node"]]["input"]
                ):
                    print(
                        f"[Subplan replan] In the orignal node, dest_input {edge_data['dest_input']} is not existed in the destination node {edge_data['dest_node']}"
                    )
                    return
            if edge_data["dest_node"] in list_new_node_id:
                # check if the output variables are existed in the nodes
                if (
                    edge_data["src_node"] in self.dag.nodes
                    and edge_data["src_output"]
                    not in self.dag.nodes[edge_data["src_node"]]["output"]
                ):
                    print(
                        f"[Subplan replan] In the orignal node, src_output {edge_data['src_output']} is not existed in the source node {edge_data['src_node']}"
                    )
                    return

        # add new nodes
        dict_node_id_to_add_node = {}
        for node_data in list_new_node_data:
            given_node_id = node_data["id"]
            node_data["input"] = self.process_input_variables(
                node_data.get("input", {}), update_by
            )
            node_data["output"] = self.process_output_variables(
                node_data.get("output", {}), update_by
            )
            node_id_new = self.add_node(node_data, update_by)
            dict_node_id_to_add_node[given_node_id] = node_id_new

        # remove the old nodes
        for node_id in list_old_node_id:
            self.remove_node(node_id)

        # add new edges
        for edge_data in list_new_edge_data:
            if (
                edge_data["src_node"] in dict_node_id_to_add_node
                and edge_data["dest_node"] not in dict_node_id_to_add_node
            ):
                self.add_edge(
                    dict_node_id_to_add_node[edge_data["src_node"]],
                    edge_data["dest_node"],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )
            elif (
                edge_data["dest_node"] in dict_node_id_to_add_node
                and edge_data["src_node"] not in dict_node_id_to_add_node
            ):
                self.add_edge(
                    edge_data["src_node"],
                    dict_node_id_to_add_node[edge_data["dest_node"]],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )
            elif (
                edge_data["src_node"] in dict_node_id_to_add_node
                and edge_data["dest_node"] in dict_node_id_to_add_node
            ):
                self.add_edge(
                    dict_node_id_to_add_node[edge_data["src_node"]],
                    dict_node_id_to_add_node[edge_data["dest_node"]],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )

        return True

    def subplan_replan_auto_reconnect(
        self,
        list_old_node_id,
        list_new_node_data,
        list_new_edge_data,
        update_by: IOVariableOrigin,
    ):
        """
        Replans the subplan and automatically reconnects the external nodes.
        If the input and output variables are not existed in the nodes, add the input and output variables to the nodes.
        If the input and output variables are existed in the nodes, update the input and output variables to the nodes.
        """
        # check if the nodes are existed in the plan
        for node_id in list_old_node_id:
            if node_id not in self.dag.nodes:
                print(
                    f"[Subplan replan Auto Reconnect] node {node_id} does not exist in the plan"
                )
                return

        # check if the nodes are mergeable
        if not self.is_convex_set_cached(list_old_node_id):
            print("[Subplan replan Auto Reconnect] Nodes are not mergeable")
            return

        # add new split nodes
        list_new_node_id = []
        for node_data in list_new_node_data:
            list_new_node_id.append(node_data["id"])

        # check if all edge data are valid
        for edge_data in list_new_edge_data:
            # check if the new edges connect to the old node
            if (
                edge_data["src_node"] in list_old_node_id
                or edge_data["dest_node"] in list_old_node_id
            ):
                print(
                    "[Subplan replan Auto Reconnect] The new edge should not connect to the old node."
                )
                return

            if edge_data["src_node"] in list_new_node_id:
                # check if the input variables are existed in the nodes
                if (
                    edge_data["dest_node"] in self.dag.nodes
                    and edge_data["dest_input"]
                    not in self.dag.nodes[edge_data["dest_node"]]["input"]
                ):
                    self.add_input_variable_key(
                        edge_data["dest_node"], edge_data["dest_input"], update_by
                    )
            if edge_data["dest_node"] in list_new_node_id:
                # check if the output variables are existed in the nodes
                if (
                    edge_data["src_node"] in self.dag.nodes
                    and edge_data["src_output"]
                    not in self.dag.nodes[edge_data["src_node"]]["output"]
                ):
                    self.add_output_variable_key(
                        edge_data["src_node"], edge_data["src_output"], update_by
                    )

        # add new nodes
        dict_node_id_to_add_node = {}
        for node_data in list_new_node_data:
            given_node_id = node_data["id"]
            node_data["input"] = self.process_input_variables(
                node_data.get("input", {}), update_by
            )
            node_data["output"] = self.process_output_variables(
                node_data.get("output", {}), update_by
            )
            node_id_new = self.add_node(node_data, update_by)
            dict_node_id_to_add_node[given_node_id] = node_id_new

        # remove the old nodes
        for node_id in list_old_node_id:
            self.remove_node(node_id)

        # add new edges
        for edge_data in list_new_edge_data:
            if (
                edge_data["src_node"] in dict_node_id_to_add_node
                and edge_data["dest_node"] not in dict_node_id_to_add_node
            ):
                self.add_edge(
                    dict_node_id_to_add_node[edge_data["src_node"]],
                    edge_data["dest_node"],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )
            elif (
                edge_data["dest_node"] in dict_node_id_to_add_node
                and edge_data["src_node"] not in dict_node_id_to_add_node
            ):
                self.add_edge(
                    edge_data["src_node"],
                    dict_node_id_to_add_node[edge_data["dest_node"]],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )
            elif (
                edge_data["src_node"] in dict_node_id_to_add_node
                and edge_data["dest_node"] in dict_node_id_to_add_node
            ):
                self.add_edge(
                    dict_node_id_to_add_node[edge_data["src_node"]],
                    dict_node_id_to_add_node[edge_data["dest_node"]],
                    edge_data["src_output"],
                    edge_data["dest_input"],
                )

        return True

    def boundary_edges(self, list_node_id):
        """
        Returns the boundary edges of the nodes.

        Args:
            list_node_id (list[int]): The ids of the nodes to get the boundary edges.

        Returns:
            list[dict]: The boundary edges.
        """
        S = set(list_node_id)
        incoming, outgoing, internal = [], [], []
        for u, v, k, d in self.dag.edges(data=True, keys=True):
            if u in S and v in S:
                internal.append([u, v, k, d])
            elif u not in S and v in S:
                incoming.append([u, v, k, d])
            elif u in S and v not in S:
                outgoing.append([u, v, k, d])
        return incoming, outgoing, internal

    def process_input_variables(
        self, dict_input_variables, updated_by: IOVariableOrigin
    ):
        """
        Extracts the input variables from the dictionary.
        The input variables need to fill into following formats:
        1. {<input_variable_name>: {<value>: <input_variable_value>, <value_updated>: <updated_by>, <timestamp>: <current_exact_time()>}}
        2. {<input_variable_name>: <input_variable_value>}
        3. [{<variable>: <variable_name>, <value>: <variable_value>}]
        """
        dict_input_variable_new = {}
        # if the input variables are empty, return the empty dictionary
        if not dict_input_variables:
            return dict_input_variable_new

        if isinstance(dict_input_variables, dict):
            for variable_key in dict_input_variables:
                # correct format: {<input_variable_name>: {<value>: <input_variable_value>, <value_updated>: <updated_by>, <timestamp>: <current_exact_time()>}}
                # Check if it's a dict first to avoid "argument of type 'X' is not iterable" errors with SymPy objects
                if (
                    isinstance(dict_input_variables[variable_key], dict)
                    and "value" in dict_input_variables[variable_key]
                    and "value_updated" in dict_input_variables[variable_key]
                    and "timestamp" in dict_input_variables[variable_key]
                ):
                    return dict_input_variables
                # format: {<input_variable_name>: <input_variable_value>}
                else:
                    dict_input_variable_new[variable_key] = {
                        "value": dict_input_variables[variable_key],
                        "value_updated": updated_by,
                        "timestamp": current_exact_time(),
                    }
        elif isinstance(dict_input_variables, list):
            # format: [{<variable>: <variable_name>, <value>: <variable_value>}]
            for input_variable in dict_input_variables:
                dict_input_variable_new[input_variable["variable"]] = {
                    "value": input_variable["value"],
                    "value_updated": updated_by,
                    "timestamp": current_exact_time(),
                }

        else:
            raise ValueError(
                f"Input variables are not in the correct format! \nCurrent Format: {dict_input_variables}"
            )

        # update the input variables in the node data
        return dict_input_variable_new

    def process_output_variables(
        self, dict_output_variables, updated_by: IOVariableOrigin
    ):
        """
        Extracts the output variables from the dictionary.
        The output variables need to fill into following formats:
        1. {<output_variable_name>: {<value>: <output_variable_value>, <value_updated>: <updated_by>, <timestamp>: <current_exact_time()>}}
        2. {<output_variable_name>: <output_variable_value>}
        3. output_variables: [<output_variable_name>, <output_variable_name>, ...]
        """
        dict_output_variable_new = {}

        # if the output variables are empty, return the empty dictionary
        if not dict_output_variables:
            return dict_output_variable_new

        if isinstance(dict_output_variables, dict):
            for variable_key in dict_output_variables:
                # correct format: {<output_variable_name>: {<value>: <output_variable_value>, <value_updated>: <updated_by>, <timestamp>: <current_exact_time()>}}
                # Check if it's a dict first to avoid "argument of type 'X' is not iterable" errors with SymPy objects
                if (
                    isinstance(dict_output_variables[variable_key], dict)
                    and "value" in dict_output_variables[variable_key]
                    and "value_updated" in dict_output_variables[variable_key]
                    and "timestamp" in dict_output_variables[variable_key]
                ):
                    return dict_output_variables
                # format: {<output_variable_name>: <output_variable_value>}
                else:
                    dict_output_variable_new[variable_key] = {
                        "value": dict_output_variables[variable_key],
                        "value_updated": updated_by,
                        "timestamp": current_exact_time(),
                    }
        elif isinstance(dict_output_variables, list):
            # format: [<variable_name>, <variable_name>, ...]
            for output_variable in dict_output_variables:
                dict_output_variable_new[output_variable] = {
                    "value": "",
                    "value_updated": updated_by,
                    "timestamp": current_exact_time(),
                }
        else:
            raise ValueError(
                f"Output variables are not in the correct format! \nCurrent Format: {dict_output_variables}"
            )

        # update the output variables in the node data
        return dict_output_variable_new

    def extract_executed_outputs_and_inputs(self, node_id: int):
        """
        Extracts the executed outputs and inputs from the node.

        Args:
            node_id (int): The id of the node to extract the executed outputs and inputs that this node is connected to .

        Returns:
            tuple: A tuple of the executed outputs and inputs.
        """
        if node_id not in self.dag.nodes:
            print(
                f"[Extract executed outputs and inputs] node {node_id} does not exist in the plan"
            )
            return

        executed_outputs = {}  # key: output_variable, value: value
        executed_inputs = {}  # {node_id: {input_variable: value}}
        for output_variable in self.dag.nodes[node_id]["output"]:
            executed_outputs[output_variable] = str(
                self.dag.nodes[node_id]["output"][output_variable]["value"]
            )

        for edge in self.dag.edges(node_id, data=True):
            src_id = edge[0]
            if src_id != node_id:
                continue
            dest_id = edge[1]
            if dest_id not in executed_inputs:
                executed_inputs[dest_id] = {}
            src_output = edge[2]["src_output"]
            dest_input = edge[2]["dest_input"]

            executed_inputs[dest_id][dest_input] = str(executed_outputs[src_output])

        return executed_outputs, executed_inputs

    def extract_all_executed_outputs_and_inputs(self):
        executed_outputs = {}  # {node_id: {output_variable: value}}
        executed_inputs = {}  # {node_id: {input_variable: value}}
        for node_id in self.dag.nodes:
            executed_outputs[node_id] = {}
            executed_inputs[node_id] = {}
            for output_variable in self.dag.nodes[node_id]["output"]:
                executed_outputs[node_id][output_variable] = str(
                    self.dag.nodes[node_id]["output"][output_variable]["value"]
                )
            for input_variable in self.dag.nodes[node_id]["input"]:
                executed_inputs[node_id][input_variable] = str(
                    self.dag.nodes[node_id]["input"][input_variable]["value"]
                )
        return executed_outputs, executed_inputs

    def get_latest_log(self, node_id: int, start_word: str):
        if node_id not in self.dag.nodes:
            return [f"[Get latest log] Node {node_id} Not Exist!"]
        dict_full_log = self.dag.nodes[node_id]["agent_instance"].get_latest_log(
            start_word
        )
        dict_log = []
        for log_info in dict_full_log:
            if "[Present]" in log_info.log_name:
                dict_log.append(log_info)
        return dict_log

    @staticmethod
    def compare_plans(plan1: dict, plan2: dict) -> dict:
        """
        Compares two plans and returns what was removed and what was added.

        Plans should be in the format: {"nodes": [], "edges": []}

        For nodes:
        - Nodes are considered the same if they have:
          1. Same task description
          2. Same input variable names (exact match)
          3. Same output variable names (exact match)
        - Node IDs are NOT used for comparison

        For edges:
        - Edges are considered the same if they have:
          1. Same source node (based on node matching criteria above)
          2. Same destination node (based on node matching criteria above)
          3. Same src_output variable name
          4. Same dest_input variable name

        Args:
            plan1 (dict): First plan (baseline) with format {"nodes": [], "edges": []}
            plan2 (dict): Second plan (comparison) with format {"nodes": [], "edges": []}

        Returns:
            dict: A dictionary with format:
                  {
                      "removed": {"nodes": [], "edges": []},  # in plan1 but not in plan2
                      "added": {"nodes": [], "edges": []}     # in plan2 but not in plan1
                  }
        """

        def node_signature(node_data):
            """
            Creates a unique signature for a node based on task, input variable names, and output variable names.

            Args:
                node_data: Can be a dict or LLMNode object

            Returns:
                tuple: A hashable signature (task, frozenset of input names, frozenset of output names)
            """
            if isinstance(node_data, dict):
                # Handle dictionary format
                task = node_data.get("task", "")

                # Handle input - could be dict or list
                input_data = node_data.get("input", {})
                if isinstance(input_data, dict):
                    input_names = frozenset(input_data.keys())
                elif isinstance(input_data, list):
                    # List of LLMNodeInput objects or dicts
                    input_names = frozenset(
                        item["variable"] if isinstance(item, dict) else item.variable
                        for item in input_data
                    )
                else:
                    input_names = frozenset()

                # Handle output - could be dict or list
                output_data = node_data.get("output", {})
                if isinstance(output_data, dict):
                    output_names = frozenset(output_data.keys())
                elif isinstance(output_data, list):
                    output_names = frozenset(output_data)
                else:
                    output_names = frozenset()
            else:
                # Handle LLMNode object
                task = node_data.task
                input_names = frozenset(inp.variable for inp in node_data.input)
                output_names = frozenset(node_data.output)

            return (task, input_names, output_names)

        def edge_signature(edge_data, node_sig_map):
            """
            Creates a unique signature for an edge based on source node signature,
            destination node signature, src_output, and dest_input.

            Args:
                edge_data: Can be a dict or LLMEdge object
                node_sig_map: Mapping from node ID to node signature

            Returns:
                tuple: A hashable signature (src_node_sig, dest_node_sig, src_output, dest_input)
                       or None if the referenced nodes don't exist
            """
            if isinstance(edge_data, dict):
                src_node = edge_data.get("src_node")
                dest_node = edge_data.get("dest_node")
                src_output = edge_data.get("src_output", "")
                dest_input = edge_data.get("dest_input", "")
            else:
                # Handle LLMEdge object
                src_node = edge_data.src_node
                dest_node = edge_data.dest_node
                src_output = edge_data.src_output
                dest_input = edge_data.dest_input

            # Get node signatures
            src_sig = node_sig_map.get(src_node)
            dest_sig = node_sig_map.get(dest_node)

            if src_sig is None or dest_sig is None:
                return None

            return (src_sig, dest_sig, src_output, dest_input)

        # Extract nodes and edges from both plans
        nodes1 = plan1.get("nodes", [])
        edges1 = plan1.get("edges", [])
        nodes2 = plan2.get("nodes", [])
        edges2 = plan2.get("edges", [])

        # Create node signature sets and mappings for plan1
        node_signatures1 = set()
        node_sig_map1 = {}
        sig_to_node1 = {}  # Map signature back to node data
        for node_data in nodes1:
            node_id = (
                node_data.get("id") if isinstance(node_data, dict) else node_data.id
            )
            sig = node_signature(node_data)
            node_signatures1.add(sig)
            node_sig_map1[node_id] = sig
            sig_to_node1[sig] = node_data

        # Create node signature sets and mappings for plan2
        node_signatures2 = set()
        node_sig_map2 = {}
        sig_to_node2 = {}  # Map signature back to node data
        for node_data in nodes2:
            node_id = (
                node_data.get("id") if isinstance(node_data, dict) else node_data.id
            )
            sig = node_signature(node_data)
            node_signatures2.add(sig)
            node_sig_map2[node_id] = sig
            sig_to_node2[sig] = node_data

        # Find nodes removed (in plan1 but not in plan2)
        removed_nodes = []
        for sig in node_signatures1:
            if sig not in node_signatures2:
                removed_nodes.append(sig_to_node1[sig].id)

        # Find nodes added (in plan2 but not in plan1)
        added_nodes = []
        for sig in node_signatures2:
            if sig not in node_signatures1:
                added_nodes.append(sig_to_node2[sig].id)

        # Create edge signature sets and mappings for plan1
        edge_signatures1 = set()
        sig_to_edge1 = {}  # Map signature back to edge data
        for edge in edges1:
            sig = edge_signature(edge, node_sig_map1)
            if sig is not None:
                edge_signatures1.add(sig)
                sig_to_edge1[sig] = edge

        # Create edge signature sets and mappings for plan2
        edge_signatures2 = set()
        sig_to_edge2 = {}  # Map signature back to edge data
        for edge in edges2:
            sig = edge_signature(edge, node_sig_map2)
            if sig is not None:
                edge_signatures2.add(sig)
                sig_to_edge2[sig] = edge

        # Find edges removed (in plan1 but not in plan2)
        removed_edges = []
        for sig in edge_signatures1:
            if sig not in edge_signatures2:
                removed_edges.append(sig_to_edge1[sig])

        # Find edges added (in plan2 but not in plan1)
        added_edges = []
        for sig in edge_signatures2:
            if sig not in edge_signatures1:
                added_edges.append(sig_to_edge2[sig])

        return {
            "removed": {"nodes": removed_nodes, "edges": removed_edges},
            "added": {"nodes": added_nodes, "edges": added_edges},
        }

    @staticmethod
    def calculate_graph_edit_distance(
        plan1: dict,
        plan2: dict,
        node_insert_cost: float = 1.0,
        node_delete_cost: float = 1.0,
        node_substitute_cost: float = 1.0,
        edge_insert_cost: float = 1.0,
        edge_delete_cost: float = 1.0,
        edge_substitute_cost: float = 1.0,
    ) -> dict:
        """
        Calculates the graph edit distance between two plans.

        Graph Edit Distance (GED) is the minimum cost of edit operations needed to
        transform plan1 into plan2. Operations include:
        - Node insertion/deletion/substitution
        - Edge insertion/deletion/substitution

        This implementation detects node substitutions by finding the optimal matching
        between nodes in plan1 and plan2, considering partial matches.

        Plans should be in the format: {"nodes": [], "edges": []}

        Node matching criteria:
        - Node IDs are IGNORED
        - Nodes are compared based on: task description, agent_name, input variables, output variables
        - Exact match: all 4 attributes are the same
        - Partial match: some attributes match -> counted as substitution
        - No match: completely different -> counted as deletion + insertion

        Edge matching criteria:
        - Same source node (based on node matching)
        - Same destination node (based on node matching)
        - Same src_output variable name
        - Same dest_input variable name

        Args:
            plan1 (dict): First plan (source) with format {"nodes": [], "edges": []}
            plan2 (dict): Second plan (target) with format {"nodes": [], "edges": []}
            node_insert_cost (float): Cost of inserting a node (default: 1.0)
            node_delete_cost (float): Cost of deleting a node (default: 1.0)
            node_substitute_cost (float): Cost of substituting a node (default: 1.0)
            edge_insert_cost (float): Cost of inserting an edge (default: 1.0)
            edge_delete_cost (float): Cost of deleting an edge (default: 1.0)
            edge_substitute_cost (float): Cost of substituting an edge (default: 1.0)

        Returns:
            dict: A dictionary with format:
                  {
                      "total_distance": float,           # Total GED
                      "node_operations": {
                          "deletions": int,              # Number of node deletions
                          "insertions": int,             # Number of node insertions
                          "substitutions": int,          # Number of node substitutions
                          "cost": float                  # Total cost of node operations
                      },
                      "edge_operations": {
                          "deletions": int,              # Number of edge deletions
                          "insertions": int,             # Number of edge insertions
                          "substitutions": int,          # Number of edge substitutions
                          "cost": float                  # Total cost of edge operations
                      },
                      "details": {
                          "removed_nodes": list,         # Nodes deleted from plan1
                          "added_nodes": list,           # Nodes added in plan2
                          "substituted_nodes": list,     # Nodes substituted (from plan1 -> plan2)
                          "removed_edges": list,         # Edges removed from plan1
                          "added_edges": list            # Edges added in plan2
                      }
                  }
        """

        def node_signature(node_data):
            """Creates a unique signature for a node based on all 4 attributes."""
            if isinstance(node_data, dict):
                task = node_data.get("task", "")
                agent_name = node_data.get("agent_name", "")

                input_data = node_data.get("input", {})
                if isinstance(input_data, dict):
                    input_names = frozenset(input_data.keys())
                elif isinstance(input_data, list):
                    input_names = frozenset(
                        item["variable"] if isinstance(item, dict) else item.variable
                        for item in input_data
                    )
                else:
                    input_names = frozenset()

                output_data = node_data.get("output", {})
                if isinstance(output_data, dict):
                    output_names = frozenset(output_data.keys())
                elif isinstance(output_data, list):
                    output_names = frozenset(output_data)
                else:
                    output_names = frozenset()
            else:
                task = node_data.task
                agent_name = node_data.agent_name
                input_names = frozenset(inp.variable for inp in node_data.input)
                output_names = frozenset(node_data.output)

            return (task, agent_name, input_names, output_names)

        def partial_node_signature(node_data):
            """Creates a partial signature (agent_name, inputs, outputs) for substitution detection."""
            if isinstance(node_data, dict):
                agent_name = node_data.get("agent_name", "")

                input_data = node_data.get("input", {})
                if isinstance(input_data, dict):
                    input_names = frozenset(input_data.keys())
                elif isinstance(input_data, list):
                    input_names = frozenset(
                        item["variable"] if isinstance(item, dict) else item.variable
                        for item in input_data
                    )
                else:
                    input_names = frozenset()

                output_data = node_data.get("output", {})
                if isinstance(output_data, dict):
                    output_names = frozenset(output_data.keys())
                elif isinstance(output_data, list):
                    output_names = frozenset(output_data)
                else:
                    output_names = frozenset()
            else:
                agent_name = node_data.agent_name
                input_names = frozenset(inp.variable for inp in node_data.input)
                output_names = frozenset(node_data.output)

            return (agent_name, input_names, output_names)

        def edge_signature(edge_data, node_partial_sig_map):
            """Creates a unique signature for an edge using partial node signatures.

            This ensures that edges are not marked as changed when only the task
            description of connected nodes changes (substitution). Edges should only
            be marked as changed if the actual connections (agent_name, inputs, outputs)
            or edge variables change.
            """
            if isinstance(edge_data, dict):
                src_node = edge_data.get("src_node")
                dest_node = edge_data.get("dest_node")
                src_output = edge_data.get("src_output", "")
                dest_input = edge_data.get("dest_input", "")
            else:
                src_node = edge_data.src_node
                dest_node = edge_data.dest_node
                src_output = edge_data.src_output
                dest_input = edge_data.dest_input

            # Use partial signatures (agent_name, inputs, outputs) instead of full signatures
            src_sig = node_partial_sig_map.get(src_node)
            dest_sig = node_partial_sig_map.get(dest_node)

            if src_sig is None or dest_sig is None:
                return None

            return (src_sig, dest_sig, src_output, dest_input)

        # Extract nodes and edges from both plans
        nodes1 = plan1.get("nodes", [])
        edges1 = plan1.get("edges", [])
        nodes2 = plan2.get("nodes", [])
        edges2 = plan2.get("edges", [])

        # Build full and partial signatures for all nodes
        # For plan1
        full_sigs1 = []  # List of (full_sig, partial_sig, node_data, index)
        node_partial_sig_map1 = {}  # node_id -> partial_signature (for edges)
        for idx, node_data in enumerate(nodes1):
            node_id = (
                node_data.get("id") if isinstance(node_data, dict) else node_data.id
            )
            full_sig = node_signature(node_data)
            partial_sig = partial_node_signature(node_data)
            full_sigs1.append((full_sig, partial_sig, node_data, idx))
            node_partial_sig_map1[node_id] = partial_sig

        # For plan2
        full_sigs2 = []  # List of (full_sig, partial_sig, node_data, index)
        node_partial_sig_map2 = {}  # node_id -> partial_signature (for edges)
        for idx, node_data in enumerate(nodes2):
            node_id = (
                node_data.get("id") if isinstance(node_data, dict) else node_data.id
            )
            full_sig = node_signature(node_data)
            partial_sig = partial_node_signature(node_data)
            full_sigs2.append((full_sig, partial_sig, node_data, idx))
            node_partial_sig_map2[node_id] = partial_sig

        # Match nodes using greedy approach
        # Priority: exact match > partial match (substitution) > no match
        matched1 = set()  # indices in plan1 that have been matched
        matched2 = set()  # indices in plan2 that have been matched

        node_deletions = []
        node_insertions = []
        node_substitutions = []

        # Phase 1: Find exact matches (all 4 attributes match)
        for idx1, (full_sig1, partial_sig1, node_data1, _) in enumerate(full_sigs1):
            if idx1 in matched1:
                continue
            for idx2, (full_sig2, partial_sig2, node_data2, _) in enumerate(full_sigs2):
                if idx2 in matched2:
                    continue
                if full_sig1 == full_sig2:
                    # Exact match - no operation needed
                    matched1.add(idx1)
                    matched2.add(idx2)
                    break

        # Phase 2: Find partial matches for substitutions (agent_name, inputs, outputs match but task differs)
        for idx1, (full_sig1, partial_sig1, node_data1, _) in enumerate(full_sigs1):
            if idx1 in matched1:
                continue
            for idx2, (full_sig2, partial_sig2, node_data2, _) in enumerate(full_sigs2):
                if idx2 in matched2:
                    continue
                if partial_sig1 == partial_sig2:
                    # Partial match - this is a substitution
                    node_substitutions.append({"from": node_data1, "to": node_data2})
                    matched1.add(idx1)
                    matched2.add(idx2)
                    break

        # Phase 3: Unmatched nodes are deletions (from plan1) or insertions (to plan2)
        for idx1, (full_sig1, partial_sig1, node_data1, _) in enumerate(full_sigs1):
            if idx1 not in matched1:
                node_deletions.append(node_data1)

        for idx2, (full_sig2, partial_sig2, node_data2, _) in enumerate(full_sigs2):
            if idx2 not in matched2:
                node_insertions.append(node_data2)

        # Calculate edge operations
        edge_signatures1 = {}  # sig -> list of edges with that signature
        for edge in edges1:
            sig = edge_signature(edge, node_partial_sig_map1)
            if sig is not None:
                if sig not in edge_signatures1:
                    edge_signatures1[sig] = []
                edge_signatures1[sig].append(edge)

        edge_signatures2 = {}  # sig -> list of edges with that signature
        for edge in edges2:
            sig = edge_signature(edge, node_partial_sig_map2)
            if sig is not None:
                if sig not in edge_signatures2:
                    edge_signatures2[sig] = []
                edge_signatures2[sig].append(edge)

        edge_deletions = []
        edge_insertions = []

        matched_edge_signatures = set()

        # Process edge signatures in plan1
        for sig1, edges1_list in edge_signatures1.items():
            if sig1 in edge_signatures2:
                edges2_list = edge_signatures2[sig1]
                matched_edge_signatures.add(sig1)

                count1 = len(edges1_list)
                count2 = len(edges2_list)

                if count1 > count2:
                    edge_deletions.extend(edges1_list[count2:])
                elif count2 > count1:
                    edge_insertions.extend(edges2_list[count1:])
            else:
                # Signature only in plan1: all are deletions
                edge_deletions.extend(edges1_list)

        # Process edge signatures only in plan2 (insertions)
        for sig2, edges2_list in edge_signatures2.items():
            if sig2 not in matched_edge_signatures and sig2 not in edge_signatures1:
                edge_insertions.extend(edges2_list)

        # Calculate costs
        num_node_deletions = len(node_deletions)
        num_node_insertions = len(node_insertions)
        num_node_substitutions = len(node_substitutions)

        num_edge_deletions = len(edge_deletions)
        num_edge_insertions = len(edge_insertions)
        num_edge_substitutions = 0  # No edge substitutions in this implementation

        node_cost = (
            num_node_deletions * node_delete_cost
            + num_node_insertions * node_insert_cost
            + num_node_substitutions * node_substitute_cost
        )

        edge_cost = (
            num_edge_deletions * edge_delete_cost
            + num_edge_insertions * edge_insert_cost
            + num_edge_substitutions * edge_substitute_cost
        )

        total_distance = node_cost + edge_cost

        return {
            "total_distance": total_distance,
            "node_operations": {
                "deletions": num_node_deletions,
                "insertions": num_node_insertions,
                "substitutions": num_node_substitutions,
                "cost": node_cost,
            },
            "edge_operations": {
                "deletions": num_edge_deletions,
                "insertions": num_edge_insertions,
                "substitutions": num_edge_substitutions,
                "cost": edge_cost,
            },
            "details": {
                "removed_nodes": node_deletions,
                "added_nodes": node_insertions,
                "substituted_nodes": node_substitutions,
                "removed_edges": edge_deletions,
                "added_edges": edge_insertions,
            },
        }
