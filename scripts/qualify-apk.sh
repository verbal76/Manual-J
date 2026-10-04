#!/usr/bin/env bash
# Inspects the ACTUAL built APK (never the source) and fails if it violates the release rules.
# Usage: scripts/qualify-apk.sh <apk> [expected-versionCode]
# Env:   EXPECT_DEBUGGABLE=true|false (default true)   ALLOWED_EXTRA_PERMS="a b" (space separated, optional)
set -u
APK="${1:?apk path}"; WANT_VC="${2:-}"
EXPECT_PKG="com.hotatticgames.manualj"; EXPECT_MIN=23; EXPECT_TARGET=36; EXPECT_COMPILE=36
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1); fails=0
fail() { echo "QUALIFY FAIL: $*"; fails=$((fails+1)); }
ok()   { echo "QUALIFY ok:   $*"; }
echo "== APK: $APK ($(stat -c %s "$APK") bytes) sha256 $(sha256sum "$APK" | cut -d' ' -f1)"
BADGE=$("$BT/aapt2" dump badging "$APK")
pkg=$(echo "$BADGE" | sed -n "s/^package: name='\([^']*\)'.*/\1/p"); vc=$(echo "$BADGE" | sed -n "s/^package:.* versionCode='\([^']*\)'.*/\1/p"); vn=$(echo "$BADGE" | sed -n "s/^package:.* versionName='\([^']*\)'.*/\1/p")
min=$(echo "$BADGE" | sed -n "s/^minSdkVersion:'\([0-9]*\)'.*/\1/p"); tgt=$(echo "$BADGE" | sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p"); comp=$(echo "$BADGE" | sed -n "s/.*compileSdkVersion='\([0-9]*\)'.*/\1/p")
echo "package=$pkg versionName=$vn versionCode=$vc minSdk=$min targetSdk=$tgt compileSdk=$comp"
[ "$pkg" = "$EXPECT_PKG" ] && ok "package $pkg" || fail "package is '$pkg', expected $EXPECT_PKG"
[ "$min" = "$EXPECT_MIN" ] && ok "minSdk $min" || fail "minSdk $min != $EXPECT_MIN"
[ "$tgt" = "$EXPECT_TARGET" ] && ok "targetSdk $tgt (Play requires 36)" || fail "targetSdk $tgt != $EXPECT_TARGET"
[ "$comp" = "$EXPECT_COMPILE" ] && ok "compileSdk $comp" || fail "compileSdk $comp != $EXPECT_COMPILE"
[ -z "$WANT_VC" ] || { [ "$vc" = "$WANT_VC" ] && ok "versionCode $vc" || fail "versionCode $vc != $WANT_VC"; }
# permissions: allowlist only
ALLOW="android.permission.INTERNET android.permission.WAKE_LOCK android.permission.ACCESS_NETWORK_STATE $EXPECT_PKG.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION ${ALLOWED_EXTRA_PERMS:-}"
for perm in $(echo "$BADGE" | sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p"); do case " $ALLOW " in *" $perm "*) ok "permission $perm";; *) fail "unexpected permission $perm";; esac; done
# signature
"$BT/apksigner" verify --print-certs "$APK" > /tmp/apksigner.out 2>&1 && ok "signature verifies ($(grep -m1 'SHA-256' /tmp/apksigner.out | awk '{print $NF}'))" || { fail "apksigner verify failed"; cat /tmp/apksigner.out | head -5; }
# debuggable flag
dbg=$("$BT/aapt2" dump xmltree --file AndroidManifest.xml "$APK" | grep -c 'debuggable.*=true')
if [ "${EXPECT_DEBUGGABLE:-true}" = "true" ]; then [ "$dbg" -ge 1 ] && ok "debuggable (debug build)" || fail "debug build is not debuggable"; else [ "$dbg" -eq 0 ] && ok "not debuggable" || fail "release build is debuggable"; fi
# native libraries + 16 KB
if unzip -Z1 "$APK" | grep -q '^lib/.*\.so$'; then echo "native libs:"; unzip -Z1 "$APK" | grep '^lib/.*\.so$'; "$BT/zipalign" -c -P 16 -v 4 "$APK" >/dev/null 2>&1 && ok "native libs 16 KB aligned" || fail "native libs not 16 KB aligned"; else ok "no native libraries (16 KB ELF check not applicable)"; fi
"$BT/zipalign" -c -P 16 -v 4 "$APK" >/dev/null 2>&1 && ok "zipalign 4-byte + 16 KB page check" || fail "zipalign check failed"
# canonical splash packaged byte-for-byte (derived lossless asset) and referenced by the shipped index.html
want=$(sha256sum src/assets/hag-splash.webp | cut -d' ' -f1)
entry=$(unzip -Z1 "$APK" | grep -E '^assets/public/assets/hag-splash-.*\.webp$' | head -1)
if [ -z "$entry" ]; then fail "splash asset not packaged in the APK"; else got=$(unzip -p "$APK" "$entry" | sha256sum | cut -d' ' -f1); [ "$got" = "$want" ] && ok "splash asset packaged ($entry) matches repository asset" || fail "packaged splash differs from src/assets/hag-splash.webp"; fi
unzip -p "$APK" assets/public/index.html | grep -q "hag-splash" && ok "shipped index.html references the splash asset" || fail "shipped index.html does not reference the splash asset"
unzip -p "$APK" assets/public/index.html | grep -q "id=\"hag-splash\"" && ok "studio card markup present at first paint" || fail "studio card markup missing"
# launcher icon: adaptive + monochrome + all densities
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do unzip -Z1 "$APK" | grep -q "mipmap-$d.*/ic_launcher_foreground.png" || fail "missing adaptive foreground for $d"; done
unzip -Z1 "$APK" | grep -c "ic_launcher_monochrome.png" | grep -q '^[5-9]\|^[1-9][0-9]' && ok "monochrome icon layers packaged" || fail "monochrome icon layers missing"
"$BT/aapt2" dump xmltree --file res/mipmap-anydpi-v26/ic_launcher.xml "$APK" 2>/dev/null | grep -q "monochrome" && ok "adaptive icon declares monochrome" || fail "adaptive icon XML lacks monochrome"
echo "$BADGE" | grep -q "^application-icon-" && ok "application icon declared" || fail "no application icon"
[ "$fails" -eq 0 ] && echo "QUALIFY RESULT: PASS" || { echo "QUALIFY RESULT: FAIL ($fails problem(s))"; exit 1; }
