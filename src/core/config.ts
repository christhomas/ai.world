/** Tunables. Anything a designer would want to twiddle lives here. */

export const WORLD = {
  CHUNK_SIZE: 16,     // tiles per chunk side
  TILE: 1,            // world units per tile
  STEP: 0.5,          // world units per terrace level
  WATER_Y: 0.28,      // water surface height (seabed is level 0 at y=0, lowest land is level 1 at y=0.5)
  SEABED_RANGE: 12,   // tiles of seabed drawn beyond the coast before we stop drawing floor
  VIEW_RADIUS: 5,     // chunks kept loaded around the camera
  UNLOAD_RADIUS: 7,   // chunks beyond this get disposed
  MAX_LEVEL: 14,
} as const;

export const GRAPH = {
  RADIUS: 480,            // world radius in tiles
  ATTRACTOR_SPACING: 16,  // jittered grid spacing for growth targets; smaller = denser roads
  INFLUENCE: 52,          // attractor pulls nearest node within this range
  KILL: 12,               // attractor satisfied when a node is this close
  STEP: 7,                // road segment length per growth step
  MAX_ITER: 800,
  LOOP_DIST: 20,          // connect nearby unrelated nodes within this distance
  LOOP_CHANCE: 0.3,
  HUB_RADIUS: 34,         // flat plains clearing around the origin
  MIN_WIDTH: 5,           // land half-width along a twig
  MAX_WIDTH: 22,          // land half-width along the trunk
  TOWNS: 9,               // secondary hubs, each grows its own local road web
  TOWN_SPACING: 120,
  TOWN_RADIUS: 36,        // radius of the local web
  TOWN_ATTRACTOR_SPACING: 9,
  TOWN_LAND_WIDTH: 14,    // land half-width guaranteed around towns
} as const;

export const HYDRO = {
  RIVERS: 26,              // river sources attempted per world
  LAKES: 16,               // standalone lakes attempted per world
  SOURCE_SPACING: 45,     // min distance between river sources
  RIVER_STEP: 5,          // polyline segment length
  RIVER_MAX_STEPS: 120,
  RIVER_MIN_NODES: 6,     // shorter attempts are discarded
  CROSS_CHANCE: 0.06,     // per step chance the river swaps sides of the road (= a bridge)
  RIVER_MIN_WIDTH: 1.1,   // half-width at the source
  RIVER_MAX_WIDTH: 2.6,   // half-width near the mouth
  MERGE_DIST: 6,          // river stops (and pools) when this close to other water
  BANK: 1.4,              // width of the flat bank ring around water
} as const;

export const CAMERA = {
  SPEED: 24,        // world units per second
  ROT_SPEED: 1.7,   // radians per second
  MIN_ZOOM: 14,
  MAX_ZOOM: 72,
  START_ZOOM: 30,
  HEIGHT: 70,
  DIST: 70,
  DRAG_SPEED: 0.05,
} as const;
