// components/PlanDisplay.js
import {
  Button,
  ButtonGroup,
  Icon,
  Menu,
  MenuItem,
  Popover,
  Position,
  Spinner,
  Tooltip,
} from "@blueprintjs/core";
import {
  addEdge,
  Background,
  ConnectionLineType,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addConversationMessage,
  sendCaptureBatchDeleteSnapshot,
  sendGetUndoRedoStatus,
  sendRedo,
  sendUndo,
  sendUpdateNodePositions,
} from "../services/backendApi";
import {
  addEdge as addEdgeToBackend,
  addNode,
  autoMergeNodes,
  checkNodesMergeable,
  duplicateNode,
  executeTask,
  forceMergeNodes,
  getTopologicalOrder,
  loadPlan,
  removeEdge as removeEdgeFromBackend,
  removeNode,
  savePlan,
} from "../services/uiInteraction";
import { logButtonClick } from "../utils/buttonLogger";
import {
  clearAllNodesAndEdgesBackend,
  clearAllNodesAndEdgesFrontend,
} from "../utils/clearFunction";
import {
  addUserInteractionToConversation,
  updateUserInteractionMessage,
} from "../utils/interactionMessages";
import {
  applyAutoLayout,
  applyTargetReplanLayout,
  processPlanData,
} from "../utils/planProcessor";
import CustomTaskNode from "./CustomTaskNode";
import "./PlanDisplay.css";
import UndoRedoControl from "./UndoRedoControl";

const PlanDisplay = ({
  planData,
  selectedNode,
  selectedEdge,
  onNodeSelect,
  onEdgeSelect,
  onDeselect,
  setPlanData,
  setSelectedNode,
  setSelectedEdge,
  sessionId,
  onUpdateOtherNodeOutputs,
  onUpdateOtherNodeInputs,
  onForceEdgeRerender,
  setConversationHistory,
  conversationHistory,
  modelRegistry = [],
}) => {
  // Store ref to latest planData to avoid stale closures
  const planDataRef = useRef(planData);
  planDataRef.current = planData;

  // State for undo/redo availability
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [currentActionDescription, setCurrentActionDescription] = useState("");

  // Handler for clearing all nodes and edges
  const handleClearAll = async () => {
    try {
      // Attempt to clear the backend
      const backendSuccess = await clearAllNodesAndEdgesBackend(
        sessionId,
        setConversationHistory,
      );

      if (backendSuccess) {
        // Define onRemoveNode callback for removing nodes from frontend
        const onRemoveNodeCallback = (nodeId) => {
          console.log(`Removing node ${nodeId} from frontend state`);
          setPlanData((prev) => ({
            ...prev,
            nodes: prev.nodes.filter((n) => n.id !== nodeId),
            edges: prev.edges.filter(
              (e) => e.source !== nodeId && e.target !== nodeId,
            ),
          }));

          if (selectedNode?.id === nodeId) {
            setSelectedNode(null);
          }
        };

        // clear the frontend if backend clear finished successfully
        clearAllNodesAndEdgesFrontend(
          setPlanData,
          setSelectedNode,
          setSelectedEdge,
          planData,
          onRemoveNodeCallback,
        );

        // Reset z-index tracking for fresh start
        nodeZIndexMap.current.clear();
        zIndexCounter.current = 1000;

        console.log("Both frontend and backend cleared successfully");
      } else {
        console.warn("Backend clear failed");
      }
    } catch (error) {
      console.error("Error during clear operation:", error);
      // Frontend is still cleared even if backend fails
    }
  };

  // Define custom node types with sessionId
  const nodeTypes = useMemo(
    () => ({
      customTask: CustomTaskNode,
    }),
    [],
  ); // Empty dependency array - nodeTypes never changes

  // Convert planData to React Flow format
  const initialNodes = useMemo(() => {
    return (
      planData?.nodes?.map((node) => ({
        id: String(node.id), // Ensure ID is string
        type: "customTask", // Use custom node type
        position: { x: node.x || 0, y: node.y || 0 },
        draggable: true, // Explicitly enable dragging
        selectable: true, // Explicitly enable selection
        data: {
          label: node.id || "Untitled Node",
          description: node.task,
          agent_name: node.agent_name,
          input: node.input || [],
          output: node.output || [],
          isVariablesCollapsed: node.isVariablesCollapsed || false,
          isLogCollapsed:
            node.isLogCollapsed !== undefined ? node.isLogCollapsed : true,
          execution_log: node.execution_log || "",
          selected: selectedNode === String(node.id),
          isSelected: node.isSelected || false,
          sessionId: sessionId,
          executionStatus: node.executionStatus || null, // 'loading', 'success', 'error', or null
          modelName: node.modelName || "gpt-4o-mini",
          temperature: node.temperature !== undefined ? node.temperature : 0,
          modelRegistry: modelRegistry,
          nodes: planData.nodes, // Pass all nodes for merge selection
          onNodeSelect: onNodeSelect,
          setConversationHistory: setConversationHistory, // Pass conversation history setter for interaction messages
          onUpdateNode: (nodeId, updatedData) => {
            // Update the planData when node is modified
            setPlanData((prev) => ({
              ...prev,
              nodes: prev.nodes.map((n) =>
                n.id === nodeId ? { ...n, ...updatedData } : n,
              ),
            }));
          },
          onRemoveEdges: (nodeId, variableName, varType) => {
            // Remove edges tied to a specific input/output handle on this node
            setPlanData((prev) => {
              const filtered = prev.edges.filter((e) => {
                if (varType === "input") {
                  return !(
                    String(e.target) === String(nodeId) &&
                    e.targetHandle === variableName
                  );
                }
                if (varType === "output") {
                  return !(
                    String(e.source) === String(nodeId) &&
                    e.sourceHandle === variableName
                  );
                }
                return true;
              });
              return { ...prev, edges: filtered };
            });
            // Also sync React Flow edges immediately
            setEdges((curr) =>
              curr.filter((e) => {
                if (varType === "input") {
                  return !(
                    String(e.target) === String(nodeId) &&
                    e.targetHandle === variableName
                  );
                }
                if (varType === "output") {
                  return !(
                    String(e.source) === String(nodeId) &&
                    e.sourceHandle === variableName
                  );
                }
                return true;
              }),
            );
          },
          onRemoveNode: (nodeId) => {
            // Remove the node from frontend state (called from delete button)
            console.log(`Removing node ${nodeId} from frontend state`);
            setPlanData((prev) => ({
              ...prev,
              nodes: prev.nodes.filter((n) => n.id !== nodeId),
              // Also remove any edges connected to this node
              edges: prev.edges.filter(
                (e) => e.source !== nodeId && e.target !== nodeId,
              ),
            }));

            // Clear selected node if it was the deleted one
            if (selectedNode?.id === nodeId) {
              setSelectedNode(null);
            }
          },

          onDuplicateNode: async (nodeId) => {
            // Duplicate the node (create a copy with new ID and offset position)
            console.log(`Duplicating node ${nodeId}`);

            const nodeToDuplicate = planData.nodes.find((n) => n.id === nodeId);
            if (!nodeToDuplicate) {
              console.error(`Node ${nodeId} not found for duplication`);
              return;
            }

            // Calculate new position with offset
            const newPosition = {
              x: (nodeToDuplicate.x || 0) + 50,
              y: (nodeToDuplicate.y || 0) + 50,
            };

            let newNodeInfo = null;
            try {
              const response = await duplicateNode(
                sessionId,
                nodeId,
                setConversationHistory,
                newPosition,
              );
              console.log("Duplicate node response:", response);
              if (response.status === "completed") {
                console.log(`Node ${nodeId} duplicated as node ${response}`);
                newNodeInfo = response;
              } else {
                alert("Failed to duplicate node: " + response);
                return;
              }
            } catch (error) {
              alert("Failed to duplicate node: " + error);
              return;
            }
            if (!newNodeInfo) {
              return;
            }

            const newNodeId = newNodeInfo.id;
            console.log(newNodeInfo);
            // Create a copy with offset position
            const duplicatedNode = {
              id: newNodeId.toString(),
              agent_name: newNodeInfo.agent_name,
              task: newNodeInfo.task || "",
              input: [],
              output: [],
              x: newPosition.x,
              y: newPosition.y,
              executionStatus: null, // Reset execution status
              isSelected: false, // Initialize selection state
            };
            if (newNodeInfo.input) {
              duplicatedNode.input = Object.entries(newNodeInfo.input).map(
                ([key, value]) => ({
                  name: key,
                  value: value,
                  isValid: true,
                  isEditing: false,
                }),
              );
            }
            if (newNodeInfo.output) {
              duplicatedNode.output = Object.entries(newNodeInfo.output).map(
                ([key, value]) => ({
                  name: key,
                  value: value,
                  isValid: true,
                  isEditing: false,
                }),
              );
            }

            setPlanData((prev) => ({
              ...prev,
              nodes: [...prev.nodes, duplicatedNode],
            }));

            console.log(`Node ${nodeId} duplicated as node ${newNodeId}`);
          },
          onUpdateOtherNodeInputs: (
            targetNodeId,
            inputVariableName,
            inputVariableValue,
          ) => {
            // Update specific input variable for other nodes after task execution
            console.log(
              `Updating node ${targetNodeId}, variable "${inputVariableName}" with value: "${inputVariableValue}"`,
            );

            setPlanData((prev) => ({
              ...prev,
              nodes: prev.nodes.map((node) => {
                if (node.id === targetNodeId) {
                  // Update the specific input variable in the node's input array
                  const updatedInputs = node.input.map((input) => {
                    if (input.name === inputVariableName) {
                      console.log(
                        `Found matching input variable "${inputVariableName}" in node ${targetNodeId}, updating value`,
                      );
                      return { ...input, value: inputVariableValue };
                    }
                    return input;
                  });

                  console.log(
                    `Updated node ${targetNodeId} input "${inputVariableName}":`,
                    updatedInputs,
                  );
                  return { ...node, input: updatedInputs };
                }
                return node;
              }),
            }));
          },
          onSplitNode: (splitNodeId, new_plan) => {
            console.log(
              "[PlanDisplay] Split node - removing node:",
              splitNodeId,
            );
            console.log(
              "[PlanDisplay] Split node - new plan received:",
              new_plan,
            );

            // Process backend plan data
            const nodeList = new_plan.list_node || new_plan.nodes || [];
            const edgeList = new_plan.list_edge || new_plan.edges || [];

            const processedPlan = processPlanData(nodeList, edgeList);

            // Store all nodes to collect their positions later
            let allNodesForPositionUpdate = [];

            setPlanData((prev) => {
              // Step 1: Get the removed node for positioning context
              const removedNode = prev.nodes.find((n) => n.id === splitNodeId);
              console.log(
                `[PlanDisplay] Split node position: x=${removedNode?.x}, y=${removedNode?.y}`,
              );

              // Step 2: Remove the split node and its connected edges
              const nodesAfterRemoval = prev.nodes.filter(
                (n) => n.id !== splitNodeId,
              );
              const edgesAfterRemoval = prev.edges.filter(
                (e) => e.source !== splitNodeId && e.target !== splitNodeId,
              );

              // Step 3: Get existing node and edge IDs after removal
              const existingNodeIds = new Set(
                nodesAfterRemoval.map((n) => String(n.id)),
              );
              const existingEdgeIds = new Set(
                edgesAfterRemoval.map((e) => e.id),
              );

              // Step 4: Find new nodes and edges that don't exist in current plan
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

              console.log(
                `[PlanDisplay] Removed node ${splitNodeId}, adding ${newNodes.length} nodes and ${newEdges.length} edges`,
              );

              // Step 5: Apply smart layout for new nodes
              const removedNodes = removedNode ? [removedNode] : [];
              const allEdges = [...edgesAfterRemoval, ...newEdges];

              const { layoutedNodes, shiftedNodes } = applyTargetReplanLayout(
                nodesAfterRemoval,
                newNodes,
                removedNodes,
                allEdges,
              );

              console.log("[PlanDisplay] Applied split layout:", {
                layoutedNewNodes: layoutedNodes.length,
                shiftedExistingNodes: shiftedNodes.length,
              });

              // Store all nodes for position update
              const allNodes = [...shiftedNodes, ...layoutedNodes];
              allNodesForPositionUpdate = allNodes;

              // Step 6: Return updated plan with layouted new nodes and shifted existing nodes
              return {
                ...prev,
                nodes: allNodes,
                edges: allEdges,
              };
            });

            // Update all node positions in history after rendering
            if (allNodesForPositionUpdate.length > 0) {
              setTimeout(async () => {
                try {
                  const positions = {};
                  allNodesForPositionUpdate.forEach((node) => {
                    positions[node.id] = { x: node.x, y: node.y };
                  });
                  await sendUpdateNodePositions(sessionId, positions);
                  console.log(
                    `Updated positions for all ${allNodesForPositionUpdate.length} nodes in history after split`,
                  );
                } catch (error) {
                  console.error("Failed to update node positions:", error);
                }
              }, 100); // Small delay to ensure rendering is complete
            }

            // Clear selection if split node was selected
            if (selectedNode === splitNodeId) {
              setSelectedNode(null);
            }
          },
          onMergeNodes: (mergedNodeIds, new_plan) => {
            console.log(
              "[PlanDisplay] Merge nodes - removing nodes:",
              mergedNodeIds,
            );
            console.log(
              "[PlanDisplay] Merge nodes - new plan received:",
              new_plan,
            );

            // Process backend plan data
            const nodeList = new_plan.list_node || new_plan.nodes || [];
            const edgeList = new_plan.list_edge || new_plan.edges || [];

            const processedPlan = processPlanData(nodeList, edgeList);

            // Store new nodes to collect their positions later
            let newNodesForPositionUpdate = [];

            setPlanData((prev) => {
              // Step 1: Remove the merged nodes and their connected edges
              const nodesAfterRemoval = prev.nodes.filter(
                (n) => !mergedNodeIds.includes(n.id),
              );
              const edgesAfterRemoval = prev.edges.filter(
                (e) =>
                  !mergedNodeIds.includes(e.source) &&
                  !mergedNodeIds.includes(e.target),
              );

              // Step 2: Get existing node and edge IDs after removal
              const existingNodeIds = new Set(
                nodesAfterRemoval.map((n) => String(n.id)),
              );
              const existingEdgeIds = new Set(
                edgesAfterRemoval.map((e) => e.id),
              );

              // Step 3: Find new nodes and edges that don't exist in current plan
              const newNodes = processedPlan.nodes
                .filter((node) => !existingNodeIds.has(String(node.id)))
                .map((node) => ({
                  ...node,
                  isVariablesCollapsed: true,
                  isSelected: false, // Reset selection for new merged node
                }));

              const newEdges = processedPlan.edges.filter(
                (edge) => !existingEdgeIds.has(edge.id),
              );

              console.log(
                `[PlanDisplay] Removed ${mergedNodeIds.length} nodes, adding ${newNodes.length} nodes and ${newEdges.length} edges`,
              );

              // Store new nodes for position update
              newNodesForPositionUpdate = newNodes;

              // Step 4: Return updated plan with new nodes and edges added
              return {
                ...prev,
                nodes: [...nodesAfterRemoval, ...newNodes],
                edges: [...edgesAfterRemoval, ...newEdges],
              };
            });

            // Update node positions in history after rendering
            if (newNodesForPositionUpdate.length > 0) {
              setTimeout(async () => {
                try {
                  const positions = {};
                  newNodesForPositionUpdate.forEach((node) => {
                    positions[node.id] = { x: node.x, y: node.y };
                  });
                  await sendUpdateNodePositions(sessionId, positions);
                  console.log(
                    `Updated positions for ${newNodesForPositionUpdate.length} merged node(s) in history`,
                  );
                } catch (error) {
                  console.error("Failed to update node positions:", error);
                }
              }, 100); // Small delay to ensure rendering is complete
            }

            // Clear selection if any merged node was selected
            if (mergedNodeIds.includes(selectedNode)) {
              setSelectedNode(null);
            }
          },
          onUpdateEdges: (nodeId, oldVarName, newVarName, varType) => {
            console.log(
              `Updating edges for node ${nodeId}: ${oldVarName} -> ${newVarName} (${varType})`,
            );

            setPlanData((prev) => ({
              ...prev,
              edges: prev.edges.map((edge) => {
                // Update target handle if this is an input variable
                if (
                  varType === "input" &&
                  String(edge.target) === String(nodeId) &&
                  edge.targetHandle === oldVarName
                ) {
                  return { ...edge, targetHandle: newVarName };
                }
                // Update source handle if this is an output variable
                if (
                  varType === "output" &&
                  String(edge.source) === String(nodeId) &&
                  edge.sourceHandle === oldVarName
                ) {
                  return { ...edge, sourceHandle: newVarName };
                }
                return edge;
              }),
            }));
          },
          edges: planData?.edges || [],
        },
        style: {
          width: node.width || 200,
          height: node.height || 80,
        },
      })) || []
    );
  }, [planData?.nodes, setPlanData, sessionId, selectedNode, modelRegistry]);

  const initialEdges = useMemo(() => {
    // Filter edges to only include those whose handles exist on the current nodes
    const nodesById = new Map(
      (planData?.nodes || []).map((n) => [String(n.id), n]),
    );
    const edges = (planData?.edges || []).filter((edge) => {
      const src = nodesById.get(String(edge.source));
      const tgt = nodesById.get(String(edge.target));
      if (!src || !tgt) return false;
      const srcHandles = new Set((src.output || []).map((o) => o?.name));
      const tgtHandles = new Set((tgt.input || []).map((i) => i?.name));
      return (
        srcHandles.has(edge.sourceHandle) && tgtHandles.has(edge.targetHandle)
      );
    });

    return edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      type: edge.type || "default",
      animated: edge.animated || false,
      label: edge.label || "",
      pathOptions: { curvature: 0.25 },
    }));
  }, [planData?.edges, planData?.nodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [finalResults, setFinalResults] = useState([]);
  const [hasNewResults, setHasNewResults] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isForceMerging, setIsForceMerging] = useState(false);
  const [isAutoMerging, setIsAutoMerging] = useState(false);

  // Track z-index stacking order for nodes
  const zIndexCounter = useRef(1000);
  const nodeZIndexMap = useRef(new Map());

  // Handle node changes including position updates
  const handleNodesChange = useCallback(
    (changes) => {
      // Allow all changes including selection (for node elevation)
      // Note: This selection is separate from the checkbox-based selection (isSelected)
      onNodesChange(changes);

      // Update planData for position changes only
      changes.forEach(async (change) => {
        if (
          change.type === "position" &&
          change.position &&
          change.dragging === false
        ) {
          // Only update when dragging is finished
          const nodeId = change.id;
          const newPosition = change.position;

          // Get old position from planData to check if movement is significant
          const oldNode = planData.nodes.find(
            (node) => String(node.id) === String(nodeId),
          );
          if (oldNode) {
            const deltaX = Math.abs(newPosition.x - (oldNode.x || 0));
            const deltaY = Math.abs(newPosition.y - (oldNode.y || 0));
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            // Only record if movement is greater than 4 pixels (to ignore force rerender moves)
            if (distance <= 4) {
              console.log(
                `Node ${nodeId} movement too small (${distance.toFixed(4)}px), skipping snapshot`,
              );
              return; // Skip this change
            }
          }

          // Update the planData with new position
          setPlanData((prev) => ({
            ...prev,
            nodes: prev.nodes.map((node) =>
              String(node.id) === String(nodeId)
                ? { ...node, x: newPosition.x, y: newPosition.y }
                : node,
            ),
          }));

          console.log(`Node ${nodeId} moved to:`, newPosition);

          // Send move_node interaction to backend to capture new snapshot
          try {
            const { sendMoveNode } = await import("../services/backendApi");
            await sendMoveNode(sessionId, nodeId, newPosition);
            console.log(`Captured snapshot for node ${nodeId} move in history`);

            // Add invisible message to conversation history for workflow consistency
            if (setConversationHistory) {
              setConversationHistory((prev) => [
                ...prev,
                {
                  type: "invisible",
                  message: `Moved node ${nodeId} to position (${newPosition.x.toFixed(2)}, ${newPosition.y.toFixed(2)})`,
                  timestamp: new Date().toISOString(),
                },
              ]);
            }
          } catch (error) {
            console.error("Failed to capture move_node snapshot:", error);
          }
        }
      });
    },
    [onNodesChange, setPlanData, sessionId, planData.nodes],
  );

  // Update nodes and edges when planData changes
  useEffect(() => {
    // Preserve the current selection state and z-index when updating nodes
    setNodes((currentNodes) => {
      const currentSelection = new Map(
        currentNodes.map((n) => [n.id, n.selected]),
      );

      return initialNodes.map((node) => ({
        ...node,
        selected: currentSelection.get(node.id) || false,
        style: {
          ...node.style,
          zIndex: nodeZIndexMap.current.get(node.id) || 1,
        },
      }));
    });

    // Wait a frame or two for nodes to mount before setting edges
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEdges(initialEdges);
        console.log("[PlanDisplay] Nodes updated, edges synchronized");
      });
    });
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Note: We don't override React Flow's node selection state anymore
  // This allows elevateNodesOnSelect to work properly for bringing clicked nodes to front
  // The checkbox selection (isSelected) remains independent for merge/delete operations

  // Update React Flow's internal edge selection state for delete key functionality
  useEffect(() => {
    setEdges((currentEdges) =>
      currentEdges.map((edge) => ({
        ...edge,
        selected: selectedEdge === edge.id,
        style: {
          stroke:
            selectedEdge === edge.id
              ? "var(--bp-intent-success-rest)"
              : "var(--edge-color)",
          strokeWidth: selectedEdge === edge.id ? 5 : 2,
        },
        labelStyle: {
          fill:
            selectedEdge === edge.id
              ? "var(--bp-intent-success-rest)"
              : "var(--edge-color)",
          fontWeight: selectedEdge === edge.id ? "bold" : "normal",
        },
      })),
    );
  }, [selectedEdge, setEdges]);

  // Handle connection between nodes
  const onConnect = useCallback(
    async (params) => {
      console.log("Connection attempt:", params);

      // Restriction 1: Prevent connections within the same node
      if (params.source === params.target) {
        console.log(
          "Blocked: Cannot connect input and output within the same node",
        );
        alert("Cannot connect input and output variables within the same node");
        return;
      }

      // Restriction 2: Prevent multiple connections to the same input variable
      const existingConnectionToTarget = edges.find(
        (edge) =>
          edge.target === params.target &&
          edge.targetHandle === params.targetHandle,
      );

      if (existingConnectionToTarget) {
        console.log("Blocked: Input variable already has a connection");
        alert(
          `Input variable "${params.targetHandle}" already has a connection. Remove the existing connection first.`,
        );
        return;
      }

      // Call backend function to add edge before creating connection
      try {
        const result = await addEdgeToBackend(
          sessionId,
          params.source,
          params.target,
          params.sourceHandle,
          params.targetHandle,
          setConversationHistory,
        );
        if (result == "success") {
          console.log("Edge added successfully");
        } else {
          console.error("Failed to add edge:", result);
          alert(result);
          return;
        }
      } catch (error) {
        console.error("Failed to send edge to backend:", error);
        alert(error.message);
        return;
      }

      // If all validations pass, create the connection
      console.log("Connection allowed - creating edge");

      // Generate edge ID following the backend format (from planProcessor.js)
      const edgeId = `edge-${params.source}-${params.target}-${params.sourceHandle}-${params.targetHandle}`;

      // Update React Flow state
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "default",
            animated: true,
            style: {
              stroke: "var(--edge-color)",
              strokeWidth: 2,
            },
            labelStyle: {
              fill: "var(--edge-color)",
              fontWeight: "normal",
            },
            pathOptions: { curvature: 0.25 },
          },
          eds,
        ),
      );

      // Update planData state to reflect the new edge
      // Use the same format as convertBackendEdgeToUI in planProcessor.js
      setPlanData((prev) => ({
        ...prev,
        edges: [
          ...prev.edges,
          {
            id: edgeId,
            source: params.source,
            target: params.target,
            sourceHandle: params.sourceHandle,
            targetHandle: params.targetHandle,
            type: "default",
            animated: true,
            pathOptions: { curvature: 0.25 },
          },
        ],
      }));
    },
    [setEdges, edges, sessionId, setPlanData],
  );

  // Handle node click - bring to front with increasing z-index
  const onNodeClick = useCallback(
    (_event, node) => {
      console.log("Node clicked:", node.id);

      // Assign a new z-index to bring this node to the front
      zIndexCounter.current += 1;
      nodeZIndexMap.current.set(node.id, zIndexCounter.current);

      console.log(`Node ${node.id} z-index: ${zIndexCounter.current}`);

      // Update nodes with new z-index
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          style: {
            ...n.style,
            zIndex: nodeZIndexMap.current.get(n.id) || 1,
          },
          selected: n.id === node.id,
        })),
      );
    },
    [setNodes],
  );

  // Handle edge click
  const onEdgeClick = useCallback(
    (event, edge) => {
      event.stopPropagation();
      console.log("Edge clicked:", edge.id);
      if (onEdgeSelect) {
        onEdgeSelect(edge.id);
      }
    },
    [onEdgeSelect],
  );

  // Use add node function from uiInteraction
  const handleAddNode = useCallback(async () => {
    await addNode(
      planData,
      setPlanData,
      setSelectedNode,
      sessionId,
      setConversationHistory,
    );
  }, [
    planData,
    setPlanData,
    setSelectedNode,
    sessionId,
    setConversationHistory,
  ]);

  // Execute a single node by ID
  const executeSingleNode = useCallback(
    async (nodeId, suppressMessage = false, skipSnapshot = false) => {
      // Get the latest node data at execution time to avoid stale closure
      const getCurrentNode = () => planData.nodes.find((n) => n.id === nodeId);

      let node = getCurrentNode();
      console.log(planData.nodes);
      if (!node) {
        console.error(`Node ${nodeId} not found`);
        return { status: "error", message: `Node ${nodeId} not found` };
      }

      console.log(
        `Executing node ${node.id}: ${node.task || node.description}`,
      );

      // Set loading state - will be updated later with results
      setPlanData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, executionStatus: "loading" } : n,
        ),
      }));

      // Get fresh node data after setting loading state
      node = getCurrentNode();
      if (!node) {
        console.error(`Node ${nodeId} not found after loading state update`);
        return { status: "error", message: `Node ${nodeId} not found` };
      }

      // Prepare input variables
      const inputVariables = {};
      (node.input || []).forEach((input, index) => {
        const key = input.name || `input_${index}`;
        inputVariables[key] = input.value || "";
      });

      // Prepare output variables
      const outputVariables = {};
      (node.output || []).forEach((output, index) => {
        const key = output.name || `output_${index}`;
        outputVariables[key] = output.value || "";
      });

      const executionData = {
        agent_name: node.agent_name || "commonsense",
        task_description: node.task || node.description || "",
        input_variables: inputVariables,
        output_variables: outputVariables,
      };

      // Execute individual node
      const execution_result = await executeTask(
        sessionId,
        node.id,
        executionData,
        setConversationHistory,
        suppressMessage,
        skipSnapshot,
      );

      if (execution_result && execution_result.status === "completed") {
        console.log(`✅ Node ${node.id} executed successfully`);

        // Consolidate all updates into a single setPlanData call
        let boolInvalidValue = false;

        // Check for invalid values if output_values exist
        if (execution_result.output_values) {
          console.log(
            `Updating outputs for node ${node.id}:`,
            execution_result.output_values,
          );

          for (let value of Object.values(execution_result.output_values)) {
            if (value === "None" || value === null || value === "") {
              boolInvalidValue = true;
            }
          }
        }

        // Single setPlanData call that updates both execution status and output values
        setPlanData((prev) => {
          console.log(
            `[PlanDisplay] Before update - node ${nodeId} outputs:`,
            prev.nodes.find((n) => n.id === nodeId)?.output,
          );

          const updated = {
            ...prev,
            nodes: prev.nodes.map((n) => {
              if (n.id === nodeId) {
                let updatedNode = {
                  ...n,
                  executionStatus: boolInvalidValue ? "none" : "success",
                  isVariablesCollapsed: false, // Expand variables section after execution
                };

                // Update output values if available
                if (execution_result.output_values) {
                  const updatedOutputs = (n.output || []).map((output) => {
                    if (
                      execution_result.output_values.hasOwnProperty(output.name)
                    ) {
                      console.log(
                        `[PlanDisplay] Updating output "${output.name}" from "${output.value}" to "${execution_result.output_values[output.name]}"`,
                      );
                      return {
                        ...output,
                        value: execution_result.output_values[output.name],
                        isValid: true,
                      };
                    }
                    return output;
                  });
                  updatedNode.output = updatedOutputs;
                  console.log(
                    `[PlanDisplay] After update - node ${nodeId} outputs:`,
                    updatedOutputs,
                  );
                }

                // Update execution log if available
                if (execution_result.execution_log) {
                  updatedNode.execution_log = execution_result.execution_log;
                  console.log(
                    `[PlanDisplay] Updated execution log for node ${nodeId}`,
                  );
                }

                return updatedNode;
              }
              return n;
            }),
          };

          console.log(`[PlanDisplay] setPlanData called for node ${nodeId}`);
          return updated;
        });

        // Note: Component state will be updated automatically via useEffect when data.output changes

        // Update input values for other nodes if provided
        if (execution_result.input_values) {
          Object.keys(execution_result.input_values).forEach((targetNodeId) => {
            const nodeInputValues = execution_result.input_values[targetNodeId];
            console.log(
              `Updating inputs for node ${targetNodeId}:`,
              nodeInputValues,
            );

            // Use setPlanData to update input values
            setPlanData((prev) => ({
              ...prev,
              nodes: prev.nodes.map((node) => {
                if (node.id === targetNodeId) {
                  const updatedInputs = (node.input || []).map((input) => {
                    if (nodeInputValues.hasOwnProperty(input.name)) {
                      console.log(
                        `[PlanDisplay] Updating input "${input.name}" from "${input.value}" to "${nodeInputValues[input.name]}"`,
                      );
                      return {
                        ...input,
                        value: nodeInputValues[input.name],
                        isValid: true,
                      };
                    }
                    return input;
                  });
                  return { ...node, input: updatedInputs };
                }
                return node;
              }),
            }));
          });
        }

        // After execution, update positions in the latest snapshot
        // Get current positions from React Flow nodes
        const currentPositions = {};
        nodes.forEach((rfNode) => {
          currentPositions[rfNode.id] = {
            x: rfNode.position.x,
            y: rfNode.position.y,
          };
        });

        // Send positions to backend to update latest snapshot
        try {
          const { sendUpdateNodePositions } =
            await import("../services/backendApi");
          await sendUpdateNodePositions(sessionId, currentPositions);
          console.log(
            `Updated positions in latest snapshot after node ${nodeId} execution`,
          );
        } catch (error) {
          console.error("Failed to update positions after execution:", error);
        }
      } else {
        const errorMsg = execution_result?.message || "Unknown error";
        console.error(`❌ Node ${node.id} execution failed:`, errorMsg);

        // Set error state
        setPlanData((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === nodeId ? { ...n, executionStatus: "error" } : n,
          ),
        }));
      }

      return execution_result;
    },
    [
      sessionId,
      planData,
      setPlanData,
      onUpdateOtherNodeOutputs,
      onUpdateOtherNodeInputs,
      nodes,
    ],
  );

  // Function to collect final results (output variables without outgoing edges)
  const collectFinalResults = useCallback(() => {
    const results = [];
    console.log("all node", planData.nodes);
    planData.nodes.forEach((node) => {
      if (node.output && node.output.length > 0) {
        node.output.forEach((output) => {
          // Check if this output variable has an outgoing edge
          const hasOutgoingEdge = planData.edges.some(
            (edge) =>
              edge.source === node.id && edge.sourceHandle === output.name,
          );

          // If no outgoing edge, it's a final result
          if (!hasOutgoingEdge) {
            console.log(output);
            results.push({
              nodeId: node.id,
              nodeLabel: node.id,
              variableName: output.name,
              variableValue: output.value,
            });
          }
        });
      }
    });

    setFinalResults(results);
    console.log("Final results collected:", results);
  }, [planData]);

  // Handle execute all nodes - execute each node individually
  const handleExecuteAllNodes = useCallback(async () => {
    console.log("Executing all nodes individually in plan");

    if (!planData.nodes || planData.nodes.length === 0) {
      alert("No nodes to execute");
      return;
    }

    // Generate unique message ID for this execution
    const messageId = `execute_all_nodes_${Date.now()}`;
    const executedNodesWithResults = [];

    // Add initial loading message
    if (setConversationHistory) {
      addUserInteractionToConversation(
        "execute_all_nodes",
        { status: "loading", messageId },
        setConversationHistory,
        sessionId,
        addConversationMessage,
      ).catch((err) => console.error("Error adding loading message:", err));
    }

    // Set executing state to disable button
    setIsExecuting(true);

    // Clear all execution statuses before starting
    setPlanData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => ({ ...n, executionStatus: null })),
    }));

    // Clear previous final results
    setFinalResults([]);
    setHasNewResults(false);

    try {
      // send for the topolgical order
      const topologicalOrder = await getTopologicalOrder(sessionId);

      // Execute each node one by one with skipSnapshot=true
      for (const nodeID of topologicalOrder) {
        // Update message to show current progress
        if (setConversationHistory) {
          updateUserInteractionMessage(
            messageId,
            "execute_all_nodes",
            {
              status: "executing",
              executedNodesWithResults: [...executedNodesWithResults],
              currentNode: nodeID,
              messageId,
            },
            setConversationHistory,
            sessionId,
            addConversationMessage,
          ).catch((err) => console.error("Error updating message:", err));
        }

        // Skip individual snapshots during batch execution
        const execution_result = await executeSingleNode(
          nodeID.toString(),
          true,
          true,
        ); // suppressMessage=true, skipSnapshot=true

        if (!execution_result || execution_result.status !== "completed") {
          const errorMsg = execution_result?.message || "Unknown error";
          alert(`❌ Node ${nodeID} execution failed: ${errorMsg}`);
          break; // Stop execution on first failure
        }

        // Add to executed nodes list with output values
        const nodeResult = {
          nodeId: nodeID,
          outputValues: execution_result.output_values || {},
        };
        executedNodesWithResults.push(nodeResult);
      }

      console.log("✅ All nodes executed individually!");

      // Capture a single snapshot for all executed nodes
      try {
        const { sendCaptureExecuteAllSnapshot } =
          await import("../services/backendApi");
        await sendCaptureExecuteAllSnapshot(sessionId, topologicalOrder);
        console.log(
          `Captured single snapshot for ${topologicalOrder.length} executed nodes`,
        );

        // Update undo/redo status immediately after snapshot capture
        await updateUndoRedoStatus();
      } catch (error) {
        console.error("Failed to capture execute all snapshot:", error);
      }

      // Update node positions before capturing snapshot
      try {
        // Get current positions from React Flow nodes
        const currentPositions = {};
        nodes.forEach((rfNode) => {
          currentPositions[rfNode.id] = {
            x: rfNode.position.x,
            y: rfNode.position.y,
          };
        });

        // Send positions to backend to update before snapshot
        const { sendUpdateNodePositions } =
          await import("../services/backendApi");
        await sendUpdateNodePositions(sessionId, currentPositions);
        console.log(
          `Updated positions for ${Object.keys(currentPositions).length} nodes before capturing snapshot`,
        );
      } catch (error) {
        console.error("Failed to update positions before snapshot:", error);
      }

      // Collect final results after all executions complete
      // Use ref to get fresh planData and avoid stale closure
      setTimeout(() => {
        const currentPlanData = planDataRef.current;
        const results = [];
        console.log("all node (fresh)", currentPlanData.nodes);
        currentPlanData.nodes.forEach((node) => {
          if (node.output && node.output.length > 0) {
            node.output.forEach((output) => {
              // Check if this output variable has an outgoing edge
              const hasOutgoingEdge = currentPlanData.edges.some(
                (edge) =>
                  edge.source === node.id && edge.sourceHandle === output.name,
              );

              // If no outgoing edge, it's a final result
              if (!hasOutgoingEdge) {
                console.log("Final result output:", output);
                results.push({
                  nodeId: node.id,
                  nodeLabel: node.id,
                  variableName: output.name,
                  variableValue: output.value,
                });
              }
            });
          }
        });

        setFinalResults(results);
        setHasNewResults(results.length > 0);
        console.log("Final results collected (fresh):", results);

        // Update message to show completion with final results
        if (setConversationHistory) {
          updateUserInteractionMessage(
            messageId,
            "execute_all_nodes",
            {
              status: "completed",
              executedNodesWithResults: executedNodesWithResults,
              totalNodes: executedNodesWithResults.length,
              finalResults: results,
              messageId,
            },
            setConversationHistory,
            sessionId,
            addConversationMessage,
          ).catch((err) =>
            console.error("Error updating completion message:", err),
          );
        }

        // Manually trigger expand all after execution completes
        toggleAllVariablesCollapse(false);
        console.log("Expanded all nodes after execution");
      }, 500); // Increased delay to ensure last node's edge re-render (500ms) completes first
    } catch (error) {
      console.error("Error executing nodes individually:", error);
      alert(`❌ Error executing nodes: ${error.message}`);
    } finally {
      // Re-enable button after execution completes (success or failure)
      setIsExecuting(false);
    }
  }, [sessionId, planData, executeSingleNode, collectFinalResults]);

  // Handle edge deletion (triggered by Delete key or programmatically)
  const onEdgesDelete = useCallback(
    async (edgesToDelete) => {
      console.log("Deleting edges:", edgesToDelete);

      for (const edge of edgesToDelete) {
        try {
          // Call backend to remove edge
          const result = await removeEdgeFromBackend(
            sessionId,
            edge.source,
            edge.target,
            edge.sourceHandle,
            edge.targetHandle,
            setConversationHistory,
          );
          console.log("Backend remove edge result:", result);
          if (result == "success") {
            // Remove edge from planData (source of truth)
            setPlanData((prev) => ({
              ...prev,
              edges: prev.edges.filter((e) => e.id !== edge.id),
            }));

            // Also remove from React Flow state
            setEdges((eds) => eds.filter((e) => e.id !== edge.id));

            console.log(`Successfully removed edge ${edge.id}`);
          } else {
            console.error("Failed to remove edge:", result);
            alert(
              `Failed to remove edge: ${result.message || "Unknown error"}`,
            );
          }
        } catch (error) {
          console.error("Failed to remove edge:", error);
        }
      }
    },
    [sessionId, setPlanData, setEdges, setConversationHistory],
  );

  // Handle node deletion (triggered by Delete key or programmatically)
  const onNodesDelete = useCallback(
    async (nodesToDelete) => {
      console.log("Deleting nodes:", nodesToDelete);

      for (const node of nodesToDelete) {
        try {
          // Call backend to remove node (backend handles edge deletion automatically)
          const result = await removeNode(
            sessionId,
            parseInt(node.id),
            setConversationHistory,
          );
          console.log("Backend remove node result:", result);

          if (result.status === "success") {
            // Remove node from local state
            setPlanData((prevPlan) => ({
              ...prevPlan,
              nodes: prevPlan.nodes.filter((n) => n.id !== node.id),
              // Also remove any edges connected to this node from frontend
              edges: prevPlan.edges.filter(
                (e) => e.source !== node.id && e.target !== node.id,
              ),
            }));

            // Also remove from React Flow edges state to prevent React Flow from trying to delete them
            setEdges((eds) =>
              eds.filter((e) => e.source !== node.id && e.target !== node.id),
            );

            // Clear selected node if it was the deleted one
            if (selectedNode?.id === node.id) {
              setSelectedNode(null);
            }

            console.log(
              `Successfully removed node ${node.id} and its connected edges`,
            );
          } else {
            console.error("Backend failed to remove node:", result);
            alert(
              `Failed to remove node: ${result.message || "Unknown error"}`,
            );
          }
        } catch (error) {
          console.error("Failed to remove node:", error);
          alert(`Error removing node: ${error.message}`);
        }
      }
    },
    [
      sessionId,
      setPlanData,
      selectedNode,
      setSelectedNode,
      setEdges,
      setConversationHistory,
    ],
  );

  // Force edge re-render by moving each node 1px left and back
  // This triggers React Flow's edge recalculation mechanism
  const forceEdgeRerender = useCallback(() => {
    // Step 1: Move all nodes 1px left
    setNodes((currentNodes) => {
      return currentNodes.map((node) => ({
        ...node,
        position: {
          x: node.position.x - 1,
          y: node.position.y,
        },
      }));
    });

    setNodes((currentNodes) => {
      return currentNodes.map((node) => ({
        ...node,
        position: {
          x: node.position.x,
          y: node.position.y - 1,
        },
      }));
    });

    // Step 2: Wait for React Flow to process, then move back
    setTimeout(() => {
      setNodes((currentNodes) => {
        return currentNodes.map((node) => ({
          ...node,
          position: {
            x: node.position.x + 1,
            y: node.position.y + 1,
          },
        }));
      });
    }, 100);
  }, [setNodes]);

  // Expose forceEdgeRerender to parent component
  useEffect(() => {
    if (onForceEdgeRerender) {
      onForceEdgeRerender(forceEdgeRerender);
    }
  }, [forceEdgeRerender, onForceEdgeRerender]);

  // Function to update undo/redo status
  const updateUndoRedoStatus = useCallback(async () => {
    try {
      const response = await sendGetUndoRedoStatus(sessionId);
      if (response.status === "success") {
        setCanUndo(response.can_undo);
        setCanRedo(response.can_redo);
      }
    } catch (error) {
      console.error("Failed to get undo/redo status:", error);
    }
  }, [sessionId]);

  // Function to sync plan data with backend response (for undo/redo)
  const syncPlanDataWithBackend = useCallback(
    (backendPlan) => {
      console.log("[Undo/Redo] Backend plan:", backendPlan);

      // Save current UI-only state (collapse states) before syncing
      const currentCollapseStates = {};
      planData.nodes.forEach((node) => {
        currentCollapseStates[node.id] = {
          isVariablesCollapsed: node.isVariablesCollapsed,
          isLogCollapsed: node.isLogCollapsed,
        };
      });

      // Use the same processPlanData function that's used for plan generation
      // Backend returns: { nodes: [...], edges: [...] } with backend format
      const nodeList = backendPlan.nodes || [];
      const edgeList = backendPlan.edges || [];

      // Convert backend format to UI format (same as in plan generation)
      const processedPlan = processPlanData(nodeList, edgeList);

      console.log("[Undo/Redo] Processed plan:", processedPlan);

      // Restore UI-only state (collapse states) for nodes that existed before
      const updatedNodes = processedPlan.nodes.map((node) => {
        const savedState = currentCollapseStates[node.id];
        return {
          ...node,
          isSelected: false, // Reset selection
          // Preserve collapse states if node existed before, otherwise use defaults (collapsed=true for variables, collapsed=true for logs)
          isVariablesCollapsed: savedState
            ? savedState.isVariablesCollapsed
            : true,
          isLogCollapsed: savedState ? savedState.isLogCollapsed : true,
        };
      });

      const updatedEdges = processedPlan.edges;

      // STEP 1: Update planData state (source of truth)
      setPlanData({
        nodes: updatedNodes,
        edges: updatedEdges,
      });

      // STEP 2: Manually sync React Flow state (since useNodesState/useEdgesState don't auto-update)
      // Convert to React Flow format (same as initialNodes/initialEdges useMemo)
      const reactFlowNodes = updatedNodes.map((node) => ({
        id: String(node.id),
        type: "customTask",
        position: { x: node.x || 0, y: node.y || 0 },
        draggable: true,
        selectable: true,
        data: {
          label: node.id || "Untitled Node",
          description: node.task,
          agent_name: node.agent_name,
          input: node.input || [],
          output: node.output || [],
          isVariablesCollapsed: node.isVariablesCollapsed || false,
          isLogCollapsed:
            node.isLogCollapsed !== undefined ? node.isLogCollapsed : true,
          execution_log: node.execution_log || "",
          selected: false,
          isSelected: node.isSelected || false,
          sessionId: sessionId,
          executionStatus: node.executionStatus || null,
          modelName: node.modelName || "gpt-4o-mini",
          temperature: node.temperature !== undefined ? node.temperature : 0,
          modelRegistry: modelRegistry,
          nodes: updatedNodes,
          edges: updatedEdges,
          onNodeSelect: onNodeSelect,
          setConversationHistory: setConversationHistory,
          onUpdateNode: (nodeId, updatedData) => {
            setPlanData((prev) => ({
              ...prev,
              nodes: prev.nodes.map((n) =>
                n.id === nodeId ? { ...n, ...updatedData } : n,
              ),
            }));
          },
          onRemoveNode: (nodeId) => {
            setPlanData((prev) => ({
              ...prev,
              nodes: prev.nodes.filter((n) => n.id !== nodeId),
              edges: prev.edges.filter(
                (e) => e.source !== nodeId && e.target !== nodeId,
              ),
            }));
          },
          onUpdateOtherNodeOutputs: onUpdateOtherNodeOutputs,
          onUpdateOtherNodeInputs: onUpdateOtherNodeInputs,
        },
      }));

      const reactFlowEdges = updatedEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
        type: edge.type || "default",
        animated: edge.animated || false,
        label: edge.label || "",
        pathOptions: { curvature: 0.25 },
      }));

      // Update nodes first
      setNodes(reactFlowNodes);
      setTimeout(() => {
        console.log("Nodes updated and wait 200ms before setting edges");
      }, 200);
      // Give nodes a tick to mount before wiring edges
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setEdges(reactFlowEdges);
          console.log("[Undo/Redo] Nodes updated, edges synchronized");
        });
      });
    },
    [
      setPlanData,
      setNodes,
      setEdges,
      sessionId,
      onNodeSelect,
      setConversationHistory,
      onUpdateOtherNodeOutputs,
      onUpdateOtherNodeInputs,
      planData.nodes,
    ],
  );

  // Undo handler
  const handleUndo = useCallback(async () => {
    console.log("Undo action triggered");
    try {
      const response = await sendUndo(sessionId);
      if (response.status === "success") {
        // Sync plan data with backend, checking for edge differences
        console.log("Undo test", response.plan);
        syncPlanDataWithBackend(response.plan);

        // Update undo/redo button states
        setCanUndo(response.can_undo);
        setCanRedo(response.can_redo);

        // Add undo message to conversation history
        if (setConversationHistory && response.action_summary) {
          setConversationHistory((prev) => [
            ...prev,
            {
              type: "user_interaction",
              message: `Undo: "${response.action_summary}"`,
              timestamp: new Date().toISOString(),
            },
          ]);
        }

        console.log("Undo successful");
      } else {
        console.warn("Undo failed:", response.message);
      }
    } catch (error) {
      console.error("Failed to undo:", error);
    }
  }, [sessionId, syncPlanDataWithBackend, setConversationHistory]);

  // Redo handler
  const handleRedo = useCallback(async () => {
    console.log("Redo action triggered");
    try {
      const response = await sendRedo(sessionId);
      if (response.status === "success") {
        // Sync plan data with backend, checking for edge differences
        console.log("Redo test", response.plan);

        syncPlanDataWithBackend(response.plan);

        // Update undo/redo button states
        setCanUndo(response.can_undo);
        setCanRedo(response.can_redo);

        // Add redo message to conversation history
        if (setConversationHistory && response.action_summary) {
          setConversationHistory((prev) => [
            ...prev,
            {
              type: "user_interaction",
              message: `Redo: "${response.action_summary}"`,
              timestamp: new Date().toISOString(),
            },
          ]);
        }

        console.log("Redo successful");
      } else {
        console.warn("Redo failed:", response.message);
      }
    } catch (error) {
      console.error("Failed to redo:", error);
    }
  }, [sessionId, syncPlanDataWithBackend, setConversationHistory]);

  // Update undo/redo status when planData changes (after interactions/feedback)
  useEffect(() => {
    // Only update if we have a session
    if (sessionId) {
      updateUndoRedoStatus();
    }
  }, [planData.nodes, planData.edges, sessionId, updateUndoRedoStatus]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Check for Ctrl (Windows/Linux) or Cmd (Mac)
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;

      // Undo: Ctrl+Z or Cmd+Z
      if (isCtrlOrCmd && event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (canUndo) {
          handleUndo();
        }
      }
      // Redo: Ctrl+Shift+Z or Cmd+Shift+Z
      else if (isCtrlOrCmd && event.key === "z" && event.shiftKey) {
        event.preventDefault();
        if (canRedo) {
          handleRedo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleUndo, handleRedo, canUndo, canRedo]);

  // Function to collapse/uncollapse all variables in all nodes
  const toggleAllVariablesCollapse = useCallback(
    (shouldCollapse) => {
      setPlanData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => ({
          ...node,
          isVariablesCollapsed: shouldCollapse,
        })),
      }));

      // Manually update React Flow nodes to trigger dimension recalculation
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            isVariablesCollapsed: shouldCollapse,
          },
        })),
      );

      // No explicit internals update here; CustomTaskNode handles it on collapse change
    },
    [setPlanData, setNodes],
  );

  // Function to select all nodes
  const handleSelectAllNodes = useCallback(() => {
    setPlanData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => ({
        ...node,
        isSelected: true,
      })),
    }));
    console.log("Selected all nodes");
  }, [setPlanData]);

  // Function to deselect all nodes
  const handleDeselectAllNodes = useCallback(() => {
    setPlanData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => ({
        ...node,
        isSelected: false,
      })),
    }));
    console.log("Deselected all nodes");
  }, [setPlanData]);

  // Function to calculate center position of selected nodes
  const calculateCenterPosition = useCallback(
    (selectedNodeIds) => {
      // Get positions from React Flow nodes (which have the most up-to-date positions including drags)
      const selectedNodesData = nodes.filter((n) =>
        selectedNodeIds.includes(n.id),
      );
      let centerX = 0;
      let centerY = 0;

      if (selectedNodesData.length > 0) {
        selectedNodesData.forEach((node) => {
          centerX += node.position?.x || 0;
          centerY += node.position?.y || 0;
        });
        centerX = centerX / selectedNodesData.length;
        centerY = centerY / selectedNodesData.length;
      }

      console.log(
        "[calculateCenterPosition] Selected nodes:",
        selectedNodesData.map((n) => ({
          id: n.id,
          x: n.position?.x,
          y: n.position?.y,
        })),
      );
      console.log("[calculateCenterPosition] Center:", {
        x: centerX,
        y: centerY,
      });

      return { x: centerX, y: centerY };
    },
    [nodes],
  );

  // Function to merge selected nodes (regular merge)
  const handleMergeSelectedNodes = useCallback(async () => {
    console.log("Regular merge selected nodes");

    // Collect all selected nodes
    const selectedNodes = planData.nodes.filter(
      (node) => node.isSelected === true,
    );
    const selectedNodeIds = selectedNodes.map((node) => node.id);

    console.log("Selected nodes for merge:", selectedNodeIds);

    if (selectedNodeIds.length < 2) {
      alert("Please select at least 2 nodes to merge");
      return;
    }

    // Check if nodes are mergeable
    const mergeable = await checkNodesMergeable(sessionId, selectedNodeIds);

    if (!mergeable) {
      alert(
        "Nodes are not mergeable!\nPlease double check on the selected nodes!",
      );
      return;
    }

    setIsForceMerging(true);
    try {
      // Calculate center position before merge
      const centerPosition = calculateCenterPosition(selectedNodeIds);

      // Get all edges connected to the selected nodes
      const connectedEdges =
        planData.edges?.filter(
          (edge) =>
            selectedNodeIds.includes(String(edge.source)) ||
            selectedNodeIds.includes(String(edge.target)),
        ) || [];
      console.log("Connected edges:", connectedEdges);

      // Force merge backend call
      const forceMergeResult = await forceMergeNodes(
        sessionId,
        selectedNodeIds,
        connectedEdges,
      );
      console.log("Force merge result:", forceMergeResult);

      if (forceMergeResult.status === "completed") {
        // Process backend plan data
        const nodeList =
          forceMergeResult.plan.list_node || forceMergeResult.plan.nodes || [];
        const edgeList =
          forceMergeResult.plan.list_edge || forceMergeResult.plan.edges || [];

        const processedPlan = processPlanData(nodeList, edgeList);

        let mergedNodeId = null;

        setPlanData((prev) => {
          // Step 1: Remove the merged nodes and their connected edges
          const nodesAfterRemoval = prev.nodes.filter(
            (n) => !selectedNodeIds.includes(n.id),
          );
          const edgesAfterRemoval = prev.edges.filter(
            (e) =>
              !selectedNodeIds.includes(e.source) &&
              !selectedNodeIds.includes(e.target),
          );

          // Step 2: Get existing node and edge IDs after removal
          const existingNodeIds = new Set(
            nodesAfterRemoval.map((n) => String(n.id)),
          );
          const existingEdgeIds = new Set(edgesAfterRemoval.map((e) => e.id));

          // Step 3: Find new nodes and edges that don't exist in current plan
          const newNodes = processedPlan.nodes
            .filter((node) => !existingNodeIds.has(String(node.id)))
            .map((node) => ({
              ...node,
              x: centerPosition.x, // Use calculated center position
              y: centerPosition.y,
              isVariablesCollapsed: true,
              isSelected: false,
            }));

          // Store the merged node ID for position update
          if (newNodes.length > 0) {
            mergedNodeId = newNodes[0].id;
          }

          const newEdges = processedPlan.edges.filter(
            (edge) => !existingEdgeIds.has(edge.id),
          );

          console.log(
            `[PlanDisplay] Removed ${selectedNodeIds.length} nodes, adding ${newNodes.length} nodes and ${newEdges.length} edges`,
          );
          console.log(
            `[PlanDisplay] Merged node ${mergedNodeId} positioned at (${centerPosition.x}, ${centerPosition.y})`,
          );

          // Step 4: Return updated plan with new nodes and edges added
          return {
            ...prev,
            nodes: [...nodesAfterRemoval, ...newNodes],
            edges: [...edgesAfterRemoval, ...newEdges],
          };
        });

        // Update node positions in history after rendering - send ALL node positions
        setTimeout(async () => {
          try {
            const positions = {};
            // Get current positions from React Flow nodes for existing nodes
            nodes.forEach((rfNode) => {
              positions[rfNode.id] = {
                x: rfNode.position.x,
                y: rfNode.position.y,
              };
            });

            // Explicitly set the merged node's position to our calculated center
            if (mergedNodeId) {
              positions[mergedNodeId] = {
                x: centerPosition.x,
                y: centerPosition.y,
              };
              console.log(
                `[PlanDisplay] Explicitly setting merged node ${mergedNodeId} position to (${centerPosition.x}, ${centerPosition.y})`,
              );
            }

            await sendUpdateNodePositions(sessionId, positions);
            console.log(
              `Updated positions for all nodes after merge (${Object.keys(positions).length} nodes)`,
            );
          } catch (error) {
            console.error("Failed to update node positions:", error);
          }
        }, 100);

        // Extract new merged node ID
        const newNodeIds = (forceMergeResult.plan.nodes || [])
          .map((node) => String(node.id))
          .filter(
            (nodeId) => !planData.nodes.some((n) => String(n.id) === nodeId),
          );
        const newNodeId = newNodeIds.length > 0 ? newNodeIds[0] : null;

        // Log user interaction
        if (setConversationHistory) {
          await addUserInteractionToConversation(
            "force_merge_nodes",
            { nodeIds: selectedNodeIds, newNodeId },
            setConversationHistory,
            sessionId,
            addConversationMessage,
          );
        }

        // Clear selection
        if (selectedNodeIds.includes(selectedNode)) {
          setSelectedNode(null);
        }
      } else {
        alert(`Regular merge failed!\n${forceMergeResult}`);
      }
    } finally {
      setIsForceMerging(false);
    }
  }, [
    sessionId,
    planData,
    setPlanData,
    setConversationHistory,
    selectedNode,
    setSelectedNode,
    calculateCenterPosition,
    nodes,
  ]);

  // Function to auto merge selected nodes
  const handleAutoMergeSelectedNodes = useCallback(async () => {
    console.log("Auto merge selected nodes");

    // Collect all selected nodes
    const selectedNodes = planData.nodes.filter(
      (node) => node.isSelected === true,
    );
    const selectedNodeIds = selectedNodes.map((node) => node.id);

    console.log("Selected nodes for auto merge:", selectedNodeIds);

    if (selectedNodeIds.length < 2) {
      alert("Please select at least 2 nodes to merge");
      return;
    }

    // Check if nodes are mergeable
    const mergeable = await checkNodesMergeable(sessionId, selectedNodeIds);

    if (!mergeable) {
      alert(
        "Nodes are not mergeable!\nPlease double check on the selected nodes!",
      );
      return;
    }

    setIsAutoMerging(true);
    try {
      // Calculate center position before merge
      const centerPosition = calculateCenterPosition(selectedNodeIds);

      // Get all edges connected to the selected nodes
      const connectedEdges =
        planData.edges?.filter(
          (edge) =>
            selectedNodeIds.includes(String(edge.source)) ||
            selectedNodeIds.includes(String(edge.target)),
        ) || [];
      console.log("Connected edges:", connectedEdges);

      // Auto merge backend call
      const autoMergeResult = await autoMergeNodes(
        sessionId,
        selectedNodeIds,
        connectedEdges,
      );
      console.log("Auto merge result:", autoMergeResult);

      if (autoMergeResult.status === "completed") {
        // Process backend plan data
        const nodeList =
          autoMergeResult.plan.list_node || autoMergeResult.plan.nodes || [];
        const edgeList =
          autoMergeResult.plan.list_edge || autoMergeResult.plan.edges || [];

        const processedPlan = processPlanData(nodeList, edgeList);

        let mergedNodeId = null;

        setPlanData((prev) => {
          // Step 1: Remove the merged nodes and their connected edges
          const nodesAfterRemoval = prev.nodes.filter(
            (n) => !selectedNodeIds.includes(n.id),
          );
          const edgesAfterRemoval = prev.edges.filter(
            (e) =>
              !selectedNodeIds.includes(e.source) &&
              !selectedNodeIds.includes(e.target),
          );

          // Step 2: Get existing node and edge IDs after removal
          const existingNodeIds = new Set(
            nodesAfterRemoval.map((n) => String(n.id)),
          );
          const existingEdgeIds = new Set(edgesAfterRemoval.map((e) => e.id));

          // Step 3: Find new nodes and edges that don't exist in current plan
          const newNodes = processedPlan.nodes
            .filter((node) => !existingNodeIds.has(String(node.id)))
            .map((node) => ({
              ...node,
              x: centerPosition.x, // Use calculated center position
              y: centerPosition.y,
              isVariablesCollapsed: true,
              isSelected: false,
            }));

          // Store the merged node ID for position update
          if (newNodes.length > 0) {
            mergedNodeId = newNodes[0].id;
          }

          const newEdges = processedPlan.edges.filter(
            (edge) => !existingEdgeIds.has(edge.id),
          );

          console.log(
            `[PlanDisplay] Auto merge - Removed ${selectedNodeIds.length} nodes, adding ${newNodes.length} nodes and ${newEdges.length} edges`,
          );
          console.log(
            `[PlanDisplay] Auto merged node ${mergedNodeId} positioned at (${centerPosition.x}, ${centerPosition.y})`,
          );

          // Step 4: Return updated plan with new nodes and edges added
          return {
            ...prev,
            nodes: [...nodesAfterRemoval, ...newNodes],
            edges: [...edgesAfterRemoval, ...newEdges],
          };
        });

        // Update node positions in history after rendering - send ALL node positions
        setTimeout(async () => {
          try {
            const positions = {};
            // Get current positions from React Flow nodes for existing nodes
            nodes.forEach((rfNode) => {
              positions[rfNode.id] = {
                x: rfNode.position.x,
                y: rfNode.position.y,
              };
            });

            // Explicitly set the merged node's position to our calculated center
            if (mergedNodeId) {
              positions[mergedNodeId] = {
                x: centerPosition.x,
                y: centerPosition.y,
              };
              console.log(
                `[PlanDisplay] Explicitly setting auto merged node ${mergedNodeId} position to (${centerPosition.x}, ${centerPosition.y})`,
              );
            }

            await sendUpdateNodePositions(sessionId, positions);
            console.log(
              `Updated positions for all nodes after auto merge (${Object.keys(positions).length} nodes)`,
            );
          } catch (error) {
            console.error("Failed to update node positions:", error);
          }
        }, 100);

        // Extract new merged node ID
        const newNodeIds = (autoMergeResult.plan.nodes || [])
          .map((node) => String(node.id))
          .filter(
            (nodeId) => !planData.nodes.some((n) => String(n.id) === nodeId),
          );
        const newNodeId = newNodeIds.length > 0 ? newNodeIds[0] : null;

        // Log user interaction
        if (setConversationHistory) {
          await addUserInteractionToConversation(
            "auto_merge_nodes",
            { nodeIds: selectedNodeIds, newNodeId },
            setConversationHistory,
            sessionId,
            addConversationMessage,
          );
        }

        // Clear selection
        if (selectedNodeIds.includes(selectedNode)) {
          setSelectedNode(null);
        }
      } else {
        alert(`Auto merge failed!\n${autoMergeResult}`);
      }
    } finally {
      setIsAutoMerging(false);
    }
  }, [
    sessionId,
    planData,
    setPlanData,
    setConversationHistory,
    selectedNode,
    setSelectedNode,
    calculateCenterPosition,
    nodes,
  ]);

  // Function to delete selected nodes
  const handleDeleteSelectedNodes = useCallback(async () => {
    console.log("Deleting all selected nodes");

    // Collect all selected nodes
    const selectedNodes = planData.nodes.filter(
      (node) => node.isSelected === true,
    );
    const selectedNodeIds = selectedNodes.map((node) => node.id);

    console.log("Selected nodes for deletion:", selectedNodeIds);

    if (selectedNodeIds.length === 0) {
      alert("No nodes selected for deletion");
      return;
    }

    // Confirm deletion
    const confirmMessage = `Are you sure you want to delete ${selectedNodeIds.length} selected node(s)?\n\nNodes: ${selectedNodeIds.join(", ")}`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    // Delete each selected node one by one, skipping snapshots
    let successCount = 0;
    let failCount = 0;
    const successfullyDeletedNodeIds = [];

    for (const nodeId of selectedNodeIds) {
      try {
        // Pass skipSnapshot=true to avoid taking a snapshot for each individual deletion
        const result = await removeNode(
          sessionId,
          parseInt(nodeId),
          setConversationHistory,
          true,
        );
        console.log(`Delete node ${nodeId} result:`, result);

        if (result.status === "success") {
          successCount++;
          successfullyDeletedNodeIds.push(nodeId);
          console.log(`Node ${nodeId} deleted successfully (snapshot skipped)`);
        } else {
          console.error(`Failed to delete node ${nodeId}:`, result);
          failCount++;
        }
      } catch (error) {
        console.error(`Error deleting node ${nodeId}:`, error);
        failCount++;
      }
    }

    // Update frontend state for all successfully deleted nodes
    if (successfullyDeletedNodeIds.length > 0) {
      setPlanData((prevPlan) => ({
        ...prevPlan,
        nodes: prevPlan.nodes.filter(
          (n) => !successfullyDeletedNodeIds.includes(n.id),
        ),
        edges: prevPlan.edges.filter(
          (e) =>
            !successfullyDeletedNodeIds.includes(e.source) &&
            !successfullyDeletedNodeIds.includes(e.target),
        ),
      }));

      // Clear selected node if it was one of the deleted ones
      if (selectedNode && successfullyDeletedNodeIds.includes(selectedNode)) {
        setSelectedNode(null);
      }

      // Capture a single snapshot for all deleted nodes
      try {
        await sendCaptureBatchDeleteSnapshot(
          sessionId,
          successfullyDeletedNodeIds,
        );
        console.log(
          `Captured snapshot after deleting ${successfullyDeletedNodeIds.length} nodes`,
        );

        // Log user interaction after snapshot is captured
        if (setConversationHistory) {
          await addUserInteractionToConversation(
            "remove_node",
            { nodeId: successfullyDeletedNodeIds.join(", ") },
            setConversationHistory,
            sessionId,
            addConversationMessage,
          );
        }
      } catch (error) {
        console.error("Failed to capture batch delete snapshot:", error);
      }
    }

    // Show summary
    if (failCount > 0) {
      alert(
        `Deletion completed:\n✓ ${successCount} nodes deleted\n✗ ${failCount} nodes failed`,
      );
    } else {
      console.log(`All ${successCount} selected nodes deleted successfully`);
    }
  }, [
    sessionId,
    planData,
    setPlanData,
    setConversationHistory,
    selectedNode,
    setSelectedNode,
  ]);

  const handleSavePlan = useCallback(async () => {
    try {
      // Extract initial query and assistant response from conversation history
      let assistantResponse = "";

      if (conversationHistory && conversationHistory.length > 0) {
        // Find the most recent assistant message with plan generation confirmation
        // Look backwards from the end to find the latest "Plan generated" or similar message
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
          const msg = conversationHistory[i];
          if (
            msg.type === "assistant" &&
            (msg.message.includes("Plan generated") ||
              msg.message.includes("✅") ||
              msg.message.includes("Plan loaded"))
          ) {
            assistantResponse = msg.message;
            break;
          }
        }
      }

      const result = await savePlan(sessionId, assistantResponse);
      if (result === "success") {
        console.log("Plan saved successfully from backend");

        // Log user interaction
        if (setConversationHistory) {
          await addUserInteractionToConversation(
            "save_plan",
            {
              nodeCount: planData.nodes.length,
              edgeCount: planData.edges.length,
            },
            setConversationHistory,
            sessionId,
            addConversationMessage,
          );
        }
      } else {
        console.error("Failed to save plan:", result);
        alert(`Failed to save plan: ${result}`);
      }
    } catch (error) {
      console.error("Error saving plan:", error);
      alert(`Error saving plan: ${error.message}`);
    }
  }, [sessionId, planData, setConversationHistory]);

  const handleLoadPlan = useCallback(async () => {
    // Create a file input element
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        // Read the file
        const fileContent = await file.text();
        const planJson = JSON.parse(fileContent);

        // Clear current plan BEFORE sending to backend (skip snapshot since we'll capture one after loading)
        clearAllNodesAndEdgesFrontend(
          setPlanData,
          setSelectedNode,
          setSelectedEdge,
        );
        await clearAllNodesAndEdgesBackend(sessionId, null, true); // skipSnapshot = true

        // Reset z-index tracking for fresh start
        nodeZIndexMap.current.clear();
        zIndexCounter.current = 1000;

        // Send to backend
        const response = await loadPlan(sessionId, planJson);

        if (response.status === "success" && response.plan) {
          console.log("Plan loaded successfully, processing:", response.plan);

          // Process and apply the loaded plan
          const nodeList = response.plan.list_node || response.plan.nodes || [];
          const edgeList = response.plan.list_edge || response.plan.edges || [];

          const processedPlan = processPlanData(nodeList, edgeList);

          // Apply auto-layout
          const layoutedNodes = applyAutoLayout(
            processedPlan.nodes,
            processedPlan.edges,
          );

          // Update plan data
          setPlanData({
            nodes: layoutedNodes.map((node) => ({
              ...node,
              isVariablesCollapsed: true,
              isSelected: false,
            })),
            edges: processedPlan.edges,
          });

          // Force initial render to ensure all nodes appear
          setTimeout(() => {
            forceEdgeRerender();
          }, 50);

          // Update node positions in history after rendering
          setTimeout(async () => {
            try {
              // Collect all node positions
              const positions = {};
              layoutedNodes.forEach((node) => {
                positions[node.id] = { x: node.x, y: node.y };
              });

              // Send positions to backend
              await sendUpdateNodePositions(sessionId, positions);
              console.log(
                `Updated positions for ${layoutedNodes.length} loaded nodes in history`,
              );

              // Wait another 100ms before final edge rerender
              setTimeout(() => {
                forceEdgeRerender();
              }, 100);
            } catch (error) {
              console.error("Failed to update node positions:", error);
            }
          }, 100);

          // Log user interaction
          if (setConversationHistory) {
            await addUserInteractionToConversation(
              "load_plan",
              {
                nodeCount: layoutedNodes.length,
                edgeCount: processedPlan.edges.length,
              },
              setConversationHistory,
              sessionId,
              addConversationMessage,
            );
          }

          // Append load action and initial query/response to conversation history
          const newMessages = [];

          // Add the original query and response if they exist
          if (response.initial_query) {
            newMessages.push({
              type: "user",
              message: response.initial_query,
              timestamp: new Date(),
            });
            await addConversationMessage(
              sessionId,
              "user",
              response.initial_query,
            );
          }

          if (response.assistant_response) {
            newMessages.push({
              type: "assistant",
              message: response.assistant_response,
              timestamp: new Date(),
            });
            await addConversationMessage(
              sessionId,
              "assistant",
              response.assistant_response,
            );
          }

          // Append to existing conversation history
          setConversationHistory((prev) => [...prev, ...newMessages]);
        }
      } catch (error) {
        console.error("Error loading plan:", error);
        alert(`Error loading plan: ${error.message}`);
      }
    };

    // Trigger file selection
    input.click();
  }, [
    sessionId,
    setPlanData,
    setSelectedNode,
    setSelectedEdge,
    forceEdgeRerender,
    setConversationHistory,
  ]);

  return (
    <div className="plan-display">
      <div className="plan-display-header">
        <div className="header-left">
          <Icon icon="diagram-tree" />
          <div className="plan-stats">
            {planData.nodes?.length || 0} nodes, {planData.edges?.length || 0}{" "}
            edges
          </div>
          <ButtonGroup minimal>
            <Tooltip content="Load Plan from JSON">
              <Button
                icon="document-open"
                onClick={() => {
                  logButtonClick(sessionId, "load_plan");
                  handleLoadPlan();
                }}
              />
            </Tooltip>
            <Tooltip content="Save Plan as JSON">
              <Button
                icon="floppy-disk"
                onClick={() => {
                  logButtonClick(sessionId, "save_plan", {
                    nodeCount: planData.nodes?.length || 0,
                    edgeCount: planData.edges?.length || 0,
                  });
                  handleSavePlan();
                }}
                disabled={!planData.nodes || planData.nodes.length === 0}
              />
            </Tooltip>
          </ButtonGroup>
        </div>

        <div className="header-center">
          {/* Undo/Redo Control Component */}
          <UndoRedoControl
            sessionId={sessionId}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo}
            canRedo={canRedo}
            conversationHistory={conversationHistory}
            onCurrentActionChange={setCurrentActionDescription}
          />
        </div>

        <div className="header-right">
          <ButtonGroup>
            <Popover
              content={
                finalResults.length === 0 ? (
                  <Menu>
                    <MenuItem
                      text="No final results yet. Run 'Execute All' first."
                      disabled
                      style={{
                        fontStyle: "italic",
                        color: "var(--bp-typography-color-muted)",
                      }}
                    />
                  </Menu>
                ) : (
                  <div
                    style={{
                      padding: "var(--sp-sm)",
                      background: "white",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                      borderRadius: "4px",
                      minWidth: "400px",
                    }}
                  >
                    <div
                      className="intent-text-success"
                      style={{
                        fontWeight: "bold",
                        marginBottom: "var(--sp-sm)",
                        padding: "var(--sp-xs)",
                      }}
                    >
                      Final Results
                    </div>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "12px",
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: "2px solid var(--border-subtle)",
                            background: "var(--bg-muted)",
                          }}
                        >
                          <th
                            style={{
                              padding: "var(--sp-sm)",
                              textAlign: "left",
                              fontWeight: "bold",
                              color: "var(--bp-typography-color-muted)",
                            }}
                          >
                            Node ID
                          </th>
                          <th
                            style={{
                              padding: "var(--sp-sm)",
                              textAlign: "left",
                              fontWeight: "bold",
                              color: "var(--bp-typography-color-muted)",
                            }}
                          >
                            Variable Name
                          </th>
                          <th
                            style={{
                              padding: "var(--sp-sm)",
                              textAlign: "left",
                              fontWeight: "bold",
                              color: "var(--bp-typography-color-muted)",
                            }}
                          >
                            Value
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalResults.map((result, index) => (
                          <tr
                            key={index}
                            style={{
                              borderBottom: "1px solid var(--border-subtle)",
                              transition: "background-color 0.15s",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "var(--bg-muted)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "transparent")
                            }
                          >
                            <td
                              style={{
                                padding: "var(--sp-sm)",
                                fontWeight: "500",
                              }}
                            >
                              {result.nodeLabel}
                            </td>
                            <td
                              style={{
                                padding: "var(--sp-sm)",
                                color: "var(--handle-color)",
                              }}
                            >
                              {result.variableName}
                            </td>
                            <td
                              style={{
                                padding: "var(--sp-sm)",
                                maxWidth: "200px",
                                wordBreak: "break-word",
                                whiteSpace: "pre-wrap",
                                color: "var(--bp-typography-color-default)",
                              }}
                            >
                              {result.variableValue}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }
              position={Position.BOTTOM_LEFT}
              onOpening={() => {
                logButtonClick(sessionId, "view_final_results", {
                  resultCount: finalResults.length,
                  hasResults: finalResults.length > 0,
                });
                setHasNewResults(false);
              }}
            >
              <Tooltip content="View Final Results">
                <Button
                  icon="chart"
                  intent={finalResults.length > 0 ? "success" : "none"}
                  style={{ position: "relative" }}
                >
                  Results
                  {hasNewResults && (
                    <span
                      style={{
                        position: "absolute",
                        top: "4px",
                        right: "4px",
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: "var(--bp-intent-danger-rest)",
                        border: "1px solid white",
                      }}
                    />
                  )}
                </Button>
              </Tooltip>
            </Popover>

            <Button
              icon={isExecuting ? "refresh" : "play"}
              intent="primary"
              onClick={() => {
                logButtonClick(sessionId, "execute_all", {
                  nodeCount: planData.nodes?.length || 0,
                });
                handleExecuteAllNodes();
              }}
              disabled={
                !planData.nodes || planData.nodes.length === 0 || isExecuting
              }
              loading={isExecuting}
            >
              {isExecuting ? "Executing..." : "Execute All"}
            </Button>
          </ButtonGroup>
        </div>
      </div>

      <div className="plan-canvas-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onBeforeDelete={async ({
            nodes: nodesToDelete,
            edges: edgesToDelete,
          }) => {
            // IMPORTANT: Only allow edge deletion when NO nodes are involved
            // If any nodes are in the deletion request, block ALL deletion
            // This prevents accidental edge deletion when clicking on a node and pressing Delete

            if (nodesToDelete && nodesToDelete.length > 0) {
              console.log(
                "[onBeforeDelete] Blocked deletion - nodes in request:",
                nodesToDelete,
              );
              return { nodes: [], edges: [] };
            }

            // Only delete edges if edges are explicitly selected and no nodes are involved
            console.log(
              "[onBeforeDelete] Allowing edge deletion:",
              edgesToDelete,
            );
            return { nodes: [], edges: edgesToDelete || [] };
          }}
          onEdgesDelete={onEdgesDelete}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onDeselect}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={{ stroke: "var(--edge-color)", strokeWidth: 2 }}
          defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
          minZoom={0.5}
          maxZoom={2}
          elevateEdgesOnSelect={true}
          elevateNodesOnSelect={false}
        >
          <Background color="#aaa" gap={16} />
          <Controls />
          <MiniMap />

          {/* Undo/Redo and Selection Panel at top-left */}
          <Panel position="top-left">
            <div className="header-controls">
              <ButtonGroup minimal>
                <Tooltip content="Add New Node">
                  <Button
                    icon="insert"
                    intent="primary"
                    onClick={async () => {
                      await logButtonClick(sessionId, "add_node");
                      await handleAddNode();
                    }}
                    text="Add Node"
                  />
                </Tooltip>
                <Tooltip content="Select All Nodes">
                  <Button
                    icon="multi-select"
                    onClick={() => {
                      logButtonClick(sessionId, "select_all", {
                        nodeCount: planData.nodes?.length || 0,
                      });
                      handleSelectAllNodes();
                    }}
                    disabled={!planData.nodes || planData.nodes.length === 0}
                    text="Select All"
                  />
                </Tooltip>
                <Tooltip content="Deselect All Nodes">
                  <Button
                    icon="selection-box"
                    onClick={() => {
                      logButtonClick(sessionId, "deselect_all", {
                        nodeCount: planData.nodes?.length || 0,
                      });
                      handleDeselectAllNodes();
                    }}
                    disabled={!planData.nodes || planData.nodes.length === 0}
                    text="Deselect All"
                  />
                </Tooltip>
              </ButtonGroup>

              <ButtonGroup minimal>
                <Tooltip content="Regular Merge Selected Nodes">
                  <Button
                    icon={
                      isForceMerging ? <Spinner size={16} /> : "merge-columns"
                    }
                    intent="primary"
                    onClick={() => {
                      if (!isForceMerging && !isAutoMerging) {
                        const selectedCount =
                          planData.nodes?.filter((n) => n.isSelected).length ||
                          0;
                        logButtonClick(sessionId, "merge_nodes", {
                          selectedCount,
                        });
                        handleMergeSelectedNodes();
                      }
                    }}
                    disabled={
                      !planData.nodes ||
                      planData.nodes.length === 0 ||
                      isForceMerging ||
                      isAutoMerging
                    }
                    text={isForceMerging ? "Merging..." : "Merge"}
                  />
                </Tooltip>
                <Tooltip content="Auto Merge Selected Nodes">
                  <Button
                    icon={
                      isAutoMerging ? <Spinner size={16} /> : "linked-squares"
                    }
                    intent="primary"
                    onClick={() => {
                      if (!isForceMerging && !isAutoMerging) {
                        const selectedCount =
                          planData.nodes?.filter((n) => n.isSelected).length ||
                          0;
                        logButtonClick(sessionId, "auto_merge_nodes", {
                          selectedCount,
                        });
                        handleAutoMergeSelectedNodes();
                      }
                    }}
                    disabled={
                      !planData.nodes ||
                      planData.nodes.length === 0 ||
                      isForceMerging ||
                      isAutoMerging
                    }
                    text={isAutoMerging ? "Merging..." : "Auto Merge"}
                  />
                </Tooltip>
                <Tooltip content="Delete Selected Nodes">
                  <Button
                    icon="remove-column"
                    intent="danger"
                    onClick={() => {
                      const selectedCount =
                        planData.nodes?.filter((n) => n.isSelected).length || 0;
                      logButtonClick(sessionId, "delete_selected_nodes", {
                        selectedCount,
                      });
                      handleDeleteSelectedNodes();
                    }}
                    disabled={!planData.nodes || planData.nodes.length === 0}
                    text="Delete Selection"
                  />
                </Tooltip>
                <Tooltip content="Clear All Nodes and Edges">
                  <Button
                    icon="trash"
                    intent="danger"
                    onClick={() => {
                      logButtonClick(sessionId, "clear_all", {
                        nodeCount: planData.nodes?.length || 0,
                        edgeCount: planData.edges?.length || 0,
                      });
                      handleClearAll();
                    }}
                    text="Clear All"
                  />
                </Tooltip>
              </ButtonGroup>
            </div>
          </Panel>

          {/* Custom Panel for our Blueprint.js controls */}
          <Panel position="top-right">
            <div className="header-controls">
              <ButtonGroup minimal>
                <Tooltip content="Collapse All Variables">
                  <Button
                    icon="collapse-all"
                    onClick={() => {
                      logButtonClick(sessionId, "collapse_all_variables", {
                        nodeCount: planData.nodes?.length || 0,
                      });
                      toggleAllVariablesCollapse(true);
                    }}
                    disabled={!planData.nodes || planData.nodes.length === 0}
                  />
                </Tooltip>
                <Tooltip content="Expand All Variables">
                  <Button
                    icon="expand-all"
                    onClick={() => {
                      logButtonClick(sessionId, "expand_all_variables", {
                        nodeCount: planData.nodes?.length || 0,
                      });
                      toggleAllVariablesCollapse(false);
                    }}
                    disabled={!planData.nodes || planData.nodes.length === 0}
                  />
                </Tooltip>
              </ButtonGroup>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
};

export default PlanDisplay;
