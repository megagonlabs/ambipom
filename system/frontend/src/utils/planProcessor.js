// Utility functions for processing plan data from backend

/**
 * Converts backend node format to UI node format
 * @param {Object} backendNode - Node from backend in format: {agent_name, id, input, output, task}
 * @returns {Object} UI node format
 */
export const convertBackendNodeToUI = (backendNode) => {
  console.log("Converting backend node:", backendNode);
  console.log("Backend node agent_name:", backendNode.agent_name);

  // Convert input object to array format expected by UI
  // Values may be plain strings or objects like {value: "...", value_updated: "..."}
  const inputArray = Object.keys(backendNode.input || {}).map((key) => {
    const raw = backendNode.input[key];
    return {
      name: key,
      value: raw && typeof raw === "object" ? raw.value || "" : raw || "",
      isValid: true,
      isEditing: false,
    };
  });

  // Convert output object to array format expected by UI
  const outputArray = Object.keys(backendNode.output || {}).map((key) => {
    const raw = backendNode.output[key];
    return {
      name: key,
      value: raw && typeof raw === "object" ? raw.value || "" : raw || "",
      isValid: true,
      isEditing: false,
    };
  });
  return {
    id: String(backendNode.id), // Ensure ID is string
    task: backendNode.task || "No task description",
    agent_name: backendNode.agent_name || "commonsense",
    input: inputArray,
    output: outputArray,
    params: {},
    // Use backend position if available (for undo/redo), otherwise random
    x: backendNode.x !== undefined ? backendNode.x : Math.random() * 400 + 100,
    y: backendNode.y !== undefined ? backendNode.y : Math.random() * 300 + 100,
    width: 200,
    height: 150, // Increased height for more variables
    isSelected: false, // Initialize selection state to false
    // Include agent configuration
    modelName: backendNode.modelName || "gpt-4o-mini",
    temperature:
      backendNode.temperature !== undefined ? backendNode.temperature : 0,
    // Preserve execution log from backend (for undo/redo)
    execution_log: backendNode.execution_log || [],
  };
};

/**
 * Converts backend edge format to UI edge format
 * @param {Object} backendEdge - Edge from backend in format: {src_id, dest_id, src_output, dest_input}
 * @returns {Object} UI edge format
 */
export const convertBackendEdgeToUI = (backendEdge) => {
  console.log("Converting backend edge:", backendEdge);

  return {
    id: `edge-${backendEdge.src_id}-${backendEdge.dest_id}-${backendEdge.src_output}-${backendEdge.dest_input}`,
    source: String(backendEdge.src_id), // Ensure string ID
    target: String(backendEdge.dest_id), // Ensure string ID
    sourceHandle: backendEdge.src_output,
    targetHandle: backendEdge.dest_input,
    type: "default",
    animated: true,
    pathOptions: { curvature: 0.25 },
  };
};

/**
 * Processes the complete plan from backend (list_node and list_edge)
 * @param {Array} list_node - Array of nodes from backend
 * @param {Array} list_edge - Array of edges from backend
 * @returns {Object} Processed plan data {nodes, edges}
 */
export const processPlanData = (list_node, list_edge) => {
  console.log("Processing plan data - nodes:", list_node, "edges:", list_edge);
  console.log(
    "Node count:",
    (list_node || []).length,
    "Edge count:",
    (list_edge || []).length,
  );

  try {
    // Convert all nodes
    const processedNodes = (list_node || []).map((node, index) => {
      console.log(`Processing node ${index}:`, node);
      return convertBackendNodeToUI(node);
    });

    // Convert all edges
    const processedEdges = (list_edge || []).map((edge, index) => {
      console.log(`Processing edge ${index}:`, edge);
      return convertBackendEdgeToUI(edge);
    });

    console.log("Processed nodes:", processedNodes);
    console.log("Processed edges:", processedEdges);

    return {
      nodes: processedNodes,
      edges: processedEdges,
    };
  } catch (error) {
    console.error("Error processing plan data:", error);
    console.error("Error details:", error.stack);
    return {
      nodes: [],
      edges: [],
    };
  }
};

/**
 * Validates that a plan has valid node and edge structure
 * @param {Object} planData - Plan data {nodes, edges}
 * @returns {Object} Validation result {isValid, errors}
 */
export const validatePlanData = (planData) => {
  const errors = [];

  if (!planData.nodes || !Array.isArray(planData.nodes)) {
    errors.push("Nodes must be an array");
  }

  if (!planData.edges || !Array.isArray(planData.edges)) {
    errors.push("Edges must be an array");
  }

  // Check that all edge source/target nodes exist
  if (planData.nodes && planData.edges) {
    const nodeIds = planData.nodes.map((node) => node.id);

    planData.edges.forEach((edge, index) => {
      if (!nodeIds.includes(edge.source)) {
        errors.push(`Edge ${index}: source node ${edge.source} not found`);
      }
      if (!nodeIds.includes(edge.target)) {
        errors.push(`Edge ${index}: target node ${edge.target} not found`);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Applies layout algorithm to position nodes properly
 * @param {Array} nodes - Array of nodes
 * @param {Array} edges - Array of edges
 * @returns {Array} Nodes with updated positions
 */
export const applyAutoLayout = (nodes, edges) => {
  // Simple hierarchical layout - you can enhance this
  const levels = {};
  const visited = new Set();

  // Find root nodes (no incoming edges)
  const hasIncoming = new Set(edges.map((edge) => edge.target));
  const rootNodes = nodes.filter((node) => !hasIncoming.has(node.id));

  // BFS to assign levels
  const queue = rootNodes.map((node) => ({ node, level: 0 }));

  while (queue.length > 0) {
    const { node, level } = queue.shift();

    if (visited.has(node.id)) continue;
    visited.add(node.id);

    if (!levels[level]) levels[level] = [];
    levels[level].push(node);

    // Find children
    const children = edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => nodes.find((n) => n.id === edge.target))
      .filter((child) => child && !visited.has(child.id));

    children.forEach((child) => {
      queue.push({ node: child, level: level + 1 });
    });
  }

  // Position nodes by level
  return nodes.map((node) => {
    const nodeLevel = Object.keys(levels).find((level) =>
      levels[level].some((n) => n.id === node.id),
    );

    if (nodeLevel !== undefined) {
      const levelNodes = levels[nodeLevel];
      const nodeIndex = levelNodes.findIndex((n) => n.id === node.id);

      return {
        ...node,
        x: parseInt(nodeLevel) * 450 + 100, // Horizontal spacing
        y: nodeIndex * 450 + 100, // Vertical spacing - increased for better readability
      };
    }

    return node;
  });
};

/**
 * Applies smart layout for target replan - positions new nodes intelligently
 * based on removed nodes and shifts existing nodes if needed
 * @param {Array} existingNodes - Nodes that remain after removal
 * @param {Array} newNodes - New nodes from replan
 * @param {Array} removedNodes - Nodes that were removed
 * @param {Array} allEdges - All edges (including new ones)
 * @returns {Object} { layoutedNodes: Array, shiftedNodes: Array } - Both new and shifted existing nodes with updated positions
 */
export const applyTargetReplanLayout = (
  existingNodes,
  newNodes,
  removedNodes,
  allEdges,
) => {
  const NODE_WIDTH = 300;
  const NODE_HEIGHT = 320;
  const HORIZONTAL_GAP = 150;
  const VERTICAL_GAP = 50; // Keep compact for target replan - overlapping is fine
  const RIGHT_SHIFT_AMOUNT = HORIZONTAL_GAP;

  console.log("[TargetReplanLayout] Starting layout calculation", {
    existingCount: existingNodes.length,
    newCount: newNodes.length,
    removedCount: removedNodes.length,
  });

  if (newNodes.length === 0) {
    return { layoutedNodes: [], shiftedNodes: existingNodes };
  }

  // Calculate bounding box of removed nodes
  let removedBounds = null;
  if (removedNodes.length > 0) {
    const minX = Math.min(...removedNodes.map((n) => n.x));
    const maxX = Math.max(...removedNodes.map((n) => n.x + NODE_WIDTH));
    const minY = Math.min(...removedNodes.map((n) => n.y));
    const maxY = Math.max(...removedNodes.map((n) => n.y + NODE_HEIGHT));
    removedBounds = {
      minX,
      maxX,
      minY,
      maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
    console.log("[TargetReplanLayout] Removed nodes bounds:", removedBounds);
  }

  // Build a subgraph of new nodes to understand their structure
  const newNodeIds = new Set(newNodes.map((n) => n.id));
  const newNodesEdges = allEdges.filter(
    (e) => newNodeIds.has(e.source) && newNodeIds.has(e.target),
  );

  // Find connections between new nodes and existing nodes
  const incomingEdges = allEdges.filter(
    (e) => !newNodeIds.has(e.source) && newNodeIds.has(e.target),
  );
  const outgoingEdges = allEdges.filter(
    (e) => newNodeIds.has(e.source) && !newNodeIds.has(e.target),
  );

  console.log("[TargetReplanLayout] Connections:", {
    internal: newNodesEdges.length,
    incoming: incomingEdges.length,
    outgoing: outgoingEdges.length,
  });

  // Determine start position for new nodes
  let startX, startY;
  if (removedBounds) {
    // Start at the position of removed nodes
    startX = removedBounds.minX;
    startY = removedBounds.minY;
  } else if (incomingEdges.length > 0) {
    // Position based on incoming connections
    const sourceNodes = incomingEdges
      .map((e) => existingNodes.find((n) => n.id === e.source))
      .filter((n) => n);
    const avgX =
      sourceNodes.reduce((sum, n) => sum + n.x, 0) / sourceNodes.length;
    const avgY =
      sourceNodes.reduce((sum, n) => sum + n.y, 0) / sourceNodes.length;
    startX = avgX + NODE_WIDTH + HORIZONTAL_GAP;
    startY = avgY;
  } else {
    // Default position
    startX = 100;
    startY = 100;
  }

  // Apply hierarchical layout to new nodes
  const levels = {};
  const visited = new Set();
  const hasIncoming = new Set(newNodesEdges.map((e) => e.target));
  const rootNodes = newNodes.filter((n) => !hasIncoming.has(n.id));

  // If no root nodes in subgraph, treat nodes with external incoming edges as roots
  const effectiveRoots =
    rootNodes.length > 0
      ? rootNodes
      : newNodes.filter((n) => incomingEdges.some((e) => e.target === n.id));

  if (effectiveRoots.length === 0 && newNodes.length > 0) {
    // If still no roots, use all new nodes as level 0
    effectiveRoots.push(...newNodes);
  }

  // BFS to assign levels within new nodes
  const queue = effectiveRoots.map((node) => ({ node, level: 0 }));

  while (queue.length > 0) {
    const { node, level } = queue.shift();

    if (visited.has(node.id)) continue;
    visited.add(node.id);

    if (!levels[level]) levels[level] = [];
    levels[level].push(node);

    // Find children within new nodes
    const children = newNodesEdges
      .filter((edge) => edge.source === node.id)
      .map((edge) => newNodes.find((n) => n.id === edge.target))
      .filter((child) => child && !visited.has(child.id));

    children.forEach((child) => {
      queue.push({ node: child, level: level + 1 });
    });
  }

  console.log(
    "[TargetReplanLayout] New nodes levels:",
    Object.keys(levels).map(
      (level) => `Level ${level}: ${levels[level].length} nodes`,
    ),
  );

  // Calculate required width for new nodes
  const numLevels = Object.keys(levels).length;
  const requiredWidth = numLevels * (NODE_WIDTH + HORIZONTAL_GAP);
  const maxNodesInLevel = Math.max(
    ...Object.values(levels).map((arr) => arr.length),
  );
  const requiredHeight = maxNodesInLevel * (NODE_HEIGHT + VERTICAL_GAP);

  console.log("[TargetReplanLayout] Required space:", {
    requiredWidth,
    requiredHeight,
  });

  // Position new nodes
  const layoutedNewNodes = newNodes.map((node) => {
    const nodeLevel = Object.keys(levels).find((level) =>
      levels[level].some((n) => n.id === node.id),
    );

    if (nodeLevel !== undefined) {
      const levelNodes = levels[nodeLevel];
      const nodeIndex = levelNodes.findIndex((n) => n.id === node.id);

      return {
        ...node,
        x: startX + parseInt(nodeLevel) * (NODE_WIDTH + HORIZONTAL_GAP),
        y: startY + nodeIndex * (NODE_HEIGHT + VERTICAL_GAP),
      };
    }

    // Fallback position
    return {
      ...node,
      x: startX,
      y: startY,
    };
  });

  // Determine if we need to shift existing nodes to the right
  // Shift only if: 1) horizontal overlap exists AND 2) existing node is in top 75% of new node
  const overlappingNodes = existingNodes.filter((existingNode) => {
    return layoutedNewNodes.some((newNode) => {
      // Check horizontal overlap
      const xOverlap = !(
        existingNode.x + NODE_WIDTH < newNode.x ||
        newNode.x + NODE_WIDTH < existingNode.x
      );

      // Check if existing node is in the top 75% of the new node
      const newNodeTop75Percent = newNode.y + NODE_HEIGHT * 0.75;
      const existingNodeInTop75 =
        existingNode.y < newNodeTop75Percent &&
        existingNode.y + NODE_HEIGHT > newNode.y;

      return xOverlap && existingNodeInTop75;
    });
  });

  console.log(
    "[TargetReplanLayout] Nodes with overlap in top 75%:",
    overlappingNodes.length,
  );

  // Calculate shift needed
  let shiftAmount = 0;
  const nodesToShift = [];

  if (overlappingNodes.length > 0) {
    // Calculate the rightmost edge of new nodes
    const newNodesRightEdge = Math.max(
      ...layoutedNewNodes.map((n) => n.x + NODE_WIDTH),
    );

    // Target position for shifted nodes: one HORIZONTAL_GAP to the right of new nodes
    const targetPosition = newNodesRightEdge + HORIZONTAL_GAP;

    // Find all nodes that need to be shifted (overlapping + any nodes to their right)
    const minOverlapX = Math.min(...overlappingNodes.map((n) => n.x));
    nodesToShift.push(...existingNodes.filter((node) => node.x >= minOverlapX));

    // Calculate shift: move the leftmost overlapping node to the target position
    shiftAmount = targetPosition - minOverlapX;

    console.log("[TargetReplanLayout] Overlap detected, shifting:", {
      overlappingCount: overlappingNodes.length,
      totalNodesToShift: nodesToShift.length,
      newNodesRightEdge,
      targetPosition,
      minOverlapX,
      shiftAmount,
    });
  }

  // Apply shift to nodes that need it
  const shiftedExistingNodes = existingNodes.map((node) => {
    if (shiftAmount > 0 && nodesToShift.some((n) => n.id === node.id)) {
      return {
        ...node,
        x: node.x + shiftAmount,
      };
    }
    return node;
  });

  console.log("[TargetReplanLayout] Layout complete", {
    newNodesPositioned: layoutedNewNodes.length,
    existingNodesShifted: shiftedExistingNodes.filter(
      (n, i) => n.x !== existingNodes[i].x,
    ).length,
  });

  return {
    layoutedNodes: layoutedNewNodes,
    shiftedNodes: shiftedExistingNodes,
  };
};
