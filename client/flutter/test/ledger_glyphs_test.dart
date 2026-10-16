import 'dart:io';
import 'dart:ui';

import 'package:ai_world_flutter/src/shell/ledger_glyphs.dart';
import 'package:flutter_test/flutter_test.dart';

/// The glyphs are copied from `src/ui/glyphs.ts`, not redrawn: these hold the copy to the source,
/// mark for mark, so the web and the phone keep one set of controls.
void main() {
  final source = File('../../src/ui/glyphs.ts').readAsStringSync();
  Map<String, String> attributes(String tag) => {
    for (final a in RegExp(r'([\w-]+)="([^"]*)"').allMatches(tag)) a.group(1)!: a.group(2)!,
  };

  test('every glyph is the source glyph, part for part', () {
    for (final glyph in LedgerGlyph.values) {
      final body = RegExp("\\b${glyph.name}: svg\\('([^']*)'\\)").firstMatch(source)?.group(1);
      expect(body, isNotNull, reason: '${glyph.name} is not in glyphs.ts');
      final marks = RegExp(r'<(path|rect|circle) ([^>]*)/>').allMatches(body!).toList();
      final copied = ledgerGlyphs[glyph]!;
      expect(copied, hasLength(marks.length), reason: glyph.name);
      for (var i = 0; i < marks.length; i++) {
        final a = attributes(marks[i].group(2)!);
        final part = copied[i];
        final why = '${glyph.name} mark $i';
        expect(part.filled, a['fill'] == 'currentColor', reason: why);
        expect(part.strokeWidth, double.parse(a['stroke-width'] ?? '2'), reason: why);
        switch (marks[i].group(1)) {
          case 'path':
            expect((part as GlyphPath).d, a['d'], reason: why);
          case 'rect':
            final rect = part as GlyphRect;
            expect([rect.x, rect.y, rect.width, rect.height, rect.radius],
              ['x', 'y', 'width', 'height', 'rx'].map((k) => double.parse(a[k]!)).toList(), reason: why);
          case 'circle':
            final circle = part as GlyphCircle;
            expect([circle.cx, circle.cy, circle.r], ['cx', 'cy', 'r'].map((k) => double.parse(a[k]!)).toList(), reason: why);
        }
      }
    }
  });

  test('the path reader draws every glyph on its grid, where the source puts it', () {
    for (final glyph in LedgerGlyph.values) {
      final bounds = glyphBounds(glyph);
      expect(bounds.isEmpty, isFalse, reason: glyph.name);
      expect(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= 24 && bounds.bottom <= 24, isTrue,
        reason: '${glyph.name} at $bounds');
    }
    expect(glyphBounds(LedgerGlyph.close), const Rect.fromLTRB(6.5, 6.5, 17.5, 17.5));
    // relative moves and implicit lines: the bow's arrowhead is m14.5 8.5 then two relative pairs
    expect(parseSvgPath('m14.5 8.5 4 3.5-4 3.5').getBounds(), const Rect.fromLTRB(14.5, 8.5, 18.5, 15.5));
    // an arc lands where it says, and the pack's handle rises above its body
    final handle = parseSvgPath('M10 7V5.6a2 2 0 0 1 4 0V7').getBounds();
    expect(handle.right, closeTo(14, 1e-6));
    expect(handle.top, lessThan(5.6));
    expect(() => parseSvgPath('M1 2 Q3 4 5 6'), throwsFormatException);
  });
}
