/**
 * Utility functions to generate human-readable messages for user interactions
 * These messages will be displayed in the conversation panel
 */

/**
 * Generate a user interaction message based on the interaction type
 * @param {string} type - The type of interaction (e.g., 'add_node', 'remove_node')
 * @param {Object} data - Additional data about the interaction
 * @returns {string} - A human-readable message describing the interaction
 */
export const generateInteractionMessage = (type, data = {}) => {
  switch (type) {
    case "add_node":
      return data.nodeId
        ? `Added a new <strong>node ${data.nodeId}</strong> to the plan`
        : "Added a new node to the plan";

    case "remove_node":
      return `Removed <strong>node ${data.nodeId}</strong> from the plan`;

    case "duplicate_node":
      if (data.newNodeId) {
        return `Duplicated <strong>node ${data.nodeId}</strong> to create <strong>node ${data.newNodeId}</strong>`;
      }
      return `Duplicated <strong>node ${data.nodeId}</strong>`;

    case "add_edge":
      return `Connected node ${data.source} (<strong>${data.sourceHandle}</strong>) → node ${data.target} (<strong>${data.targetHandle}</strong>)`;

    case "remove_edge":
      return `Disconnected node ${data.source} (<strong>${data.sourceHandle}</strong>) → node ${data.target} (<strong>${data.targetHandle}</strong>)`;

    case "add_input_variable_key":
      return `Node ${data.nodeId}: Added input variable <strong>"${data.inputVariable}"</strong>`;

    case "remove_input_variable_key":
      return `Node ${data.nodeId}: Removed input variable <strong>"${data.inputVariable}"</strong>`;

    case "add_output_variable_key":
      return `Node ${data.nodeId}: Added output variable <strong>"${data.outputVariable}"</strong>`;

    case "remove_output_variable_key":
      return `Node ${data.nodeId}: Removed output variable <strong>"${data.outputVariable}"</strong>`;

    case "modify_input_variable_key":
      return `Node ${data.nodeId}: Renamed input variable <strong>"${data.oldInputName}"</strong> to <strong>"${data.newInputName}"</strong>`;

    case "modify_output_variable_key":
      return `Node ${data.nodeId}: Renamed output variable <strong>"${data.oldOutputName}"</strong> to <strong>"${data.newOutputName}"</strong>`;

    case "update_variable_value":
      const variableTypeLabel =
        data.variableType === "input" ? "input" : "output";
      if (data.oldValue !== undefined && data.newValue !== undefined) {
        return `Node ${data.nodeId}: Updated ${variableTypeLabel} variable <strong>"${data.variableName}"</strong> from <strong>"${data.oldValue}"</strong> to <strong>"${data.newValue}"</strong>`;
      }
      return `Node ${data.nodeId}: Updated ${variableTypeLabel} variable <strong>"${data.variableName}"</strong>`;

    case "update_node_agent_name":
      if (data.oldAgentName) {
        return `Node ${data.nodeId}: Changed agent from <strong>"${data.oldAgentName}"</strong> to <strong>"${data.agentName}"</strong>`;
      }
      return `Node ${data.nodeId}: Changed agent to <strong>"${data.agentName}"</strong>`;

    case "update_node_task_description":
      return `Node ${data.nodeId}: Updated task description`;

    case "update_node_config":
      return `Node ${data.nodeId}: Updated agent config\nmodel: <strong>${data.modelName}</strong>`;

    case "execute_task":
      if (data.status === "loading") {
        // Loading state with animated loading indicator (use node-loading for consistency)
        return `<span class="node-loading">⏳</span> Executing task for <strong>node ${data.nodeId}</strong>...`;
      } else if (data.status === "completed") {
        // Completed state with output values
        let message = `✅ Executed task for <strong>node ${data.nodeId}</strong> successfully`;

        if (data.outputValues && Object.keys(data.outputValues).length > 0) {
          message += "\n\n<strong>Output variables:</strong>";
          for (const [key, value] of Object.entries(data.outputValues)) {
            message += `\n• <strong>${key}</strong>: ${value}`;
          }
        }

        // Check for None/null values (output exception)
        if (data.hasInvalidOutput) {
          message +=
            "\n\n⚠️ <strong>Output Exception:</strong> Some output values are None or invalid";
        }

        return message;
      }
      // Fallback for backward compatibility
      return `Executed task for <strong>node ${data.nodeId}</strong>`;

    case "execute_all_nodes":
      if (data.status === "loading") {
        // Initial loading state - use circular spinner for overall operation
        return '<span class="loading-spinner">🔄</span> Executing all nodes in the plan...';
      } else if (data.status === "executing") {
        // Progress state - show which nodes are being executed
        // Use circular spinner for overall operation
        let message =
          '<span class="loading-spinner">🔄</span> Executing all nodes in the plan...\n\n';

        if (
          data.executedNodesWithResults &&
          data.executedNodesWithResults.length > 0
        ) {
          message += "<strong>Completed:</strong>\n";
          data.executedNodesWithResults.forEach((nodeResult) => {
            message += `✅ Node ${nodeResult.nodeId}`;

            // Include output values if available
            if (
              nodeResult.outputValues &&
              Object.keys(nodeResult.outputValues).length > 0
            ) {
              message += "\n  <strong>Output:</strong>";
              for (const [key, value] of Object.entries(
                nodeResult.outputValues,
              )) {
                message += `\n  • <strong>${key}</strong>: ${value}`;
              }
            }
            message += "\n\n";
          });
        }

        if (data.currentNode) {
          // Use animated hourglass for individual node execution in progress
          message += `<strong>Currently executing:</strong> <span class="node-loading">⏳</span> Node ${data.currentNode}`;
        }

        return message;
      } else if (data.status === "completed") {
        // Completed state
        let message = "✅ Executed all nodes successfully";

        if (data.totalNodes) {
          message += ` (${data.totalNodes} nodes)`;
        }

        // Show detailed results for each node
        if (
          data.executedNodesWithResults &&
          data.executedNodesWithResults.length > 0
        ) {
          message += "\n\n<strong>Execution Results:</strong>\n";
          data.executedNodesWithResults.forEach((nodeResult) => {
            message += `\n✅ Node ${nodeResult.nodeId}`;

            // Include output values if available
            if (
              nodeResult.outputValues &&
              Object.keys(nodeResult.outputValues).length > 0
            ) {
              message += "\n  <strong>Output:</strong>";
              for (const [key, value] of Object.entries(
                nodeResult.outputValues,
              )) {
                message += `\n  • <strong>${key}</strong>: ${value}`;
              }
            }
          });
        }

        // Add Final Results section if available
        if (data.finalResults && data.finalResults.length > 0) {
          message += "\n\n====================================\n";
          message += "\n<strong>📊 Final Results:</strong>\n";
          data.finalResults.forEach((result) => {
            message += `\n• Node ${result.nodeId} - <strong>${result.variableName}</strong>: ${result.variableValue}`;
          });
        }

        return message;
      }
      // Fallback for backward compatibility
      return "Executed all nodes in the plan";

    case "reset_plan":
      return "Cleared all nodes and edges from the plan";

    case "auto_split_node":
      if (data.newNodeIds && data.newNodeIds.length > 0) {
        const newNodeList = data.newNodeIds
          .map((id) => `<strong>node ${id}</strong>`)
          .join(", ");
        return `Split <strong>node ${data.nodeId}</strong> into ${newNodeList} using split agent`;
      }
      return `Split <strong>node ${data.nodeId}</strong> using split agent`;

    case "sequential_split_node":
      if (data.newNodeIds && data.newNodeIds.length > 0) {
        const newNodeList = data.newNodeIds
          .map((id) => `<strong>node ${id}</strong>`)
          .join(", ");
        return `Split <strong>node ${data.nodeId}</strong> into ${newNodeList} sequentially. \nPlease make your modification on task description and input/output variables`;
      }
      return `Split <strong>node ${data.nodeId}</strong> sequentially. \nPlease make your modification on task description and input/output variables`;

    case "auto_merge_nodes":
      if (data.nodeIds && data.nodeIds.length > 0) {
        const nodeList = data.nodeIds
          .map((id) => `<strong>node ${id}</strong>`)
          .join(", ");
        if (data.newNodeId) {
          return `Auto merged ${nodeList} to create <strong>node ${data.newNodeId}</strong> using merge agent`;
        }
        return `Auto merged ${nodeList} using merge agent`;
      }
      return "Auto merged selected nodes using merge agent";

    case "force_merge_nodes":
      if (data.nodeIds && data.nodeIds.length > 0) {
        const nodeList = data.nodeIds
          .map((id) => `<strong>node ${id}</strong>`)
          .join(", ");
        if (data.newNodeId) {
          return `Regular merged ${nodeList} to create <strong>node ${data.newNodeId}</strong>. \nPlease make your modification on task description and input/output variables`;
        }
        return `Regular merged ${nodeList}. \nPlease make your modification on task description and input/output variables`;
      }
      return "Regular merged selected nodes. \nPlease make your modification on task description and input/output variables";

    case "load_plan":
      if (data.nodeCount !== undefined && data.edgeCount !== undefined) {
        return `📂 Loaded a plan from file with <strong>${data.nodeCount} nodes</strong> and <strong>${data.edgeCount} connections</strong>`;
      }
      return "📂 Loaded a plan from file";

    case "save_plan":
      if (data.nodeCount !== undefined && data.edgeCount !== undefined) {
        return `💾 Saved the current plan with <strong>${data.nodeCount} nodes</strong> and <strong>${data.edgeCount} connections</strong>`;
      }
      return "💾 Saved the current plan";

    default:
      return `Performed action: ${type}`;
  }
};

/**
 * Add a user interaction message to the conversation history
 * @param {string} type - The type of interaction
 * @param {Object} data - Additional data about the interaction
 * @param {Function} setConversationHistory - State setter function for conversation history
 * @param {string} sessionId - Current session ID
 * @param {Function} addConversationMessageAPI - API function to persist the message to backend
 */
export const addUserInteractionToConversation = async (
  type,
  data,
  setConversationHistory,
  sessionId,
  addConversationMessageAPI,
) => {
  const message = generateInteractionMessage(type, data);

  // Determine message type: 'execution' for task execution, 'user_interaction' for others
  const messageType =
    type === "execute_task" || type === "execute_all_nodes"
      ? "execution"
      : "user_interaction";

  // Add to frontend state
  setConversationHistory((prev) => [
    ...prev,
    {
      type: messageType,
      message: message,
      timestamp: new Date(),
      id: data.messageId, // Optional message ID for updates
    },
  ]);

  // Persist to backend
  try {
    await addConversationMessageAPI(sessionId, messageType, message);
  } catch (error) {
    console.error("Error adding user interaction to backend:", error);
  }
};

/**
 * Update an existing user interaction message in the conversation history
 * @param {string} messageId - The unique ID of the message to update
 * @param {string} type - The type of interaction
 * @param {Object} data - Updated data about the interaction
 * @param {Function} setConversationHistory - State setter function for conversation history
 * @param {string} sessionId - Current session ID
 * @param {Function} addConversationMessageAPI - API function to persist the message to backend
 */
export const updateUserInteractionMessage = async (
  messageId,
  type,
  data,
  setConversationHistory,
  sessionId,
  addConversationMessageAPI,
) => {
  const message = generateInteractionMessage(type, data);

  // Determine message type: 'execution' for task execution, 'user_interaction' for others
  const messageType =
    type === "execute_task" || type === "execute_all_nodes"
      ? "execution"
      : "user_interaction";

  // Update frontend state
  setConversationHistory((prev) =>
    prev.map((entry) =>
      entry.id === messageId
        ? { ...entry, message: message, type: messageType }
        : entry,
    ),
  );

  // Persist to backend
  try {
    await addConversationMessageAPI(sessionId, messageType, message);
  } catch (error) {
    console.error("Error updating user interaction in backend:", error);
  }
};
