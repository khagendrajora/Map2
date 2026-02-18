import { useEffect, useRef, useState } from "react";
import "./App.css";
import { loadGoogleMaps } from "./google-map-loader";
import {
  calculateDistance,
  updateMarkerLabels,
  snapToRoadAndDrawConnector,
  restoreConnectorLine,
  addConnectorLabel,
  findNearestOnRoadCheckpoint,
  type Position,
} from "./offRoadHandler";

function App() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const mapsApi = useRef<any>(null);

  const routePolylineRef = useRef<any>(null);
  const connectorPolylinesRef = useRef<any[]>([]);
  const connectorLabelMarkersRef = useRef<any[]>([]);
  const routeLabelMarkersRef = useRef<any[]>([]);
  const allRoutesRef = useRef<any[]>([]); // Store all routes for restoration

  // const [markers, setMarkers] = useState([
  //   {
  //     coords: { lat: 27.696354, lng: 85.336537 },
  //     IconImage:
  //       "https://developers.google.com/maps/documentation/javascript/examples/full/images/beachflag.png",
  //     title: "location 1",
  //   },
  //   {
  //     coords: { lat: 27.696662677926415, lng: 85.33526643980764 },
  //     IconImage:
  //       "https://developers.google.com/maps/documentation/javascript/examples/full/images/beachflag.png",
  //     title: "location 2",
  //   },
  //   {
  //     coords: { lat: 27.696865502368286, lng: 85.33607831974011 },
  //     IconImage:
  //       "https://developers.google.com/maps/documentation/javascript/examples/full/images/beachflag.png",
  //     title: "location 3",
  //   },
  // ]);

  const [checkPoints, setCheckPoints] = useState<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const [distances, setDistances] = useState<{ from: number; to: number; distance: number }[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<any[]>([]);
  const savedRoutesRef = useRef<any[]>([]);


  // Function to save route data to localStorage
  const saveRouteData = (label: string, response: any, distances: any[], routeCheckpoints: any[]) => {
    // Only save checkpoints that belong to THIS specific route
    // routeCheckpoints contains only the checkpoints used for this route calculation
    console.log(`Saving route "${label}" with ${routeCheckpoints.length} checkpoints`);

    const checkpointData: any[] = [];

    routeCheckpoints.forEach((checkpoint, routeIndex) => {
      // Find the corresponding marker for this checkpoint in the global markers array
      const globalIndex = checkPoints.findIndex((cp: any) =>
        cp && checkpoint &&
        typeof cp.lat === 'number' && typeof cp.lng === 'number' &&
        typeof checkpoint.lat === 'number' && typeof checkpoint.lng === 'number' &&
        Math.abs(cp.lat - checkpoint.lat) < 0.000001 &&
        Math.abs(cp.lng - checkpoint.lng) < 0.000001
      );

      if (globalIndex === -1) {
        console.warn(`Marker not found for checkpoint at route index ${routeIndex}:`, checkpoint);
        return;
      }

      const marker = markersRef.current[globalIndex];
      if (!marker) {
        console.warn(`Marker not found at global index ${globalIndex}`);
        return;
      }

      // Determine if checkpoint is off-road - check both roadMarker (old way) and isOffRoad flag (new way)
      const isOffRoad = !!marker.roadMarker || !!marker.isOffRoad;

      const snappedPoint = marker.roadMarker ? {
        lat: marker.roadMarker.getPosition().lat(),
        lng: marker.roadMarker.getPosition().lng(),
      } : (marker.snappedPoint || null);

      const checkpointInfo: any = {
        position: checkpoint,
        isOffRoad: isOffRoad,
        snappedPoint: snappedPoint,
        connectorTo: null, // Will be set if there's a connector line
      };

      // IMPORTANT: Only save connectorTo for OFF-ROAD checkpoints
      // On-road checkpoints connect via the route path, not via connector lines

      // If there's a connector polyline AND this is an off-road checkpoint, find which checkpoint it connects to
      // Note: connectorTo index is relative to THIS route's checkpoint array
      if (isOffRoad && marker.connectorPolyline) {
        const connectorPath = marker.connectorPolyline.getPath();
        if (connectorPath && connectorPath.getLength() === 2) {
          const startPoint = connectorPath.getAt(0);
          const endPoint = connectorPath.getAt(1);

          // First, try to find the target checkpoint within THIS route's checkpoints
          let foundInRoute = false;
          routeCheckpoints.forEach((cp, cpRouteIndex) => {
            if (cpRouteIndex !== routeIndex && !foundInRoute) {
              const dist1 = calculateDistance(
                { lat: startPoint.lat(), lng: startPoint.lng() },
                checkpoint
              );
              const dist2 = calculateDistance(
                { lat: endPoint.lat(), lng: endPoint.lng() },
                cp
              );
              // Check if this connector connects the current checkpoint to cp
              // The connector should start near the current checkpoint and end near cp
              if (dist1 < 1 && dist2 < 1) {
                checkpointInfo.connectorTo = cpRouteIndex; // Index within THIS route's checkpoint array

                // Save label information if it exists
                // if (marker.connectorPolyline.labelMarker) {
                //   const labelPos = marker.connectorPolyline.labelMarker.getPosition();
                //   if (labelPos) {
                //     checkpointInfo.connectorLabel = {
                //       position: { lat: labelPos.lat(), lng: labelPos.lng() },
                //       text: marker.connectorPolyline.labelMarker.getLabel()?.text || ""
                //     };
                //   }
                // }

                console.log(`Saving connector: route checkpoint ${routeIndex} connects to route checkpoint ${cpRouteIndex} (within same route)`);
              }
            }
          });

          if (!foundInRoute) {
            // Find the target checkpoint in the global checkpoints array
            checkPoints.forEach((globalCp: any, globalIndex: number) => {
              if (!foundInRoute && globalCp) {
                const dist1 = calculateDistance(
                  { lat: startPoint.lat(), lng: startPoint.lng() },
                  checkpoint
                );
                const dist2 = calculateDistance(
                  { lat: endPoint.lat(), lng: endPoint.lng() },
                  globalCp
                );
                // Check if this connector connects the current checkpoint to globalCp
                if (dist1 < 1 && dist2 < 1) {
                  // Find if this global checkpoint exists in the routeCheckpoints array
                  const routeIndexInRoute = routeCheckpoints.findIndex((rcp: any) =>
                    rcp && globalCp &&
                    Math.abs(rcp.lat - globalCp.lat) < 0.000001 &&
                    Math.abs(rcp.lng - globalCp.lng) < 0.000001
                  );

                  if (routeIndexInRoute !== -1) {
                    // Target checkpoint is in this route
                    checkpointInfo.connectorTo = routeIndexInRoute;
                    console.log(`Saving connector: route checkpoint ${routeIndex} connects to route checkpoint ${routeIndexInRoute} (found via global search)`);
                    foundInRoute = true;
                  } else {
                    // Target checkpoint is NOT in this route - we need to save it differently
                    // For now, we'll save the position and find it during restore
                    checkpointInfo.connectorTo = null; // Will be handled during restore by finding nearest
                    console.log(`Saving connector: route checkpoint ${routeIndex} connects to checkpoint outside this route at ${globalCp.lat}, ${globalCp.lng}`);
                    // Store the target position for restoration
                    checkpointInfo.connectorToPosition = globalCp;
                    foundInRoute = true;
                  }
                }
              }
            });
          }


        }
      }

      checkpointData.push(checkpointInfo);
    });

    const routeData = {
      label: label,
      response: response,
      distances: distances,
      checkpoints: checkpointData,
    };

    const existingRoutes = JSON.parse(localStorage.getItem("savedRoutes") || "[]");
    existingRoutes.push(routeData);
    localStorage.setItem("savedRoutes", JSON.stringify(existingRoutes));
    setSavedRoutes(existingRoutes);
    savedRoutesRef.current = existingRoutes;

    // Also download as JSON file in the requested format
    const dataArray = existingRoutes.map((route: any) => ({
      label: route.label,
      response: route.response,
      distances: route.distances,
      checkpoints: route.checkpoints || [],
    }));

    // Console log the saved data format
    console.log("Saved Route Data (JSON Format):", JSON.stringify(dataArray, null, 2));

    // Also log what's in localStorage for debugging
    const localStorageData = localStorage.getItem("savedRoutes");
    console.log("Data in localStorage:", localStorageData ? JSON.parse(localStorageData) : "No data");

    const dataStr = JSON.stringify(dataArray, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `routes_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };




  // Function to load saved routes from localStorage
  const loadSavedRoutes = () => {
    const saved = localStorage.getItem("savedRoutes");
    if (saved) {
      try {
        const routes = JSON.parse(saved);
        console.log("Loading routes from localStorage:", routes);
        console.log("Number of routes:", routes.length);
        routes.forEach((route: any, index: number) => {
          console.log(`Route ${index + 1}:`, {
            label: route.label,
            checkpointsCount: route.checkpoints?.length || 0,
            checkpoints: route.checkpoints?.map((cp: any) => ({
              position: cp.position,
              isOffRoad: cp.isOffRoad,
              hasSnappedPoint: !!cp.snappedPoint,
              connectorTo: cp.connectorTo
            }))
          });
        });
        setSavedRoutes(routes);
        savedRoutesRef.current = routes;
        return routes;
      } catch (error) {
        console.error("Error loading saved routes:", error);
        return [];
      }
    }
    console.log("No saved routes in localStorage");
    return [];
  };

  // Function to restore checkpoints with connector lines
  const restoreCheckpoints = (checkpoints: any[]) => {
    if (!mapsApi.current || !mapInstance.current || !checkpoints || checkpoints.length === 0) {
      console.warn("restoreCheckpoints: Early return - mapsApi:", !!mapsApi.current, "mapInstance:", !!mapInstance.current, "checkpoints:", checkpoints?.length);
      return;
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'App.tsx:807', message: 'restoreCheckpoints entry', data: { checkpointsCount: checkpoints.length, checkpoints: checkpoints.map((cp: any, i: number) => ({ index: i, position: cp.position, isOffRoad: cp.isOffRoad, hasSnappedPoint: !!cp.snappedPoint })) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    console.log(`[restoreCheckpoints] Starting restoration of ${checkpoints.length} checkpoints. Current markersRef.length: ${markersRef.current.length}`);

    // First, check which checkpoints already exist to avoid duplicates
    // Check markersRef.current which is always up-to-date (every checkpoint has a marker)
    const existingPositions = new Set(
      markersRef.current.map((marker: any) => {
        const pos = marker.getPosition();
        return pos ? `${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}` : null;
      }).filter((key: any) => key !== null)
    );

    console.log(`[restoreCheckpoints] Found ${existingPositions.size} existing checkpoint positions`);

    const restoredMarkers: any[] = [];
    const restoredCheckpoints: any[] = [];
    const checkpointIndexMap = new Map<number, number>(); // Map original index to restored index

    checkpoints.forEach((checkpointInfo: any, originalIndex: number) => {
      const position = checkpointInfo.position;

      // Validate position before using it
      if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
        console.warn(`Invalid checkpoint position at index ${originalIndex}:`, position);
        return; // Skip invalid checkpoints
      }
      if (!isFinite(position.lat) || !isFinite(position.lng)) {
        console.warn(`Non-finite checkpoint coordinates at index ${originalIndex}:`, position);
        return; // Skip invalid checkpoints
      }

      // Check if this checkpoint already exists (duplicate check)
      const positionKey = `${position.lat.toFixed(6)},${position.lng.toFixed(6)}`;
      if (existingPositions.has(positionKey)) {
        console.log(`Skipping duplicate checkpoint at index ${originalIndex}:`, position);

        // Even though checkpoint exists, we need to restore connector lines and road markers for off-road checkpoints
        const isOffRoad = checkpointInfo.isOffRoad || !!checkpointInfo.snappedPoint;
        if (isOffRoad) {
          // Find the existing marker for this checkpoint
          const existingMarker = markersRef.current.find((m: any) => {
            const pos = m.getPosition();
            if (!pos) return false;
            const markerKey = `${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}`;
            return markerKey === positionKey;
          });

          if (existingMarker) {
            // Restore road marker (snapped point) if it doesn't exist
            if (checkpointInfo.snappedPoint && !existingMarker.roadMarker) {
              const snappedPoint = checkpointInfo.snappedPoint;
              if (typeof snappedPoint.lat === 'number' && typeof snappedPoint.lng === 'number' &&
                isFinite(snappedPoint.lat) && isFinite(snappedPoint.lng)) {
                const roadMarker = new mapsApi.current.Marker({
                  position: snappedPoint,
                  map: mapInstance.current,
                  icon: {
                    path: mapsApi.current.SymbolPath.CIRCLE,
                    scale: 6,
                    fillColor: "#00FF00",
                    fillOpacity: 1,
                    strokeColor: "#006600",
                    strokeWeight: 2,
                  },
                  title: "Road connection point",
                });
                existingMarker.roadMarker = roadMarker;
              }
            }

            // Restore connector line if it doesn't exist
            if (!existingMarker.connectorPolyline) {
              // Get the actual marker position (not the saved position)
              const markerPos = existingMarker.getPosition();
              if (!markerPos) return;
              const fromPosition = { lat: markerPos.lat(), lng: markerPos.lng() };

              // First, try to restore saved connector
              if (checkpointInfo.connectorTo !== null && checkpointInfo.connectorTo !== undefined && checkpointInfo.connectorTo < checkpoints.length) {
                const targetCheckpoint = checkpoints[checkpointInfo.connectorTo];
                if (targetCheckpoint && targetCheckpoint.position) {
                  // Find the actual marker for the target checkpoint
                  // Check both restoredMarkers (current batch) and markersRef.current (previous routes)
                  const targetKey = `${targetCheckpoint.position.lat.toFixed(6)},${targetCheckpoint.position.lng.toFixed(6)}`;
                  let targetMarker: any = null;

                  // First check restoredMarkers (current batch)
                  restoredMarkers.forEach((m: any) => {
                    if (targetMarker) return;
                    const pos = m.getPosition();
                    if (pos) {
                      const markerKey = `${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}`;
                      if (markerKey === targetKey) {
                        targetMarker = m;
                      }
                    }
                  });

                  // Then check markersRef.current (previous routes)
                  if (!targetMarker) {
                    markersRef.current.forEach((m: any) => {
                      if (targetMarker) return;
                      const pos = m.getPosition();
                      if (pos) {
                        const markerKey = `${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}`;
                        if (markerKey === targetKey) {
                          targetMarker = m;
                        }
                      }
                    });
                  }

                  if (targetMarker) {
                    const targetPos = targetMarker.getPosition();
                    if (targetPos) {
                      const toPosition = { lat: targetPos.lat(), lng: targetPos.lng() };
                      console.log(`Restoring connector line for existing checkpoint ${originalIndex} to checkpoint ${checkpointInfo.connectorTo}`);
                      const connectorPolyline = new mapsApi.current.Polyline({
                        path: [fromPosition, toPosition],
                        map: mapInstance.current,
                        strokeColor: "#FF0000",
                        strokeWeight: 3,
                        strokeOpacity: 0.8,
                      });
                      existingMarker.connectorPolyline = connectorPolyline;
                      connectorPolylinesRef.current.push(connectorPolyline);
                      // Add label to connector line (use saved label info if available)
                      handleAddConnectorLabel(fromPosition, toPosition, connectorPolyline, checkpointInfo.connectorLabel);
                    }
                  }
                }
              } else {
                // If no saved connector, find nearest checkpoint marker
                let nearestCheckpointMarker: any = null;
                let minDist = Infinity;

                markersRef.current.forEach((otherMarker: any) => {
                  if (otherMarker === existingMarker) return;
                  const otherPos = otherMarker.getPosition();
                  if (otherPos) {
                    const dist = calculateDistance(
                      fromPosition,
                      { lat: otherPos.lat(), lng: otherPos.lng() }
                    );
                    if (dist < minDist && dist > 0) {
                      minDist = dist;
                      nearestCheckpointMarker = otherMarker;
                    }
                  }
                });

                if (nearestCheckpointMarker) {
                  const nearestPos = nearestCheckpointMarker.getPosition();
                  if (nearestPos) {
                    const toPosition = { lat: nearestPos.lat(), lng: nearestPos.lng() };
                    console.log(`Restoring connector line for existing checkpoint ${originalIndex} to nearest checkpoint`);
                    const connectorPolyline = new mapsApi.current.Polyline({
                      path: [fromPosition, toPosition],
                      map: mapInstance.current,
                      strokeColor: "#FF0000",
                      strokeWeight: 3,
                      strokeOpacity: 0.8,
                    });
                    existingMarker.connectorPolyline = connectorPolyline;
                    connectorPolylinesRef.current.push(connectorPolyline);
                    // Add label to connector line (use saved label info if available)
                    handleAddConnectorLabel(fromPosition, toPosition, connectorPolyline, checkpointInfo.connectorLabel);
                  }
                }
              }
            }
          }
        }

        return; // Skip duplicate checkpoint
      }

      const restoredIndex = restoredCheckpoints.length;
      checkpointIndexMap.set(originalIndex, restoredIndex);
      restoredCheckpoints.push(position);
      existingPositions.add(positionKey); // Track this checkpoint to avoid duplicates within the same batch

      // Get current checkpoints to calculate the final index
      const currentCheckpoints = checkPoints;

      // Calculate the label based on the final position in checkPoints array
      // This ensures labels match the distance indices (1-based)
      const finalIndex = currentCheckpoints.length + restoredCheckpoints.length;

      // Create marker for checkpoint
      console.log(`[restoreCheckpoints] Creating new marker for checkpoint ${originalIndex} at position:`, position);
      const marker = new mapsApi.current.Marker({
        position: position,
        map: mapInstance.current,
        label: `${finalIndex}`,
      });

      marker.addListener("click", () => {
        removePoint(marker, position);
      });

      restoredMarkers.push(marker);

      fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'App.tsx:826', message: 'Creating checkpoint marker', data: { index: originalIndex, position: position, isOffRoad: checkpointInfo.isOffRoad, hasSnappedPoint: !!checkpointInfo.snappedPoint }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
      console.log(`[restoreCheckpoints] Marker created and added to restoredMarkers. Total restoredMarkers: ${restoredMarkers.length}`);

      // If checkpoint has a snappedPoint (indicating it's off-road), restore road marker
      // Check snappedPoint first as it's the most reliable indicator
      if (checkpointInfo.snappedPoint) {
        const snappedPoint = checkpointInfo.snappedPoint;
        // Validate snapped point
        if (typeof snappedPoint.lat === 'number' && typeof snappedPoint.lng === 'number' &&
          isFinite(snappedPoint.lat) && isFinite(snappedPoint.lng)) {
          // Create road marker at snapped point
          const roadMarker = new mapsApi.current.Marker({
            position: snappedPoint,
            map: mapInstance.current,
            icon: {
              path: mapsApi.current.SymbolPath.CIRCLE,
              scale: 6,
              fillColor: "#00FF00",
              fillOpacity: 1,
              strokeColor: "#006600",
              strokeWeight: 2,
            },
            title: "Road connection point",
          });

          marker.roadMarker = roadMarker;
        }
      }

      // IMPORTANT: Green road markers should ONLY appear for ON-ROAD checkpoints
      // For off-road checkpoints, we only show the red connector line, NOT the green marker
      // So we do NOT create green road markers for off-road checkpoints during restoration
      // The green marker creation is removed - only connector lines will be shown for off-road checkpoints
    });

    // Update state and refs BEFORE restoring connectors (so all markers are available)
    // Only add new markers that don't already exist in markersRef.current
    const newMarkers = restoredMarkers.filter((newMarker) => {
      return !markersRef.current.some((existingMarker) => existingMarker === newMarker);
    });
    markersRef.current = [...markersRef.current, ...newMarkers];
    setCheckPoints((prev) => {
      const updated = [...prev, ...restoredCheckpoints];
      // Update all marker labels after state update to match checkpoint indices
      setTimeout(() => {
        updateMarkerLabels(updated, markersRef.current);
      }, 0);
      return updated;
    });

    // STEP 2: Restore connector lines for off-road checkpoints
    checkpoints.forEach((checkpointInfo: any, originalIndex: number) => {
      const position = checkpointInfo.position;
      if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') return;

      // Find the marker by position (not by index, because some checkpoints might have been skipped as duplicates)
      const positionKey = `${position.lat.toFixed(6)},${position.lng.toFixed(6)}`;
      let marker: any = null;

      // First check in restoredMarkers
      restoredMarkers.forEach((m: any) => {
        const pos = m.getPosition();
        if (pos) {
          const markerKey = `${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}`;
          if (markerKey === positionKey) {
            marker = m;
          }
        }
      });

      // If not found, check in markersRef (might be a duplicate that was skipped)
      if (!marker) {
        markersRef.current.forEach((m: any) => {
          const pos = m.getPosition();
          if (pos) {
            const markerKey = `${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}`;
            if (markerKey === positionKey) {
              marker = m;
            }
          }
        });
      }

      if (!marker) return;

      // Only restore connector lines for OFF-ROAD checkpoints
      const isOffRoad = checkpointInfo.isOffRoad || !!checkpointInfo.snappedPoint;

      fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'App.tsx:875', message: 'Checking if checkpoint needs connector', data: { index: originalIndex, position: position, isOffRoad: isOffRoad, checkpointIsOffRoad: checkpointInfo.isOffRoad, hasSnappedPoint: !!checkpointInfo.snappedPoint }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });

      if (!isOffRoad) return; // Skip on-road checkpoints

      // Skip if already has connector
      if (marker.connectorPolyline) return;

      let connectorDrawn = false;

      // First, try to restore saved connector (from connectorTo field or connectorToPosition)
      let targetPosition: any = null;

      // Check if connectorToPosition is saved (for connectors to checkpoints outside the route)
      if (checkpointInfo.connectorToPosition) {
        targetPosition = checkpointInfo.connectorToPosition;
        console.log(`Restoring connector from saved position: ${targetPosition.lat}, ${targetPosition.lng}`);
      }
      // Otherwise, check connectorTo index within this route
      else if (checkpointInfo.connectorTo !== null &&
        checkpointInfo.connectorTo !== undefined &&
        checkpointInfo.connectorTo < checkpoints.length) {
        const targetCheckpoint = checkpoints[checkpointInfo.connectorTo];
        if (targetCheckpoint && targetCheckpoint.position) {
          targetPosition = targetCheckpoint.position;
        }
      }

      // If we have a target position, try to restore the connector
      if (targetPosition &&
        typeof targetPosition.lat === 'number' && typeof targetPosition.lng === 'number' &&
        isFinite(targetPosition.lat) && isFinite(targetPosition.lng)) {
        // Find the marker at this position (could be in current route or previous routes)
        // IMPORTANT: Find by position, not by index, because some checkpoints might have been skipped as duplicates
        let targetMarker: any = null;
        const targetKey = `${targetPosition.lat.toFixed(6)},${targetPosition.lng.toFixed(6)}`;

        // First check in restoredMarkers (current batch)
        restoredMarkers.forEach((m: any) => {
          if (targetMarker) return; // Already found
          const pos = m.getPosition();
          if (pos) {
            const markerKey = `${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}`;
            if (markerKey === targetKey) {
              targetMarker = m;
            }
          }
        });

        // If not found, search in all markers (from previous routes)
        if (!targetMarker) {
          markersRef.current.forEach((m: any) => {
            if (targetMarker) return; // Already found
            const pos = m.getPosition();
            if (pos) {
              const markerKey = `${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}`;
              if (markerKey === targetKey) {
                targetMarker = m;
              }
            }
          });
        }

        // Verify target is on-road (off-road checkpoints connect to on-road checkpoints)
        const isTargetOnRoad = targetMarker && !targetMarker.roadMarker && !targetMarker.isOffRoad;

        if (targetMarker && isTargetOnRoad) {
          const targetPos = targetMarker.getPosition();
          if (targetPos) {
            const fromPos = marker.getPosition();
            if (fromPos) {
              const fromPosition = { lat: fromPos.lat(), lng: fromPos.lng() };
              const toPosition = { lat: targetPos.lat(), lng: targetPos.lng() };
              console.log(`Restoring saved connector: off-road checkpoint ${originalIndex} to on-road checkpoint at ${targetPosition.lat}, ${targetPosition.lng}`);
              const connectorPolyline = new mapsApi.current.Polyline({
                path: [fromPosition, toPosition],
                map: mapInstance.current,
                strokeColor: "#FF0000",
                strokeWeight: 3,
                strokeOpacity: 0.8,
              });

              marker.connectorPolyline = connectorPolyline;
              connectorPolylinesRef.current.push(connectorPolyline);
              connectorDrawn = true;
            }
          }
        } else {
          console.warn(`Saved connector target is not on-road or not found, will find nearest on-road checkpoint`);
        }
      }

      // If no saved connector, find nearest on-road checkpoint
      if (!connectorDrawn) {
        const markerPos = marker.getPosition();
        if (!markerPos) return;
        const fromPosition = { lat: markerPos.lat(), lng: markerPos.lng() };

        const nearest = findNearestOnRoadCheckpoint(
          fromPosition,
          marker,
          markersRef.current, // All markers including previously restored ones
          checkpoints.map((cp: any) => ({ position: cp.position, isOffRoad: cp.isOffRoad })) // Current route's checkpoints
        );

        fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'App.tsx:947', message: 'Finding nearest on-road checkpoint', data: { offRoadIndex: originalIndex, offRoadPosition: fromPosition, nearestFound: !!nearest, nearestPosition: nearest?.position, nearestDistance: nearest?.distance }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });

        if (nearest) {
          console.log(`Connecting off-road checkpoint ${originalIndex} to nearest on-road checkpoint at distance ${nearest.distance.toFixed(2)}m`);

          fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'App.tsx:957', message: 'Drawing connector polyline', data: { fromIndex: originalIndex, fromPosition: fromPosition, toPosition: nearest.position }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });

          const connectorPolyline = new mapsApi.current.Polyline({
            path: [fromPosition, nearest.position],
            map: mapInstance.current,
            strokeColor: "#FF0000",
            strokeWeight: 3,
            strokeOpacity: 0.8,
          });

          marker.connectorPolyline = connectorPolyline;
          connectorPolylinesRef.current.push(connectorPolyline);
        } else {
          console.warn(`No on-road checkpoint found for off-road checkpoint ${originalIndex}`);
        }
      }
    });
  };

  // Function to restore a route on the map
  const restoreRoute = (routeData: any) => {
    if (!mapsApi.current || !mapInstance.current) return;

    const data = routeData.response;
    // Only use label if it exists and is not empty - labels are route-specific
    const label = routeData.label && routeData.label.trim() !== "" ? routeData.label : "";

    // Restore checkpoints with connector lines BEFORE drawing the route
    if (routeData.checkpoints && routeData.checkpoints.length > 0) {
      restoreCheckpoints(routeData.checkpoints);
    }

    // Draw the route with its specific label (or no label if none was provided)
    // Labels only appear on the route path where they were originally provided
    drawRoute(data, label, true);
  };

  useEffect(() => {
    // IMPORTANT: Replace with your actual Google Maps API key
    loadGoogleMaps("AIzaSyBQkos0nrQdixBBmGf06TBjXgjtFcShzzU").then((maps) => {
      mapsApi.current = maps;
      mapInstance.current = new maps.Map(mapRef.current!, {
        center: { lat: 28.90258, lng: 80.34553 },
        zoom: 18,
      });

      // markers.forEach((m) => {
      //   new maps.Marker({
      //     position: m.coords,
      //     map: mapInstance.current,
      //     icon: m.IconImage,
      //     title: m.title,
      //   });
      // });
      addClickListener();

      // Load and restore saved routes
      const routes = loadSavedRoutes();
      if (routes.length > 0) {
        console.log("Loading saved routes:", routes.length);
        // Restore all saved routes
        routes.forEach((route: any, routeIndex: number) => {
          console.log(`Restoring route ${routeIndex + 1}: ${route.label}`);
          restoreRoute(route);
        });

        // Final pass: Ensure all connector lines are drawn after all routes are restored
        // This handles cases where connector lines couldn't be drawn during restoration
        setTimeout(() => {
          console.log("Final pass: Ensuring all connector lines are drawn");
          routes.forEach((route: any) => {
            if (route.checkpoints && route.checkpoints.length > 0) {
              route.checkpoints.forEach((checkpointInfo: any) => {
                if (!checkpointInfo.position) return;

                // Find the marker for this checkpoint
                const marker = markersRef.current.find((m: any) => {
                  const pos = m.getPosition();
                  if (!pos) return false;
                  return Math.abs(pos.lat() - checkpointInfo.position.lat) < 0.000001 &&
                    Math.abs(pos.lng() - checkpointInfo.position.lng) < 0.000001;
                });

                if (!marker || marker.connectorPolyline) return; // Skip if no marker or already has connector

                // Only ensure off-road checkpoints have connector lines
                // On-road checkpoints connect via the route path
                // IMPORTANT: Off-road checkpoints connect to ON-ROAD checkpoints only
                const isOffRoad = checkpointInfo.isOffRoad || !!checkpointInfo.snappedPoint;
                if (isOffRoad) {
                  // Use the handler function to restore connector line
                  restoreConnectorLine(
                    mapsApi.current,
                    mapInstance.current,
                    marker,
                    checkpointInfo,
                    [checkpointInfo], // Pass as array for compatibility
                    markersRef.current,
                    [], // No restored markers in final pass
                    connectorPolylinesRef.current,
                    connectorLabelMarkersRef.current
                  );
                }
              });
            }
          });
        }, 500); // Small delay to ensure all routes are fully restored
      }
    });
  }, []);


  const addClickListener = () => {
    mapInstance.current.addListener("click", (event: any) => {
      const pos = {
        lat: event.latLng.lat(),
        lng: event.latLng.lng(),
      };
      console.log("Checkpoint Info:", event)
      setCheckPoints((prev: any) => {
        const newPoints = [...prev, pos];

        const marker = new mapsApi.current.Marker({
          position: pos,
          map: mapInstance.current,
          label: `${newPoints.length}`,
        });

        marker.addListener("click", () => {
          removePoint(marker, pos);
        });

        markersRef.current.push(marker);
        // --- THIS IS THE KEY LOGIC ---
        // This function checks if the clicked point is on a road.
        // If not, it draws the connector line to the closest on-road checkpoint.
        handleSnapToRoadAndDrawConnector(pos, marker, prev);

        return newPoints;
      });
    });
  };

  // Use the off-road handler function
  const handleSnapToRoadAndDrawConnector = async (originalPos: Position, marker: any, existingCheckpoints: Position[]) => {
    await snapToRoadAndDrawConnector(
      originalPos,
      marker,
      existingCheckpoints,
      markersRef.current,
      mapsApi.current,
      mapInstance.current,
      connectorPolylinesRef.current,
      connectorLabelMarkersRef.current
    );
  };

  // calculateDistance is now imported from offRoadHandler.ts

  // addConnectorLabel is now imported from offRoadHandler.ts
  const handleAddConnectorLabel = (fromPosition: Position, toPosition: Position, connectorPolyline: any, savedLabelInfo?: any) => {
    return addConnectorLabel(
      mapsApi.current,
      mapInstance.current,
      fromPosition,
      toPosition,
      connectorPolyline,
      connectorLabelMarkersRef.current,
      savedLabelInfo
    );
  };

  const calculateAllDistances = () => {
    if (checkPoints.length < 2) {
      setDistances([]);
      return;
    }

    // Filter out invalid checkpoints
    const validCheckPoints = checkPoints.filter((cp: any) =>
      cp &&
      typeof cp.lat === 'number' &&
      typeof cp.lng === 'number' &&
      isFinite(cp.lat) &&
      isFinite(cp.lng)
    );

    if (validCheckPoints.length < 2) {
      setDistances([]);
      return;
    }

    const newDistances: { from: number; to: number; distance: number }[] = [];
    for (let i = 0; i < validCheckPoints.length; i++) {
      for (let j = i + 1; j < validCheckPoints.length; j++) {
        const dist = calculateDistance(validCheckPoints[i], validCheckPoints[j]);
        if (dist > 0) { // Only add valid distances
          newDistances.push({
            from: i + 1,
            to: j + 1,
            distance: Math.round(dist * 100) / 100,
          });
        }
      }
    }
    setDistances(newDistances);
  };

  useEffect(() => {
    calculateAllDistances();
    // Update marker labels to match checkpoint indices whenever checkPoints changes
    updateMarkerLabels(checkPoints, markersRef.current);
  }, [checkPoints]);

  const removePoint = (marker: any, point: any) => {
    // This logic correctly removes the extra markers and lines if they exist
    if (marker.connectorPolyline) {
      // Remove label marker if it exists
      if (marker.connectorPolyline.labelMarker) {
        marker.connectorPolyline.labelMarker.setMap(null);
        connectorLabelMarkersRef.current = connectorLabelMarkersRef.current.filter(
          (lm) => lm !== marker.connectorPolyline.labelMarker
        );
      }
      marker.connectorPolyline.setMap(null);
      connectorPolylinesRef.current = connectorPolylinesRef.current.filter(
        (p) => p !== marker.connectorPolyline
      );
    }
    if (marker.roadMarker) {
      marker.roadMarker.setMap(null);
    }

    marker.setMap(null);
    markersRef.current = markersRef.current.filter((m) => m !== marker);
    setCheckPoints((prev: any) =>
      prev.filter((p: any) => p.lat !== point.lat || p.lng !== point.lng)
    );

    if (checkPoints.length > 2) {
      handleCalculate(true);
    } else if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
    }
  };

  const handleCalculate = async (silent = false) => {
    if (checkPoints.length < 2) {
      if (!silent) alert("Please select at least 2 points!");
      return;
    }

    // Prompt for label input (only if not silent)
    let routeLabel = "";
    if (!silent) {
      const input = prompt("Enter a label for this route:");
      if (input === null) {
        // User cancelled, don't proceed
        return;
      }
      routeLabel = input.trim();
    }

    const apiKey = "11e685bcf1e448a8ab56b428e61dfad4";

    const waypointsString = checkPoints
      .map((p: any) => `${p.lat},${p.lng}`)
      .join("|");

    const url = `https://api.geoapify.com/v1/routing?waypoints=${waypointsString}&mode=drive&apiKey=${apiKey}`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      console.log("REsponse:", data)

      if (!data.features || data.features.length === 0) {
        if (!silent) alert("Failed to calculate route.");
        return;
      }

      const legs = data.features[0].properties.legs;
      let totalDistance = 0;
      let totalTime = 0;
      legs.forEach((l: any) => {
        totalDistance += l.distance;
        totalTime += l.time;
      });

      if (!silent) {
        alert(`Distance: ${totalDistance} m\nDuration: ${totalTime} seconds`);
      }

      drawRoute(data, routeLabel);

      // Save route data if label is provided
      // Pass only the checkpoints used for THIS route calculation
      if (routeLabel) {
        saveRouteData(routeLabel, data, distances, checkPoints);
      }
    } catch (error: any) {
      if (!silent) alert("Failed to Calculate");
      console.log(error);
    }
  };

  const drawRoute = (data: any, label: string = "", isRestore: boolean = false) => {
    if (!mapsApi.current || !mapInstance.current) return;
    fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'App.tsx:1362', message: 'drawRoute entry', data: { hasLabel: !!label, label: label, isRestore: isRestore }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });

    const coordsArray = data?.features?.[0]?.geometry?.coordinates;
    if (!coordsArray) {
      if (!isRestore) alert("No route found in the response.");
      return;
    }

    let path: { lat: number; lng: number }[] = [];
    coordsArray.forEach((segment: any) => {
      segment.forEach((c: any) => {
        path.push({ lat: Number(c[1]), lng: Number(c[0]) });
      });
    });

    if (path.length === 0) {
      if (!isRestore) alert("No valid route coordinates");
      return;
    }

    // Console log the checkpoints traveled sequentially (only for new routes)
    if (!isRestore) {
      console.log("Checkpoints traveled sequentially:");
      checkPoints.forEach((checkpoint, index) => {
        console.log(`Checkpoint ${index + 1}:`, checkpoint);
      });
      console.log(`Total checkpoints: ${checkPoints.length}`);
    }

    // Generate a random color for each route
    const colors = ["#007bff", "#28a745", "#dc3545", "#ffc107", "#17a2b8", "#6f42c1", "#e83e8c", "#fd7e14"];
    const routeColor = colors[allRoutesRef.current.length % colors.length];

    const routePolyline = new mapsApi.current.Polyline({
      path,
      map: mapInstance.current,
      strokeColor: routeColor,
      strokeWeight: 6,
    });

    // Store route reference
    if (!isRestore) {
      routePolylineRef.current = routePolyline;
    }

    const labelMarkers: any[] = [];

    // Add label markers along THIS SPECIFIC route path ONLY if label is provided for this route
    // Labels are isolated per route - each route only shows its own label
    if (label && label.trim() !== "") {

      fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'App.tsx:1412', message: 'Adding route labels', data: { label: label, pathLength: path.length, isRestore: isRestore }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
      // Add labels at multiple points along THIS route's path for better visibility
      const labelPositions = [
        Math.floor(path.length * 0.25), // 25% along THIS route's path
        Math.floor(path.length * 0.5),  // 50% (midpoint) of THIS route's path
        Math.floor(path.length * 0.75), // 75% along THIS route's path
      ];

      labelPositions.forEach((pathIndex) => {
        if (pathIndex < path.length) {

          fetch('http://127.0.0.1:7242/ingest/9c4c8c80-63bb-4083-9603-ef2446228ebc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'App.tsx:1420', message: 'Creating label marker on route path', data: { label: label, pathIndex: pathIndex, position: path[pathIndex] }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
          // Create a transparent 1x1 pixel icon so only the label shows
          const transparentIcon = {
            url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
            size: new mapsApi.current.Size(1, 1),
            anchor: new mapsApi.current.Point(0, 0),
          };

          // Label is placed on THIS route's path at the specified position
          const labelMarker = new mapsApi.current.Marker({
            position: path[pathIndex], // Position on THIS route's path
            map: mapInstance.current,
            label: {
              text: label, // This route's specific label
              color: "#000000",
              fontSize: "14px",
              fontWeight: "bold",
            },
            icon: transparentIcon,
          });
          labelMarkers.push(labelMarker);
          if (!isRestore) {
            routeLabelMarkersRef.current.push(labelMarker);
          }
        }
      });
    }

    // Store route data for restoration
    const routeData = {
      polyline: routePolyline,
      labelMarkers: labelMarkers,
      path: path,
      label: label,
    };
    allRoutesRef.current.push(routeData);

    // Fit bounds to show all routes
    const bounds = new mapsApi.current.LatLngBounds();
    allRoutesRef.current.forEach((route: any) => {
      route.path.forEach((p: any) => bounds.extend(p));
    });
    mapInstance.current.fitBounds(bounds);
  };

  const reset = () => {
    setCheckPoints([]);
    setDistances([]);

    markersRef.current.forEach((m) => {
      m.setMap(null);
      if (m.connectorPolyline) {
        m.connectorPolyline.setMap(null);
      }
      if (m.roadMarker) {
        m.roadMarker.setMap(null);
      }
    });
    markersRef.current = [];

    connectorPolylinesRef.current.forEach((p) => {
      if (p.labelMarker) {
        p.labelMarker.setMap(null);
      }
      p.setMap(null);
    });
    connectorPolylinesRef.current = [];

    // Clear connector label markers
    connectorLabelMarkersRef.current.forEach((marker) => {
      marker.setMap(null);
    });
    connectorLabelMarkersRef.current = [];

    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
    }

    // Clear route label markers
    routeLabelMarkersRef.current.forEach((marker) => {
      marker.setMap(null);
    });
    routeLabelMarkersRef.current = [];

    // Clear all routes and their associated labels
    allRoutesRef.current.forEach((route: any) => {
      route.polyline.setMap(null);
      // Clear labels for THIS specific route only
      if (route.labelMarkers && route.labelMarkers.length > 0) {
        route.labelMarkers.forEach((marker: any) => {
          marker.setMap(null);
        });
      }
    });
    allRoutesRef.current = [];
  };

  return (
    <div className="app-container">
      <div className="map-section">
        <div className="map-wrapper" ref={mapRef} />

        <div className="controls-panel">
          <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "4px", color: "#1a1a1a" }}>Controls</h3>
          <div className="button-group">
            <button
              onClick={() => handleCalculate()}
              className="btn btn-primary"
            >
              ✓ Calculate Route
            </button>
            <button onClick={reset} className="btn btn-danger">
              ↻ Reset
            </button>
          </div>
        </div>
      </div>

      {distances.length > 0 && (
        <div className="data-section">
          <h3>📍 Straight-Line Distances Between Markers</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Distance</th>
                </tr>
              </thead>
              <tbody>
                {distances.map((d, index) => (
                  <tr key={index}>
                    <td>Point {d.from}</td>
                    <td>Point {d.to}</td>
                    <td className="distance-value">
                      {d.distance >= 1000
                        ? `${(d.distance / 1000).toFixed(2)} km`
                        : `${d.distance.toFixed(2)} m`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
