// App.js - No JSX version
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import ConversationPanel from "./components/ConversationPanel";
import PlanDisplay from "./components/PlanDisplay";
import ResizableLayout from "./components/ResizableLayout";
import {
  addConversationMessage,
  sendGeneratePlan,
  sendReplan,
  sendSubplanFeedback,
} from "./services/backendApi";
import { checkNodesMergeable } from "./services/uiInteraction";
import { clearAllNodesAndEdgesFrontend } from "./utils/clearFunction";
import {
  applyAutoLayout,
  applyTargetReplanLayout,
  processPlanData,
  validatePlanData,
} from "./utils/planProcessor";

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [planData, setPlanData] = useState({ nodes: [], edges: [] });
  const [conversationHistory, setConversationHistory] = useState([]);
  const [agentRegistry, setAgentRegistry] = useState(null);
  const [modelRegistry, setModelRegistry] = useState([]);
  const sessionStarting = useRef(false);
  const agentRegistryLoading = useRef(false);
  const modelRegistryLoading = useRef(false);
  const forceEdgeRerenderRef = useRef(null);

  useEffect(() => {
    // console.log("sessionId", sessionId, "sessionStarting", sessionStarting.current);

    if (!sessionId && !sessionStarting.current) {
      sessionStarting.current = true;

      const startSession = async () => {
        try {
          const systemLabel = window.SYSTEM_LABEL || "unknown";
          const response = await fetch("/api/start-session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              system_label: systemLabel,
            }),
          });
          const data = await response.json();
          // console.log("Session created:", data);
          setSessionId(data.session_id);
        } catch (error) {
          console.error("Error starting session:", error);
        } finally {
          sessionStarting.current = false;
        }
      };

      startSession();
    }
  }, []);

  useEffect(() => {
    if (!agentRegistry && !agentRegistryLoading.current) {
      agentRegistryLoading.current = true;

      const getAgentRegistry = async () => {
        try {
          const response = await fetch("/api/get-agent-registry", {
            method: "GET",
          });
          const data = await response.json();
          const AgentNames = data.agent_registry.map((agent) => agent.name);
          const agentDescriptions = data.agent_registry.reduce((acc, d) => {
            acc[d.name] = d.description;
            return acc;
          }, {});
          const agentDefaultConfigs = data.agent_registry.reduce((acc, d) => {
            acc[d.name] = d.config;
            return acc;
          }, {});

          // Store the processed agent data in state
          setAgentRegistry({
            names: AgentNames,
            descriptions: agentDescriptions,
            configs: agentDefaultConfigs,
          });

          // console.log("Agent registry loaded:", AgentNames);
        } catch (error) {
          console.error("Error getting agent registry:", error);
        } finally {
          agentRegistryLoading.current = false;
        }
      };

      getAgentRegistry();
    }
  }, []);

  useEffect(() => {
    if (modelRegistry.length === 0 && !modelRegistryLoading.current) {
      modelRegistryLoading.current = true;
      const getModelRegistry = async () => {
        try {
          const response = await fetch("/api/get-model-registry", {
            method: "GET",
          });
          const data = await response.json();
          setModelRegistry(data.model_registry);
        } catch (error) {
          console.error("Error getting model registry:", error);
        } finally {
          modelRegistryLoading.current = false;
        }
      };
      getModelRegistry();
    }
  }, []);
  // Function to send messages to planning assistant
  const generatePlan = useCallback(
    async (userMessage) => {
      try {
        // console.log('Sending message to planning assistant:', userMessage);

        // Add user message to conversation history immediately
        setConversationHistory((prev) => [
          ...prev,
          { type: "user", message: userMessage, timestamp: new Date() },
        ]);

        // Send message to backend
        const response = await sendGeneratePlan(sessionId, userMessage);

        if (response.status === "success") {
          // console.log('Message sent successfully, response:', response);

          // Process plan data if provided
          if (
            response.plan &&
            (response.plan.list_node || response.plan.nodes)
          ) {
            // console.log('Processing plan data from backend:', response.plan);

            try {
              // Handle both possible formats from backend
              const nodeList =
                response.plan.list_node || response.plan.nodes || [];
              const edgeList =
                response.plan.list_edge || response.plan.edges || [];

              // Convert backend format to UI format
              const processedPlan = processPlanData(nodeList, edgeList);

              // Validate the processed plan
              const validation = validatePlanData(processedPlan);

              if (validation.isValid) {
                clearAllNodesAndEdgesFrontend(
                  setPlanData,
                  setSelectedNode,
                  setSelectedEdge,
                );
                // Apply auto-layout to position nodes properly
                const layoutedNodes = applyAutoLayout(
                  processedPlan.nodes,
                  processedPlan.edges,
                );

                // Collapse all variables by default
                const nodesWithCollapsedVariables = layoutedNodes.map(
                  (node) => ({
                    ...node,
                    isVariablesCollapsed: true,
                  }),
                );

                // Update plan data state and reset selection
                setPlanData({
                  nodes: nodesWithCollapsedVariables.map((node) => ({
                    ...node,
                    isSelected: false, // Reset selection for new plan
                  })),
                  edges: processedPlan.edges,
                });

                // console.log('Plan data updated successfully:', {
                //   nodes: layoutedNodes,
                //   edges: processedPlan.edges
                // });

                // Update node positions in history and force edge rerender after rendering
                setTimeout(async () => {
                  try {
                    // Collect all node positions
                    const positions = {};
                    layoutedNodes.forEach((node) => {
                      positions[node.id] = { x: node.x, y: node.y };
                    });

                    // Send positions to backend
                    const { sendUpdateNodePositions } =
                      await import("./services/backendApi");
                    await sendUpdateNodePositions(sessionId, positions);
                    // console.log(`Updated positions for ${layoutedNodes.length} generated nodes in history`);
                  } catch (error) {
                    console.error("Failed to update node positions:", error);
                  }

                  // Force edge rerender to ensure edges are displayed
                  if (forceEdgeRerenderRef.current) {
                    forceEdgeRerenderRef.current();

                    // Force another rerender after a delay to ensure all edges are visible
                    setTimeout(() => {
                      if (forceEdgeRerenderRef.current) {
                        forceEdgeRerenderRef.current();
                        // console.log('Forced second edge rerender for plan generation');
                      }
                    }, 300);
                  }
                }, 100);

                const summaryMessage = `✅ Plan generated with ${layoutedNodes.length} nodes and ${processedPlan.edges.length} connections.`;
                // Add success message to conversation
                setConversationHistory((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    message: summaryMessage,
                    timestamp: new Date(),
                  },
                ]);

                await addConversationMessage(
                  sessionId,
                  "assistant",
                  summaryMessage,
                );
              } else {
                console.error("Plan validation failed:", validation.errors);
                const summaryMessage = `❌ Plan validation failed: ${validation.errors.join(", ")}`;
                setConversationHistory((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    message: summaryMessage,
                    timestamp: new Date(),
                  },
                ]);
                await addConversationMessage(
                  sessionId,
                  "assistant",
                  summaryMessage,
                );
              }
            } catch (error) {
              console.error("Error processing plan data:", error);
              const summaryMessage = `❌ Error processing plan: ${error.message}`;
              setConversationHistory((prev) => [
                ...prev,
                {
                  type: "assistant",
                  message: summaryMessage,
                  timestamp: new Date(),
                },
              ]);
              await addConversationMessage(
                sessionId,
                "assistant",
                summaryMessage,
              );
            }
          }
        } else {
          console.error("Backend error:", response.message);
          // Add error message to conversation
          setConversationHistory((prev) => [
            ...prev,
            {
              type: "assistant",
              message: `Error: ${response.message}`,
              timestamp: new Date(),
            },
          ]);
          await addConversationMessage(
            sessionId,
            "assistant",
            `Error: ${response.message}`,
          );
        }

        return response;
      } catch (error) {
        console.error("Error sending message:", error);
        // Add error message to conversation
        setConversationHistory((prev) => [
          ...prev,
          {
            type: "assistant",
            message: `Error: ${error.message}`,
            timestamp: new Date(),
          },
        ]);
        await addConversationMessage(
          sessionId,
          "assistant",
          `Error: ${error.message}`,
        );
      }
    },
    [sessionId],
  );

  // Function to send replan requests to planning assistant
  const replan = useCallback(
    async (userMessage) => {
      try {
        // console.log('Sending replan request to planning assistant:', userMessage);

        // Add user message to conversation history immediately
        setConversationHistory((prev) => [
          ...prev,
          { type: "user", message: userMessage, timestamp: new Date() },
        ]);

        // Send replan request to backend
        const response = await sendReplan(
          sessionId,
          userMessage,
          conversationHistory,
          planData,
        );

        if (response.status === "success") {
          // console.log('Replan sent successfully, response:', response);

          // Process plan data if provided
          if (
            response.plan &&
            (response.plan.list_node || response.plan.nodes)
          ) {
            // console.log('Processing replanned data from backend:', response.plan);

            try {
              // Handle both possible formats from backend
              const nodeList =
                response.plan.list_node || response.plan.nodes || [];
              const edgeList =
                response.plan.list_edge || response.plan.edges || [];

              // Convert backend format to UI format
              const processedPlan = processPlanData(nodeList, edgeList);

              // Validate the processed plan
              const validation = validatePlanData(processedPlan);

              if (validation.isValid) {
                clearAllNodesAndEdgesFrontend(
                  setPlanData,
                  setSelectedNode,
                  setSelectedEdge,
                );
                // Apply auto-layout to position nodes properly
                const layoutedNodes = applyAutoLayout(
                  processedPlan.nodes,
                  processedPlan.edges,
                );

                // Collapse all variables by default
                const nodesWithCollapsedVariables = layoutedNodes.map(
                  (node) => ({
                    ...node,
                    isVariablesCollapsed: true,
                  }),
                );

                // Update plan data state and reset selection
                setPlanData({
                  nodes: nodesWithCollapsedVariables.map((node) => ({
                    ...node,
                    isSelected: false, // Reset selection for new plan
                  })),
                  edges: processedPlan.edges,
                });

                // console.log('Replan data updated successfully:', {
                //   nodes: layoutedNodes,
                //   edges: processedPlan.edges
                // });

                // Update node positions in history and force edge rerender after rendering
                setTimeout(async () => {
                  try {
                    // Collect all node positions
                    const positions = {};
                    layoutedNodes.forEach((node) => {
                      positions[node.id] = { x: node.x, y: node.y };
                    });

                    // Send positions to backend
                    const { sendUpdateNodePositions } =
                      await import("./services/backendApi");
                    await sendUpdateNodePositions(sessionId, positions);
                    // console.log(`Updated positions for ${layoutedNodes.length} replanned nodes in history`);
                  } catch (error) {
                    console.error("Failed to update node positions:", error);
                  }

                  // Force edge rerender to ensure edges are displayed
                  if (forceEdgeRerenderRef.current) {
                    forceEdgeRerenderRef.current();

                    // Force another rerender after a delay to ensure all edges are visible
                    setTimeout(() => {
                      if (forceEdgeRerenderRef.current) {
                        forceEdgeRerenderRef.current();
                        // console.log('Forced second edge rerender for replan');
                      }
                    }, 300);
                  }
                }, 100);

                const summaryMessage = `✅ Plan replanned with ${layoutedNodes.length} nodes and ${processedPlan.edges.length} connections.`;
                // Add success message to conversation
                setConversationHistory((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    message: summaryMessage,
                    timestamp: new Date(),
                  },
                ]);
                await addConversationMessage(
                  sessionId,
                  "assistant",
                  summaryMessage,
                );
              } else {
                console.error("Replan validation failed:", validation.errors);
                const summaryMessage = `❌ Replan validation failed: ${validation.errors.join(", ")}`;
                setConversationHistory((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    message: summaryMessage,
                    timestamp: new Date(),
                  },
                ]);
                await addConversationMessage(
                  sessionId,
                  "assistant",
                  summaryMessage,
                );
              }
            } catch (error) {
              console.error("Error processing replan data:", error);
              const summaryMessage = `❌ Error processing replan: ${error.message}`;
              setConversationHistory((prev) => [
                ...prev,
                {
                  type: "assistant",
                  message: summaryMessage,
                  timestamp: new Date(),
                },
              ]);
              await addConversationMessage(
                sessionId,
                "assistant",
                summaryMessage,
              );
            }
          }
        } else {
          console.error("Backend replan error:", response.message);
          // Add error message to conversation
          setConversationHistory((prev) => [
            ...prev,
            {
              type: "assistant",
              message: `Replan Error: ${response.message}`,
              timestamp: new Date(),
            },
          ]);
          await addConversationMessage(
            sessionId,
            "assistant",
            `Replan Error: ${response.message}`,
          );
        }

        return response;
      } catch (error) {
        console.error("Error sending replan request:", error);
        // Add error message to conversation
        setConversationHistory((prev) => [
          ...prev,
          {
            type: "assistant",
            message: `Replan Error: ${error.message}`,
            timestamp: new Date(),
          },
        ]);
        await addConversationMessage(
          sessionId,
          "assistant",
          `Replan Error: ${error.message}`,
        );
      }
    },
    [sessionId, conversationHistory, planData],
  );

  const subplanFeedback = useCallback(
    async (userMessage) => {
      try {
        // console.log('Sending subplan feedback request to planning assistant:', userMessage);

        // Collect all selected nodes
        const selectedNodes = planData.nodes.filter((node) => node.isSelected);
        // console.log('Selected nodes for subplan feedback:', selectedNodes);
        if (selectedNodes.length === 0) {
          alert("No nodes selected for subplan feedback");
          return;
        }

        // Extract only node IDs for backend
        const selectedNodeIds = selectedNodes.map((node) => node.id);

        //check if it is merageable, meaning all nodes are connected to each other
        const isMergeable = await checkNodesMergeable(
          sessionId,
          selectedNodeIds,
        );
        if (!isMergeable) {
          alert("Selected nodes have to be connected as a subplan");
          return;
        }

        // Add user message to conversation history immediately
        setConversationHistory((prev) => [
          ...prev,
          { type: "user", message: userMessage, timestamp: new Date() },
        ]);

        // Send subplan feedback request to backend with selected node IDs
        const response = await sendSubplanFeedback(
          sessionId,
          userMessage,
          conversationHistory,
          planData,
          selectedNodeIds,
        );

        if (response.status === "success") {
          // console.log('Subplan feedback sent successfully, response:', response);

          // Process plan data if provided
          if (
            response.plan &&
            (response.plan.list_node || response.plan.nodes)
          ) {
            // console.log('Processing subplan feedback data from backend:', response.plan);

            try {
              // Handle both possible formats from backend
              const nodeList =
                response.plan.list_node || response.plan.nodes || [];
              const edgeList =
                response.plan.list_edge || response.plan.edges || [];

              // Convert backend format to UI format
              const processedPlan = processPlanData(nodeList, edgeList);

              // Validate the processed plan
              const validation = validatePlanData(processedPlan);

              if (validation.isValid) {
                // console.log('[App] Subplan feedback - removing nodes:', selectedNodeIds);
                // console.log('[App] Subplan feedback - new plan received:', processedPlan);

                // Calculate new nodes BEFORE setPlanData to use in summary message
                const nodesAfterRemoval = planData.nodes.filter(
                  (n) => !selectedNodeIds.includes(String(n.id)),
                );
                const existingNodeIds = new Set(
                  nodesAfterRemoval.map((n) => String(n.id)),
                );

                const newNodesForPositionUpdate = processedPlan.nodes
                  .filter((node) => !existingNodeIds.has(String(node.id)))
                  .map((node) => ({
                    ...node,
                    isVariablesCollapsed: true,
                    isSelected: false,
                  }));

                // console.log(`[App] Calculated: Removing ${selectedNodeIds.length} nodes, adding ${newNodesForPositionUpdate.length} new nodes`);

                setPlanData((prev) => {
                  // Step 1: Remove the selected nodes and their connected edges
                  const nodesAfterRemoval = prev.nodes.filter(
                    (n) => !selectedNodeIds.includes(String(n.id)),
                  );
                  const edgesAfterRemoval = prev.edges.filter(
                    (e) =>
                      !selectedNodeIds.includes(String(e.source)) &&
                      !selectedNodeIds.includes(String(e.target)),
                  );

                  // Step 2: Get existing node and edge IDs after removal
                  const existingNodeIds = new Set(
                    nodesAfterRemoval.map((n) => String(n.id)),
                  );
                  const existingEdgeIds = new Set(
                    edgesAfterRemoval.map((e) => e.id),
                  );

                  // Step 3: Find new nodes and edges from backend that don't exist in current plan
                  const newNodes = processedPlan.nodes
                    .filter((node) => !existingNodeIds.has(String(node.id)))
                    .map((node) => ({
                      ...node,
                      isVariablesCollapsed: true,
                      isSelected: false,
                    }));

                  const newEdges = processedPlan.edges.filter(
                    (edge) => !existingEdgeIds.has(edge.id),
                  );

                  // console.log(`[App] setPlanData: Removed ${selectedNodeIds.length} nodes, adding ${newNodes.length} nodes and ${newEdges.length} edges`);

                  // Step 4: Apply smart layout for new nodes
                  // Get the removed nodes for positioning context
                  const removedNodes = prev.nodes.filter((n) =>
                    selectedNodeIds.includes(String(n.id)),
                  );

                  // Combine edges for layout calculation
                  const allEdges = [...edgesAfterRemoval, ...newEdges];

                  // Apply smart layout
                  const { layoutedNodes, shiftedNodes } =
                    applyTargetReplanLayout(
                      nodesAfterRemoval,
                      newNodes,
                      removedNodes,
                      allEdges,
                    );

                  // console.log('[App] Applied target replan layout:', {
                  //   layoutedNewNodes: layoutedNodes.length,
                  //   shiftedExistingNodes: shiftedNodes.length
                  // });

                  // Step 5: Return updated plan with layouted new nodes and shifted existing nodes
                  return {
                    ...prev,
                    nodes: [...shiftedNodes, ...layoutedNodes],
                    edges: allEdges,
                  };
                });

                // Clear selection if any selected node was selected
                if (selectedNodeIds.includes(String(selectedNode))) {
                  setSelectedNode(null);
                }

                // Update node positions in history and force edge rerender after rendering
                setTimeout(async () => {
                  try {
                    // Collect ALL node positions from the entire plan (not just subplan nodes)
                    const positions = {};
                    setPlanData((currentPlanData) => {
                      currentPlanData.nodes.forEach((node) => {
                        positions[node.id] = { x: node.x, y: node.y };
                      });
                      return currentPlanData; // Return unchanged to avoid re-render
                    });

                    // Send positions to backend
                    const { sendUpdateNodePositions } =
                      await import("./services/backendApi");
                    await sendUpdateNodePositions(sessionId, positions);
                    // console.log(`Updated positions for ${Object.keys(positions).length} nodes (entire plan) in history`);
                  } catch (error) {
                    console.error("Failed to update node positions:", error);
                  }

                  // Force edge rerender to ensure nodes are positioned
                  if (forceEdgeRerenderRef.current) {
                    forceEdgeRerenderRef.current();
                  }
                }, 100);

                // Add success message to conversation
                const removedNodeIdsText = selectedNodeIds.join(", ");
                const addedNodeIds = newNodesForPositionUpdate.map(
                  (node) => node.id,
                );
                const addedNodeIdsText = addedNodeIds.join(", ");
                const summaryMessage = `✅ Plan updated with subplan feedback focused on node${selectedNodeIds.length > 1 ? "s" : ""} ${removedNodeIdsText}: Removed ${selectedNodeIds.length > 1 ? "these" : "this"} ${selectedNodeIds.length} node${selectedNodeIds.length > 1 ? "s" : ""}, added ${addedNodeIds.length} node${addedNodeIds.length !== 1 ? "s" : ""} ${addedNodeIdsText}.`;
                setConversationHistory((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    message: summaryMessage,
                    timestamp: new Date(),
                  },
                ]);
                await addConversationMessage(
                  sessionId,
                  "assistant",
                  summaryMessage,
                );
              } else {
                console.error(
                  "Subplan feedback validation failed:",
                  validation.errors,
                );
                let summaryMessage = `❌ Subplan feedback validation failed: ${validation.errors.join(", ")}`;
                if (response.captured_output) {
                  summaryMessage += `\n${response.captured_output}`;
                }
                setConversationHistory((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    message: summaryMessage,
                    timestamp: new Date(),
                  },
                ]);
                await addConversationMessage(
                  sessionId,
                  "assistant",
                  summaryMessage,
                );
              }
            } catch (error) {
              console.error("Error processing subplan feedback data:", error);
              const summaryMessage = `❌ Error processing subplan feedback: ${error.message}`;
              setConversationHistory((prev) => [
                ...prev,
                {
                  type: "assistant",
                  message: summaryMessage,
                  timestamp: new Date(),
                },
              ]);
              await addConversationMessage(
                sessionId,
                "assistant",
                summaryMessage,
              );
            }
          }
        } else {
          console.error("Backend subplan feedback error:", response.message);
          // Add error message to conversation
          setConversationHistory((prev) => [
            ...prev,
            {
              type: "assistant",
              message: `Subplan Feedback Error: ${response.message}`,
              timestamp: new Date(),
            },
          ]);
          await addConversationMessage(
            sessionId,
            "assistant",
            `Subplan Feedback Error: ${response.message}`,
          );
        }

        return response;
      } catch (error) {
        console.error("Error sending subplan feedback request:", error);
        // Add error message to conversation
        setConversationHistory((prev) => [
          ...prev,
          {
            type: "assistant",
            message: `Subplan Feedback Error: ${error.message}`,
            timestamp: new Date(),
          },
        ]);
        await addConversationMessage(
          sessionId,
          "assistant",
          `Subplan Feedback Error: ${error.message}`,
        );
      }
    },
    [sessionId, conversationHistory, planData],
  );

  // Callback to update output variables for a specific node
  const onUpdateOtherNodeOutputs = useCallback(
    (targetNodeId, outputVariableName, outputVariableValue) => {
      // console.log(`[App] Updating node ${targetNodeId}, output variable "${outputVariableName}" with value: "${outputVariableValue}"`);

      setPlanData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (node.id === parseInt(targetNodeId)) {
            // Update the specific output variable in the node's output array
            const updatedOutputs = node.output.map((output) => {
              if (output.name === outputVariableName) {
                // console.log(`[App] Updating output variable "${outputVariableName}" from "${output.value}" to "${outputVariableValue}"`);
                return { ...output, value: outputVariableValue };
              }
              return output;
            });

            return { ...node, output: updatedOutputs };
          }
          return node;
        }),
      }));
    },
    [],
  );

  // Callback to update input variables for a specific node
  const onUpdateOtherNodeInputs = useCallback(
    (targetNodeId, inputVariableName, inputVariableValue) => {
      // console.log(`[App] Updating node ${targetNodeId}, input variable "${inputVariableName}" with value: "${inputVariableValue}"`);

      setPlanData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (node.id === parseInt(targetNodeId)) {
            // Update the specific input variable in the node's input array
            const updatedInputs = node.input.map((input) => {
              if (input.name === inputVariableName) {
                // console.log(`[App] Updating input variable "${inputVariableName}" from "${input.value}" to "${inputVariableValue}"`);
                return { ...input, value: inputVariableValue };
              }
              return input;
            });

            return { ...node, input: updatedInputs };
          }
          return node;
        }),
      }));
    },
    [],
  );

  const handleNodeSelect = useCallback((nodeId) => {
    // console.log('Node selected:', nodeId);
    setSelectedNode(nodeId);
    setSelectedEdge(null);
  }, []);

  const handleEdgeSelect = useCallback((edgeId) => {
    // console.log('Edge selected:', edgeId);
    setSelectedEdge(edgeId);
    setSelectedNode(null);
  }, []);

  const handleDeselect = useCallback(() => {
    // console.log('Deselecting nodes and edges');
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  return React.createElement(
    "div",
    { className: "app" },
    React.createElement(ResizableLayout, {
      leftPanel: React.createElement(ConversationPanel, {
        conversationHistory: conversationHistory,
        onGeneratePlan: generatePlan,
        onReplan: replan,
        onSubplanFeedback: subplanFeedback,
        sessionId: sessionId,
        planData: planData,
        modelRegistry: modelRegistry,
      }),
      centerPanel: React.createElement(PlanDisplay, {
        planData: planData,
        selectedNode: selectedNode,
        selectedEdge: selectedEdge,
        onNodeSelect: handleNodeSelect,
        onEdgeSelect: handleEdgeSelect,
        onDeselect: handleDeselect,
        setPlanData: setPlanData,
        setSelectedNode: setSelectedNode,
        setSelectedEdge: setSelectedEdge,
        sessionId: sessionId,
        onUpdateOtherNodeOutputs: onUpdateOtherNodeOutputs,
        onUpdateOtherNodeInputs: onUpdateOtherNodeInputs,
        onForceEdgeRerender: (fn) => {
          forceEdgeRerenderRef.current = fn;
        },
        setConversationHistory: setConversationHistory,
        conversationHistory: conversationHistory,
        modelRegistry: modelRegistry,
      }),
      rightPanel: null,
      isRightPanelVisible: false,
    }),
  );
}

export default App;
