/**
 * Off-Road Handler Module
 * 
 * This module handles all off-road checkpoint logic, including:
 * - Detecting off-road checkpoints
 * - Creating connector lines to on-road checkpoints
 * - Restoring off-road checkpoints and their connectors
 * - Managing road markers and labels
 */

export interface Position {
  lat: number;
  lng: number;
}

export interface CheckpointInfo {
  position: Position;
  isOffRoad: boolean;
  snappedPoint?: Position | null;
  connectorTo?: number | null;
  connectorToPosition?: Position | null;
  connectorLabel?: {
    position: Position;
    text: string;
  };
}

export interface MarkerWithExtras {
  getPosition: () => { lat: () => number; lng: () => number } | null;
  setLabel: (label: string) => void;
  roadMarker?: any;
  connectorPolyline?: any;
  isOffRoad?: boolean;
  snappedPoint?: Position;
  connectorToIndex?: number;
}

/**
 * Calculate distance between two positions in meters
 */
export const calculateDistance = (pos1: Position, pos2: Position): number => {
  // Validate inputs
  if (!pos1 || !pos2) return 0;
  if (typeof pos1.lat !== 'number' || typeof pos1.lng !== 'number') return 0;
  if (typeof pos2.lat !== 'number' || typeof pos2.lng !== 'number') return 0;
  if (!isFinite(pos1.lat) || !isFinite(pos1.lng)) return 0;
  if (!isFinite(pos2.lat) || !isFinite(pos2.lng)) return 0;

  const R = 6371000; // Earth's radius in meters
  const dLat = ((pos2.lat - pos1.lat) * Math.PI) / 180;
  const dLng = ((pos2.lng - pos1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((pos1.lat * Math.PI) / 180) *
      Math.cos((pos2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Check if a checkpoint is on-road
 */
export const isCheckpointOnRoad = (checkpointInfo: CheckpointInfo, marker: MarkerWithExtras): boolean => {
  // A checkpoint is on-road if it doesn't have isOffRoad flag and doesn't have snappedPoint
  return !checkpointInfo.isOffRoad && !checkpointInfo.snappedPoint && !marker?.roadMarker && !marker?.isOffRoad;
};

/**
 * Find the nearest on-road checkpoint
 * IMPORTANT: Off-road checkpoints should connect to ON-ROAD checkpoints only
 */
export const findNearestOnRoadCheckpoint = (
  fromPosition: Position,
  excludeMarker: MarkerWithExtras | null,
  allMarkers: MarkerWithExtras[],
  allCheckpoints: CheckpointInfo[]
): { position: Position; distance: number; marker: MarkerWithExtras } | null => {
  let nearestCheckpoint: Position | null = null;
  let nearestMarker: MarkerWithExtras | null = null;
  let minDist = Infinity;

  // Check all markers - only consider ON-ROAD ones (those WITHOUT roadMarker or isOffRoad flag)
  allMarkers.forEach((marker: MarkerWithExtras) => {
    if (marker === excludeMarker) return;
    
    const isOffRoad = marker && (marker.roadMarker || marker.isOffRoad);
    if (isOffRoad) return; // Skip off-road checkpoints
    
    const markerPos = marker.getPosition();
    if (markerPos) {
      const dist = calculateDistance(
        fromPosition,
        { lat: markerPos.lat(), lng: markerPos.lng() }
      );
      if (dist < minDist && dist > 0) {
        minDist = dist;
        nearestCheckpoint = { lat: markerPos.lat(), lng: markerPos.lng() };
        nearestMarker = marker;
      }
    }
  });

  // Also check checkpoint data for on-road checkpoints
  allCheckpoints.forEach((cp: CheckpointInfo) => {
    if (!cp || !cp.position) return;
    
    const isCpOffRoad = cp.isOffRoad || !!cp.snappedPoint;
    if (isCpOffRoad) return; // Skip off-road checkpoints
    
    const cpPos = cp.position;
    if (typeof cpPos.lat === 'number' && typeof cpPos.lng === 'number') {
      const dist = calculateDistance(fromPosition, cpPos);
      if (dist < minDist && dist > 0) {
        minDist = dist;
        nearestCheckpoint = cpPos;
        // Try to find corresponding marker
        const correspondingMarker = allMarkers.find((m: MarkerWithExtras) => {
          const pos = m.getPosition();
          if (!pos) return false;
          return Math.abs(pos.lat() - cpPos.lat) < 0.000001 &&
                 Math.abs(pos.lng() - cpPos.lng) < 0.000001;
        });
        if (correspondingMarker) {
          nearestMarker = correspondingMarker;
        }
      }
    }
  });

  return nearestCheckpoint && nearestMarker
    ? { position: nearestCheckpoint, distance: minDist, marker: nearestMarker }
    : null;
};

/**
 * Check if a checkpoint position already exists
 */
export const checkpointExists = (position: Position, existingCheckpoints: Position[]): boolean => {
  if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
    return false;
  }
  
  return existingCheckpoints.some((cp: Position) => {
    if (!cp || typeof cp.lat !== 'number' || typeof cp.lng !== 'number') {
      return false;
    }
    // Check if positions are very close (within 0.000001 degrees, roughly 0.1 meters)
    return Math.abs(cp.lat - position.lat) < 0.000001 && 
           Math.abs(cp.lng - position.lng) < 0.000001;
  });
};

/**
 * Update all marker labels to match their index in checkPoints array
 * This ensures labels are always correct and match the distance indices (1-based)
 */
export const updateMarkerLabels = (checkpointsArray: Position[], markers: MarkerWithExtras[]): void => {
  markers.forEach((marker: MarkerWithExtras, index: number) => {
    const pos = marker.getPosition();
    if (!pos) return;
    
    // Find the index of this marker's position in checkPoints array
    const checkpointIndex = checkpointsArray.findIndex((cp: Position) => {
      if (!cp || typeof cp.lat !== 'number' || typeof cp.lng !== 'number') return false;
      return Math.abs(cp.lat - pos.lat()) < 0.000001 &&
             Math.abs(cp.lng - pos.lng()) < 0.000001;
    });
    
    if (checkpointIndex !== -1) {
      // Update label to match checkpoint index (1-based)
      marker.setLabel(`${checkpointIndex + 1}`);
    }
  });
};

/**
 * Create a connector polyline from off-road checkpoint to on-road checkpoint
 */
export const createConnectorPolyline = (
  mapsApi: any,
  mapInstance: any,
  fromPosition: Position,
  toPosition: Position,
  marker: MarkerWithExtras,
  connectorPolylinesRef: any[]
): any => {
  const connectorPolyline = new mapsApi.Polyline({
    path: [fromPosition, toPosition],
    map: mapInstance,
    strokeColor: "#FF0000",
    strokeWeight: 3,
    strokeOpacity: 0.8,
  });

  marker.connectorPolyline = connectorPolyline;
  connectorPolylinesRef.push(connectorPolyline);
  
  return connectorPolyline;
};

/**
 * Add label to connector line
 */
export const addConnectorLabel = (
  mapsApi: any,
  mapInstance: any,
  fromPosition: Position,
  toPosition: Position,
  connectorPolyline: any,
  connectorLabelMarkersRef: any[],
  savedLabelInfo?: { position: Position; text: string }
): any => {
  if (!mapsApi || !mapInstance) return null;
  fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offRoadHandler.ts:addConnectorLabel',message:'Adding connector label',data:{fromPosition:fromPosition,toPosition:toPosition,hasSavedLabel:!!savedLabelInfo,savedLabelText:savedLabelInfo?.text},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // Use saved label position if available, otherwise calculate midpoint
  let labelPosition: Position;
  let labelText: string;
  
  if (savedLabelInfo && savedLabelInfo.position) {
    // Use saved position
    labelPosition = savedLabelInfo.position;
    labelText = savedLabelInfo.text || "";
  } else {
    // Calculate midpoint for label placement
    const midLat = (fromPosition.lat + toPosition.lat) / 2;
    const midLng = (fromPosition.lng + toPosition.lng) / 2;
    labelPosition = { lat: midLat, lng: midLng };
    
    // Calculate distance for label
    const distance = calculateDistance(fromPosition, toPosition);
    labelText = distance >= 1000 
      ? `${(distance / 1000).toFixed(2)} km` 
      : `${Math.round(distance)} m`;
  }
  
  // Create transparent icon so only the label shows
  const transparentIcon = {
    url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    size: new mapsApi.Size(1, 1),
    anchor: new mapsApi.Point(0, 0),
  };
  
  // Create label marker at saved or calculated position
  const labelMarker = new mapsApi.Marker({
    position: labelPosition,
    map: mapInstance,
    label: {
      text: labelText,
      color: "#000000",
      fontSize: "12px",
      fontWeight: "bold",
    },
    icon: transparentIcon,
  });
  
  // Store label marker reference with the connector polyline for cleanup
  connectorPolyline.labelMarker = labelMarker;
  connectorLabelMarkersRef.push(labelMarker);
  return labelMarker;
};

/**
 * Snap to road and draw connector for off-road checkpoints
 * IMPORTANT: Off-road checkpoints connect to ON-ROAD checkpoints only
 * IMPORTANT: Green road markers should NOT be created for off-road checkpoints
 */
export const snapToRoadAndDrawConnector = async (
  originalPos: Position,
  marker: MarkerWithExtras,
  existingCheckpoints: Position[],
  existingMarkers: MarkerWithExtras[],
  mapsApi: any,
  mapInstance: any,
  connectorPolylinesRef: any[],
  connectorLabelMarkersRef: any[]
): Promise<void> => {
  const apiKey = "11e685bcf1e448a8ab56b428e61dfad4";
  const url = `https://api.geoapify.com/v1/routing?waypoints=${originalPos.lat},${originalPos.lng}|${originalPos.lat},${originalPos.lng}&mode=drive&apiKey=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.features && data.features[0]?.geometry?.coordinates) {
      const coordsArray = data.features[0].geometry.coordinates;

      if (coordsArray.length > 0 && coordsArray[0].length > 0) {
        const snappedPoint: Position = {
          lat: Number(coordsArray[0][0][1]),
          lng: Number(coordsArray[0][0][0]),
        };

        // Check if the clicked point is off-road (distance > 10m from snapped point)
        const distanceFromRoad = calculateDistance(originalPos, snappedPoint);
        const isOffRoad = distanceFromRoad > 10;

        // IMPORTANT: Only off-road checkpoints should have connector lines
        // On-road checkpoints connect via the route path, not via connector lines
        // If the click is off-road, find the closest ON-ROAD checkpoint and draw a connector line
        if (isOffRoad && existingCheckpoints.length > 0) {
          // Find the closest ON-ROAD checkpoint from existing checkpoints array
          // Off-road checkpoints should connect to ON-ROAD checkpoints
          let nearestCheckpoint: Position | null = null;
          let nearestCheckpointIndex: number = -1;
          let minDist = Infinity;

          // Iterate through existing checkpoints and find the nearest ON-ROAD one
          existingCheckpoints.forEach((checkpoint, index) => {
            // Check if this existing checkpoint is ON-ROAD by checking its corresponding marker
            const existingMarker = existingMarkers[index];
            const isExistingOffRoad = existingMarker && (existingMarker.roadMarker || existingMarker.isOffRoad);
            
            // Only consider ON-ROAD checkpoints (those WITHOUT roadMarker or isOffRoad flag)
            if (!isExistingOffRoad) {
              // Calculate distance to this on-road checkpoint
              const dist = calculateDistance(originalPos, checkpoint);
              
              // Update if this is the closest on-road checkpoint so far
              if (dist < minDist) {
                minDist = dist;
                nearestCheckpoint = checkpoint;
                nearestCheckpointIndex = index;
              }
            }
          });

          // If we found an on-road checkpoint, draw a straight line to it
          if (nearestCheckpoint) {
            const connectorPolyline = createConnectorPolyline(
              mapsApi,
              mapInstance,
              originalPos,
              nearestCheckpoint,
              marker,
              connectorPolylinesRef
            );

            // Add label to connector line
            addConnectorLabel(
              mapsApi,
              mapInstance,
              originalPos,
              nearestCheckpoint,
              connectorPolyline,
              connectorLabelMarkersRef
            );

            marker.connectorToIndex = nearestCheckpointIndex; // Store the target checkpoint index
          }

          // IMPORTANT: Green road markers should ONLY appear for ON-ROAD checkpoints
          // For off-road checkpoints, we only show the red connector line, NOT the green marker
          // So we do NOT create green road markers for off-road checkpoints
          // Only the connector line will be shown to connect off-road points to on-road points

          // Store the snapped point info for saving, but don't create the green marker
          // Use a flag to indicate this is an off-road checkpoint (for saving purposes)
          // We don't create the green road marker - only the connector line will be shown
          marker.isOffRoad = true; // Flag to indicate off-road checkpoint
          marker.snappedPoint = snappedPoint; // Store snapped point for saving
        }
      }
    }
  } catch (error) {
    console.log("Error snapping to road:", error);
  }
};

/**
 * Restore connector line for off-road checkpoint
 */
export const restoreConnectorLine = (
  mapsApi: any,
  mapInstance: any,
  marker: MarkerWithExtras,
  checkpointInfo: CheckpointInfo,
  checkpoints: CheckpointInfo[],
  allMarkers: MarkerWithExtras[],
  restoredMarkers: MarkerWithExtras[],
  connectorPolylinesRef: any[],
  connectorLabelMarkersRef: any[]
): boolean => {
  const isOffRoad = checkpointInfo.isOffRoad || !!checkpointInfo.snappedPoint;
  if (!isOffRoad) return false; // Skip on-road checkpoints

  // Skip if already has connector
  if (marker.connectorPolyline) return true;

  const markerPos = marker.getPosition();
  if (!markerPos) return false;
  const fromPosition: Position = { lat: markerPos.lat(), lng: markerPos.lng() };

  let connectorDrawn = false;

  // First, try to restore saved connector (from connectorTo field or connectorToPosition)
  let targetPosition: Position | null = null;
  let targetMarker: MarkerWithExtras | null = null;

  // Check if connectorToPosition is saved (for connectors to checkpoints outside the route)
  if (checkpointInfo.connectorToPosition) {
    targetPosition = checkpointInfo.connectorToPosition;
    // Find the marker at this position
    targetMarker = allMarkers.find((m: MarkerWithExtras) => {
      const pos = m.getPosition();
      if (!pos) return false;
      return Math.abs(pos.lat() - targetPosition!.lat) < 0.000001 &&
             Math.abs(pos.lng() - targetPosition!.lng) < 0.000001;
    }) || null;
  }
  // Otherwise, check connectorTo index within this route
  else if (checkpointInfo.connectorTo !== null &&
           checkpointInfo.connectorTo !== undefined &&
           checkpointInfo.connectorTo < checkpoints.length) {
    const targetCheckpoint = checkpoints[checkpointInfo.connectorTo];
    if (targetCheckpoint && targetCheckpoint.position) {
      targetPosition = targetCheckpoint.position;
      // Find the marker at this position (could be in current route or previous routes)
      // First check restored markers in this route
      targetMarker = restoredMarkers.find((m: MarkerWithExtras) => {
        const pos = m.getPosition();
        if (!pos) return false;
        return Math.abs(pos.lat() - targetPosition!.lat) < 0.000001 &&
               Math.abs(pos.lng() - targetPosition!.lng) < 0.000001;
      }) || null;

      // If not found, search in all markers
      if (!targetMarker) {
        targetMarker = allMarkers.find((m: MarkerWithExtras) => {
          const pos = m.getPosition();
          if (!pos) return false;
          return Math.abs(pos.lat() - targetPosition!.lat) < 0.000001 &&
                 Math.abs(pos.lng() - targetPosition!.lng) < 0.000001;
        }) || null;
      }
    }
  }

  // If we have a target position and marker, restore the connector
  if (targetPosition && targetMarker) {
    const targetPos = targetMarker.getPosition();
    if (targetPos) {
      const toPosition: Position = { lat: targetPos.lat(), lng: targetPos.lng() };
      
      // Verify target is on-road (off-road checkpoints connect to on-road checkpoints)
      const isTargetOnRoad = targetMarker && !targetMarker.roadMarker && !targetMarker.isOffRoad;
      
      if (isTargetOnRoad) {
        const connectorPolyline = createConnectorPolyline(
          mapsApi,
          mapInstance,
          fromPosition,
          toPosition,
          marker,
          connectorPolylinesRef
        );

        // Add label to connector line (use saved label info if available)
        addConnectorLabel(
          mapsApi,
          mapInstance,
          fromPosition,
          toPosition,
          connectorPolyline,
          connectorLabelMarkersRef,
          checkpointInfo.connectorLabel
        );

        connectorDrawn = true;
      }
    }
  }

  // If no saved connector, find nearest on-road checkpoint
  if (!connectorDrawn) {
    const nearest = findNearestOnRoadCheckpoint(
      fromPosition,
      marker,
      allMarkers,
      checkpoints.map((cp: CheckpointInfo) => ({ position: cp.position, isOffRoad: cp.isOffRoad }))
    );

    if (nearest) {
      const connectorPolyline = createConnectorPolyline(
        mapsApi,
        mapInstance,
        fromPosition,
        nearest.position,
        marker,
        connectorPolylinesRef
      );

      // Add label to connector line (use saved label info if available)
      addConnectorLabel(
        mapsApi,
        mapInstance,
        fromPosition,
        nearest.position,
        connectorPolyline,
        connectorLabelMarkersRef,
        checkpointInfo.connectorLabel
      );

      connectorDrawn = true;
    }
  }

  return connectorDrawn;
};

