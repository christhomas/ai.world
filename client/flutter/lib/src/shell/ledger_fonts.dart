import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// The faces bundled for Ledger II (pubspec.yaml), each under the SIL Open Font License 1.1.
const ledgerFaces = ['SpaceGrotesk', 'EBGaramond', 'BarlowCondensed', 'IBMPlexMono'];

/// Each face's licence, from the copy shipped beside it.
Stream<LicenseEntry> ledgerFontLicences({AssetBundle? assets}) async* {
  for (final face in ledgerFaces) {
    yield LicenseEntryWithLineBreaks([face], await (assets ?? rootBundle).loadString('assets/licences/$face-OFL.txt'));
  }
}

/// Put them where Flutter's licence page, and anyone auditing the app, will find them.
void registerLedgerFontLicences() => LicenseRegistry.addLicense(ledgerFontLicences);
