// Backend API helpers. Wraps fetch() calls to the FastAPI server (proxied at /api).

const time = () => new Date().toISOString();

export const sendAddNode = async (sessionId) => {
  console.log(`[${time()}] Sending add node request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "add_node",
        session_id: sessionId,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending add node request: ${error}`);
    throw error;
  }
};

export const sendRemoveNode = async (
  sessionId,
  nodeId,
  skipSnapshot = false,
) => {
  console.log(
    `[${time()}] Sending remove node request for node ${nodeId} (skipSnapshot: ${skipSnapshot})`,
  );
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "remove_node",
        session_id: sessionId,
        node_id: nodeId,
        skip_snapshot: skipSnapshot,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending remove node request: ${error}`);
    throw error;
  }
};

export const sendAddInputVariableKey = async (
  sessionId,
  nodeId,
  inputVariable,
) => {
  console.log(`[${time()}] Sending add input variable request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "add_input_variable_key",
        session_id: sessionId,
        node_id: nodeId,
        input_variable: inputVariable,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending add input variable request: ${error}`,
    );
    throw error;
  }
};

export const sendRemoveInputVariableKey = async (
  sessionId,
  nodeId,
  inputVariable,
) => {
  console.log(`[${time()}] Sending remove input variable request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "remove_input_variable_key",
        session_id: sessionId,
        node_id: nodeId,
        input_variable: inputVariable,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending remove input variable request: ${error}`,
    );
    throw error;
  }
};

export const sendModifyInputVariableKey = async (
  sessionId,
  nodeId,
  oldInputName,
  newInputName,
) => {
  console.log(`[${time()}] Sending modify input variable request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "modify_input_variable_key",
        session_id: sessionId,
        node_id: nodeId,
        old_input_name: oldInputName,
        new_input_name: newInputName,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending modify input variable request: ${error}`,
    );
    throw error;
  }
};

export const sendAddOutputVariableKey = async (
  sessionId,
  nodeId,
  outputVariable,
) => {
  console.log(`[${time()}] Sending add output variable request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "add_output_variable_key",
        session_id: sessionId,
        node_id: nodeId,
        output_variable: outputVariable,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending add output variable request: ${error}`,
    );
    throw error;
  }
};

export const sendRemoveOutputVariableKey = async (
  sessionId,
  nodeId,
  outputVariable,
) => {
  console.log(`[${time()}] Sending remove output variable request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "remove_output_variable_key",
        session_id: sessionId,
        node_id: nodeId,
        output_variable: outputVariable,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending remove output variable request: ${error}`,
    );
    throw error;
  }
};

export const sendModifyOutputVariableKey = async (
  sessionId,
  nodeId,
  oldOutputName,
  newOutputName,
) => {
  console.log(`[${time()}] Sending modify output variable request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "modify_output_variable_key",
        session_id: sessionId,
        node_id: nodeId,
        old_output_name: oldOutputName,
        new_output_name: newOutputName,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending modify output variable request: ${error}`,
    );
    throw error;
  }
};

export const sendAddEdge = async (
  sessionId,
  source,
  target,
  sourceHandle,
  targetHandle,
) => {
  console.log(`[${time()}] Sending add edge request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "add_edge",
        session_id: sessionId,
        src_id: parseInt(source), // Convert to integer
        dest_id: parseInt(target), // Convert to integer
        src_output: sourceHandle,
        dest_input: targetHandle,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending add edge request: ${error}`);
    throw error;
  }
};

export const sendRemoveEdge = async (
  sessionId,
  source,
  target,
  sourceHandle,
  targetHandle,
) => {
  console.log(`[${time()}] Sending remove edge request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "remove_edge",
        session_id: sessionId,
        src_id: parseInt(source), // Convert to integer
        dest_id: parseInt(target), // Convert to integer
        src_output: sourceHandle,
        dest_input: targetHandle,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending remove edge request: ${error}`);
    throw error;
  }
};

export const sendUpdateNodeAgentName = async (sessionId, nodeId, agentName) => {
  console.log(`[${time()}] Sending update node agent name request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "update_node_agent_name",
        session_id: sessionId,
        node_id: parseInt(nodeId), // Convert to integer
        agent_name: agentName,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending update node agent name request: ${error}`,
    );
    throw error;
  }
};

export const sendUpdateNodeConfig = async (
  sessionId,
  nodeId,
  modelName,
  temperature,
) => {
  console.log(`[${time()}] Sending update node config request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "update_node_config",
        session_id: sessionId,
        node_id: parseInt(nodeId),
        modelName: modelName,
        temperature: temperature,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending update node config request: ${error}`,
    );
    throw error;
  }
};

export const sendUpdateNodeTaskDescription = async (
  sessionId,
  nodeId,
  taskDescription,
) => {
  console.log(`[${time()}] Sending update node task description request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "update_node_task_description",
        session_id: sessionId,
        node_id: parseInt(nodeId), // Convert to integer
        task_description: taskDescription,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending update node task description request: ${error}`,
    );
    throw error;
  }
};

export const sendExecuteTask = async (
  sessionId,
  nodeId,
  executionData,
  skipSnapshot = false,
) => {
  console.log(
    `[${time()}] Sending execute task request (skip_snapshot: ${skipSnapshot})`,
  );
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "execute_task",
        session_id: sessionId,
        node_id: parseInt(nodeId), // Convert to integer
        agent_name: executionData.agent_name,
        task_description: executionData.task_description,
        input_variables: executionData.input_variables,
        output_variables: executionData.output_variables,
        skip_snapshot: skipSnapshot,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending execute task request: ${error}`);
    throw error;
  }
};

export const sendGeneratePlan = async (sessionId, message) => {
  console.log(`[${time()}] Sending message to planning assistant`);
  try {
    const response = await fetch("/api/generate-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending message: ${error}`);
    throw error;
  }
};

export const sendReplan = async (
  sessionId,
  message,
  conversationHistory,
  planData,
) => {
  console.log(`[${time()}] Sending replan request to planning assistant`);
  try {
    console.log(conversationHistory);
    console.log(planData);

    const response = await fetch("/api/replan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
        conversation_history: JSON.parse(JSON.stringify(conversationHistory)),
        ui_plan: JSON.parse(JSON.stringify(planData)),
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending replan request: ${error}`);
    throw error;
  }
};

export const sendSubplanFeedback = async (
  sessionId,
  message,
  conversationHistory,
  planData,
  selectedNodes = [],
) => {
  console.log(
    `[${time()}] Sending subplan feedback request to planning assistant`,
  );
  try {
    console.log(conversationHistory);
    console.log(planData);
    console.log("Selected nodes:", selectedNodes);
    const newSelectedNodes = selectedNodes.map((node) => parseInt(node));

    const response = await fetch("/api/subplan-replan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
        conversation_history: JSON.parse(JSON.stringify(conversationHistory)),
        ui_plan: JSON.parse(JSON.stringify(planData)),
        selected_nodes: newSelectedNodes,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending subplan replan request: ${error}`);
    throw error;
  }
};

export const sendExecuteAllNodes = async (sessionId) => {
  console.log(`[${time()}] Sending execute all nodes request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "execute_all_nodes",
        session_id: sessionId,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending execute all nodes request: ${error}`,
    );
    throw error;
  }
};

export const sendResetPlan = async (sessionId, skipSnapshot = false) => {
  console.log(
    `[${time()}] Sending reset plan request (skip_snapshot: ${skipSnapshot})`,
  );
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "reset_plan",
        session_id: sessionId,
        skip_snapshot: skipSnapshot,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending reset plan request: ${error}`);
    throw error;
  }
};

export const sendUpdateVariableValue = async (
  sessionId,
  nodeId,
  variableName,
  variableValue,
  variableType,
) => {
  console.log(`[${time()}] Sending update variable value request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "update_variable_value",
        session_id: sessionId,
        node_id: parseInt(nodeId),
        variable_name: variableName,
        variable_value: variableValue,
        variable_type: variableType, // 'input' or 'output'
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending update variable value request: ${error}`,
    );
    throw error;
  }
};

export const sendGetTopologicalOrder = async (sessionId) => {
  console.log(`[${time()}] Sending get topological order request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "get_topological_order",
        session_id: sessionId,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending get topological order request: ${error}`,
    );
    throw error;
  }
};

export const sendDuplicateNode = async (sessionId, nodeId) => {
  console.log(`[${time()}] Sending duplicate node request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "duplicate_node",
        session_id: sessionId,
        node_id: nodeId,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending duplicate node request: ${error}`);
    throw error;
  }
};

export const addConversationMessage = async (
  sessionId,
  messageType,
  message,
) => {
  console.log(`[${time()}] Sending add conversation message request`);
  try {
    const response = await fetch("/api/add-conversation-message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        message_type: messageType,
        message: message,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending add conversation message request: ${error}`,
    );
    throw error;
  }
};

export const sendAutoSplitNode = async (sessionId, nodeId, connectedEdges) => {
  console.log(`[${time()}] Sending split node request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "auto_split_node",
        session_id: sessionId,
        node_id: parseInt(nodeId),
        connected_edges: connectedEdges,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending split node request: ${error}`);
    throw error;
  }
};

export const sendSequentialSplitNode = async (
  sessionId,
  nodeId,
  connectedEdges,
) => {
  console.log(`[${time()}] Sending sequential split node request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "sequential_split_node",
        session_id: sessionId,
        node_id: parseInt(nodeId),
        connected_edges: connectedEdges,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending sequential split node request: ${error}`,
    );
    throw error;
  }
};

export const sendCheckNodesMergeable = async (sessionId, nodeIds) => {
  console.log(`[${time()}] Sending check nodes mergeable request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "check_nodes_mergeable",
        session_id: sessionId,
        node_ids: nodeIds.map((id) => parseInt(id)),
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending check nodes mergeable request: ${error}`,
    );
    throw error;
  }
};

export const sendAutoMergeNodes = async (
  sessionId,
  nodeIds,
  connectedEdges,
) => {
  console.log(`[${time()}] Sending auto merge nodes request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "auto_merge_nodes",
        session_id: sessionId,
        node_ids: nodeIds.map((id) => parseInt(id)),
        connected_edges: connectedEdges,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending auto merge nodes request: ${error}`,
    );
    throw error;
  }
};

export const sendForceMergeNodes = async (
  sessionId,
  nodeIds,
  connectedEdges,
) => {
  console.log(`[${time()}] Sending force merge nodes request`);
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "force_merge_nodes",
        session_id: sessionId,
        node_ids: nodeIds.map((id) => parseInt(id)),
        connected_edges: connectedEdges,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending force merge nodes request: ${error}`,
    );
    throw error;
  }
};

export const sendLoadPlan = async (sessionId, planJson) => {
  console.log(`[${time()}] Sending load plan request`);
  try {
    const response = await fetch("/api/load-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        plan_json: planJson,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const jsonResponse = await response.json();
    console.log("Load plan response:", jsonResponse);

    if (jsonResponse?.status === "error") {
      throw new Error(jsonResponse.message || "Unknown error");
    }

    return jsonResponse;
  } catch (error) {
    console.error(`[${time()}] Error sending load plan request: ${error}`);
    throw error;
  }
};

export const sendSavePlan = async (sessionId, assistantResponse) => {
  console.log(`[${time()}] Sending save plan request`);
  try {
    const currentDate = new Date().toISOString().slice(0, 10);
    const response = await fetch("/api/save-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        filename: currentDate,
        assistant_response: assistantResponse,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Check if response has Content-Disposition header (indicates file download)
    const contentDisposition = response.headers.get("content-disposition");

    // If no Content-Disposition, it's likely an error JSON response
    if (!contentDisposition) {
      const jsonResponse = await response.json();
      console.log("JSON response:", jsonResponse);
      if (jsonResponse?.status === "error") {
        throw new Error(jsonResponse.message || "Unknown error");
      }
      // Return the JSON response if it's not an error
      return jsonResponse;
    }

    // It's a file download - process as blob
    const blob = await response.blob();
    console.log("File blob:", blob);
    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plan_${currentDate}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { status: "success" };
  } catch (error) {
    console.error(`[${time()}] Error sending save plan request: ${error}`);
    throw error;
  }
};

export const sendUpdateNodePositions = async (sessionId, positions) => {
  console.log(`[${time()}] Sending update node positions request`);
  try {
    const response = await fetch("/api/update-node-positions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        positions: positions,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending update node positions request: ${error}`,
    );
    throw error;
  }
};

export const sendMoveNode = async (sessionId, nodeId, position) => {
  console.log(
    `[${time()}] Sending move node request for node ${nodeId} to position (${position.x}, ${position.y})`,
  );
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "move_node",
        session_id: sessionId,
        node_id: parseInt(nodeId),
        position: position, // {x: number, y: number}
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending move node request: ${error}`);
    throw error;
  }
};

export const sendUndo = async (sessionId) => {
  console.log(`[${time()}] Sending undo request`);
  try {
    const response = await fetch("/api/undo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending undo request: ${error}`);
    throw error;
  }
};

export const sendRedo = async (sessionId) => {
  console.log(`[${time()}] Sending redo request`);
  try {
    const response = await fetch("/api/redo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(`[${time()}] Error sending redo request: ${error}`);
    throw error;
  }
};

export const sendGetUndoRedoStatus = async (sessionId) => {
  console.log(`[${time()}] Sending get undo/redo status request`);
  try {
    const response = await fetch("/api/get-undo-redo-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending get undo/redo status request: ${error}`,
    );
    throw error;
  }
};

export const sendGetUndoRedoHistory = async (sessionId) => {
  console.log(`[${time()}] Sending get undo/redo history request`);
  try {
    const response = await fetch("/api/get-undo-redo-history", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending get undo/redo history request: ${error}`,
    );
    throw error;
  }
};

export const sendCaptureBatchDeleteSnapshot = async (
  sessionId,
  deletedNodeIds,
) => {
  console.log(
    `[${time()}] Sending capture batch delete snapshot request for nodes: ${deletedNodeIds.join(", ")}`,
  );
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "capture_batch_delete_snapshot",
        session_id: sessionId,
        deleted_node_ids: deletedNodeIds,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending capture batch delete snapshot request: ${error}`,
    );
    throw error;
  }
};

export const sendCaptureExecuteAllSnapshot = async (
  sessionId,
  executedNodeIds,
) => {
  console.log(
    `[${time()}] Sending capture execute all snapshot request for ${executedNodeIds.length} nodes`,
  );
  try {
    const response = await fetch("/api/process-ui-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "capture_execute_all_snapshot",
        session_id: sessionId,
        executed_node_ids: executedNodeIds,
      }),
    });
    return response.json();
  } catch (error) {
    console.error(
      `[${time()}] Error sending capture execute all snapshot request: ${error}`,
    );
    throw error;
  }
};
