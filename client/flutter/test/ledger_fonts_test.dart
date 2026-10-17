import 'dart:io';

import 'package:ai_world_flutter/src/shell/ledger_fonts.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter_test/flutter_test.dart';

/// The interface reads the same offline: every face a theme names ships in the app with its licence.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('every theme face and the number face are bundled, with their licences', () async {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final faces = {...LedgerTokens.all.values.map((t) => t.display), LedgerTokens.mono};
    expect(faces, unorderedEquals(ledgerFaces));
    for (final face in faces) {
      expect(pubspec, contains('- family: $face'), reason: face);
      expect(File('assets/licences/$face-OFL.txt').readAsStringSync(), contains('SIL OPEN FONT LICENSE'), reason: face);
    }
    for (final asset in RegExp(r'- asset: (assets/fonts/\S+)').allMatches(pubspec).map((m) => m.group(1)!)) {
      final bytes = File(asset).readAsBytesSync();
      // a TrueType file begins 0x00010000; anything else is not the font it claims to be
      expect(bytes.sublist(0, 4), [0, 1, 0, 0], reason: asset);
    }
  });

  test('each face has its licence entry, read from the copy shipped with it', () async {
    final named = <String>{};
    await for (final entry in ledgerFontLicences()) {
      named.addAll(entry.packages);
      expect(entry.paragraphs.map((p) => p.text).join(' '), contains('SIL OPEN FONT LICENSE'));
    }
    expect(named, unorderedEquals(ledgerFaces));
  });
}
