# Vendored licence texts

Licence texts that Homebrew's kegs don't ship in full. `vp run package` copies each formula's folder into `Couch.app/Contents/Resources/licenses/<formula>/`, next to the files from the keg, and fails if a file listed in `REQUIRED_LICENCE_FILES` (`scripts/lib/licences.mts`) is missing.

Each file is the exact text from the formula's source archive at the version bundled (the archive's sha256 matches the formula's).

| Formula          | File                   | Why the keg isn't enough                                                                                 | Taken from                                                                                                                                                              |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| freetype 2.15.0  | `FTL.TXT`, `GPLv2.TXT` | the keg's `LICENSE.TXT` only says the terms are in `docs/FTL.TXT` (FreeType License) or `docs/GPLv2.TXT` | `docs/` of `freetype-2.15.0.tar.xz` (https://downloads.sourceforge.net/project/freetype/freetype2/2.15.0/freetype-2.15.0.tar.xz, sha256 93cd47eb…1dd5)                  |
| lz4 1.10.0       | `LICENSE-lib`          | the keg's `LICENSE` says the `lib` directory (what Couch ships) is BSD 2-Clause, without the text        | `lib/LICENSE` of `v1.10.0.tar.gz` (https://github.com/lz4/lz4/archive/refs/tags/v1.10.0.tar.gz, sha256 53751290…5f48b)                                                  |
| jpeg-turbo 3.2.0 | `README.ijg`           | the keg's `LICENSE.md` points to `README.ijg` for the IJG licence                                        | `README.ijg` of `libjpeg-turbo-3.2.0.tar.gz` (https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.2.0/libjpeg-turbo-3.2.0.tar.gz, sha256 6f30092c…9878e) |
| gettext 1.0      | `COPYING.LIB`          | the keg's `COPYING` is the GPL-3.0 for the tools; the bundled `libintl` is LGPL-2.1-or-later             | `gettext-runtime/intl/COPYING.LIB` of `gettext-1.0.tar.gz` (https://ftpmirror.gnu.org/gnu/gettext/gettext-1.0.tar.gz, sha256 85d99b79…974f1a)                           |

pcre2 needs no vendored file: its keg's `COPYING` points to `LICENCE`, and the keg ships it as `LICENCE.md`; that file is only required to be present.
