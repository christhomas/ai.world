import 'dart:math' as math;
import 'dart:typed_data';

import 'chunk_parcel.dart';

/// Interleaved native vertex: position, normal, linear colour, material,
/// animation joint and animation pivot.
final class RenderMesh {
  const RenderMesh({required this.id, required this.vertices, required this.indices});

  static const int floatsPerVertex = 14;
  static const double terrainMaterial = 0;
  static const double cuttableMaterial = 1;
  static const double waterMaterial = 2;

  final String id;
  final Float32List vertices;
  final Int32List indices;

  int get vertexCount => vertices.length ~/ floatsPerVertex;
}

final class ChunkMeshes {
  const ChunkMeshes({this.land, this.water});
  final RenderMesh? land;
  final RenderMesh? water;
}

final class _Palette {
  const _Palette(this.ground, this.groundAlt, this.cliff, this.road, this.sand, this.high);
  final int ground, groundAlt, cliff, road, sand, high;
}

const _palettes = <_Palette>[
  _Palette(0x72b04c, 0x80bc58, 0x8b6b4a, 0xc7a56b, 0xdcc78e, 0x9a9a8a),
  _Palette(0x3f8c3a, 0x377d33, 0x6b5238, 0x9c7d55, 0xc9b98a, 0x7f8a70),
  _Palette(0xe2c688, 0xd8b975, 0xb3895a, 0xbf9d63, 0xe8d39a, 0xc4a274),
  _Palette(0x5f7d3f, 0x536f3a, 0x5a4a3a, 0x8a7a5a, 0x8f8a62, 0x6f7a60),
  _Palette(0x7f9468, 0x8ba072, 0x6e6e6e, 0xa39a86, 0xa8a48f, 0x8f8f8f),
  _Palette(0xeef2f5, 0xdfe6ec, 0x9aa5b0, 0xc9cfd6, 0xd5dde3, 0xffffff),
];

final class _MeshBuilder {
  final List<double> vertices = <double>[];
  final List<int> indices = <int>[];

  void quad(
    List<double> a,
    List<double> b,
    List<double> c,
    List<double> d,
    List<double> normal,
    List<double> color,
    double material,
  ) {
    final ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
    final bx = c[0] - a[0], by = c[1] - a[1], bz = c[2] - a[2];
    final crossX = ay * bz - az * by;
    final crossY = az * bx - ax * bz;
    final crossZ = ax * by - ay * bx;
    final flipped = crossX * normal[0] + crossY * normal[1] + crossZ * normal[2] < 0;
    final base = vertices.length ~/ RenderMesh.floatsPerVertex;
    for (final point in <List<double>>[a, b, c, d]) {
      vertices.addAll(<double>[
        ...point,
        ...normal,
        ...color,
        material,
        0, // no rig joint
        0, 0, 0, // no pivot
      ]);
    }
    indices.addAll(flipped
        ? <int>[base, base + 3, base + 2, base, base + 2, base + 1]
        : <int>[base, base + 1, base + 2, base, base + 2, base + 3]);
  }

  RenderMesh? finish(String id) => indices.isEmpty
      ? null
      : RenderMesh(
          id: id,
          vertices: Float32List.fromList(vertices),
          indices: Int32List.fromList(indices),
        );
}

final class _Side {
  const _Side(this.dx, this.dz, this.mineA, this.mineB, this.theirA, this.theirB,
      this.ax, this.az, this.bx, this.bz, this.nx, this.nz);
  final int dx, dz, mineA, mineB, theirA, theirB;
  final double ax, az, bx, bz, nx, nz;
}

const _sides = <_Side>[
  _Side(1, 0, 1, 2, 0, 3, 1, 0, 1, 1, 1, 0),
  _Side(-1, 0, 0, 3, 1, 2, 0, 0, 0, 1, -1, 0),
  _Side(0, 1, 3, 2, 0, 1, 0, 1, 1, 1, 0, 1),
  _Side(0, -1, 0, 1, 3, 2, 0, 0, 1, 0, 0, -1),
];

/// Turns server parcels directly into flat-shaded, vertex-coloured country.
/// The apron is used for cliff and waterfall seams but never rendered itself.
final class ChunkMesher {
  const ChunkMesher();

  ChunkMeshes build(ChunkParcel chunk, {required int seed}) {
    if (chunk.empty) return const ChunkMeshes();
    final land = _MeshBuilder(), water = _MeshBuilder();
    final originX = chunk.cx * ChunkParcel.chunkSize;
    final originZ = chunk.cz * ChunkParcel.chunkSize;

    for (var z = 0; z < ChunkParcel.chunkSize; z++) {
      for (var x = 0; x < ChunkParcel.chunkSize; x++) {
        final i = chunk.index(x, z);
        final kind = chunk.type[i];
        if (kind == TileType.skip.index) continue;
        final palette = _palettes[chunk.biome[i].clamp(0, _palettes.length - 1)];
        final wx = (originX + x).toDouble(), wz = (originZ + z).toDouble();
        final shade = 0.94 + _hash01(seed, originX + x, originZ + z) * 0.12;
        final top = _linear(_topHex(kind, palette)).map((v) => v * shade).toList(growable: false);
        final corners = _corners(chunk, x, z);
        final normal = (chunk.sloped[i] == 1 || kind == TileType.road.index || kind == TileType.bridge.index)
            ? _slopeNormal(corners)
            : const <double>[0, 1, 0];
        land.quad(
          <double>[wx, corners[0], wz],
          <double>[wx, corners[3], wz + 1],
          <double>[wx + 1, corners[2], wz + 1],
          <double>[wx + 1, corners[1], wz],
          normal, top, RenderMesh.terrainMaterial,
        );

        final bridge = kind == TileType.bridge.index || kind == TileType.pier.index;
        final cliff = _linear(bridge ? 0x6e4a2a : palette.cliff);
        for (final side in _sides) {
          final neighbour = _corners(chunk, x + side.dx, z + side.dz);
          final a = corners[side.mineA], b = corners[side.mineB];
          final na = neighbour[side.theirA], nb = neighbour[side.theirB];
          if (na >= a - 0.001 && nb >= b - 0.001) continue;
          final lip = math.max(a - na, b - nb) <= 0.3 && !bridge;
          final color = lip ? top.map((v) => v * 0.8).toList(growable: false) : cliff;
          land.quad(
            <double>[wx + side.ax, math.min(na, a), wz + side.az],
            <double>[wx + side.bx, math.min(nb, b), wz + side.bz],
            <double>[wx + side.bx, b, wz + side.bz],
            <double>[wx + side.ax, a, wz + side.az],
            <double>[side.nx, 0, side.nz], color, RenderMesh.terrainMaterial,
          );
        }

        final surface = chunk.water[i];
        if (surface <= 0) continue;
        if (surface > 0.281) {
          water.quad(
            <double>[wx, surface, wz], <double>[wx, surface, wz + 1],
            <double>[wx + 1, surface, wz + 1], <double>[wx + 1, surface, wz],
            const <double>[0, 1, 0], _linear(0x3fa3da), RenderMesh.waterMaterial,
          );
        }
        for (final side in _sides) {
          final neighbourSurface = _surface(chunk, x + side.dx, z + side.dz);
          if (neighbourSurface < 0 || neighbourSurface >= surface - 0.01) continue;
          final ox = side.nx * 0.02, oz = side.nz * 0.02;
          water.quad(
            <double>[wx + side.ax + ox, neighbourSurface, wz + side.az + oz],
            <double>[wx + side.bx + ox, neighbourSurface, wz + side.bz + oz],
            <double>[wx + side.bx + ox, surface, wz + side.bz + oz],
            <double>[wx + side.ax + ox, surface, wz + side.az + oz],
            <double>[side.nx, 0, side.nz], _linear(0xd9f0fb), RenderMesh.waterMaterial,
          );
        }
      }
    }
    return ChunkMeshes(
      land: land.finish('chunk:${chunk.cx},${chunk.cz}:land'),
      water: water.finish('chunk:${chunk.cx},${chunk.cz}:water'),
    );
  }

  static List<double> _corners(ChunkParcel chunk, int x, int z) {
    final i = chunk.index(x, z);
    if (chunk.type[i] == TileType.skip.index) return const <double>[0, 0, 0, 0];
    return List<double>.generate(4, (k) => chunk.corners[i * 4 + k], growable: false);
  }

  static double _surface(ChunkParcel chunk, int x, int z) {
    final i = chunk.index(x, z), kind = chunk.type[i];
    if (kind == TileType.water.index || kind == TileType.bridge.index) return chunk.water[i];
    if (kind == TileType.seabed.index || kind == TileType.skip.index) return 0.28;
    return -1;
  }

  static List<double> _slopeNormal(List<double> h) {
    final dx = (h[1] + h[2] - h[0] - h[3]) * 0.5;
    final dz = (h[2] + h[3] - h[0] - h[1]) * 0.5;
    final length = math.sqrt(dx * dx + 1 + dz * dz);
    return <double>[-dx / length, 1 / length, -dz / length];
  }

  static int _topHex(int kind, _Palette p) => switch (kind) {
        1 || 4 || 7 => p.sand,
        3 => p.groundAlt,
        5 => p.road,
        6 => p.high,
        8 => 0x9a6a3d,
        9 => 0x8a7a62,
        10 => 0xbfb096,
        11 => 0x9a6a3d,
        _ => p.ground,
      };

  static List<double> _linear(int hex) {
    double channel(int bits) {
      final value = bits / 255;
      return value <= 0.04045 ? value / 12.92 : math.pow((value + 0.055) / 1.055, 2.4).toDouble();
    }
    return <double>[channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255)];
  }

  static double _hash01(int seed, int x, int z) {
    var h = seed ^ (x * 0x27d4eb2d) ^ (z * 0x165667b1);
    h = ((h ^ (h >> 15)) * 0x85ebca6b) & 0xffffffff;
    return (h & 0xffff) / 65535;
  }
}
