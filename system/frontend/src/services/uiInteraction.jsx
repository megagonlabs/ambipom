import {
  addConversationMessage,
  sendAddEdge,
  sendAddInputVariableKey,
  sendAddNode,
  sendAddOutputVariableKey,
  sendAutoMergeNodes,
  sendAutoSplitNode,
  sendCheckNodesMergeable,
  sendDuplicateNode,
  sendExecuteAllNodes,
  sendExecuteTask,
  sendForceMergeNodes,
  sendGetTopologicalOrder,
  sendLoadPlan,
  sendModifyInputVariableKey,
  sendModifyOutputVariableKey,
  sendRemoveEdge,
  sendRemoveInputVariableKey,
  sendRemoveNode,
  sendRemoveOutputVariableKey,
  sendResetPlan,
  sendSavePlan,
  sendSequentialSplitNode,
  sendUpdateNodeAgentName,
  sendUpdateNodeConfig,
  sendUpdateNodePositions,
  sendUpdateNodeTaskDescription,
  sendUpdateVariableValue,
} from "./backendApi";

import {
  addUserInteractionToConversation,
  updateUserInteractionMessage,
} from "../utils/interactionMessages";

export const addNode = async (
  planData,
  setPlanData,
  setSelectedNode,
  sessionId,
  setConversationHistory = null,
) => {
  let newNode = null;
  try {
    const response = await sendAddNode(sessionId);
    console.log("Add node response:", response);
    if (response.status == "success") {
      const nodeId = `${response.node_id}`;
      newNode = {
        id: nodeId,
        task: "",
        agent_name: "commonsense",
        input: [],
        output: [],
        params: {},
        x: Math.random() * 400 + 100,
        y: Math.random() * 300 + 100,
        width: 200,
        height: 80,
      };

      setPlanData((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
      }));

      setSelectedNode(nodeId);

      // Update node positions in history after rendering
      // Use setTimeout to ensure React Flow has finished rendering
      setTimeout(async () => {
        try {
          const positions = {
            [nodeId]: { x: newNode.x, y: newNode.y },
          };
          await sendUpdateNodePositions(sessionId, positions);
          console.log(`Updated position for node ${nodeId} in history`);
        } catch (error) {
          console.error("Failed to update node positions:", error);
        }
      }, 100); // Small delay to ensure rendering is complete

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "add_node",
          { nodeId },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    }
  } catch (error) {
    console.error("Failed to send add node request:", error);
  } finally {
    return newNode;
  }
};

export const duplicateNode = async (
  sessionId,
  nodeId,
  setConversationHistory = null,
  newNodePosition = null,
) => {
  let duplicateResult = null;
  try {
    const response = await sendDuplicateNode(sessionId, nodeId);
    if (response.status == "success") {
      duplicateResult = response.node_info;

      // Update node positions in history after rendering (if position is provided)
      if (newNodePosition && duplicateResult) {
        const newNodeId = duplicateResult.id.toString();
        setTimeout(async () => {
          try {
            const positions = {
              [newNodeId]: { x: newNodePosition.x, y: newNodePosition.y },
            };
            await sendUpdateNodePositions(sessionId, positions);
            console.log(
              `Updated position for duplicated node ${newNodeId} in history`,
            );
          } catch (error) {
            console.error("Failed to update node positions:", error);
          }
        }, 100); // Small delay to ensure rendering is complete
      }

      // Log user interaction
      if (setConversationHistory && duplicateResult) {
        await addUserInteractionToConversation(
          "duplicate_node",
          { nodeId, newNodeId: duplicateResult.id },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      duplicateResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send duplicate node request:", error);
    duplicateResult = error.message;
  } finally {
    return duplicateResult;
  }
};

export const removeNode = async (
  sessionId,
  nodeId,
  setConversationHistory = null,
  skipSnapshot = false,
) => {
  try {
    const response = await sendRemoveNode(sessionId, nodeId, skipSnapshot);
    console.log("Remove node response:", response);

    // Log user interaction (only if not skipping snapshot, i.e., not part of batch delete)
    if (
      setConversationHistory &&
      response.status === "success" &&
      !skipSnapshot
    ) {
      await addUserInteractionToConversation(
        "remove_node",
        { nodeId },
        setConversationHistory,
        sessionId,
        addConversationMessage,
      );
    }

    return response;
  } catch (error) {
    console.error("Failed to remove node:", error);
    throw error;
  }
};

export const addInputVariableKey = async (
  sessionId,
  nodeId,
  inputVariable,
  setConversationHistory = null,
) => {
  let newInputVariable = null;
  try {
    const response = await sendAddInputVariableKey(
      sessionId,
      nodeId,
      inputVariable,
    );
    console.log("Add input variable response:", response);
    if (response.status == "success") {
      newInputVariable = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "add_input_variable_key",
          { nodeId, inputVariable },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      newInputVariable = response.message;
    }
  } catch (error) {
    console.error("Failed to send add input variable request:", error);
  } finally {
    return newInputVariable;
  }
};

export const removeInputVariableKey = async (
  sessionId,
  nodeId,
  inputVariable,
  setConversationHistory = null,
) => {
  let newInputVariable = null;
  try {
    const response = await sendRemoveInputVariableKey(
      sessionId,
      nodeId,
      inputVariable,
    );
    console.log("Remove input variable response:", response);
    if (response.status == "success") {
      newInputVariable = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "remove_input_variable_key",
          { nodeId, inputVariable },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      newInputVariable = response.message;
    }
  } catch (error) {
    console.error("Failed to send remove input variable request:", error);
  } finally {
    return newInputVariable;
  }
};

export const modifyInputVariableKey = async (
  sessionId,
  nodeId,
  oldInputName,
  newInputName,
  setConversationHistory = null,
) => {
  let modifiedInputVariable = null;
  try {
    const response = await sendModifyInputVariableKey(
      sessionId,
      nodeId,
      oldInputName,
      newInputName,
    );
    if (response.status == "success") {
      modifiedInputVariable = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "modify_input_variable_key",
          { nodeId, oldInputName, newInputName },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      modifiedInputVariable = response.message;
    }
  } catch (error) {
    console.error("Failed to send modify input variable request:", error);
    modifiedInputVariable = error.message;
  } finally {
    return modifiedInputVariable;
  }
};

export const addOutputVariableKey = async (
  sessionId,
  nodeId,
  outputVariable,
  setConversationHistory = null,
) => {
  let newOutputVariable = null;
  try {
    const response = await sendAddOutputVariableKey(
      sessionId,
      nodeId,
      outputVariable,
    );
    console.log("Add output variable response:", response);
    if (response.status == "success") {
      newOutputVariable = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "add_output_variable_key",
          { nodeId, outputVariable },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      newOutputVariable = response.message;
    }
  } catch (error) {
    console.error("Failed to send add output variable request:", error);
  } finally {
    return newOutputVariable;
  }
};

export const removeOutputVariableKey = async (
  sessionId,
  nodeId,
  outputVariable,
  setConversationHistory = null,
) => {
  let newOutputVariable = null;
  try {
    const response = await sendRemoveOutputVariableKey(
      sessionId,
      nodeId,
      outputVariable,
    );
    console.log("Remove output variable response:", response);
    if (response.status == "success") {
      newOutputVariable = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "remove_output_variable_key",
          { nodeId, outputVariable },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      newOutputVariable = response.message;
    }
  } catch (error) {
    console.error("Failed to send remove output variable request:", error);
    newOutputVariable = error.message;
  } finally {
    return newOutputVariable;
  }
};

export const modifyOutputVariableKey = async (
  sessionId,
  nodeId,
  oldOutputName,
  newOutputName,
  setConversationHistory = null,
) => {
  let modifiedOutputVariable = null;
  try {
    const response = await sendModifyOutputVariableKey(
      sessionId,
      nodeId,
      oldOutputName,
      newOutputName,
    );
    if (response.status == "success") {
      modifiedOutputVariable = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "modify_output_variable_key",
          { nodeId, oldOutputName, newOutputName },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      modifiedOutputVariable = response.message;
    }
  } catch (error) {
    console.error("Failed to send modify output variable request:", error);
    modifiedOutputVariable = error.message;
  } finally {
    return modifiedOutputVariable;
  }
};

export const addEdge = async (
  sessionId,
  source,
  target,
  sourceHandle,
  targetHandle,
  setConversationHistory = null,
) => {
  let newEdge = null;
  try {
    const response = await sendAddEdge(
      sessionId,
      source,
      target,
      sourceHandle,
      targetHandle,
    );
    if (response.status == "success") {
      newEdge = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "add_edge",
          { source, target, sourceHandle, targetHandle },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      newEdge = response.message;
    }
  } catch (error) {
    console.error("Failed to send add edge request:", error);
    newEdge = error.message;
  } finally {
    return newEdge;
  }
};

export const removeEdge = async (
  sessionId,
  source,
  target,
  sourceHandle,
  targetHandle,
  setConversationHistory = null,
) => {
  let removedEdge = null;
  try {
    const response = await sendRemoveEdge(
      sessionId,
      source,
      target,
      sourceHandle,
      targetHandle,
    );
    if (response.status == "success") {
      removedEdge = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "remove_edge",
          { source, target, sourceHandle, targetHandle },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      removedEdge = response.message;
    }
  } catch (error) {
    console.error("Failed to send remove edge request:", error);
    removedEdge = error.message;
  } finally {
    return removedEdge;
  }
};

export const updateNodeAgentName = async (
  sessionId,
  nodeId,
  agentName,
  setConversationHistory = null,
  oldAgentName = null,
) => {
  let updateResult = null;
  try {
    const response = await sendUpdateNodeAgentName(
      sessionId,
      nodeId,
      agentName,
    );
    if (response.status == "success") {
      updateResult = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "update_node_agent_name",
          { nodeId, agentName, oldAgentName },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      updateResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send update node agent name request:", error);
    updateResult = error.message;
  } finally {
    return updateResult;
  }
};

export const updateNodeConfig = async (
  sessionId,
  nodeId,
  modelName,
  temperature,
) => {
  let updateResult = null;
  try {
    const response = await sendUpdateNodeConfig(
      sessionId,
      nodeId,
      modelName,
      temperature,
    );
    if (response.status == "success") {
      updateResult = "success";
    } else {
      updateResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send update node config request:", error);
    updateResult = error.message;
  } finally {
    return updateResult;
  }
};

export const updateNodeTaskDescription = async (
  sessionId,
  nodeId,
  taskDescription,
  setConversationHistory = null,
  oldDescription = undefined,
) => {
  let updateResult = null;
  try {
    const response = await sendUpdateNodeTaskDescription(
      sessionId,
      nodeId,
      taskDescription,
    );
    if (response.status == "success") {
      updateResult = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "update_node_task_description",
          { nodeId, oldDescription, newDescription: taskDescription },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      updateResult = response.message;
    }
  } catch (error) {
    console.error(
      "Failed to send update node task description request:",
      error,
    );
    updateResult = error.message;
  } finally {
    return updateResult;
  }
};

export const executeTask = async (
  sessionId,
  nodeId,
  executionData,
  setConversationHistory = null,
  suppressMessage = false,
  skipSnapshot = false,
) => {
  // Generate unique message ID for this execution
  const messageId = `execute_task_${nodeId}_${Date.now()}`;

  // Add loading message at the start (non-blocking) - only if not suppressed
  if (setConversationHistory && !suppressMessage) {
    addUserInteractionToConversation(
      "execute_task",
      { nodeId, status: "loading", messageId },
      setConversationHistory,
      sessionId,
      addConversationMessage,
    ).catch((err) => console.error("Error adding loading message:", err));
  }

  let executionResult = null;
  try {
    const response = await sendExecuteTask(
      sessionId,
      nodeId,
      executionData,
      skipSnapshot,
    );
    if (response.status == "success") {
      executionResult = response.execution_result;

      // Update message with completion status - only if not suppressed
      if (
        setConversationHistory &&
        executionResult?.status === "completed" &&
        !suppressMessage
      ) {
        // Check for invalid output values
        let hasInvalidOutput = false;
        if (executionResult.output_values) {
          for (const value of Object.values(executionResult.output_values)) {
            if (value === "None" || value === null || value === "") {
              hasInvalidOutput = true;
              break;
            }
          }
        }

        await updateUserInteractionMessage(
          messageId,
          "execute_task",
          {
            nodeId,
            status: "completed",
            outputValues: executionResult.output_values || {},
            hasInvalidOutput,
          },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      executionResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send execute task request:", error);
    executionResult = error.message;
  } finally {
    return executionResult;
  }
};

export const executeAllNodes = async (sessionId) => {
  let executionResult = null;
  try {
    const response = await sendExecuteAllNodes(sessionId);
    if (response.status == "success") {
      executionResult = response.execution_result;
    } else {
      executionResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send execute all nodes request:", error);
    executionResult = error.message;
  } finally {
    return executionResult;
  }
};

export const resetPlan = async (
  sessionId,
  setConversationHistory = null,
  skipSnapshot = false,
) => {
  let resetResult = null;
  try {
    const response = await sendResetPlan(sessionId, skipSnapshot);
    if (response.status == "success") {
      resetResult = "success";

      // Log user interaction (only if not skipping snapshot)
      if (setConversationHistory && !skipSnapshot) {
        await addUserInteractionToConversation(
          "reset_plan",
          {},
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      resetResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send reset plan request:", error);
    resetResult = error.message;
  } finally {
    return resetResult;
  }
};

export const updateVariableValue = async (
  sessionId,
  nodeId,
  variableName,
  variableValue,
  variableType,
  setConversationHistory = null,
  oldValue = undefined,
) => {
  let updateResult = null;
  try {
    const response = await sendUpdateVariableValue(
      sessionId,
      nodeId,
      variableName,
      variableValue,
      variableType,
    );
    if (response.status == "success") {
      updateResult = "success";

      // Log user interaction
      if (setConversationHistory) {
        await addUserInteractionToConversation(
          "update_variable_value",
          {
            nodeId,
            variableName,
            variableType,
            oldValue,
            newValue: variableValue,
          },
          setConversationHistory,
          sessionId,
          addConversationMessage,
        );
      }
    } else {
      updateResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send update variable value request:", error);
    updateResult = error.message;
  } finally {
    return updateResult;
  }
};

export const getTopologicalOrder = async (sessionId) => {
  let topologicalOrder = null;
  try {
    const response = await sendGetTopologicalOrder(sessionId);
    if (response.status == "success") {
      topologicalOrder = response.execution_result.topological_order;
    } else {
      console.error("Failed to get topological order:", response.message);
      topologicalOrder = response.message;
    }
  } catch (error) {
    console.error("Failed to send get topological order request:", error);
    topologicalOrder = error.message;
  } finally {
    return topologicalOrder;
  }
};

export const autoSplitNode = async (sessionId, nodeId, connectedEdges) => {
  let splitResult = null;
  try {
    const response = await sendAutoSplitNode(sessionId, nodeId, connectedEdges);
    if (response.status == "success") {
      splitResult = response.execution_result;
    } else {
      splitResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send split node request:", error);
    splitResult = error.message;
  } finally {
    return splitResult;
  }
};

export const sequentialSplitNode = async (
  sessionId,
  nodeId,
  connectedEdges,
) => {
  let splitResult = null;
  try {
    const response = await sendSequentialSplitNode(
      sessionId,
      nodeId,
      connectedEdges,
    );
    if (response.status == "success") {
      splitResult = response.execution_result;
    } else {
      splitResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send sequential split node request:", error);
    splitResult = error.message;
  } finally {
    return splitResult;
  }
};

export const checkNodesMergeable = async (sessionId, nodeIds) => {
  let mergeable = null;
  try {
    const response = await sendCheckNodesMergeable(sessionId, nodeIds);
    if (response.status == "success") {
      mergeable = response.mergeable;
    } else {
      mergeable = response.message;
    }
  } catch (error) {
    console.error("Failed to send check nodes mergeable request:", error);
    mergeable = error.message;
  } finally {
    return mergeable;
  }
};

export const autoMergeNodes = async (sessionId, nodeIds, connectedEdges) => {
  let mergeResult = null;
  try {
    const response = await sendAutoMergeNodes(
      sessionId,
      nodeIds,
      connectedEdges,
    );
    if (response.status == "success") {
      mergeResult = response.execution_result;
    } else {
      mergeResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send auto merge nodes request:", error);
    mergeResult = error.message;
  } finally {
    return mergeResult;
  }
};

export const forceMergeNodes = async (sessionId, nodeIds, connectedEdges) => {
  let mergeResult = null;
  try {
    const response = await sendForceMergeNodes(
      sessionId,
      nodeIds,
      connectedEdges,
    );
    if (response.status == "success") {
      mergeResult = response.execution_result;
    } else {
      mergeResult = response.message;
    }
  } catch (error) {
    console.error("Failed to send force merge nodes request:", error);
    mergeResult = error.message;
  } finally {
    return mergeResult;
  }
};

export const savePlan = async (sessionId, assistantResponse) => {
  try {
    const response = await sendSavePlan(sessionId, assistantResponse);
    if (response.status === "success") {
      console.log("Plan saved successfully from backend");
      return "success";
    } else {
      console.error("Failed to save plan:", response.message);
      return response.message;
    }
  } catch (error) {
    console.error("Failed to save plan:", error);
    throw error;
  }
};

export const loadPlan = async (sessionId, planJson) => {
  try {
    const response = await sendLoadPlan(sessionId, planJson);
    if (response.status === "success") {
      console.log("Plan loaded successfully from backend");
      return response;
    } else {
      console.error("Failed to load plan:", response.message);
      throw new Error(response.message);
    }
  } catch (error) {
    console.error("Failed to load plan:", error);
    throw error;
  }
};
