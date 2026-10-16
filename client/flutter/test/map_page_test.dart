import 'dart:ui' as ui;

import 'package:ai_world_flutter/src/screens/map_page.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A 64-tile country as `src/world/map-ground.ts` sends it: two cells of 32 tiles to a side, sea
/// in the top row and meadow under it, and one road across.
const picture = <String, dynamic>{
  'pad': 32, 'cell': 32, 'size': 2, 'colours': [0x1b4466, 0x6aa84f],
  'runs': [0, 2, 1, 2], 'roads': [-20, 10, 20, 10, 2],
};

void main() {
  test('cells are the colours the runs name, row by row', () {
    final pixels = mapPixels(picture);
    expect(pixels.length, 2 * 2 * 4);
    expect(pixels.sublist(0, 4), [0x1b, 0x44, 0x66, 255]);
    expect(pixels.sublist(12, 16), [0x6a, 0xa8, 0x4f, 255]);
  });

  test('the dark lies over what has not been walked, and is gone from what has', () async {
    final recorder = ui.PictureRecorder();
    MapPainter(picture: picture, image: null, map: const {'fogged': true, 'chunk': 16, 'markers': []},
      walked: {'0,0'}, charted: const {}, hero: const {}, zoom: 1).paint(Canvas(recorder), const Size(64, 64));
    final image = await recorder.endRecording().toImage(64, 64);
    final bytes = (await image.toByteData())!;
    int brightness(int x, int y) {
      final at = (y * 64 + x) * 4;
      return bytes.getUint8(at) + bytes.getUint8(at + 1) + bytes.getUint8(at + 2);
    }
    // chunk 0,0 is the world from (0, 0) to (16, 16): pixels 32 to 48 with the pad of 32
    expect(brightness(40, 40), greaterThan(brightness(8, 8) * 2), reason: 'walked country is clear of the dark');
  });

  testWidgets('opens on the hero, pans by drag, zooms by button, and finds him again', (tester) async {
    await tester.binding.setSurfaceSize(const Size(328, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    Future<void> show(Map<String, dynamic>? drawn) => tester.pumpWidget(MaterialApp(home: Scaffold(body: MapPage(
      picture: drawn, map: const {'title': 'Ashford · day 2', 'fogged': false, 'markers': [
        {'x': 10, 'z': 10, 'color': '#2ecc71', 'label': 'Ashford (errand)', 'emphasis': true},
      ]}, walked: const {}, charted: const {}, hero: const {'x': 5, 'z': -5, 'yaw': 0.5},
      tokens: LedgerTokens.all[LedgerTheme.stone]!))));
    await show(null);
    expect(find.text('The map is being drawn…'), findsOneWidget);
    await show(picture);
    await tester.pumpAndSettle();
    expect(find.text('ASHFORD · DAY 2'), findsOneWidget);
    final view = tester.widget<InteractiveViewer>(find.byKey(const ValueKey('map-view'))).transformationController!;
    final glass = tester.getSize(find.byKey(const ValueKey('map-view')));
    Offset middle() => view.toScene(glass.center(Offset.zero));
    expect(view.value.getMaxScaleOnAxis(), 2);
    expect(middle().dx, closeTo(5 + 32, 0.01), reason: 'the hero is in the middle of the glass');
    expect(middle().dy, closeTo(-5 + 32, 0.01));
    await tester.tap(find.byKey(const ValueKey('map-in')));
    await tester.pump();
    expect(view.value.getMaxScaleOnAxis(), closeTo(3, 0.001));
    expect(middle().dx, closeTo(37, 0.01), reason: 'zooming keeps the middle where it was');
    await tester.drag(find.byKey(const ValueKey('map-view')), const Offset(-60, 40));
    await tester.pumpAndSettle();
    expect(middle().dx, isNot(closeTo(37, 0.5)), reason: 'a drag pans the map');
    await tester.tap(find.byKey(const ValueKey('map-centre')));
    await tester.pump();
    expect(middle().dx, closeTo(37, 0.01));
    expect(middle().dy, closeTo(27, 0.01));
    await tester.tap(find.byKey(const ValueKey('map-out')));
    await tester.pump();
    expect(view.value.getMaxScaleOnAxis(), closeTo(2, 0.001));
  });
}
