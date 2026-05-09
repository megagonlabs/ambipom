"""FastAPI HTTP backend for the AMBIPOM interactive system.

Exposes ~20 `/api/*` endpoints (session lifecycle, plan generation/revision, per-node
edits, undo/redo, execution) and serves the built frontend (`frontend/dist`) as
static files at `/` when present. Run with `cd system && python server.py`; the
server listens on `:8000`."""

import io
import os
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from uuid import uuid4

import uvicorn
from action_logger import ActionLogger
from controller import Controller
from fastapi import APIRouter, BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ambipom.registry import AgentRegistry
from ambipom.types import PydanticJSONEncoder
from ambipom.utils import MODEL_REGISTRY, current_exact_time

app = FastAPI()
api = APIRouter(prefix="/api")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:4174",  # vite preview
        "http://localhost:5173",  # vite dev
        "http://localhost:5174",  # vite dev
        "http://localhost:6173",  # vite dev - frontend_experiment
        "http://localhost:8000",
    ],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sessions: dict[str, dict] = {}
loggers: dict[str, ActionLogger] = {}


@api.post("/start-session")
async def start_session(request_data: dict = None):
    session_id = str(uuid4())
    system_label = None

    if request_data:
        system_label = request_data.get("system_label")

    sessions[session_id] = Controller(session_id)
    loggers[session_id] = ActionLogger(session_id, system_label=system_label)

    print(
        f"[{current_exact_time()}] Session started with id: {session_id}, system: {system_label}"
    )
    loggers[session_id].log_action("session_start", {"session_id": session_id})
    return {"session_id": session_id}


@api.post("/log-button-click")
async def log_button_click(click_data: dict):
    """
    Log button click events from the frontend.

    Expected payload:
    {
        "session_id": str,
        "button_name": str,
        "context": dict (optional)
    }
    """
    session_id = click_data.get("session_id")
    button_name = click_data.get("button_name")
    context = click_data.get("context", {})

    if not session_id or session_id not in loggers:
        return {"status": "error", "message": "Invalid or missing session_id"}

    if not button_name:
        return {"status": "error", "message": "Missing button_name"}

    try:
        loggers[session_id].log_button_click(button_name, context)
        print(f"[{current_exact_time()}] Button click logged: {button_name}")
        return {"status": "success"}
    except Exception as e:
        print(f"Error logging button click: {e}")
        return {"status": "error", "message": str(e)}


@api.get("/get-agent-registry")
async def get_agent_registry():
    return {"agent_registry": AgentRegistry().get_agent_list()}


@api.get("/get-model-registry")
async def get_model_registry():
    return {"model_registry": MODEL_REGISTRY}


@api.post("/process-ui-interaction")
async def process_ui_interaction(interaction_data: dict):
    session_id = interaction_data["session_id"]
    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    return_message = sessions[session_id].process_ui_interaction(interaction_data)
    print(f"[{current_exact_time()}] UI interaction processed successfully")

    # Log the UI interaction
    if session_id in loggers:
        loggers[session_id].log_direct_manipulation(
            interaction_type=interaction_data.get("type", "unknown"),
            interaction_data=interaction_data,
            processed_result=return_message,
        )

    return return_message


@api.post("/undo")
async def undo(request_data: dict):
    session_id = request_data["session_id"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    try:
        # Check if undo is available
        if not sessions[session_id].planner.can_undo():
            return {
                "status": "error",
                "message": "No more actions to undo",
                "can_undo": False,
                "can_redo": sessions[session_id].planner.can_redo(),
            }

        # Get the action summary before performing undo
        history = sessions[session_id].planner.get_plan_history()
        current_index = sessions[
            session_id
        ].planner.plan_history.get_current_step_index()
        action_summary = "Unknown action"
        if current_index > 0 and current_index < len(history):
            action_summary = history[current_index].get("summary", "Unknown action")

        # Log the undo button click
        if session_id in loggers:
            loggers[session_id].log_direct_manipulation(
                interaction_type="undo",
                interaction_data={"action_summary": action_summary},
            )

        # Perform undo and get the restored plan with positions
        ui_plan = sessions[session_id].planner.undo()

        return {
            "status": "success",
            "message": "Undo successful",
            "plan": ui_plan,
            "can_undo": sessions[session_id].planner.can_undo(),
            "can_redo": sessions[session_id].planner.can_redo(),
            "action_summary": action_summary,
            "timestamp": current_exact_time(),
        }

    except Exception as e:
        print(f"Error during undo: {e}")
        return {"status": "error", "message": str(e)}


@api.post("/redo")
async def redo(request_data: dict):
    session_id = request_data["session_id"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    try:
        # Check if redo is available
        if not sessions[session_id].planner.can_redo():
            return {
                "status": "error",
                "message": "No more actions to redo",
                "can_undo": sessions[session_id].planner.can_undo(),
                "can_redo": False,
            }

        # Get the action summary before performing redo
        history = sessions[session_id].planner.get_plan_history()
        current_index = sessions[
            session_id
        ].planner.plan_history.get_current_step_index()
        action_summary = "Unknown action"
        if current_index + 1 < len(history):
            action_summary = history[current_index + 1].get("summary", "Unknown action")

        # Log the redo button click
        if session_id in loggers:
            loggers[session_id].log_direct_manipulation(
                interaction_type="redo",
                interaction_data={"action_summary": action_summary},
            )

        # Perform redo and get the restored plan with positions
        ui_plan = sessions[session_id].planner.redo()

        return {
            "status": "success",
            "message": "Redo successful",
            "plan": ui_plan,
            "can_undo": sessions[session_id].planner.can_undo(),
            "can_redo": sessions[session_id].planner.can_redo(),
            "action_summary": action_summary,
            "timestamp": current_exact_time(),
        }

    except Exception as e:
        print(f"Error during redo: {e}")
        return {"status": "error", "message": str(e)}


@api.post("/get-undo-redo-status")
async def get_undo_redo_status(request_data: dict):
    session_id = request_data["session_id"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    try:
        return {
            "status": "success",
            "can_undo": sessions[session_id].planner.can_undo(),
            "can_redo": sessions[session_id].planner.can_redo(),
        }
    except Exception as e:
        print(f"Error getting undo/redo status: {e}")
        return {"status": "error", "message": str(e)}


@api.post("/get-undo-redo-history")
async def get_undo_redo_history(request_data: dict):
    session_id = request_data["session_id"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    try:
        # Get the complete history
        history = sessions[session_id].planner.get_plan_history()
        current_index = sessions[
            session_id
        ].planner.plan_history.get_current_step_index()

        # Extract summaries from history
        summaries = [
            {
                "index": i,
                "summary": snapshot.get("summary", "Unknown action"),
                "is_current": i == current_index,
            }
            for i, snapshot in enumerate(history)
        ]

        return {
            "status": "success",
            "history": summaries,
            "current_index": current_index,
            "can_undo": sessions[session_id].planner.can_undo(),
            "can_redo": sessions[session_id].planner.can_redo(),
        }
    except Exception as e:
        print(f"Error getting undo/redo history: {e}")
        return {"status": "error", "message": str(e)}


@api.post("/generate-plan")
async def generate_plan(message_data: dict):
    session_id = message_data["session_id"]
    user_message = message_data["message"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    # Log the chat message
    if session_id in loggers:
        loggers[session_id].log_chat_message(
            user_message, message_type="user-generate-plan"
        )

    try:
        print(f"[{current_exact_time()}] User message: {user_message}")

        ui_plan = sessions[session_id].process_user_message(user_message)

        return {"status": "success", "plan": ui_plan, "timestamp": current_exact_time()}

    except Exception as e:
        print(f"Error processing message: {e}")
        sessions[session_id].append_conversation_history(
            "assistant", f"Error processing message: {e}"
        )
        return {"status": "error", "message": str(e)}


@api.post("/replan")
async def replan(message_data: dict):
    session_id = message_data["session_id"]
    user_message = message_data["message"]
    conversation_history = message_data["conversation_history"]
    ui_plan = message_data["ui_plan"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    # Log the replan chat message
    if session_id in loggers:
        loggers[session_id].log_chat_message(user_message, message_type="user-replan")

    try:
        ui_plan = sessions[session_id].replan(
            user_message, conversation_history, ui_plan
        )

        return {"status": "success", "plan": ui_plan, "timestamp": current_exact_time()}
    except Exception as e:
        print(f"Error processing message: {e}")
        sessions[session_id].append_conversation_history(
            "assistant", f"Error processing message: {e}"
        )
        return {"status": "error", "message": str(e)}


@api.post("/subplan-replan")
async def subplan_replan(message_data: dict):
    session_id = message_data["session_id"]
    user_message = message_data["message"]
    conversation_history = message_data["conversation_history"]
    ui_plan = message_data["ui_plan"]
    selected_nodes = message_data["selected_nodes"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    if session_id in loggers:
        loggers[session_id].log_chat_message(
            user_message, message_type="user-subplan-replan"
        )

    try:
        f = io.StringIO()
        with redirect_stdout(f):
            ui_plan = sessions[session_id].subplan_replan(
                user_message, conversation_history, ui_plan, selected_nodes
            )
        captured_output = f.getvalue()

        return {
            "status": "success",
            "plan": ui_plan,
            "timestamp": current_exact_time(),
            "captured_output": captured_output,
        }
    except Exception as e:
        print(f"Error processing message: {e}")
        sessions[session_id].append_conversation_history(
            "assistant", f"Error processing message: {e}"
        )
        return {"status": "error", "message": str(e)}


@api.post("/add-conversation-message")
async def add_conversation_message(message_data: dict):
    session_id = message_data["session_id"]
    message_type = message_data["message_type"]
    message = message_data["message"]
    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    # Log the message to the action logger
    if session_id in loggers:
        loggers[session_id].log_chat_message(message, message_type=message_type)

    sessions[session_id].append_conversation_history(message_type, message)
    return {"status": "success"}


def cleanup_temp_file(path: str):
    """Helper function to delete temporary file"""
    try:
        if os.path.exists(path):
            os.unlink(path)
    except Exception as e:
        print(f"Error deleting temp file: {e}")


@api.post("/load-plan")
async def load_plan(request_data: dict):
    session_id = request_data["session_id"]
    plan_json = request_data["plan_json"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    # Log the load plan action
    if session_id in loggers:
        loggers[session_id].log_direct_manipulation(
            interaction_type="load_plan",
            interaction_data={"session_id": session_id, "plan_json": plan_json},
        )

    try:
        # Create a temporary file to store the uploaded JSON
        temp_fd, temp_path = tempfile.mkstemp(suffix=".json", prefix="plan_load_")
        os.close(temp_fd)

        # Write the JSON to the temp file
        import json

        with open(temp_path, "w") as f:
            json.dump(plan_json, f, cls=PydanticJSONEncoder, indent=2)

        # Load the plan using the existing load_plan method
        sessions[session_id].planner.plan.load_plan(temp_path)

        # Clean up the temp file
        os.unlink(temp_path)

        # Capture history snapshot after loading plan
        sessions[session_id].planner.capture_plan_snapshot(summary="Loaded plan")

        # Get the updated plan in UI format
        ui_plan = sessions[session_id].planner.get_ui_plan()

        return {
            "status": "success",
            "message": "Plan loaded successfully",
            "plan": ui_plan,
        }
    except Exception as e:
        print(f"Error loading plan: {e}")
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


@api.post("/save-plan")
async def save_plan(request_data: dict, background_tasks: BackgroundTasks):
    session_id = request_data["session_id"]
    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    # Log the save plan action
    if session_id in loggers:
        loggers[session_id].log_direct_manipulation(
            interaction_type="save_plan",
            interaction_data={"filename": request_data.get("filename", "export")},
        )

    try:
        # Create a temporary file
        temp_fd, temp_path = tempfile.mkstemp(suffix=".json", prefix="plan_")
        os.close(temp_fd)

        # Save the plan using the existing save_plan method
        sessions[session_id].planner.plan.save_plan(temp_path)

        # Schedule cleanup of temp file after response is sent
        background_tasks.add_task(cleanup_temp_file, temp_path)

        # Return the file as a download
        return FileResponse(
            path=temp_path,
            media_type="application/json",
            filename=f"plan_{request_data.get('filename', 'export')}.json",
        )
    except Exception as e:
        print(f"Error saving plan: {e}")
        return {"status": "error", "message": str(e)}


@api.get("/get-planner-config")
async def get_planner_config(session_id: str):
    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    try:
        config = sessions[session_id].planner.config
        print(f"[{current_exact_time()}] Retrieved planner config: {config}")

        return {"status": "success", "config": config}
    except Exception as e:
        print(f"Error getting planner config: {e}")
        return {"status": "error", "message": str(e)}


@api.post("/update-planner-config")
async def update_planner_config(config_data: dict):
    session_id = config_data["session_id"]
    planner_config = config_data["config"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    try:
        # Update the planner's config
        sessions[session_id].planner.config.update(planner_config)

        print(f"[{current_exact_time()}] Planner config updated: {planner_config}")

        return {
            "status": "success",
            "message": "Planner configuration updated successfully",
            "config": sessions[session_id].planner.config,
        }
    except Exception as e:
        print(f"Error updating planner config: {e}")
        return {"status": "error", "message": str(e)}


@api.post("/update-node-positions")
async def update_node_positions(request_data: dict):
    """
    Update node positions in the latest history snapshot after frontend rendering.

    Expected request format:
    {
        "session_id": "...",
        "positions": {
            "1": {"x": 100, "y": 200},
            "2": {"x": 300, "y": 400}
        }
    }
    """
    session_id = request_data["session_id"]
    positions = request_data["positions"]

    if session_id not in sessions:
        return {"status": "error", "message": "Session not found"}

    try:
        # Update positions in the latest snapshot
        sessions[session_id].planner.update_positions_in_latest_snapshot(positions)

        print(
            f"[{current_exact_time()}] Updated positions for {len(positions)} nodes in latest snapshot"
        )

        return {
            "status": "success",
            "message": f"Positions updated for {len(positions)} nodes",
        }
    except Exception as e:
        print(f"Error updating node positions: {e}")
        return {"status": "error", "message": str(e)}


app.include_router(api)

# Serve the built frontend at `/` if present. In development, run vite dev server
# separately (`cd frontend && npm run dev`) which proxies `/api/*` back here.
_dist_dir = Path(__file__).parent / "frontend" / "dist"
_dist_dir.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(_dist_dir), html=True), name="frontend")


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
