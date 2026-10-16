// Default colors per space type. Override any of them with the `colors` option.

export const TYPE_COLORS = {
  office: "#7aa6d8",
  room: "#9db8d2",
  meeting_room: "#b39ddb",
  corridor: "#e9e5da",
  lobby: "#f2d388",
  elevator: "#e07a5f",
  stairs: "#e8a15c",
  escalator: "#d4876a",
  ramp: "#c9a26b",
  restroom: "#81c7c0",
  kitchen: "#a5d6a7",
  storage: "#bcaaa4",
  utility: "#a3a3ab",
  shaft: "#86868e",
  open_area: "#a8d4f7",
  bedroom: "#8fb3e8",
  living_room: "#f0b67f",
  dining_room: "#e6c27a",
  bathroom: "#7fc6d6",
  dressing_room: "#c9b2d9",
  laundry: "#9cc9b4",
  prayer_room: "#d4b8e0",
  parking: "#c4c4bc",
  balcony: "#b7d9a8",
  terrace: "#cfe3b0",
  roof: "#c9cfd6", // (format 0.11) a roof's open deck
  open_to_below: "#f4f4f2",
  // (format 0.12) a location's land's areas: paving, asphalt, grass and water
  yard: "#ddd6c8", // paved ground round the buildings
  path: "#d6c8ae",
  courtyard: "#e4dccb",
  gate_area: "#cdc3b0",
  driveway: "#a9acb0", // asphalt, as the road and parking
  road: "#8f9399",
  garden: "#8fc27a", // grass
  pool: "#5fb3e3", // water
  unspecified: "#ff4d6d",
};

// Circulation and open-air areas are drawn as floor, not as raised blocks; so is a
// location's land (format 0.12).
export const FLAT_TYPES = ["corridor", "lobby", "open_area", "parking", "balcony", "terrace", "open_to_below", "roof",
  "yard", "path", "courtyard", "gate_area", "driveway", "road", "garden", "pool"];

export function typeLabel(type) {
  return type === "unspecified" ? "needs review" : type.replaceAll("_", " ");
}
