"""Pydantic schemas for the three plan representations:

- **UI** (`UIPlan`, `UINode`, `UIEdge`, ...) — xyflow wire format, what the frontend consumes.
- **LLM** (`LLMPlan`, `LLMNode`, `LLMEdge`, `LLMNodeInput`) — compact structured-output schema for LLM calls.
- **Runtime DAG** lives in `ambipom.plan.DAGPlan` (richer, not a Pydantic type here).

Also: websocket comm envelopes, agent output schemas, tool-call schemas, and the
PydanticJSONEncoder used for on-disk serialization.
"""

import json
from enum import Enum
from typing import Any, Dict, List, Literal, Union

from pydantic import BaseModel, ConfigDict, Field
from typing_extensions import TypedDict

from ambipom.utils import InteractionType, MsgType, Status

###########################
# Chat message data type #
###########################


class BaseMessage(BaseModel):
    content: str
    timestamp: int


class UserMessage(BaseMessage):
    id: int | None = None
    role: Literal["user"]


class SystemMessage(BaseMessage):
    id: int | None = None
    role: Literal["system", "assistant"]
    response_to: int | None  # msg id or interaction id


Message = Union[UserMessage, SystemMessage]

################
# UI data type #
################

NodeInputVars = list[tuple[str, Any]]


class XYPosition(TypedDict):
    x: float
    y: float


class UINodeData(BaseModel):
    id: int | None = None
    task: str
    input: NodeInputVars = []
    output: list[str] = []
    agent: str  # agent_name
    params: dict = {}
    exec: dict[str, Any] | None = None
    plan_status: Literal["PLANNED", "MODIFIED"] = "PLANNED"
    exec_status: Literal["NONE", "MODIFIED", "EXECUTED"] = "NONE"
    # status: Literal["PLANNED", "PROCESSING", "TRIGGERED", "STARTED", "FINISHED"] = "PLANNED"


class UINode(BaseModel):
    id: str
    data: UINodeData
    position: XYPosition | None = None
    type: str | None = None


class UIEdgeData(BaseModel):
    src_node: int
    dest_node: int
    src_output: str
    dest_input: str
    plan_status: Literal["UNMODIFIED", "MODIFIED"] = "UNMODIFIED"
    hasUpdatedValue: bool = True


class UIEdge(BaseModel):
    id: str
    source: str
    target: str
    data: UIEdgeData | None
    type: str | None = None


class UIPlan(BaseModel):
    id: str
    query: str
    timestamp: int
    nodes: list[UINode]
    edges: list[UIEdge]


#####################################
# frontend <> backend communication #
#####################################


# base communication data type
class BaseComm(BaseModel):
    type: MsgType
    data: dict[str, Any]
    timestamp: int

    class Config:
        arbitrary_types_allowed = True


# front -> back
class ConnectionData(BaseModel):
    status: str


class ConnectionComm(BaseComm):
    type: MsgType.CONNECTION
    data: ConnectionData


# front -> back
class InteractionData(BaseModel):
    id: int | None = None
    interaction: InteractionType
    n: int | None
    n_attr: dict | None
    n_exec: Any
    n_exec_attr: str
    n_exec_attr_val: Any
    e_s: str | int | None
    e_t: str | int | None
    e_attr: dict | None
    edges: list[UIEdge] | None
    plan: UIPlan | None

    class Config:
        arbitrary_types_allowed = True


class InteractionComm(BaseComm):
    type: MsgType.INTERACTION
    data: InteractionData


# front -> back
class ExecuteData(BaseModel):
    mode: Literal["all", "single"]
    node_id: str | int | None


class ExecuteComm(BaseComm):
    type: MsgType.EXECUTE
    data: ExecuteData


# front -> back
class ResetComm(BaseComm):
    type: MsgType.RESET


# front <-> back
class ChatDataUser(BaseModel):
    user_message: UserMessage


class ChatDataSystem(BaseModel):
    system_response: SystemMessage
    chat_history: list[Message] | None


class ChatComm(BaseComm):
    type: MsgType.CHAT
    data: ChatDataUser | ChatDataSystem


# back -> front
class PlanData(BaseModel):
    plan: UIPlan


class PlanComm(BaseComm):
    type: MsgType.PLAN
    data: PlanData


# back -> front
class StatusData(BaseModel):
    action: str  # revisit
    status: Status
    message: str | None

    class Config:
        arbitrary_types_allowed = True


class StatusComm(BaseComm):
    type: MsgType.STATUS
    data: StatusData


######################
# Exec & Interaction #
######################


class ExecuteOption(BaseModel):
    mode: Literal["all", "propagate", "single"]
    node_id: int | None = None


class LLMNodeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")  # THIS FIXES THE SCHEMA ERROR

    # Define specific input fields instead of Dict[str, Any]
    variable: str = ""
    value: str = ""  # Accepts empty string


NodeOutputKey = List[str]
AgentOutput = Dict[str, Any]

#####################
# planner data type #
#####################


class LLMNode(BaseModel):
    model_config = ConfigDict(extra="forbid")  # Required for structured outputs
    id: int
    task: str
    agent_name: str
    input: list[LLMNodeInput] = Field(default_factory=list)
    output: NodeOutputKey = Field(default_factory=list)
    prereq: list[int] = Field(default_factory=list)


class LLMEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")  # Required for structured outputs
    src_node: int
    dest_node: int
    src_output: str
    dest_input: str


class LLMPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")  # ADDED: Required for structured outputs
    nodes: List[LLMNode]
    edges: List[LLMEdge]


###########################
# JSON Serialization Support #
###########################


class PydanticJSONEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles Pydantic models including LogInfo."""

    def default(self, obj):
        if hasattr(obj, "model_dump"):  # Check if it's a Pydantic model
            return obj.model_dump()
        # Handle SymPy Rational and other numeric types
        if hasattr(obj, "__class__") and obj.__class__.__name__ == "Rational":
            return float(obj)
        # Handle any SymPy expressions
        if hasattr(obj, "evalf"):
            try:
                return float(obj.evalf())
            except (TypeError, ValueError):
                return str(obj)  # symbolic expression with unresolved variables
        # Handle other common non-serializable types
        if hasattr(obj, "__float__"):
            return float(obj)
        if hasattr(obj, "__int__"):
            return int(obj)
        return super().default(obj)


class LogInfo(BaseModel):
    agent_name: str
    timestamp: str
    log_name: str
    log_data: Any

    def __json__(self):
        """Make the object JSON serializable by returning its dict representation."""
        return self.model_dump()

    def to_dict(self):
        """Convert to dictionary for JSON serialization."""
        return self.model_dump()

    class Config:
        json_encoders = {
            # Add any specific encoders if needed
        }


AgentLog = List[LogInfo]


class IOVariableOrigin(str, Enum):
    """Class variables to indicate the last update origin of a input/output variable."""

    PLANNER = "PLANNER"
    EXECUTION = "EXECUTION"
    USER = "USER"


class AtomicToolArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    value: str
    output_holder: str


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool: str
    args: List[AtomicToolArgs]
    reason: str


class RefinementPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_calls: List[ToolCall]
    reason: str
