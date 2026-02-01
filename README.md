# AI World

![Screenshot](ai.world.jpeg)

**[Play Now](https://christhomas.github.io/ai.world)**

A procedurally generated 3D isometric world built entirely in the browser. Explore an organic, sprawling landscape filled with wandering animals and characters.

## About

AI World generates a unique "octopus-style" map each time you play. Starting from a central hub, the world branches outward through winding paths and hidden groves, creating an organic layout that feels natural to explore. The terrain features rolling hills, varied biomes, and mysterious boundaries at the world's edge.

Entities roam the world autonomously - cows graze in meadows, chickens dart about, cats prowl through the grass, and dogs patrol the paths. Click on any creature or character to learn more about them.

## Controls

| Key/Action | Description |
|------------|-------------|
| **W A S D** | Move camera |
| **Mouse Drag** | Pan camera |
| **Q / E** | Rotate camera |
| **Scroll Wheel** | Zoom in/out |
| **Click** | Interact with entities |
| **O** | Open options panel |
| **Escape** | Close dialogs/options |

## Features

- Procedurally generated world with unique layout each session
- Dynamic terrain elevation using noise-based generation
- Animated entities with walk cycles and idle behaviors
- Interactive dialogue system
- Real-time minimap
- Adjustable lighting controls
- Smooth isometric camera with rotation and zoom
- Area naming system (Central Hub, Winding Paths, Hidden Groves, World's Edge)
- Boundary detection with visual warnings

## Technology

### Built With

- **Three.js** (v0.157.0) - 3D rendering engine
- **Vanilla JavaScript** - No frameworks, pure ES6+
- **HTML5 Canvas** - Minimap rendering
- **CSS3** - UI styling and animations

### Architecture

The entire game runs in a single HTML file with embedded JavaScript, making it trivially easy to deploy and share. Key technical aspects:

**Rendering**
- Orthographic camera for true isometric perspective
- PCF soft shadow mapping for realistic shadows
- Three-point lighting system (ambient, directional sun, hemisphere)
- Fog for depth perception and atmosphere

**World Generation**
- Custom "octopus algorithm" creates organic, branching world layouts
- Simplex-style noise function for terrain elevation
- Chunk-based tile system for efficient rendering
- Configurable parameters (tentacle count, branch depth, world size)

**Performance**
- Geometry caching to minimize GPU memory usage
- Shared materials across all meshes
- Efficient entity update loop
- Proper Three.js object disposal

**Entity System**
- Class-based entity management
- Pathfinding with terrain passability checks
- Procedural animation system
- Randomized behaviors and dialogue

### Configuration

The world generation can be customized by modifying the `CONFIG` object:

```javascript
const CONFIG = {
    CHUNK_SIZE: 8,        // Tiles per chunk
    TILE_SIZE: 2,         // World units per tile
    NUM_TENTACLES: 15,    // Main paths from hub
    TENTACLE_LENGTH: 10,  // Path length
    BRANCH_CHANCE: 0.25,  // Branching probability
    MAX_CHUNKS: 300       // World size limit
};
```

## License

MIT
