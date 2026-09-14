import 'dart:typed_data';

/// The server-owned description of one 16×16 terrain chunk plus its one-tile apron.
final class ChunkParcel {
  const ChunkParcel({
    required this.cx,
    required this.cz,
    required this.size,
    required this.empty,
    required this.height,
    required this.propRot,
    required this.shore,
    required this.corners,
    required this.water,
    required this.type,
    required this.biome,
    required this.prop,
    required this.sloped,
  });

  static const int wireVersion = 2;
  static const int chunkSize = 16;
  static const int apronSize = chunkSize + 2;
  static const int _headerInts = 5;

  final int cx;
  final int cz;
  final int size;
  final bool empty;
  final Float32List height;
  final Float32List propRot;
  final Float32List shore;
  final Float32List corners;
  final Float32List water;
  final Uint8List type;
  final Uint8List biome;
  final Uint8List prop;
  final Uint8List sloped;

  /// Decodes the exact `packChunk` version-2 wire layout.
  ///
  /// Wire data is untrusted. Unknown versions, wrong dimensions and truncated or
  /// overlong packets return null instead of producing a partial country.
  static ChunkParcel? decode(Uint8List bytes) {
    const headerBytes = _headerInts * 4;
    if (bytes.lengthInBytes < headerBytes) return null;
    final data = ByteData.sublistView(bytes);
    int word(int index) => data.getInt32(index * 4, Endian.little);
    if (word(0) != wireVersion || word(3) != apronSize) return null;

    final size = word(3);
    final tiles = size * size;
    final floatCount = tiles * 8; // height, propRot, shore, corners×4, water
    final expected = headerBytes + floatCount * 4 + tiles * 4;
    if (bytes.lengthInBytes != expected) return null;

    var at = headerBytes;
    Float32List floats(int count) {
      final values = Float32List(count);
      for (var i = 0; i < count; i++) {
        values[i] = data.getFloat32(at + i * 4, Endian.little);
      }
      at += count * 4;
      return values;
    }

    Uint8List narrow(int count) {
      final values = Uint8List.fromList(
        bytes.sublist(bytes.offsetInBytes == 0 ? at : at, at + count),
      );
      at += count;
      return values;
    }

    final height = floats(tiles);
    final propRot = floats(tiles);
    final shore = floats(tiles);
    final corners = floats(tiles * 4);
    final water = floats(tiles);
    final type = narrow(tiles);
    final biome = narrow(tiles);
    final prop = narrow(tiles);
    final sloped = narrow(tiles);
    return ChunkParcel(
      cx: word(1),
      cz: word(2),
      size: size,
      empty: word(4) == 1,
      height: height,
      propRot: propRot,
      shore: shore,
      corners: corners,
      water: water,
      type: type,
      biome: biome,
      prop: prop,
      sloped: sloped,
    );
  }

  int index(int localX, int localZ) => (localZ + 1) * size + localX + 1;
}

enum TileType {
  skip,
  seabed,
  ground,
  groundAlt,
  sand,
  road,
  high,
  water,
  bridge,
  floor,
  plaza,
  pier,
}
