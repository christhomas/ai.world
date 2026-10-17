import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../shell/ledger_tokens.dart';

/// The map's cells as pixels: the engine's colours and runs (`src/world/map-ground.ts`), row by row.
Uint8List mapPixels(Map<String, dynamic> picture) {
  final size = (picture['size'] as num).toInt();
  final colours = (picture['colours'] as List).cast<num>();
  final runs = (picture['runs'] as List).cast<num>();
  final pixels = Uint8List(size * size * 4);
  var at = 0;
  for (var i = 0; i + 1 < runs.length; i += 2) {
    final colour = colours[runs[i].toInt()].toInt();
    for (var n = runs[i + 1].toInt(); n > 0 && at < pixels.length; n--) {
      pixels[at] = (colour >> 16) & 255;
      pixels[at + 1] = (colour >> 8) & 255;
      pixels[at + 2] = colour & 255;
      pixels[at + 3] = 255;
      at += 4;
    }
  }
  return pixels;
}

/// What the map draws, in the world's own tiles: the picture, the roads, the dark over what has
/// not been walked, the markers and the hero.
class MapPainter extends CustomPainter {
  MapPainter({required this.picture, required this.image, required this.map, required this.walked,
    required this.charted, required this.hero, required this.zoom, this.focus});
  final Map<String, dynamic> picture;
  final ui.Image? image;
  final Map<String, dynamic> map;
  final Set<String> walked, charted;
  final Map<String, dynamic> hero;
  /// How far the reader has zoomed in, so what should stay one size on the glass does.
  final double zoom;
  /// A place the journal asked to be shown, in the world's tiles, ringed.
  final Offset? focus;

  /// The dark over the unknown and how soft its edge is, as the page's map has them (`mapbase.ts`).
  static const fog = Color(0xe0060a1a);
  static const road = Color(0xbf5a4128);

  @override
  void paint(Canvas canvas, Size size) {
    final pad = (picture['pad'] as num).toDouble();
    final k = size.width / (2 * pad);
    Offset at(num x, num z) => Offset((x + pad) * k, (z + pad) * k);
    final whole = Offset.zero & size;
    canvas.drawRect(whole, Paint()..color = const Color(0xff1b4466));
    if (image case final image?) {
      final cells = (picture['size'] as num).toDouble() * (picture['cell'] as num).toDouble() * k;
      canvas.drawImageRect(image, Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
        Rect.fromLTWH(0, 0, cells, cells), Paint()..filterQuality = FilterQuality.low);
    }
    final roads = (picture['roads'] as List? ?? const []).cast<num>();
    final stroke = Paint()..color = road..strokeCap = StrokeCap.round;
    for (var i = 0; i + 4 < roads.length; i += 5) {
      stroke.strokeWidth = math.max(0.8, roads[i + 4] * k);
      canvas.drawLine(at(roads[i], roads[i + 1]), at(roads[i + 2], roads[i + 3]), stroke);
    }
    if (map['fogged'] == true) {
      // the known world as one shape, softened once, so where two chunks meet there is no seam
      final chunk = ((map['chunk'] as num?) ?? 16).toDouble(), province = ((map['province'] as num?) ?? 512).toDouble();
      final known = Path();
      for (final key in walked) {
        final [cx, cz] = key.split(',').map(double.parse).toList();
        known.addRect(Rect.fromPoints(at(cx * chunk, cz * chunk), at((cx + 1) * chunk, (cz + 1) * chunk)));
      }
      for (final corner in charted) {
        final [x, z] = corner.split(',').map(double.parse).toList();
        known.addRect(Rect.fromPoints(at(x, z), at(x + province, z + province)));
      }
      canvas.saveLayer(whole, Paint());
      canvas.drawRect(whole, Paint()..color = fog);
      canvas.drawPath(known, Paint()..blendMode = BlendMode.dstOut..maskFilter = MaskFilter.blur(BlurStyle.normal, 3 * k));
      canvas.restore();
    }
    final dot = Paint();
    final ring = Paint()..style = PaintingStyle.stroke..strokeWidth = 1.5 / zoom;
    for (final raw in (map['markers'] as List? ?? const []).cast<Map>()) {
      final where = at(raw['x'] as num, raw['z'] as num);
      final colour = _css('${raw['color']}');
      final emphasis = raw['emphasis'] == true;
      canvas.drawCircle(where, (emphasis ? 4.5 : 3) / zoom, dot..color = colour);
      if (emphasis) canvas.drawCircle(where, 8 / zoom, ring..color = colour);
      final label = raw['label'] as String?;
      if (label != null && (emphasis || zoom >= 1.5)) {
        final text = TextPainter(textDirection: TextDirection.ltr, text: TextSpan(text: label,
          style: TextStyle(fontSize: 10 / zoom, color: const Color(0xffeef2ff),
            shadows: const [Shadow(color: Color(0xff060916), blurRadius: 2)])))..layout();
        text.paint(canvas, where + Offset(6 / zoom, -text.height / 2));
      }
    }
    if (focus case final focus?) {
      canvas.drawCircle(at(focus.dx, focus.dy), 12 / zoom, Paint()..style = PaintingStyle.stroke..strokeWidth = 2 / zoom
        ..color = const Color(0xffffd479));
    }
    if (hero['x'] is num && hero['z'] is num) {
      // the hero as an arrow the way he faces: a rig's yaw runs the other way to the map's z
      canvas.save();
      canvas.translate(at(hero['x'] as num, hero['z'] as num).dx, at(hero['x'] as num, hero['z'] as num).dy);
      canvas.rotate(-((hero['yaw'] as num?) ?? 0).toDouble());
      final s = 1 / zoom;
      canvas.drawPath(Path()..moveTo(8 * s, 0)..lineTo(-5 * s, 5 * s)..lineTo(-2 * s, 0)..lineTo(-5 * s, -5 * s)..close(),
        Paint()..color = const Color(0xffff4d4d));
      canvas.restore();
    }
  }

  static Color _css(String colour) {
    var hex = colour.startsWith('#') ? colour.substring(1) : 'ffffff';
    if (hex.length == 3) hex = hex.split('').map((d) => '$d$d').join();
    return Color(0xff000000 | (int.tryParse(hex, radix: 16) ?? 0xffffff));
  }

  @override
  bool shouldRepaint(MapPainter oldDelegate) => true;
}

/// A floor's map underground (`src/dungeon/floor-picture.ts`): the cells seen so far, the way in,
/// the chests seen, and the hero, as the page's floor map paints them, at `MapPage.floorTile` a cell.
class FloorPainter extends CustomPainter {
  FloorPainter({required this.floor, required this.image, required this.hero, required this.zoom});
  final Map<String, dynamic> floor;
  final ui.Image? image;
  final Map<String, dynamic> hero;
  final double zoom;

  static Color _rgb(num colour) => Color(0xff000000 | colour.toInt());

  @override
  void paint(Canvas canvas, Size size) {
    final cells = (floor['size'] as num).toDouble();
    final k = size.width / cells;
    canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xff05060c));
    if (image case final image?) {
      canvas.drawImageRect(image, Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
        Offset.zero & size, Paint()..filterQuality = FilterQuality.none);
    }
    Rect mark(num x, num z) => Rect.fromLTWH(x * k - 1, z * k - 1, k + 2, k + 2);
    if (floor['entrance'] case [final num x, final num z]) canvas.drawRect(mark(x, z), Paint()..color = _rgb(0x8fa0ff));
    for (final chest in (floor['chests'] as List? ?? const []).cast<Map>()) {
      canvas.drawRect(mark(chest['x'] as num, chest['z'] as num), Paint()..color = _rgb(chest['colour'] as num));
    }
    if (hero['x'] is num && hero['z'] is num) {
      canvas.drawCircle(Offset((hero['x'] as num) * k, (hero['z'] as num) * k), math.max(2.5 / zoom, k * 0.6),
        Paint()..color = _rgb(0xff4d4d));
    }
  }

  @override
  bool shouldRepaint(FloorPainter oldDelegate) => true;
}

/// The map (#575): the country as the page's map draws it, pannable and zoomable, with the dark
/// taken off what has been walked or charted, the places the game marks, and the hero. A page of
/// the book, so reading it parks the world and no pinch or drag here can steer him. Recentre and
/// zoom are buttons as well as gestures, so they are there at any size. Opened from the journal, it
/// opens on the place asked about, ringed, rather than on the hero.
class MapPage extends StatefulWidget {
  const MapPage({super.key, required this.picture, required this.map, required this.walked,
    required this.charted, required this.hero, required this.tokens, this.floor, this.focus});
  final Map<String, dynamic>? picture;
  /// The floor the hero is on, while he is underground; the map is that floor then, as on the page.
  final Map<String, dynamic>? floor;
  final Map<String, dynamic> map;
  final Set<String> walked, charted;
  final Map<String, dynamic> hero;
  final LedgerTokens tokens;
  /// A place to open on instead of the hero, in the world's tiles: the journal's errand or find.
  final Offset? focus;

  /// Logical pixels to a tile with nothing zoomed.
  static const double tile = 1;
  /// Logical pixels to a floor's cell with nothing zoomed: a floor is a few dozen cells across.
  static const double floorTile = 8;

  @override
  State<MapPage> createState() => _MapPageState();
}

class _MapPageState extends State<MapPage> {
  final _view = TransformationController();
  ui.Image? _image;
  /// The picture being decoded, and the one `_image` was decoded from.
  Map<String, dynamic>? _drawn, _imageOf;
  Size _viewport = Size.zero;
  bool _placed = false;

  @override
  void initState() {
    super.initState();
    _view.addListener(_zoomed);
    _decode();
  }

  @override
  void didUpdateWidget(MapPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    // going underground or coming back up is a different picture, and the hero is found again in it
    if ((widget.floor == null) != (oldWidget.floor == null)) _placed = false;
    if (!identical(_shown, _drawn)) _decode();
  }

  /// What is drawn: the floor while the hero is on one, and the country otherwise.
  Map<String, dynamic>? get _shown => widget.floor ?? widget.picture;

  /// How big the drawing is, in logical pixels before any zoom.
  double _side(Map<String, dynamic> shown) => widget.floor != null
    ? (shown['size'] as num).toDouble() * MapPage.floorTile
    : 2 * (shown['pad'] as num).toDouble() * MapPage.tile;

  /// Where a place in the world is in the drawing.
  Offset _placeIn(Map<String, dynamic> shown, double x, double z) {
    if (widget.floor != null) return Offset(x * MapPage.floorTile, z * MapPage.floorTile);
    final pad = (shown['pad'] as num).toDouble();
    return Offset((x + pad) * MapPage.tile, (z + pad) * MapPage.tile);
  }

  /// Where the hero is in the drawing.
  Offset _heroIn(Map<String, dynamic> shown) =>
    _placeIn(shown, ((widget.hero['x'] as num?) ?? 0).toDouble(), ((widget.hero['z'] as num?) ?? 0).toDouble());

  /// What the journal asked to be shown, on the country's map; underground the floor is the map.
  Offset? get _focus => widget.floor == null ? widget.focus : null;

  void _zoomed() => setState(() {});

  void _decode() {
    final picture = _shown;
    _drawn = picture;
    if (picture == null) return;
    final size = (picture['size'] as num).toInt();
    ui.decodeImageFromPixels(mapPixels(picture), size, size, ui.PixelFormat.rgba8888, (image) {
      if (!mounted || !identical(_drawn, picture)) { image.dispose(); return; }
      setState(() { _image?.dispose(); _image = image; _imageOf = picture; });
    });
  }

  double get _scale => _view.value.getMaxScaleOnAxis();

  /// Put the hero, or a place, in the middle of the glass, at this zoom.
  void _centre([double? scale, Offset? place]) {
    final shown = _shown;
    if (shown == null || _viewport.isEmpty) return;
    final s = scale ?? _scale;
    final middle = place == null ? _heroIn(shown) : _placeIn(shown, place.dx, place.dy);
    _view.value = Matrix4.diagonal3Values(s, s, 1)
      ..setTranslationRaw(_viewport.width / 2 - middle.dx * s, _viewport.height / 2 - middle.dy * s, 0);
  }

  /// Zoom about the middle of the glass, keeping what is there in the middle.
  void _zoom(double by) {
    final middle = _view.toScene(_viewport.center(Offset.zero));
    final s = (_scale * by).clamp(0.25, 8.0);
    _view.value = Matrix4.diagonal3Values(s, s, 1)
      ..setTranslationRaw(_viewport.width / 2 - middle.dx * s, _viewport.height / 2 - middle.dy * s, 0);
  }

  @override
  void dispose() {
    _view.dispose();
    _image?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final picture = _shown;
    final floor = widget.floor;
    Widget button(String label, String semantics, VoidCallback onTap, Key key) => Semantics(button: true, label: semantics,
      excludeSemantics: true, onTap: onTap, child: SizedBox(width: 44, height: 44, child: InkWell(key: key, onTap: onTap,
        child: Center(child: Text(label, style: t.numbers(15, t.pageInk, weight: FontWeight.w600, spacing: 0))))));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: t.rule, width: 2))),
        child: Padding(padding: const EdgeInsets.only(left: 12), child: Row(children: [
          Expanded(child: Text('${widget.map['title'] ?? 'MAP'}'.toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis,
            style: t.numbers(11, t.pageInk, spacing: 1))),
          button('⌖', 'Centre on the hero', () => _centre(), const ValueKey('map-centre')),
          button('−', 'Zoom out', () => _zoom(1 / 1.5), const ValueKey('map-out')),
          button('+', 'Zoom in', () => _zoom(1.5), const ValueKey('map-in')),
        ]))),
      Expanded(child: picture == null
        ? Center(child: Text('The map is being drawn…', style: t.face(14.5, t.pageDim)))
        : LayoutBuilder(builder: (context, box) {
            _viewport = box.biggest;
            if (!_placed) {
              _placed = true;
              WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _centre(floor != null ? 1 : 2, _focus); });
            }
            final side = _side(picture);
            return ClipRect(child: InteractiveViewer(key: const ValueKey('map-view'), transformationController: _view,
              constrained: false, minScale: 0.25, maxScale: 8, boundaryMargin: EdgeInsets.all(side),
              child: SizedBox(width: side, height: side, child: CustomPaint(painter: floor != null
                ? FloorPainter(floor: floor, image: identical(_imageOf, floor) ? _image : null, hero: widget.hero, zoom: _scale)
                : MapPainter(picture: picture, image: identical(_imageOf, picture) ? _image : null,
                    map: widget.map, walked: widget.walked, charted: widget.charted, hero: widget.hero, zoom: _scale,
                    focus: _focus)))));
          })),
    ]);
  }
}
