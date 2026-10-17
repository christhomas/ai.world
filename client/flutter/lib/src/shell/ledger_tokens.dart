import 'package:flutter/material.dart';

enum LedgerTheme { stone, vellum, steel, hairline }

/// A theme changes five colours and its face, and nothing else: every position, size, gap and hit
/// target is the same in all four, so a new theme cannot break a screen (design/mobile/README.md).
class LedgerTokens {
  const LedgerTokens({required this.surface, required this.rule, required this.ink,
    required this.dim, required this.accent, required this.action, required this.actionInk,
    required this.page, required this.pageInk, required this.pageDim, required this.display});
  final Color surface, rule, ink, dim, accent, action, actionInk, page, pageInk, pageDim;
  /// The theme's display face, bundled in the app (pubspec.yaml). Numbers are always [mono].
  final String display;
  static const mono = 'IBMPlexMono';
  static const double target = 44, spine = 44, book = 372, row = 44, reflex = 62;
  /// Text at the design's sizes, in this theme's faces.
  TextStyle face(double size, Color color, {FontWeight weight = FontWeight.w400, double spacing = 0}) =>
    TextStyle(fontFamily: display, fontSize: size, color: color, fontWeight: weight, letterSpacing: spacing,
      fontVariations: [FontVariation('wght', weight.value.toDouble())]);
  TextStyle numbers(double size, Color color, {FontWeight weight = FontWeight.w400, double spacing = 1}) =>
    TextStyle(fontFamily: mono, fontSize: size, color: color, fontWeight: weight, letterSpacing: spacing,
      fontFeatures: const [FontFeature.tabularFigures()]);
  static const all = <LedgerTheme, LedgerTokens>{
    LedgerTheme.stone: LedgerTokens(surface: Color(0xff060916), rule: Color(0xff343b55), ink: Color(0xffeef2ff), dim: Color(0xffa1aecf), accent: Color(0xffffd76a), action: Color(0xffaaa2ff), actionInk: Color(0xff090c13), page: Color(0xfff6efdc), pageInk: Color(0xff2a2418), pageDim: Color(0xff6b5c40), display: 'SpaceGrotesk'),
    LedgerTheme.vellum: LedgerTokens(surface: Color(0xfff6efdc), rule: Color(0xff8a6a3d), ink: Color(0xff2a2418), dim: Color(0xff6b5c40), accent: Color(0xff725329), action: Color(0xff8a2a14), actionInk: Color(0xfff6efdc), page: Color(0xfff6efdc), pageInk: Color(0xff2a2418), pageDim: Color(0xff6b5c40), display: 'EBGaramond'),
    LedgerTheme.steel: LedgerTokens(surface: Color(0xff1b2230), rule: Color(0xff4d5a6d), ink: Color(0xffe8eef7), dim: Color(0xffa3b1c4), accent: Color(0xff83b2ff), action: Color(0xffa52920), actionInk: Color(0xffffffff), page: Color(0xff151b26), pageInk: Color(0xffe8eef7), pageDim: Color(0xffa3b1c4), display: 'BarlowCondensed'),
    LedgerTheme.hairline: LedgerTokens(surface: Color(0xff04060a), rule: Color(0xffb5b5b5), ink: Color(0xffffffff), dim: Color(0xffb3b3b3), accent: Color(0xffffffff), action: Color(0xffffffff), actionInk: Color(0xff05070c), page: Color(0xfff7f6f2), pageInk: Color(0xff2a2418), pageDim: Color(0xff6b5c40), display: 'IBMPlexMono'),
  };
  static double contrast(Color a, Color b) {
    final x = a.computeLuminance(), y = b.computeLuminance();
    return x > y ? (x + .05) / (y + .05) : (y + .05) / (x + .05);
  }
}
