import React, { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, GeoJSON, useMapEvents } from "react-leaflet";
import L from "leaflet";
import axios from "axios";
import "leaflet/dist/leaflet.css";

// ─── Constants & Assets ────────────────────────────────────────────────────────
const DEFAULT_CENTER = [52.308, 4.764];
const DEFAULT_ZOOM = 17;
const MARKER_VISIBILITY_ZOOM = 14; 

const createIcon = (color) => new L.Icon({
  iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const ICONS = {
  gate: createIcon("green"),
  elevator: createIcon("gold"),
  stairs: createIcon("orange"),
  checkpoint: createIcon("red"),
  shop: createIcon("violet"),
  restaurant: createIcon("red"),
  restroom: createIcon("blue"),
  default: createIcon("blue")
};

const FEATURE_STYLES = {
  gate: { color: "#059669", weight: 2, fillColor: "#10b981", fillOpacity: 0.6 },
  shop: { color: "#7c3aed", weight: 1, fillColor: "#8b5cf6", fillOpacity: 0.5 },
  restaurant: { color: "#dc2626", weight: 1, fillColor: "#ef4444", fillOpacity: 0.5 },
  restroom: { color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.5 },
  corridor: { color: "#4b5563", weight: 1, fillColor: "#f3f4f6", fillOpacity: 0.3 },
  default: { color: "#9ca3af", weight: 1, fillColor: "#e5e7eb", fillOpacity: 0.4 }
};

const FLOOR_NAMES = {
  "-1": "Lower Level / Transport",
  "0": "Arrivals Hall",
  "1": "Departures & Lounges",
  "2": "Gate Level"
};

const FALLBACK_NODES = [
  { nodeId: "G1", name: "Gate D1", type: "gate", level: 1, location: { coordinates: [4.762, 52.309] } },
  { nodeId: "G2", name: "Gate D2", type: "gate", level: 1, location: { coordinates: [4.764, 52.310] } },
  { nodeId: "E1", name: "Main Elevator", type: "elevator", level: 1, location: { coordinates: [4.765, 52.308] } },
];

// ─── Components ───────────────────────────────────────────────────────────────

function MapController({ setZoom, setMap }) {
  const map = useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });
  useEffect(() => { if (map) setMap(map); }, [map, setMap]);
  return null;
}

export default function MapView() {
  const [nodes, setNodes] = useState(FALLBACK_NODES);
  const [services, setServices] = useState([]);
  const [indoorData, setIndoorData] = useState(null);
  const [fullPath, setFullPath] = useState([]); // Array of full node objects
  const [floor, setFloor] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [startNode, setStartNode] = useState(null);
  const [endNode, setEndNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [map, setMap] = useState(null);

  // 1. Initial Data Fetch
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const geoResponse = await fetch("/maps/ams-unified.geojson");
        if (geoResponse.ok) {
          const data = await geoResponse.json();
          setIndoorData(data);
        }
        const nodeResponse = await axios.get("http://localhost:3001/api/v1/navigation/nodes").catch(() => null);
        if (nodeResponse?.data?.data) {
          setNodes(nodeResponse.data.data);
        }
      } catch (err) {
        console.warn("Data loading issue:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // 2. Pathfinding Logic
  useEffect(() => {
    if (startNode && endNode) {
      axios.post("http://localhost:3001/api/v1/navigation/find-path", {
        fromNodeId: startNode.nodeId,
        toNodeId: endNode.nodeId,
      }).then(r => {
        setFullPath(r.data.data.path);
      }).catch(() => {
        setFullPath([]);
      });
    } else {
      setFullPath([]);
    }
  }, [startNode, endNode]);

  // 3. Filtered Path for Current Floor
  const visiblePath = useMemo(() => {
    if (!fullPath.length) return [];
    // Only show path segments where at least one node is on the current floor
    const segments = [];
    for (let i = 0; i < fullPath.length - 1; i++) {
      const n1 = fullPath[i];
      const n2 = fullPath[i+1];
      if (n1.level === floor || n2.level === floor) {
        segments.push([
          [n1.location.coordinates[1], n1.location.coordinates[0]],
          [n2.location.coordinates[1], n2.location.coordinates[0]]
        ]);
      }
    }
    return segments;
  }, [fullPath, floor]);

  // Check if floor change is needed
  const floorChangeNeeded = useMemo(() => {
    if (!fullPath.length) return null;
    const targetFloor = fullPath.find(n => n.nodeId === endNode?.nodeId)?.level;
    if (targetFloor !== undefined && targetFloor !== floor) {
      // Find where the floor change happens
      const transitionNode = fullPath.find(n => (n.type === 'elevator' || n.type === 'stairs') && n.level === floor);
      return { targetFloor, type: transitionNode?.type || 'elevator' };
    }
    return null;
  }, [fullPath, floor, endNode]);

  const visibleNodes = useMemo(() => {
    if (zoom < MARKER_VISIBILITY_ZOOM) return [];
    return nodes.filter(n => n.level === floor);
  }, [nodes, floor, zoom]);

  const visibleFeatures = useMemo(() => {
    if (!indoorData) return null;
    return {
      ...indoorData,
      features: indoorData.features.filter(f => f.properties.level === floor)
    };
  }, [indoorData, floor]);

  const getStyle = (feature) => FEATURE_STYLES[feature.properties.type] || FEATURE_STYLES.default;

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative", fontFamily: "Inter, sans-serif", overflow: "hidden" }}>
      
      {/* ── UI Components ───────────────────────────────────────────────────── */}

      {/* Manual Zoom Controls */}
      <div style={{ position: "absolute", bottom: 20, left: 20, zIndex: 1001, display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={() => map?.zoomIn()} style={{ width: 44, height: 44, borderRadius: "12px", border: "none", background: "white", color: "#1e3a8a", fontWeight: "bold", fontSize: "20px", cursor: "pointer", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>+</button>
        <button onClick={() => map?.zoomOut()} style={{ width: 44, height: 44, borderRadius: "12px", border: "none", background: "white", color: "#1e3a8a", fontWeight: "bold", fontSize: "20px", cursor: "pointer", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>-</button>
      </div>
      
      {/* Floor Selector */}
      <div style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", zIndex: 1000, display: "flex", flexDirection: "column", gap: 8 }}>
        {[2, 1, 0, -1].map(lvl => (
          <button key={lvl} onClick={() => setFloor(lvl)} style={{
              width: 44, height: 44, borderRadius: "12px", border: "none", cursor: "pointer",
              background: floor === lvl ? "#2563eb" : "white",
              color: floor === lvl ? "white" : "#1f2937",
              fontWeight: "bold", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", transition: "all 0.2s"
            }}>L{lvl}</button>
        ))}
      </div>

      {/* Navigation Toggle Button */}
      <button 
        onClick={() => setShowPanel(!showPanel)}
        style={{
          position: "absolute", top: 20, left: showPanel ? 350 : 20, zIndex: 1100,
          background: "white", border: "none", borderRadius: "12px", width: 40, height: 40,
          cursor: "pointer", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex", alignItems: "center", justifyContent: "center"
        }}
      >
        {showPanel ? "✕" : "☰"}
      </button>

      {/* Navigation Panel */}
      <div style={{
        position: "absolute", top: 20, left: showPanel ? 20 : -340, zIndex: 1000, width: 320,
        background: "rgba(255, 255, 255, 0.9)", backdropFilter: "blur(12px)",
        borderRadius: "20px", padding: "20px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
        border: "1px solid rgba(255,255,255,0.5)", transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
      }}>
        <h1 style={{ margin: 0, fontSize: "20px", color: "#1e3a8a", fontWeight: 800 }}>GateBuddy</h1>
        <p style={{ margin: "4px 0 20px", fontSize: "12px", color: "#64748b" }}>Amsterdam Schiphol (AMS)</p>

        <div style={{ background: "#f1f5f9", padding: "12px", borderRadius: "12px", marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#94a3b8", marginBottom: "4px" }}>Active Floor</div>
          <div style={{ fontWeight: 600, color: "#1e293b" }}>{FLOOR_NAMES[floor]}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} />
            <div style={{ flex: 1, fontSize: "13px", color: "#475569" }}>{startNode ? startNode.name : "Select Start Point"}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
            <div style={{ flex: 1, fontSize: "13px", color: "#475569" }}>{endNode ? endNode.name : "Select Destination"}</div>
          </div>
        </div>

        {floorChangeNeeded && (
          <div style={{ marginTop: "16px", padding: "12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "20px" }}>{floorChangeNeeded.type === 'elevator' ? '🛗' : '🪜'}</span>
            <div style={{ fontSize: "12px", color: "#92400e" }}>
              Take the <strong>{floorChangeNeeded.type}</strong> to <strong>{FLOOR_NAMES[floorChangeNeeded.targetFloor]}</strong>
            </div>
          </div>
        )}

        {(startNode || endNode) && (
          <button onClick={() => { setStartNode(null); setEndNode(null); setFullPath([]); }} style={{ marginTop: "20px", width: "100%", padding: "10px", borderRadius: "10px", border: "none", background: "#fee2e2", color: "#ef4444", fontWeight: 600, cursor: "pointer" }}>Reset Navigation</button>
        )}
      </div>

      {/* ── Map Layer ────────────────────────────────────────────────────────── */}
      <MapContainer
        center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} minZoom={15} maxZoom={21}
        style={{ height: "100%", width: "100%", background: "#cbd5e1" }} zoomControl={false}
      >
        <MapController setZoom={setZoom} setMap={setMap} />
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={21} />

        {visibleFeatures && (
          <GeoJSON 
            key={`floor-${floor}`} data={visibleFeatures} style={getStyle}
            onEachFeature={(feature, layer) => { layer.bindPopup(`<strong>${feature.properties.name}</strong><br/>${feature.properties.type}`); }}
          />
        )}

        {visibleNodes.map(node => (
          <Marker key={node.nodeId} position={[node.location.coordinates[1], node.location.coordinates[0]]} icon={ICONS[node.type] || ICONS.default}>
            <Popup>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: "bold", marginBottom: "8px" }}>{node.name}</div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setStartNode(node)} style={{ padding: "4px 8px", background: "#10b981", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>Start</button>
                  <button onClick={() => setEndNode(node)} style={{ padding: "4px 8px", background: "#ef4444", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>End</button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {visiblePath.map((seg, idx) => (
          <Polyline key={idx} positions={seg} color="#2563eb" weight={5} dashArray="10, 10" opacity={0.8} />
        )}
      </MapContainer>

      {loading && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ padding: "20px 40px", background: "white", borderRadius: "20px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)", fontWeight: 600, color: "#1e3a8a" }}>Initializing Map...</div>
        </div>
      )}
    </div>
  );
}

