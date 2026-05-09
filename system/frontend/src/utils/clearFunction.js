// Clear all nodes and edges function
// This can be added to your App.jsx or extracted to a separate utility file
import { resetPlan } from "../services/uiInteraction";
/**
 * Clears all nodes and edges from the center panel
 * @param {Function} setPlanData - State setter function for plan data
 * @param {Function} setSelectedNode - State setter function for selected node
 * @param {Function} setSelectedEdge - State setter function for selected edge
 * @param {string} sessionId - Current session ID (optional, for backend reset)
 * @param {boolean} resetBackend - Whether to also reset backend data (default: false)
 */
export const clearAllNodesAndEdgesBackend = async (
  sessionId,
  setConversationHistory = null,
  skipSnapshot = false,
) => {
  // Optionally reset backend data
  try {
    // Call backend to reset session data
    // Note: You may need to implement this endpoint on the backend
    const response = await resetPlan(
      sessionId,
      setConversationHistory,
      skipSnapshot,
    );
    console.log(response);
    if (response == "success") {
      console.log("Backend session reset successfully:", response);
      return true;
    } else {
      console.warn("Backend reset failed!", response);
    }
  } catch (backendError) {
    console.warn("Backend reset error:", backendError);
  }
  return false;
};

// Alternative: Simple version without backend reset
export const clearAllNodesAndEdgesFrontend = (
  setPlanData,
  setSelectedNode,
  setSelectedEdge,
  planData = null,
  onRemoveNode = null,
) => {
  // If planData is provided, iterate through nodes and call onRemoveNode
  if (
    planData &&
    Array.isArray(planData.nodes) &&
    typeof onRemoveNode === "function"
  ) {
    console.log("Clearing the following planData:", planData);

    // Iteratively call onRemoveNode for each node
    planData.nodes.forEach((node) => {
      console.log("Removing node from xyflow:", node);
      onRemoveNode(node.id);
    });

    if (Array.isArray(planData.edges)) {
      planData.edges.forEach((edge) => {
        console.log("Clearing edge:", edge);
      });
    }
  } else {
    // Fallback: directly clear all nodes and edges if no onRemoveNode callback
    setPlanData({ nodes: [], edges: [] });
    setSelectedNode(null);
    setSelectedEdge(null);
  }

  console.log("All nodes and edges cleared from center panel");
};
