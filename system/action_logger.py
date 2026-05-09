"""Per-session action logger. Writes a timestamped JSON file under `logging/`
recording each user interaction (chat messages, direct-manipulation events,
button clicks) for offline analysis."""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from ambipom.types import PydanticJSONEncoder


class ActionLogger:
    """
    Real-time action logger that writes user actions to JSON log files.
    Each session gets its own log file in the logging folder.
    """

    def __init__(self, session_id: str, system_label: str = None):
        """
        Initialize the action logger for a specific session.

        Args:
            session_id: Unique identifier for the session
            system_label: Optional system label (e.g., "system b")
        """
        self.session_id = session_id
        self.system_label = system_label
        self.log_folder = Path(__file__).parent / "logging"
        self.log_folder.mkdir(exist_ok=True)

        # Create filename with timestamp, system label (if provided), and session ID
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if system_label:
            # Sanitize system_label for filename (replace spaces with underscores, remove special chars)
            safe_label = (
                system_label.replace(" ", "_").replace("/", "_").replace("\\", "_")
            )
            self.log_file = (
                self.log_folder / f"{timestamp}-{safe_label}-{session_id}.json"
            )
        else:
            self.log_file = self.log_folder / f"{timestamp}-{session_id}.json"

        # Initialize the log file with session info
        self._initialize_log_file()

    def _initialize_log_file(self):
        """Initialize the log file with session metadata."""
        initial_data = {
            "session_id": self.session_id,
            "session_start_time": datetime.now().isoformat(),
            "actions": [],
        }

        if self.system_label:
            initial_data["system_label"] = self.system_label

        with open(self.log_file, "w") as f:
            json.dump(initial_data, f, indent=2, cls=PydanticJSONEncoder)

    def log_action(
        self,
        action_type: str,
        action_data: Dict[str, Any],
        metadata: Dict[str, Any] = None,
    ):
        """
        Log an action to the file in real-time.

        Args:
            action_type: Type of action (e.g., 'chat_message', 'direct_manipulation', 'button_click')
            action_data: Data associated with the action
            metadata: Optional metadata (e.g., endpoint, user info)
        """
        try:
            # Read current log file
            with open(self.log_file, "r") as f:
                log_data = json.load(f)

            # Create action entry
            action_entry = {
                "timestamp": datetime.now().isoformat(),
                "action_type": action_type,
                "data": action_data,
            }

            if metadata:
                action_entry["metadata"] = metadata

            # Append the action
            log_data["actions"].append(action_entry)

            # Write back to file
            with open(self.log_file, "w") as f:
                json.dump(log_data, f, indent=2, cls=PydanticJSONEncoder)

        except Exception as e:
            print(f"Error logging action: {e}")

    def log_chat_message(self, message: str, message_type: str = "user"):
        """
        Log a chat message.

        Args:
            message: The chat message content
            message_type: Type of message (user/assistant)
        """
        # Skip logging user_interaction messages
        if message_type == "user_interaction":
            return

        self.log_action(
            action_type="chat_message",
            action_data={"message": message, "message_type": message_type},
        )

    def log_direct_manipulation(
        self,
        interaction_type: str,
        interaction_data: Dict[str, Any],
        processed_result: str = None,
    ):
        """
        Log a direct manipulation action (node edits, edge additions, etc.).

        Args:
            interaction_type: Type of manipulation (e.g., 'add_node', 'remove_edge')
            interaction_data: Data about the manipulation
            processed_result: Result of the manipulation
        """
        self.log_action(
            action_type="direct_manipulation",
            action_data={
                "interaction_type": interaction_type,
                "details": interaction_data,
                "processed_result": processed_result,
            },
        )

    def log_button_click(self, button_name: str, context: Dict[str, Any] = None):
        """
        Log a button click action.

        Args:
            button_name: Name/identifier of the button clicked
            context: Additional context about the button click
        """
        self.log_action(
            action_type="button_click",
            action_data={"button_name": button_name, "context": context or {}},
        )

    def log_endpoint_call(
        self, endpoint: str, request_data: Dict[str, Any], response_status: str
    ):
        """
        Log an API endpoint call.

        Args:
            endpoint: The endpoint path
            request_data: Request payload
            response_status: Response status (success/error)
        """
        self.log_action(
            action_type="endpoint_call",
            action_data={
                "endpoint": endpoint,
                "request_data": request_data,
                "response_status": response_status,
            },
        )
