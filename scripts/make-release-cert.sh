#!/bin/sh
# Makes the self-signed "Couch Release Signing" certificate that release builds are signed with (see SHIPPING.md).
# Run it once. Keep the folder it writes safe and backed up: installed copies of Couch only accept updates signed
# with this same certificate.
set -e
OUT="${1:-$HOME/couch-release-signing}"
NAME="Couch Release Signing"
if [ -e "$OUT" ]; then
  echo "$OUT already exists; not overwriting it." >&2
  exit 1
fi
OPENSSL=openssl
[ -x /opt/homebrew/bin/openssl ] && OPENSSL=/opt/homebrew/bin/openssl
umask 077
mkdir -p "$OUT"
cd "$OUT"

cat > cert.cnf <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
"$OPENSSL" req -x509 -newkey rsa:3072 -nodes -keyout key.pem -out cert.pem -days 7300 -config cert.cnf
"$OPENSSL" rand -base64 24 > password.txt
# macOS' `security import` can't read OpenSSL 3+'s default .p12 encryption; -legacy uses the kind it reads.
"$OPENSSL" pkcs12 -export -legacy -inkey key.pem -in cert.pem -name "$NAME" -out couch-release.p12 \
  -passout file:password.txt 2>/dev/null ||
  "$OPENSSL" pkcs12 -export -inkey key.pem -in cert.pem -name "$NAME" -out couch-release.p12 \
    -passout file:password.txt
rm cert.cnf

cat <<EOF

Made $OUT:
  couch-release.p12  the certificate and its private key
  password.txt       the .p12's password
  key.pem, cert.pem  the same key and certificate as plain files

Back the folder up somewhere safe (a password manager, an encrypted drive). Never commit it.

Add it to the repo's Actions secrets (needs the GitHub CLI, run from the repo):
  base64 -i "$OUT/couch-release.p12" | gh secret set COUCH_SIGNING_P12
  gh secret set COUCH_SIGNING_P12_PASSWORD --body "\$(cat "$OUT/password.txt")"
EOF
