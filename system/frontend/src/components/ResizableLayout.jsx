// components/ResizableLayout.jsx - Debug Version
import { useCallback, useEffect, useRef, useState } from "react";
import "./ResizableLayout.css";

const ResizableLayout = ({
  leftPanel,
  centerPanel,
  rightPanel,
  isRightPanelVisible,
}) => {
  const containerRef = useRef(null);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(300);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const [centerVisible, setCenterVisible] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);

  // Constants for minimum widths and ratios
  const MIN_LEFT_WIDTH = 250;
  const MIN_RIGHT_WIDTH = 250;
  const MIN_CENTER_RATIO = 0.2;
  const MIN_RIGHT_RATIO = 0.15;

  const handleMouseDown = useCallback(
    (side) => (e) => {
      // console.log(`Mouse down on ${side} resizer`);
      e.preventDefault();
      e.stopPropagation();

      if (side === "left") {
        setIsDraggingLeft(true);
        // console.log('Started dragging left');
      } else {
        setIsDraggingRight(true);
        // console.log('Started dragging right');
      }
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const mouseX = e.clientX - containerRect.left;

      if (isDraggingLeft) {
        // console.log(`Dragging left: mouseX=${mouseX}, containerWidth=${containerWidth}`);
        const newLeftWidth = Math.max(MIN_LEFT_WIDTH, mouseX);
        const resizerWidth = 4 + (isRightPanelVisible ? 4 : 0);
        const usedWidth =
          newLeftWidth + (isRightPanelVisible ? rightWidth : 0) + resizerWidth;
        const remainingWidth = containerWidth - usedWidth;

        // console.log(`Drag calculation: remaining=${remainingWidth}px, min required=300px`);

        // Ensure center panel can have at least 300px width
        if (remainingWidth > 300) {
          setLeftWidth(newLeftWidth);
          setCenterVisible(true);
          // console.log(`Set left width to: ${newLeftWidth}, center will be ${remainingWidth}px`);
        } else {
          setLeftWidth(newLeftWidth);
          setCenterVisible(false);
          // console.log('Center hidden - insufficient space for 300px minimum');
        }
      }

      if (isDraggingRight && isRightPanelVisible) {
        // console.log(`Dragging right: mouseX=${mouseX}, containerWidth=${containerWidth}`);
        const newRightWidth = Math.max(
          MIN_RIGHT_WIDTH,
          containerWidth - mouseX,
        );
        const rightRatio = newRightWidth / containerWidth;

        if (rightRatio >= MIN_RIGHT_RATIO) {
          setRightWidth(newRightWidth);
          // console.log(`Set right width to: ${newRightWidth}`);
        }
      }
    },
    [isDraggingLeft, isDraggingRight, rightWidth, isRightPanelVisible],
  );

  const handleMouseUp = useCallback(() => {
    // console.log('Mouse up - stopping drag');
    setIsDraggingLeft(false);
    setIsDraggingRight(false);
  }, []);

  useEffect(() => {
    if (isDraggingLeft || isDraggingRight) {
      // console.log('Adding global mouse listeners');
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      return () => {
        // console.log('Removing global mouse listeners');
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
  }, [isDraggingLeft, isDraggingRight, handleMouseMove, handleMouseUp]);

  const calculateCenterWidth = () => {
    // Use stored containerWidth if available, otherwise try to measure
    let currentContainerWidth = containerWidth;
    if (currentContainerWidth === 0 && containerRef.current) {
      currentContainerWidth =
        containerRef.current.getBoundingClientRect().width;
    }

    // If still no width available, calculate based on viewport
    if (currentContainerWidth === 0) {
      // Estimate based on window width minus some padding
      currentContainerWidth = window.innerWidth;
    }

    // Calculate resizer widths: left resizer (4px) + right resizer (4px if right panel visible)
    // Don't use centerVisible here to avoid circular dependency
    const resizerWidth = 4 + (isRightPanelVisible ? 4 : 0);
    const usedWidth =
      leftWidth + (isRightPanelVisible ? rightWidth : 0) + resizerWidth;
    const centerWidth = Math.max(300, currentContainerWidth - usedWidth);
    // console.log(`Center width calculated: ${centerWidth}px (container: ${currentContainerWidth}px, used: ${usedWidth}px, resizerWidth: ${resizerWidth}px)`);
    return centerWidth;
  };

  return (
    <div ref={containerRef} className="resizable-layout">
      {/* Left Panel */}
      <div className="panel left-panel" style={{ width: `${leftWidth}px` }}>
        {leftPanel}
      </div>

      {/* Left Resizer */}
      <div
        className={`resizer left-resizer ${isDraggingLeft ? "dragging" : ""}`}
        onMouseDown={handleMouseDown("left")}
        style={{
          cursor: "col-resize",
          backgroundColor: isDraggingLeft
            ? "var(--bp-intent-primary-rest)"
            : "var(--border-subtle)",
        }}
        title="Drag to resize left panel"
      />

      {/* Center Panel */}
      {centerVisible && (
        <div
          className="panel center-panel"
          style={{
            width: `${calculateCenterWidth()}px`,
            borderRight: isRightPanelVisible
              ? "1px solid var(--border-subtle)"
              : "none",
          }}
        >
          {centerPanel}
        </div>
      )}

      {/* Right Resizer */}
      {/* {isRightPanelVisible && centerVisible && (
        <div
          className={`resizer right-resizer ${isDraggingRight ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown('right')}
          style={{ 
            cursor: 'col-resize',
            backgroundColor: isDraggingRight ? 'var(--bp-intent-primary-rest)' : 'var(--border-subtle)'
          }}
          title="Drag to resize right panel"
        />
      )} */}

      {/* Right Panel */}
      {isRightPanelVisible && (
        <div className="panel right-panel" style={{ width: `${rightWidth}px` }}>
          {rightPanel}
        </div>
      )}
    </div>
  );
};

export default ResizableLayout;
