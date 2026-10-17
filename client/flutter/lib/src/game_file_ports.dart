import 'dart:typed_data';
import 'dart:ui';

import 'package:file_picker/file_picker.dart';
import 'package:share_plus/share_plus.dart';

import 'storage/game_file.dart';

export 'package:share_plus/share_plus.dart' show ShareResultStatus;

/// Hand a game file to the OS share sheet, to save it or send it; `origin` is where on the screen
/// the sheet points from, which an iPad needs. Return what the sheet said happened to it.
typedef ShareGameFile = Future<ShareResultStatus> Function(String name, Uint8List bytes, Rect? origin);

/// Open the OS document picker for a game file and read it, or null when the player cancels.
typedef PickGameFile = Future<Uint8List?> Function();

/// The phone's own share sheet (`share_plus`). The plugin writes the bytes into the app's temporary
/// directory under this name and shares them from there, so the file is never in shared storage
/// until the player chooses where it goes.
Future<ShareResultStatus> shareGameFile(String name, Uint8List bytes, Rect? origin) async {
  final result = await SharePlus.instance.share(ShareParams(
    files: [XFile.fromData(bytes, mimeType: 'application/json', name: name)],
    fileNameOverrides: [name],
    subject: 'AI World game',
    sharePositionOrigin: origin,
  ));
  return result.status;
}

/// The phone's own document picker (`file_picker`): the Storage Access Framework on Android and the
/// Files picker on iOS, neither of which needs a permission. Any file may be chosen, because a game
/// file passed through a messenger or a cloud drive may come back with any name or none; what it
/// holds is what `GameFile.decode` judges.
Future<Uint8List?> pickGameFile() async {
  final file = await FilePicker.pickFile(type: FileType.any, dialogTitle: 'Import a game');
  if (file == null) return null;
  final length = file.lengthSync() ?? await file.length();
  if (length != null && length > gameFileLimit) throw const GameFileRefused('This file is too large to be an AI World game.');
  return file.readAsBytes();
}
